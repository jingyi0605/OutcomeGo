import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { MenuItemConstructorOptions } from "electron";

const popUpContextMenu = mock((_menu: MenuItemConstructorOptions[]) => undefined);
let nativeTray: EventEmitter;
class TrayFixture extends EventEmitter {
  constructor() { super(); nativeTray = this; }
  setToolTip() {}
  isDestroyed() { return false; }
  popUpContextMenu = popUpContextMenu;
  destroy() {}
  setContextMenu() {}
}
mock.module("electron", () => ({
  Menu: { buildFromTemplate: (items: MenuItemConstructorOptions[]) => items },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false, setTemplateImage: () => undefined }) },
  Notification: class {},
  Tray: TrayFixture,
}));
const { createTray } = await import("../src/main/tray");

test.each(["darwin", "win32"] as const)("tray click opens the window and right click displays commands on %s", platform => {
  popUpContextMenu.mockClear();
  const open = mock(() => undefined);
  const quit = mock(() => undefined);
  const tray = createTray({
    platform,
    assets: "/isolated",
    locale: () => "en-US",
    state: () => ({ local: false, state: "not-installed", busy: false, stopServiceOnQuit: false }),
    refresh: async () => undefined,
    actions: { open, start: () => undefined, stop: () => undefined, quit },
  });
  nativeTray.emit("click");
  expect(open).toHaveBeenCalledTimes(1);
  nativeTray.emit("right-click");
  expect(popUpContextMenu).toHaveBeenCalledTimes(1);
  const [menu] = popUpContextMenu.mock.calls[0]!;
  expect(menu.map(item => item.label)).toEqual(["Open OutcomeGo", "Quit OutcomeGo"]);
  expect(menu[1]?.click).toBe(quit);
  tray.destroy();
});

test("local right-click waits for quick refresh before popping up menu and falls back on timeout", async () => {
  popUpContextMenu.mockClear();
  let state: "starting" | "running" = "starting";
  const manage = mock(() => undefined);
  const restart = mock(() => undefined);
  const autostart = mock(() => undefined);
  const logsFolder = mock(() => undefined);
  const tray = createTray({
    platform: "win32",
    assets: "/isolated",
    locale: () => "zh-CN",
    state: () => ({
      local: true,
      state,
      busy: false,
      stopServiceOnQuit: false,
      engineKind: "managed-wsl",
      autostartEnabled: true,
      autostartSupported: true,
    }),
    refresh: async () => {
      await new Promise((r) => setTimeout(r, 15));
      state = "running";
    },
    staleMs: 5,
    rightClickTimeoutMs: 200,
    actions: {
      open: () => undefined,
      start: () => undefined,
      stop: () => undefined,
      quit: () => undefined,
      manage,
      restart,
      autostart,
      "logs-folder": logsFolder,
    },
  });

  nativeTray.emit("right-click");
  await new Promise((r) => setTimeout(r, 50));
  expect(popUpContextMenu).toHaveBeenCalledTimes(1);
  const [menu] = popUpContextMenu.mock.calls[0]!;
  expect(menu.some((item) => item.label === "本地服务：运行中")).toBe(true);
  expect(menu.find((item) => item.label === "服务管理…")?.click).toBe(manage);
  expect(menu.find((item) => item.label === "重启本地服务")?.click).toBe(restart);
  expect(menu.find((item) => item.label === "开机自动启动本地服务")).toMatchObject({
    type: "checkbox",
    checked: true,
    click: autostart,
  });
  expect(menu.find((item) => item.label === "打开日志目录")?.click).toBe(logsFolder);
  tray.destroy();
});
