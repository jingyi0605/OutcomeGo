import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  BrowserWindow,
  Menu,
  ipcMain,
  screen,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import {
  DEFAULT_BOT_DOCK_SETTINGS,
  botDockOpenTarget,
  clampDockSize,
  BOT_DOCK_SNOOZES,
  clampToWorkArea,
  defaultDockPosition,
  dockAnchorFor,
  isRecord,
  isSnoozed,
  parseBotDockAttachments,
  parseBotDockMessage,
  parseBotDockSettings,
  parseBotDockState,
  placeDockComposer,
  resizeDock,
  resizeDockFromCenter,
  snoozeDeadline,
  type BotDockAttachment,
  type BotDockMessage,
  type BotDockSettings,
  type BotDockSnooze,
  type BotDockState,
  type DockRect,
} from "./bot-dock-model";

import { GlobalDragDetector } from "./bot-dock-global-drag";

const DRAG_INTERVAL_MS = 8;
/** A drag whose release never arrives (the page died mid-gesture) must not follow the cursor forever. */
const DRAG_MAX_MS = 30_000;
const SAVE_DEBOUNCE_MS = 300;
const DRAG_HANDOFF_MS = 80;
const MAX_CRASH_RESTARTS = 3;
/** The main window answers a delivery within this, or the composer reports a failure. */
const DELIVERY_TIMEOUT_MS = 20_000;
/** A snooze is checked at least this often, so one that ended during sleep ends promptly. */
const SNOOZE_CHECK_MS = 30_000;

export interface BotDockSendResult {
  ok: boolean;
  /** No answer came (timeout, or the signed-in window went away): it may still have acted. */
  unanswered?: boolean;
}
/** Placeholder size until the page reports its real one; the window stays hidden until then. */
const INITIAL_SIZE = { width: 96, height: 64 };

export interface DesktopBotDockOptions {
  preloadPath: string;
  dragHelperPath: string | null;
  /** JSON file holding whether the dock is on and where the person left it. */
  settingsPath: string;
  /** Loads the dock page: the Vite server in development, the bundle otherwise. */
  loadPage: (window: BrowserWindow, surface: "dock" | "invitation" | "composer") => Promise<void>;
  mainWindow: () => BrowserWindow | null;
  /** Brings the main window forward without changing what it shows. */
  focusMainWindow: () => void;
  /** Opens a Bot's chat at its newest message, as a notification click does. */
  openChat: (channelId: string) => void;
  openGoals: () => void;
  locale: () => "en-US" | "zh-CN";
  /** Writes a pasted or dropped file into the durable-send staging area, so its bytes never cross to a
   * renderer again: the chat window only gets a reference. */
  stageDelivery: (stagingId: string, bytes: Uint8Array) => Promise<void>;
  discardDelivery: (stagingId: string) => Promise<void>;
  /** The dock was switched on or off (so the application menu can reflect it). */
  onEnabledChange: () => void;
}

const contextMenuText = (locale: "en-US" | "zh-CN") =>
  locale === "zh-CN"
    ? {
        open: "打开 OutcomeGo",
        snooze: {
          "5m": "隐藏 5 分钟",
          "30m": "隐藏 30 分钟",
          "1h": "隐藏 60 分钟",
          today: "今天隐藏",
        } satisfies Record<BotDockSnooze, string>,
        off: "关闭机器人浮窗",
      }
    : {
        open: "Open OutcomeGo",
        snooze: {
          "5m": "Hide for 5 Minutes",
          "30m": "Hide for 30 Minutes",
          "1h": "Hide for 60 Minutes",
          today: "Hide for Today",
        } satisfies Record<BotDockSnooze, string>,
        off: "Turn Off Bot Floating Window",
      };

/**
 * The Bot floating window: a small always-on-top capsule that shows which Bots have unread
 * messages (red badge) or goals waiting on the owner (yellow badge). It has no account of its
 * own: the signed-in main window publishes what to show, and a click only asks main to open
 * the chat or goals there. Works on macOS (a non-activating panel) and Windows (a toolbar
 * window), where clicking it does not take focus from the app being used.
 */
