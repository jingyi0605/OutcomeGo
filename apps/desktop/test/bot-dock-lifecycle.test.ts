import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { DockRect } from "../src/main/bot-dock-model";

const ipc = Object.assign(new EventEmitter(), {
  handle() {},
  removeHandler() {},
});
const workArea = { x: 0, y: 0, width: 1000, height: 800 };
let cursor = { x: 0, y: 0 };
const screen = Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => ({ workArea }),
  getDisplayMatching: () => ({ workArea }),
  getDisplayNearestPoint: () => ({ workArea }),
  getCursorScreenPoint: () => cursor,
});

class FakeDockWindow extends EventEmitter {
  readonly sent = new Map<string, unknown>();
  readonly webContents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    setWindowOpenHandler() {},
    send: (channel: string, payload: unknown) => this.sent.set(channel, payload),
  });
  bounds: DockRect = { x: 0, y: 0, width: 0, height: 0 };
  visible = false;
  destroyed = false;
  focused = false;
  boundsChanges = 0;
  hides = 0;

  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  focus() {
    this.focused = this.visible;
  }
  isFocused() {
    return this.focused;
  }
  blur() {
    this.focused = false;
    this.emit("blur");
  }

  getBounds() {
    return this.bounds;
  }

  hide() {
    this.hides++;
    this.visible = false;
    if (this.focused) this.blur();
  }

  setBounds(bounds: DockRect) {
    this.boundsChanges++;
    this.bounds = bounds;
  }

  showInactive() {
    this.visible = true;
  }

  isVisible() {
    return this.visible;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
}

const checkAccessibility = mock(() => false);
mock.module("electron", () => ({
  BrowserWindow: FakeDockWindow,
  Menu: {},
  ipcMain: ipc,
  screen,
  systemPreferences: { isTrustedAccessibilityClient: checkAccessibility },
}));

const { DesktopBotDock } = await import("../src/main/bot-dock");

