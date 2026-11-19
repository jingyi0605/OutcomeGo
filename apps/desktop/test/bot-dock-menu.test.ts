import { describe, expect, test } from "bun:test";
import type { MenuItemConstructorOptions } from "electron";
import { applicationMenuTemplate, withBotDockToggle } from "../src/main/application-menu";

const fileMenu = (template: MenuItemConstructorOptions[], label: string) =>
  template.find((item) => item.label === label)?.submenu as MenuItemConstructorOptions[];

describe("Bot floating window menu switch", () => {
  for (const platform of ["darwin", "win32"] as const) {
    test(`sits right after ScreenBot in the File menu on ${platform}`, () => {
      const toggled: boolean[] = [];
      const template = withBotDockToggle(
        applicationMenuTemplate(platform, "en-US", () => {}),
        "en-US",
        true,
        (enabled) => toggled.push(enabled)
      );
      const submenu = fileMenu(template, "File");
      const screenbot = submenu.findIndex((item) => item.label === "Open ScreenBot");
      const toggle = submenu[screenbot + 1]!;
      expect(toggle).toMatchObject({
        label: "Show Bot Floating Window",
        type: "checkbox",
        checked: true,
      });
      (toggle.click as Function)({ checked: false }, undefined, {});
      expect(toggled).toEqual([false]);
    });
  }

  test("is localized and reflects the current setting", () => {
    const template = withBotDockToggle(
      applicationMenuTemplate("win32", "zh-CN", () => {}),
      "zh-CN",
      false,
      () => {}
    );
    const toggle = fileMenu(template, "文件").find((item) => item.label === "显示机器人浮窗");
    expect(toggle).toMatchObject({ type: "checkbox", checked: false });
  });

  test("leaves every other menu untouched", () => {
    const base = applicationMenuTemplate("darwin", "en-US", () => {});
    const template = withBotDockToggle(base, "en-US", true, () => {});
    expect(template).toHaveLength(base.length);
    expect(template.filter((item) => item.label !== "File")).toEqual(
      base.filter((item) => item.label !== "File")
    );
  });
});