export class DesktopBotDock {
  private window: BrowserWindow | null = null;
  private invitationWindow: BrowserWindow | null = null;
  private invitationSize: { width: number; height: number } | null = null;
  private composerWindow: BrowserWindow | null = null;
  private composerSize: { width: number; height: number } | null = null;
  private composerPainted = false;
  private pendingDrop: { files: BotDockAttachment[]; rejected: boolean } | null = null;
  private settings: BotDockSettings;
  private state: BotDockState | null = null;
  private compactBounds: DockRect | null = null;
  private disposed = false;
  private crashes = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private drag: {
    timer: ReturnType<typeof setInterval>;
    stop: ReturnType<typeof setTimeout>;
    offsetX: number;
    offsetY: number;
  } | null = null;
  private composerOpen = false;
  private get expanded() {
    return this.composerOpen || this.invitationWindow?.isVisible();
  }
  private readonly globalDragDetector: GlobalDragDetector | null;
  private globalDragActive = false;
  private mainWindowDragActive = false;
  private readonly fileHover = new Set<Electron.WebContents>();
  private dragHandoff: ReturnType<typeof setTimeout> | null = null;
  private snoozeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deliveries = new Map<string, (result: BotDockSendResult) => void>();
  private readonly cleanups: Array<() => void> = [];
  private readonly onDisplayChange = () => this.reclamp();
  private watchingDisplays = false;

  constructor(private readonly options: DesktopBotDockOptions) {
    const settings = this.readSettings();
    // A snooze that ended while the app was closed is over.
    this.settings = isSnoozed(settings, Date.now()) ? settings : { ...settings, hiddenUntil: null };
    this.armSnooze();
    this.globalDragDetector = options.dragHelperPath
      ? new GlobalDragDetector(options.dragHelperPath, (dragging) => {
          this.globalDragActive = dragging;
          if (!dragging) {
            this.mainWindowDragActive = false;
            this.fileHover.clear();
          }
          this.updateInvitation();
        })
      : null;

    const listen = <Args extends unknown[]>(
      channel: string,
      listener: (event: IpcMainEvent, ...args: Args) => void
    ) => {
      ipcMain.on(channel, listener);
      this.cleanups.push(() => ipcMain.removeListener(channel, listener));
    };
    const handle = (
      channel: string,
      listener: (event: IpcMainInvokeEvent, value: unknown) => unknown
    ) => {
      ipcMain.handle(channel, listener);
      this.cleanups.push(() => ipcMain.removeHandler(channel));
    };
    // Only the signed-in main window may say what the dock shows.
    listen("outcomego:botdock:state", (event, value: unknown) => {
      if (event.sender !== this.options.mainWindow()?.webContents) return;
      const parsed = parseBotDockState(value);
      if (parsed !== undefined) this.setState(parsed);
    });
    // Main window detected a file drag: notify the dock to grow.
    listen("outcomego:botdock:drag-hint", (event, value: unknown) => {
      if (event.sender !== this.options.mainWindow()?.webContents) return;
      this.mainWindowDragActive = value === true;
      this.updateInvitation();
    });
    handle("botdock:get-state", (event) =>
      this.ownsCapsuleSender(event) || this.ownsSender(event, this.composerWindow) ? this.state : null
    );
    listen(
      "botdock:resize",
      (event, width: unknown, height: unknown, layout: unknown) => {
        if (layout === "composer" && this.ownsSender(event, this.composerWindow)) {
          this.onComposerResize(width, height);
        } else if (layout === "invitation" && this.ownsSender(event, this.invitationWindow)) {
          const size = clampDockSize(width, height);
          if (!size) return;
          this.invitationSize = size;
          this.placeInvitation();
          this.updateInvitation();
        } else if (layout === "compact" && this.ownsSender(event)) {
          this.onResize(width, height);
        }
      }
    );
    listen("botdock:file-hover", (event, active: unknown) => {
      if (!this.ownsCapsuleSender(event)) return;
      const previouslyHovered = this.fileHover.has(event.sender);
      if (previouslyHovered === (active === true)) return;
      if (active === true) this.fileHover.add(event.sender);
      else this.fileHover.delete(event.sender);
      this.updateInvitation();
    });
    listen(
      "botdock:open",
      this.fromDock((_event, botId: unknown) => this.onOpen(botId))
    );
    listen(
      "botdock:focus-app",
      this.fromDock(() => {
        this.closeComposer();
        this.options.focusMainWindow();
      })
    );
    listen("botdock:drop", (event) => {
      if (this.ownsCapsuleSender(event)) this.onDrop();
    });
    listen("botdock:dropped-files", (event, files: unknown, rejected: unknown) => {
      if (!this.ownsCapsuleSender(event)) return;
      const parsed = parseBotDockAttachments(files);
      if (parsed) this.attachDroppedFiles(parsed, rejected === true);
    });
    listen("botdock:composer-close", (event) => {
      if (this.ownsSender(event, this.composerWindow)) this.closeComposer();
    });
    handle("botdock:send", (event, value): Promise<BotDockSendResult> | BotDockSendResult => {
      const message = this.ownsSender(event, this.composerWindow) ? parseBotDockMessage(value) : null;
      // Only a Bot the main window listed may be written to.
      if (!message || !this.state?.roster.some((bot) => bot.id === message.botId))
        return { ok: false };
      return this.deliver(message);
    });
    // The main window answers a delivery it was asked to make.
    listen("outcomego:botdock:delivered", (event, value: unknown) => {
      if (event.sender !== this.options.mainWindow()?.webContents || !isRecord(value)) return;
      if (typeof value.requestId === "string" && typeof value.ok === "boolean")
        this.deliveries.get(value.requestId)?.({ ok: value.ok });
    });
    listen(
      "botdock:drag-start",
      this.fromDock(() => this.startDrag())
    );
    listen(
      "botdock:drag-end",
      this.fromDock(() => {
        if (this.drag) this.followCursor();
        this.stopDrag(true);
      })
    );
    listen(
      "botdock:context-menu",
      this.fromDock(() => this.showContextMenu())
    );
  }

