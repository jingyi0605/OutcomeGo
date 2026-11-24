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
  Notification: class {}, Tray: TrayFixture,
}));
const { createTray } = await import("../src/main/tray");

test.each(["darwin", "win32"] as const)("tray click opens the window and right click displays commands on %s", platform => {
  popUpContextMenu.mockClear();
  const open = mock(() => undefined);
  const quit = mock(() => undefined);
  const tray = createTray({ platform, assets: "/isolated", locale: () => "en-US",
    state: () => ({ local: false, state: "not-installed", busy: false, stopServiceOnQuit: false }),
    refresh: async () => undefined, actions: { open, start: () => undefined, stop: () => undefined, quit },
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
