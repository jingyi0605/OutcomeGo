import { describe, expect, test } from "bun:test";
import { buildTrayMenu } from "../src/main/tray-menu";

describe("buildTrayMenu", () => {
  test.each(["stopped", "running", "unhealthy", "starting", "updating", "not-installed"] as const)(
    "remote mode always shows only open and quit in %s",
    (state) => {
      const remote = buildTrayMenu({
        local: false,
        state,
        busy: false,
        stopServiceOnQuit: false,
      });
      expect(remote.map((item) => item.action)).toEqual(["open", "quit"]);
      expect(remote[1]?.label).toBe("Quit OutcomeGo");
    }
  );

  test("local mode includes manage, start/stop, restart, autostart checkbox, logs folder, and quit", () => {
    const running = buildTrayMenu({
      local: true,
      state: "running",
      busy: false,
      stopServiceOnQuit: false,
      engineKind: "managed-wsl",
      autostartEnabled: true,
      autostartSupported: true,
    });
    expect(running.map((i) => i.action)).toEqual([
      "open",
      "status",
      "manage",
      "stop",
      "restart",
      "autostart",
      "logs-folder",
      "quit",
    ]);
    expect(running.find((i) => i.action === "stop")?.enabled).toBe(true);
    expect(running.find((i) => i.action === "restart")?.enabled).toBe(true);
    expect(running.find((i) => i.action === "autostart")).toMatchObject({
      type: "checkbox",
      checked: true,
      enabled: true,
    });
    expect(running.find((i) => i.action === "logs-folder")?.enabled).toBe(true);
    expect(running.at(-1)?.label).toContain("keep local services running");
  });

  test("disables autostart checkbox on external engine and disables lifecycle actions while busy", () => {
    const external = buildTrayMenu({
      local: true,
      state: "stopped",
      busy: false,
      stopServiceOnQuit: true,
      engineKind: "external",
      autostartEnabled: false,
      autostartSupported: false,
    });
    expect(external.find((i) => i.action === "start")?.enabled).toBe(true);
    expect(external.find((i) => i.action === "restart")?.enabled).toBe(false);
    expect(external.find((i) => i.action === "autostart")).toMatchObject({
      type: "checkbox",
      checked: false,
      enabled: false,
    });
    expect(external.at(-1)?.label).toBe("Quit OutcomeGo");

    const busyMenu = buildTrayMenu({
      local: true,
      state: "running",
      busy: true,
      stopServiceOnQuit: false,
      engineKind: "managed-lima",
      autostartEnabled: true,
      autostartSupported: true,
    });
    expect(busyMenu.find((i) => i.action === "stop")?.enabled).toBe(false);
    expect(busyMenu.find((i) => i.action === "restart")?.enabled).toBe(false);
    expect(busyMenu.find((i) => i.action === "autostart")?.enabled).toBe(false);
    expect(busyMenu.find((i) => i.action === "manage")?.enabled).toBe(true);
  });
});