  /** On and not hidden for a while: what the application menu's checkbox shows. */
  get enabled() {
    return this.settings.enabled && !this.snoozed;
  }

  get preferenceEnabled() {
    return this.settings.enabled;
  }

  refreshGlobalDrag(trusted?: boolean) {
    const detector = this.globalDragDetector;
    if (!detector || !this.compactBounds || !this.enabled) return;
    if (trusted ?? systemPreferences.isTrustedAccessibilityClient(false)) detector.start();
    else detector.stop();
  }

  notifyMessageArrival() {
    const window = this.invitationWindow?.isVisible() ? this.invitationWindow : this.window;
    if (window && !window.isDestroyed() && window.isVisible()) {
      window.webContents.send("botdock:message-arrival");
    }
  }

  private get hasFileDrag() {
    return (
      !!this.state?.roster.length &&
      (this.globalDragActive || this.mainWindowDragActive || this.fileHover.size > 0)
    );
  }

  private updateInvitation() {
    const dock = this.window;
    if (!dock || !this.compactBounds) return;
    const invitation = this.invitationWindow;
    if (this.hasFileDrag) {
      if (this.dragHandoff) clearTimeout(this.dragHandoff);
      this.dragHandoff = null;
      if (!invitation) {
        this.warmSurface("invitation");
      } else if (this.invitationSize && !invitation.isVisible()) {
        this.stopDrag(true);
        this.placeInvitation();
        invitation.webContents.send("botdock:surface-visible", true);
        invitation.showInactive();
        if (invitation.isVisible()) {
          dock.hide();
          this.fileHover.delete(dock.webContents);
        }
      }
    }
    if (!this.hasFileDrag && invitation?.isVisible() && !this.dragHandoff) {
      this.dragHandoff = setTimeout(() => this.hideInvitation(), DRAG_HANDOFF_MS);
    }
  }

