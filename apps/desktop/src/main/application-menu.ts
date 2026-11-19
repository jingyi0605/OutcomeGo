import type { BaseWindow, BrowserWindow, MenuItemConstructorOptions } from "electron";

export type ApplicationMenuAction = "about" | "updates" | "settings" | "screenbot";
export type ClipboardMenuAction = "copy" | "cut" | "paste";
export type ApplicationMenuLocale = "en-US" | "zh-CN";

const menuText = (locale: ApplicationMenuLocale) =>
  locale === "zh-CN"
    ? {
        about: "关于 OutcomeGo",
        updates: "检查更新…",
        settings: "设置…",
        app: "OutcomeGo",
        services: "服务",
        hide: "隐藏 OutcomeGo",
        hideOthers: "隐藏其他",
        showAll: "显示全部",
        quit: "退出 OutcomeGo",
        file: "文件",
        edit: "编辑",
        view: "显示",
        window: "窗口",
        screenbot: "打开 ScreenBot",
        botDock: "显示机器人浮窗",
        undo: "撤销",
        redo: "重做",
        cut: "剪切",
        copy: "复制",
        paste: "粘贴",
        selectAll: "全选",
      }
    : {
        about: "About OutcomeGo",
        updates: "Check for Updates…",
        settings: "Settings…",
        app: "OutcomeGo",
        services: "Services",
        hide: "Hide OutcomeGo",
        hideOthers: "Hide Others",
        showAll: "Show All",
        quit: "Quit OutcomeGo",
        file: "File",
        edit: "Edit",
        view: "View",
        window: "Window",
        screenbot: "Open ScreenBot",
        botDock: "Show Bot Floating Window",
        undo: "Undo",
        redo: "Redo",
        cut: "Cut",
        copy: "Copy",
        paste: "Paste",
        selectAll: "Select All",
      };

export function applicationMenuTemplate(
  platform: NodeJS.Platform,
  onAction: (action: ApplicationMenuAction) => void,
  onClipboard?: (action: ClipboardMenuAction, window: BaseWindow | undefined) => boolean,
  /** The screenbot shortcut when it's an ordinary one; a two-key chord can't show in a menu. */
  screenBotAccelerator?: string | null,
  /** Rebindable in Settings › Keyboard. */
  settingsAccelerator?: string
): MenuItemConstructorOptions[];
export function applicationMenuTemplate(
  platform: NodeJS.Platform,
  locale: ApplicationMenuLocale,
  onAction: (action: ApplicationMenuAction) => void,
  onClipboard?: (action: ClipboardMenuAction, window: BaseWindow | undefined) => boolean,
  screenBotAccelerator?: string | null,
  settingsAccelerator?: string
): MenuItemConstructorOptions[];
export function applicationMenuTemplate(
  platform: NodeJS.Platform,
  localeOrAction: ApplicationMenuLocale | ((action: ApplicationMenuAction) => void),
  actionOrClipboard?: unknown,
  /**
   * The clipboard handler, or — when the locale is omitted — the screenbot accelerator.
   * Without a locale every later argument shifts back one place.
   */
  clipboardOrAccelerator?: unknown,
  acceleratorOrSettings?: unknown,
  settings?: unknown
): MenuItemConstructorOptions[] {
  const legacy = typeof localeOrAction === "function";
  const locale: ApplicationMenuLocale = legacy
    ? "en-US"
    : (localeOrAction as ApplicationMenuLocale);
  const onAction = (legacy ? localeOrAction : actionOrClipboard) as (
    action: ApplicationMenuAction
  ) => void;
  const onClipboard = (legacy ? actionOrClipboard : clipboardOrAccelerator) as
    | ((action: ClipboardMenuAction, window: BaseWindow | undefined) => boolean)
    | undefined;
  const accelerator = legacy ? clipboardOrAccelerator : acceleratorOrSettings;
  const screenBotAccelerator = typeof accelerator === "string" ? accelerator : null;
  const settingsCandidate = legacy ? acceleratorOrSettings : settings;
  const settingsAccelerator =
    typeof settingsCandidate === "string" ? settingsCandidate : "CommandOrControl+,";
  const text = menuText(locale);
  const appItems: MenuItemConstructorOptions[] = [
    { label: text.about, click: () => onAction("about") },
    { label: text.updates, click: () => onAction("updates") },
    { type: "separator" },
    {
      label: text.settings,
      accelerator: settingsAccelerator,
      click: () => onAction("settings"),
    },
  ];
  // The global shortcut (or both-key chord) fires the screenbot; the menu shows it and handles clicks.
  const screenBotItem: MenuItemConstructorOptions = {
    label: text.screenbot,
    ...(screenBotAccelerator
      ? { accelerator: screenBotAccelerator, registerAccelerator: false }
      : {}),
    click: () => onAction("screenbot"),
  };

  return [
    platform === "darwin"
      ? {
          label: text.app,
          submenu: [
            ...appItems,
            { type: "separator" },
            { role: "services", label: text.services },
            { type: "separator" },
            { role: "hide", label: text.hide },
            { role: "hideOthers", label: text.hideOthers },
            { role: "unhide", label: text.showAll },
            { type: "separator" },
            { role: "quit", label: text.quit },
          ],
        }
      : {
          label: text.file,
          submenu: [
            screenBotItem,
            { type: "separator" },
            ...appItems,
            { type: "separator" },
            { role: "quit" },
          ],
        },
    ...(platform === "darwin"
      ? [
          {
            label: text.file,
            submenu: [screenBotItem, { type: "separator" }, { role: "close" }],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    onClipboard
      ? {
          label: text.edit,
          submenu: [
            { role: "undo", label: text.undo },
            { role: "redo", label: text.redo },
            { type: "separator" },
            ...(["cut", "copy", "paste"] as const).map<MenuItemConstructorOptions>((action) => ({
              label: text[action],
              accelerator: `CommandOrControl+${action === "paste" ? "V" : action === "copy" ? "C" : "X"}`,
              // Chromium handles keyboard shortcuts; these callbacks handle menu clicks.
              registerAccelerator: false,
              click: (_item, window) => {
                if (!onClipboard(action, window) && window && "webContents" in window)
                  (window as BrowserWindow).webContents[action]();
              },
            })),
            { type: "separator" },
            { role: "selectAll", label: text.selectAll },
          ],
        }
      : { role: "editMenu" },
    { role: "viewMenu", label: text.view },
    { role: "windowMenu", label: text.window },
  ];
}

/**
 * Adds the "Show Bot Floating Window" switch to the File menu, right after ScreenBot (the other
 * floating window). Kept apart from the template so the template's positional arguments stay put.
 */
export function withBotDockToggle(
  template: MenuItemConstructorOptions[],
  locale: ApplicationMenuLocale,
  enabled: boolean,
  onToggle: (enabled: boolean) => void
): MenuItemConstructorOptions[] {
  const text = menuText(locale);
  return template.map((item) => {
    if (item.label !== text.file || !Array.isArray(item.submenu)) return item;
    const submenu = [...item.submenu];
    const anchor = submenu.findIndex((entry) => entry.label === text.screenbot);
    submenu.splice(anchor + 1, 0, {
      label: text.botDock,
      type: "checkbox",
      checked: enabled,
      click: (entry) => onToggle(entry.checked),
    });
    return { ...item, submenu };
  });
}
