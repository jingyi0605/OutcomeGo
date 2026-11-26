import { Menu, nativeImage, Notification, Tray, type MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import type { Locale } from "@outcomego/contracts/localization";
import { localServiceTranslations } from "../renderer/lib/local-service-catalog";
import { buildTrayMenu, type TrayMenuAction, type TrayMenuState } from "./tray-menu";

const translate = (locale: Locale, key: string) =>
  locale === "zh-CN" ? localServiceTranslations[key] ?? key : key;

export type TrayActions = {
  open: () => void;
  start: () => void;
  stop: () => void;
  quit: () => void;
  manage?: () => void;
  restart?: () => void;
  autostart?: () => void;
  "logs-folder"?: () => void;
};

export const createTray = (options: {
  assets: string;
  platform: "darwin" | "win32";
  locale: () => Locale;
  state: () => TrayMenuState;
  refresh: () => Promise<void>;
  actions: TrayActions;
  staleMs?: number;
  rightClickTimeoutMs?: number;
}) => {
  const mac = options.platform === "darwin";
  const image = nativeImage.createFromPath(
    join(options.assets, mac ? "outcomegoTemplate.png" : "icon.ico")
  );
  if (image.isEmpty()) throw new Error("OutcomeGo tray icon is unavailable");
  if (mac) image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip("OutcomeGo");

  const staleMs = options.staleMs ?? 10_000;
  const rightClickTimeoutMs = options.rightClickTimeoutMs ?? 1_200;
  let lastSyncedAt = 0;
  let rightClickInFlight = false;

  const menu = () => {
    const current = options.state();
    const locale = options.locale();
    const entries: MenuItemConstructorOptions[] = [];
    for (const item of buildTrayMenu(current)) {
      if (item.separatorBefore) entries.push({ type: "separator" });
      const action: TrayMenuAction = item.action;
      const label = translate(locale, item.label);
      const handler = action === "status" ? undefined : options.actions[action];
      entries.push({
        label:
          action === "status"
            ? translate(locale, "Local services: {state}").replace("{state}", label)
            : label,
        type: item.type ?? "normal",
        ...(item.type === "checkbox" ? { checked: Boolean(item.checked) } : {}),
        enabled: item.enabled,
        ...(handler ? { click: handler } : {}),
      });
    }
    return Menu.buildFromTemplate(entries);
  };

  let contextMenu = menu();
  const refresh = (markFresh = false) => {
    if (markFresh) lastSyncedAt = Date.now();
    if (!tray.isDestroyed()) contextMenu = menu();
  };

  const openMenu = () => {
    if (tray.isDestroyed()) return;
    refresh(false);
    tray.popUpContextMenu(contextMenu);
  };

  tray.on("click", options.actions.open);
  tray.on("right-click", () => {
    const current = options.state();
    const needsSync = current.local && !current.busy && Date.now() - lastSyncedAt > staleMs;
    if (!needsSync) {
      openMenu();
      return;
    }
    if (rightClickInFlight) return;
    rightClickInFlight = true;
    const syncPromise = options
      .refresh()
      .then(() => {
        lastSyncedAt = Date.now();
        refresh(false);
      })
      .catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, rightClickTimeoutMs);
    });
    void Promise.race([syncPromise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
      rightClickInFlight = false;
      openMenu();
    });
  });

  return {
    refresh: () => refresh(false),
    markSynced: () => refresh(true),
    destroy: () => tray.destroy(),
  };
};

export const warnOnClose = (locale: Locale, open: () => void): boolean => {
  if (!Notification.isSupported()) return false;
  const notice = new Notification({
    title: "OutcomeGo",
    silent: true,
    body: translate(
      locale,
      "OutcomeGo is still running. Open or quit it from the tray icon."
    ),
  });
  notice.on("click", open);
  notice.show();
  return true;
};