  private placeInvitation() {
    const window = this.invitationWindow;
    const compact = this.compactBounds;
    if (!window || !compact || !this.invitationSize) return;
    const workArea = screen.getDisplayMatching(compact).workArea;
    this.applyBounds(window, resizeDockFromCenter(compact, this.invitationSize, workArea));
  }

  private hideInvitation() {
    if (this.dragHandoff) clearTimeout(this.dragHandoff);
    this.dragHandoff = null;
    const window = this.invitationWindow;
    if (!window || (!window.isDestroyed() && !window.isVisible())) return;
    this.window?.showInactive();
    if (!window.isDestroyed()) {
      window.hide();
      window.webContents.send("botdock:surface-visible", false);
    }
  }

  private get snoozed() {
    return isSnoozed(this.settings, Date.now());
  }

  /** Switching on also ends a temporary hide: the menu shows it as off, so turning it on shows it. */
  setEnabled(enabled: boolean) {
    const resume = enabled && this.settings.hiddenUntil !== null;
    if (this.settings.enabled === enabled && !resume) return;
    this.settings = {
      ...this.settings,
      enabled,
      ...(enabled ? { hiddenUntil: null } : {}),
    };
    this.armSnooze();
    this.scheduleSave(true);
    this.sync();
    this.options.onEnabledChange();
  }

  /** Hides the dock for a while; it comes back by itself, even after a restart. */
  snooze(option: BotDockSnooze) {
    this.settings = { ...this.settings, hiddenUntil: snoozeDeadline(option, Date.now()) };
    this.armSnooze();
    this.scheduleSave(true);
    this.sync();
    this.options.onEnabledChange();
  }

  private armSnooze() {
    if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
    this.snoozeTimer = null;
    const until = this.settings.hiddenUntil;
    if (until === null) return;
    this.snoozeTimer = setTimeout(
      () => {
        this.snoozeTimer = null;
        if (this.disposed) return;
        if (this.snoozed) {
          this.armSnooze();
          return;
        }
        this.settings = { ...this.settings, hiddenUntil: null };
        this.scheduleSave(true);
        this.sync();
        this.options.onEnabledChange();
      },
      Math.max(0, Math.min(until - Date.now(), SNOOZE_CHECK_MS))
    );
  }

  /** The signed-in window went away or signed out: there is nothing to show. */
  reset() {
    this.settleDeliveries();
    this.setState(null);
  }