test("restores an opted-in dock and preserves its compact position through move, drag, and drop", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bot-dock-settings-"));
  const settingsPath = join(directory, "bot-dock-settings.json");
  const mainWindow = { webContents: {} } as BrowserWindow;
  const windows: FakeDockWindow[] = [];
  const focusMainWindow = mock(() => {});
  const options = {
    preloadPath: import.meta.path,
    settingsPath,
    dragHelperPath: join(directory, "drag-helper"),
    loadPage: async (window: BrowserWindow) => {
      windows.push(window as unknown as FakeDockWindow);
    },
    mainWindow: () => mainWindow,
    focusMainWindow,
    openChat() {},
    openGoals() {},
    async stageDelivery() {},
    async discardDelivery() {},
    locale: () => "en-US" as const,
    onEnabledChange() {},
  };
  const publish = () =>
    ipc.emit(
      "outcomego:botdock:state",
      { sender: mainWindow.webContents },
      { bots: [], roster: [{ id: "bot", name: "Bot", color: "blue", icon: "round" }] }
    );

  try {
    await writeFile(settingsPath, JSON.stringify({ position: { x: 50, y: 50, width: 80 } }));
    const defaultOff = new DesktopBotDock(options);
    try {
      publish();
      expect(defaultOff.preferenceEnabled).toBe(false);
      expect(windows).toHaveLength(0);
      expect(checkAccessibility).not.toHaveBeenCalled();
    } finally {
      defaultOff.dispose();
    }

    await writeFile(settingsPath, JSON.stringify({ enabled: true }));
    const optedIn = new DesktopBotDock(options);
    try {
      expect(optedIn.preferenceEnabled).toBe(true);
      publish();
      expect(windows).toHaveLength(1);
      expect(checkAccessibility).not.toHaveBeenCalled();
      const [window] = windows;
      if (!window) throw new Error("Dock window was not created");
      const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
      const mainEvent = { sender: mainWindow.webContents };
      const dragHint = (active: boolean) =>
        ipc.emit("outcomego:botdock:drag-hint", mainEvent, active);
      optedIn.notifyMessageArrival();
      expect(window.sent.has("botdock:message-arrival")).toBe(false);
      ipc.emit("botdock:resize", event, 96, 64, "compact");
      expect(window.visible).toBe(true);
      expect(windows).toHaveLength(3);
      const [, composer, invitation] = windows;
      if (!composer || !invitation) throw new Error("Dock surfaces did not preload");
      const composerEvent = {
        sender: composer.webContents,
        senderFrame: composer.webContents.mainFrame,
      };
      const invitationEvent = {
        sender: invitation.webContents,
        senderFrame: invitation.webContents.mainFrame,
      };
      expect(composer.visible).toBe(false);
      expect(invitation.visible).toBe(false);
      ipc.emit("botdock:resize", composerEvent, 356, 164, "composer");
      expect(composer.visible).toBe(false);
      ipc.emit("botdock:open", event);
      expect(composer.visible).toBe(false);
      composer.emit("ready-to-show");
      expect(composer.visible).toBe(true);
      expect(composer.sent.get("botdock:surface-visible")).toBe(true);
      ipc.emit("botdock:composer-close", composerEvent);
      expect(composer.sent.get("botdock:surface-visible")).toBe(false);
      expect(composer.visible).toBe(false);
      optedIn.notifyMessageArrival();
      expect(window.sent.has("botdock:message-arrival")).toBe(true);
      expect(checkAccessibility).toHaveBeenCalledTimes(1);
      expect(checkAccessibility).toHaveBeenCalledWith(false);

      cursor = { x: window.bounds.x + 48, y: window.bounds.y + 32 };
      ipc.emit("botdock:drag-start", event);
      cursor = { x: 512, y: 352 };
      ipc.emit("botdock:resize", event, 112, 64, "compact");
      ipc.emit("botdock:drag-end", event);
      expect(window.bounds).toEqual({ x: 464, y: 320, width: 112, height: 64 });
      const compactMoves = window.boundsChanges;
      ipc.emit("botdock:resize", invitationEvent, 170, 98, "invitation");
      ipc.emit("botdock:file-hover", event, true);
      expect(invitation.visible).toBe(true);
      expect(invitation.bounds).toEqual({ x: 435, y: 303, width: 170, height: 98 });
      expect(window.visible).toBe(false);
      expect(window.bounds).toEqual({ x: 464, y: 320, width: 112, height: 64 });
      ipc.emit("botdock:file-hover", invitationEvent, true);
      await Bun.sleep(100);
      expect(invitation.visible).toBe(true);
      ipc.emit("botdock:drop", invitationEvent);
      const file = { bytes: new Uint8Array([1]), fileName: "notes.txt", mimeType: "text/plain" };
      ipc.emit("botdock:dropped-files", invitationEvent, [file], false);
      expect(invitation.visible).toBe(false);
      expect(window.visible).toBe(true);
      expect(window.boundsChanges).toBe(compactMoves);
      expect(window.isFocused()).toBe(false);

      const boundsChangesBeforeComposer = window.boundsChanges;
      const hidesBeforeComposer = window.hides;
      expect(composer.bounds).toEqual({ x: 220, y: 363, width: 356, height: 164 });
      expect(window.sent.get("botdock:composer-anchor")).toEqual({ right: true, bottom: false });
      expect(composer.sent.get("botdock:dropped-files")).toEqual({ files: [file], rejected: false });
      expect(composer.isFocused()).toBe(true);
      ipc.emit("botdock:composer-close", composerEvent);
      expect(composer.visible).toBe(false);
      expect(composer.isFocused()).toBe(false);
      expect(window.boundsChanges).toBe(boundsChangesBeforeComposer);
      expect(window.hides).toBe(hidesBeforeComposer);
      expect(window.visible).toBe(true);
      expect(window.sent.get("botdock:composer-anchor")).toBeNull();
      expect(focusMainWindow).not.toHaveBeenCalled();

      cursor = { x: 512, y: 352 };
      ipc.emit("botdock:drag-start", event);
      cursor = { x: 999, y: 799 };
      ipc.emit("botdock:drag-end", event);
      const corner = { x: 888, y: 736, width: 112, height: 64 };
      expect(window.bounds).toEqual(corner);
      const cornerBoundsChanges = window.boundsChanges;
      ipc.emit("botdock:resize", invitationEvent, 168, 96, "invitation");
      dragHint(true);
      expect(invitation.bounds).toEqual({ x: 832, y: 704, width: 168, height: 96 });
      expect(window.visible).toBe(false);
      const invitationBoundsChanges = invitation.boundsChanges;
      dragHint(false);
      expect(window.bounds).toEqual(corner);
      await Bun.sleep(100);
      expect(window.visible).toBe(true);
      expect(invitation.visible).toBe(false);
      expect(window.boundsChanges).toBe(cornerBoundsChanges);
      expect(invitation.boundsChanges).toBe(invitationBoundsChanges);

      const cornerHides = window.hides;
      ipc.emit("botdock:open", event);
      expect(windows).toHaveLength(3);
      expect(composer.bounds).toEqual({ x: 644, y: 593, width: 356, height: 164 });
      expect(composer.isFocused()).toBe(true);
      composer.blur();
      expect(composer.visible).toBe(false);
      expect(window.bounds).toEqual(corner);
      expect(window.boundsChanges).toBe(cornerBoundsChanges);
      expect(window.hides).toBe(cornerHides);
      expect(window.visible).toBe(true);

      optedIn.reset();
      expect(window.destroyed).toBe(true);
      expect(composer.destroyed).toBe(true);
      expect(invitation.destroyed).toBe(true);
      optedIn.refreshGlobalDrag();
      expect(checkAccessibility).toHaveBeenCalledTimes(1);
    } finally {
      optedIn.dispose();
    }
    let savedPosition: unknown;
    for (let attempt = 0; attempt < 100; attempt++) {
      const saved = JSON.parse(await readFile(settingsPath, "utf8"));
      savedPosition = saved.position;
      if (savedPosition) break;
      await Bun.sleep(5);
    }
    expect(savedPosition).toEqual({ x: 888, y: 736, width: 112 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
