import { Menu, nativeImage, Notification, Tray, type MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import type { Locale } from "@outcomego/contracts/localization";
import { localServiceTranslations } from "../renderer/lib/local-service-catalog";
import { buildTrayMenu } from "./tray-menu";

const translate = (locale: Locale, key: string) => locale === "zh-CN" ? localServiceTranslations[key] ?? key : key;

export const createTray = (options: {
  assets: string;
  platform: "darwin" | "win32";
  locale: () => Locale;
  state: () => Parameters<typeof buildTrayMenu>[0];
  refresh: () => Promise<void>;
  actions: Record<"open" | "start" | "stop" | "quit", () => void>;
}) => {
  const mac = options.platform === "darwin";
  const image = nativeImage.createFromPath(join(options.assets, mac ? "outcomegoTemplate.png" : "icon.ico"));
  if (image.isEmpty()) throw new Error("OutcomeGo tray icon is unavailable");
  if (mac) image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip("OutcomeGo");
  const menu = () => {
    const current = options.state();
    const locale = options.locale();
    const entries: MenuItemConstructorOptions[] = [];
    for (const item of buildTrayMenu(current)) {
      if (item.action === "status" || (item.action === "quit" && current.local)) entries.push({ type: "separator" });
      const action = item.action;
      const label = translate(locale, item.label);
      entries.push({
        label: action === "status" ? translate(locale, "Local services: {state}").replace("{state}", label) : label,
        enabled: item.enabled,
        ...(action !== "status" ? { click: options.actions[action] } : {}),
      });
    }
    return Menu.buildFromTemplate(entries);
  };
  let contextMenu = menu();
  const refresh = () => { if (!tray.isDestroyed()) contextMenu = menu(); };
  tray.on("click", options.actions.open);
  tray.on("right-click", () => {
    refresh();
    tray.popUpContextMenu(contextMenu);
    void options.refresh().catch(() => undefined);
  });
  return { refresh, destroy: () => tray.destroy() };
};

export const warnOnClose = (locale: Locale, open: () => void): boolean => {
  if (!Notification.isSupported()) return false;
  const notice = new Notification({ title: "OutcomeGo", silent: true,
    body: translate(locale, "OutcomeGo is still running. Open or quit it from the tray icon.") });
  notice.on("click", open);
  notice.show();
  return true;
};