  dispose() {
    this.disposed = true;
    if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
    this.snoozeTimer = null;
    this.settleDeliveries();
    this.stopDrag(false);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.writeSettings();
    }
    this.destroyWindow();
  }

  private setState(next: BotDockState | null) {
    this.state = next;
    this.sync();
  }

  /** Creates, updates or removes the window to match the state and the setting. */
  private sync() {
    if (this.disposed) return;
    if (!this.state || !this.settings.enabled || this.snoozed) {
      this.destroyWindow();
      return;
    }
    const window = this.window;
    if (window && !window.isDestroyed()) {
      window.webContents.send("botdock:state", this.state);
      this.composerWindow?.webContents.send("botdock:state", this.state);
      this.invitationWindow?.webContents.send("botdock:state", this.state);
      this.warmSurfaces();
      if (!this.state.roster.length) this.hideInvitation();
      return;
    }
    void this.createWindow().catch((error: unknown) =>
      console.error("OutcomeGo bot dock failed to open", error)
    );
  }

  private createSurface(surface: "dock" | "invitation" | "composer") {
    // Without its preload the page has no bridge, never reports a size, and so never shows.
    // Say so instead of leaving an invisible window (a stale dev build is the usual cause).
    if (!existsSync(this.options.preloadPath)) {
      throw new Error(
        `preload script is missing: ${this.options.preloadPath} (rebuild with "bun run build:preload")`
      );
    }
    const darwin = process.platform === "darwin";
    const window = new BrowserWindow({
      show: false,
      ...INITIAL_SIZE,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: surface === "dock",
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Clicking the capsule must not take focus (or the typing cursor) from the app in use.
      focusable: surface === "composer",
      type: darwin ? "panel" : "toolbar",
      hiddenInMissionControl: true,
      acceptFirstMouse: true,
      title: surface === "composer" ? "OutcomeGo Bot Composer" : "OutcomeGo Bots",
      webPreferences: {
        preload: this.options.preloadPath,
        // Its own storage: it shows names and avatars only and holds no account.
        partition: "persist:botdock",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.setAlwaysOnTop(true, darwin ? "floating" : "screen-saver");
    if (darwin)
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    return window;
  }

  private async createWindow() {
    const window = this.createSurface("dock");
    window.webContents.on("render-process-gone", () => {
      if (this.window !== window) return;
      this.destroyWindow();
      // A page that dies while loading would loop; give up after a few tries.
      if (this.crashes++ < MAX_CRASH_RESTARTS) this.sync();
    });
    window.once("closed", () => {
      if (this.window === window) {
        this.window = null;
        this.destroyWindow();
      }
    });
    this.window = window;
    this.watchDisplays(true);
    try {
      await this.options.loadPage(window, "dock");
    } catch (error) {
      if (this.window !== window) return;
      this.destroyWindow();
      throw error;
    }
  }

  private destroyWindow() {
    this.stopDrag(false);
    this.watchDisplays(false);
    const window = this.window;
    this.window = null;
    this.compactBounds = null;
    this.mainWindowDragActive = false;
    this.globalDragDetector?.stop();
    this.globalDragActive = false;
    this.fileHover.clear();
    this.destroyInvitation();
    this.destroyComposer();
    if (window && !window.isDestroyed()) window.destroy();
  }

  /** `screen` only works once the app is ready, so displays are watched while a window exists. */
  private watchDisplays(watch: boolean) {
    if (watch === this.watchingDisplays) return;
    this.watchingDisplays = watch;
    const method = watch ? "on" : "removeListener";
    screen[method]("display-removed", this.onDisplayChange);
    screen[method]("display-metrics-changed", this.onDisplayChange);
  }

  /** The page measured its capsule: place the window on first size, then keep it in step. */
  private onResize(width: unknown, height: unknown) {
    const window = this.window;
    const size = clampDockSize(width, height);
    if (!window || window.isDestroyed() || !size) return;
    const compact = this.compactBounds;
    if (!compact) {
      this.compactBounds = this.initialBounds(size);
      window.setBounds(this.compactBounds);
      this.crashes = 0;
      if (!window.isVisible()) window.showInactive();
      this.refreshGlobalDrag();
      this.warmSurfaces();
      return;
    }
    const workArea = screen.getDisplayMatching(compact).workArea;
    const next = resizeDock(
      compact,
      size,
      workArea,
      this.drag ? { right: false, bottom: false } : undefined
    );
    this.compactBounds = next;
    if (!this.drag && !sameBounds(compact, next)) this.rememberPosition(next);
    this.applyBounds(window, next);
    this.placeInvitation();
    this.placeComposer();
  }

  private applyBounds(window: BrowserWindow, next: DockRect) {
    if (!sameBounds(window.getBounds(), next)) window.setBounds(next);
  }

  private initialBounds(size: { width: number; height: number }): DockRect {
    const saved = this.settings.position;
    if (saved) {
      const rect = { x: saved.x, y: saved.y, width: saved.width, height: size.height };
      // Placed on a display that is gone (an unplugged monitor) falls back to the default corner.
      const display = screen
        .getAllDisplays()
        .find((candidate) => overlaps(rect, candidate.workArea));
      // The same rule as a live resize: the edge nearer the screen's side stays where it was.
      if (display) return resizeDock(rect, size, display.workArea);
    }
    return defaultDockPosition(size, screen.getPrimaryDisplay().workArea);
  }

  private reclamp() {
    const window = this.window;
    const compact = this.compactBounds;
    if (!window || window.isDestroyed() || !compact) return;
    const display = screen
      .getAllDisplays()
      .find((candidate) => overlaps(compact, candidate.workArea));
    const workArea = (display ?? screen.getPrimaryDisplay()).workArea;
    const next = display
      ? clampToWorkArea(compact, workArea)
      : defaultDockPosition(compact, workArea);
    this.compactBounds = next;
    if (!sameBounds(compact, next)) this.rememberPosition(next);
    this.applyBounds(window, next);
    this.placeInvitation();
    this.placeComposer();
  }

  /** Nothing is unread and there is someone to write to: a click on the capsule starts a message. */
  private canCompose() {
    const state = this.state;
    return !!state && state.roster.length > 0 && !state.bots.some((bot) => bot.messages > 0);
  }

  private onOpen(botId: unknown) {
    const bot =
      typeof botId === "string"
        ? this.state?.bots.find((candidate) => candidate.id === botId)
        : undefined;
    if (!bot) {
      // The capsule's own button: a second click closes the panel; otherwise it writes a
      // message when nothing is unread, and brings the app forward when something is.
      if (this.composerOpen) this.closeComposer();
      else if (this.canCompose()) this.openComposer();
      else this.options.focusMainWindow();
      return;
    }
    this.closeComposer();
    const target = botDockOpenTarget(bot);
    if (target.kind === "chat") this.options.openChat(target.channelId);
    else this.options.openGoals();
  }

  private openComposer() {
    if (!this.compactBounds || this.composerOpen) return;
    this.stopDrag(true);
    this.composerOpen = true;
    this.warmSurfaces();
    this.showComposer();
  }

  private warmSurfaces() {
    if (!this.compactBounds || !this.state?.roster.length) return;
    if (!this.composerWindow) this.warmSurface("composer");
    if (!this.invitationWindow) this.warmSurface("invitation");
  }

  private warmSurface(surface: "invitation" | "composer") {
    let window: BrowserWindow;
    try {
      window = this.createSurface(surface);
    } catch (error) {
      if (surface === "composer") this.closeComposer();
      console.error(`OutcomeGo bot ${surface} failed to open`, error);
      return;
    }
    const contents = window.webContents;
    const cleanup = () => {
      if (this.composerWindow === window) this.destroyComposer();
      if (this.invitationWindow === window) {
        this.fileHover.delete(contents);
        this.destroyInvitation();
      }
    };
    if (surface === "composer") {
      this.composerWindow = window;
      window.once("ready-to-show", () => {
        if (this.composerWindow !== window) return;
        this.composerPainted = true;
        this.showComposer();
      });
      window.on("blur", () => {
        if (this.composerWindow === window) this.closeComposer();
      });
    } else {
      this.invitationWindow = window;
    }
    window.once("closed", cleanup);
    contents.once("render-process-gone", cleanup);
    void this.options.loadPage(window, surface).catch((error: unknown) => {
      cleanup();
      console.error(`OutcomeGo bot ${surface} failed to load`, error);
    });
  }

  private destroyInvitation() {
    const window = this.invitationWindow;
    this.hideInvitation();
    this.invitationWindow = null;
    this.invitationSize = null;
    if (window && !window.isDestroyed()) {
      this.fileHover.delete(window.webContents);
      window.destroy();
    }
  }

  private onComposerResize(width: unknown, height: unknown) {
    const size = clampDockSize(width, height);
    if (!size) return;
    this.composerSize = size;
    if (this.pendingDrop) {
      const { files, rejected } = this.pendingDrop;
      this.pendingDrop = null;
      this.attachDroppedFiles(files, rejected);
    }
    this.showComposer();
  }

  private placeComposer() {
    const dock = this.compactBounds;
    const window = this.composerWindow;
    if (!dock || !window || !this.composerSize) return;
    const workArea = screen.getDisplayMatching(dock).workArea;
    this.applyBounds(window, placeDockComposer(dock, this.composerSize, workArea));
    if (this.composerOpen && this.composerPainted) {
      this.window?.webContents.send("botdock:composer-anchor", dockAnchorFor(dock, workArea));
    }
  }

  private showComposer() {
    const window = this.composerWindow;
    this.placeComposer();
    if (!this.composerOpen || !window || !this.composerSize || !this.composerPainted) return;
    if (!window.isVisible()) {
      window.webContents.send("botdock:surface-visible", true);
      window.showInactive();
      window.focus();
    }
  }

  private closeComposer() {
    if (!this.composerOpen) return;
    this.composerOpen = false;
    const window = this.composerWindow;
    if (window?.isVisible()) {
      window.hide();
      window.webContents.send("botdock:surface-visible", false);
    }
    this.window?.webContents.send("botdock:composer-anchor", null);
  }

  private destroyComposer() {
    const window = this.composerWindow;
    this.composerWindow = null;
    this.closeComposer();
    this.composerSize = null;
    this.composerPainted = false;
    this.pendingDrop = null;
    if (window && !window.isDestroyed()) window.destroy();
  }

  private attachDroppedFiles(files: BotDockAttachment[], rejected: boolean) {
    const window = this.composerWindow;
    if (!window) return;
    if (this.composerSize) {
      window.webContents.send("botdock:dropped-files", { files, rejected });
    } else {
      const pending = this.pendingDrop;
      const combined = pending ? parseBotDockAttachments([...pending.files, ...files]) : files;
      this.pendingDrop = {
        files: combined ?? pending?.files ?? [],
        rejected: rejected || pending?.rejected === true || !combined,
      };
    }
  }

  /** Files were dropped on the dock: the composer opens, whether anything is unread or not. The
   * page attaches the files. */
  private onDrop() {
    this.fileHover.clear();
    this.mainWindowDragActive = false;
    this.globalDragActive = false;
    this.hideInvitation();
    if (this.state && this.state.roster.length > 0) this.openComposer();
  }

  /** Asks the signed-in window to send the message: the dock itself has no account. Pasted
   * or dropped files are staged here first, and only their references travel on. */
  private async deliver(message: BotDockMessage): Promise<BotDockSendResult> {
    const main = this.options.mainWindow();
    if (!main || main.isDestroyed() || main.webContents.isLoading()) return { ok: false };
    const staged: Array<{
      stagingId: string;
      fileName: string;
      mimeType: string;
      byteSize: number;
      width?: number;
      height?: number;
    }> = [];
    const discard = () =>
      Promise.all(
        staged.map(({ stagingId }) =>
          this.options.discardDelivery(stagingId).catch(() => undefined)
        )
      );
    try {
      for (const attachment of message.attachments) {
        const stagingId = randomUUID();
        await this.options.stageDelivery(stagingId, attachment.bytes);
        staged.push({
          stagingId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          byteSize: attachment.bytes.byteLength,
          ...(attachment.width && attachment.height
            ? { width: attachment.width, height: attachment.height }
            : {}),
        });
      }
    } catch {
      await discard();
      return { ok: false };
    }
    const result = await this.request(main, {
      botId: message.botId,
      content: message.content,
      nonce: message.nonce,
      staged,
    });
    // Refused: nothing will upload the staged copies. Unanswered, the chat window may already
    // have queued a send that reads them, and a retry (same nonce) is safe.
    if (!result.ok && !result.unanswered) await discard();
    return result;
  }

  private request(main: BrowserWindow, payload: object): Promise<BotDockSendResult> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const finish = (result: BotDockSendResult) => {
        clearTimeout(timer);
        this.deliveries.delete(requestId);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, unanswered: true }), DELIVERY_TIMEOUT_MS);
      this.deliveries.set(requestId, finish);
      main.webContents.send("outcomego:botdock:deliver", { requestId, ...payload });
    });
  }

  private settleDeliveries() {
    for (const finish of [...this.deliveries.values()]) finish({ ok: false, unanswered: true });
  }

  private startDrag() {
    const window = this.window;
    const bounds = this.compactBounds;
    if (!window || window.isDestroyed() || !bounds || this.drag || this.expanded) return;
    const cursor = screen.getCursorScreenPoint();
    this.drag = {
      offsetX: cursor.x - bounds.x,
      offsetY: cursor.y - bounds.y,
      timer: setInterval(() => this.followCursor(), DRAG_INTERVAL_MS),
      stop: setTimeout(() => this.stopDrag(true), DRAG_MAX_MS),
    };
  }

  /** The cursor is polled instead of using a drag region: on Windows a right-click on a drag
   * region opens the system menu, and a click could not be told apart from a drag. */
  private followCursor() {
    const window = this.window;
    const drag = this.drag;
    const bounds = this.compactBounds;
    if (!drag || !window || window.isDestroyed() || !bounds) {
      this.stopDrag(false);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const workArea = screen.getDisplayNearestPoint(cursor).workArea;
    // setBounds with the known size: setPosition alone can resize a window across DPI changes.
    const next = clampToWorkArea(
      { ...bounds, x: cursor.x - drag.offsetX, y: cursor.y - drag.offsetY },
      workArea
    );
    this.compactBounds = next;
    this.applyBounds(window, next);
  }

  private stopDrag(save: boolean) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    clearInterval(drag.timer);
    clearTimeout(drag.stop);
    if (save && this.compactBounds) this.rememberPosition(this.compactBounds);
  }

  private showContextMenu() {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const text = contextMenuText(this.options.locale());
    Menu.buildFromTemplate([
      { label: text.open, click: () => this.options.focusMainWindow() },
      { type: "separator" },
      ...BOT_DOCK_SNOOZES.map((option) => ({
        label: text.snooze[option],
        click: () => this.snooze(option),
      })),
      { type: "separator" },
      { label: text.off, click: () => this.setEnabled(false) },
    ]).popup({ window });
  }

  private rememberPosition(bounds: DockRect) {
    const previous = this.settings.position;
    if (
      previous &&
      previous.x === bounds.x &&
      previous.y === bounds.y &&
      previous.width === bounds.width
    )
      return;
    this.settings = {
      ...this.settings,
      position: { x: bounds.x, y: bounds.y, width: bounds.width },
    };
    this.scheduleSave(false);
  }

  private scheduleSave(immediate: boolean) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(
      () => {
        this.saveTimer = null;
        this.writeSettings();
      },
      immediate ? 0 : SAVE_DEBOUNCE_MS
    );
  }

  private readSettings(): BotDockSettings {
    try {
      return parseBotDockSettings(JSON.parse(readFileSync(this.options.settingsPath, "utf8")));
    } catch {
      return DEFAULT_BOT_DOCK_SETTINGS;
    }
  }

  private writeSettings() {
    const { settingsPath } = this.options;
    const snapshot = JSON.stringify(this.settings);
    // Written through a temporary file so a crash never leaves half a settings file.
    void mkdir(dirname(settingsPath), { recursive: true })
      .then(async () => {
        const temporary = `${settingsPath}.${process.pid}.tmp`;
        await writeFile(temporary, snapshot, "utf8");
        await rename(temporary, settingsPath);
      })
      .catch((error: unknown) =>
        console.error("OutcomeGo bot dock settings were not saved", error)
      );
  }

  private ownsSender(event: IpcMainEvent | IpcMainInvokeEvent, window = this.window) {
    return (
      !!window &&
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame
    );
  }

  private ownsCapsuleSender(event: IpcMainEvent | IpcMainInvokeEvent) {
    return this.ownsSender(event) || this.ownsSender(event, this.invitationWindow);
  }

  private fromDock<Args extends unknown[]>(handler: (event: IpcMainEvent, ...args: Args) => void) {
    return (event: IpcMainEvent, ...args: Args) => {
      if (this.ownsSender(event)) handler(event, ...args);
    };
  }
}

const overlaps = (a: DockRect, b: DockRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const sameBounds = (previous: DockRect, next: DockRect) =>
  previous.x === next.x &&
  previous.y === next.y &&
  previous.width === next.width &&
  previous.height === next.height;
