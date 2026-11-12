import type { BaseWindow, BrowserWindow, MenuItemConstructorOptions } from "electron";

export type ApplicationMenuAction = "about" | "updates" | "settings";
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
  onClipboard?: (action: ClipboardMenuAction, window: BaseWindow | undefined) => boolean
): MenuItemConstructorOptions[];
export function applicationMenuTemplate(
  platform: NodeJS.Platform,
  locale: ApplicationMenuLocale,
  onAction: (action: ApplicationMenuAction) => void,
  onClipboard?: (action: ClipboardMenuAction, window: BaseWindow | undefined) => boolean
): MenuItemConstructorOptions[];
export function applicationMenuTemplate(
  platform: NodeJS.Platform,
  localeOrAction: ApplicationMenuLocale | ((action: ApplicationMenuAction) => void),
  actionOrClipboard?:
    | ((action: ApplicationMenuAction) => void)
    | ((action: ClipboardMenuAction, window: BaseWindow | undefined) => boolean),
  clipboard?: (action: ClipboardMenuAction, window: BaseWindow | undefined) => boolean
): MenuItemConstructorOptions[] {
  const locale: ApplicationMenuLocale =
    typeof localeOrAction === "string" ? localeOrAction : "en-US";
  const onAction =
    typeof localeOrAction === "function"
      ? localeOrAction
      : (actionOrClipboard as (action: ApplicationMenuAction) => void);
  const onClipboard =
    typeof localeOrAction === "function"
      ? (actionOrClipboard as
          | ((action: ClipboardMenuAction, window: BaseWindow | undefined) => boolean)
          | undefined)
      : clipboard;
  const text = menuText(locale);
  const appItems: MenuItemConstructorOptions[] = [
    { label: text.about, click: () => onAction("about") },
    { label: text.updates, click: () => onAction("updates") },
    { type: "separator" },
    {
      label: text.settings,
      accelerator: "CommandOrControl+,",
      click: () => onAction("settings"),
    },
  ];

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
          submenu: [...appItems, { type: "separator" }, { role: "quit" }],
        },
    ...(platform === "darwin" ? [{ role: "fileMenu" } as const] : []),
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
