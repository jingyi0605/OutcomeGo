import { expect, test } from "bun:test";
import { buildTrayMenu } from "../src/main/tray-menu";

test.each(["stopped", "running", "unhealthy", "starting", "updating"] as const)("tray shows only matching local controls in %s", state => {
  const remote = buildTrayMenu({ local: false, state, busy: false, stopServiceOnQuit: false });
  expect(remote.map(item => item.action)).toEqual(["open", "quit"]);
  const local = buildTrayMenu({ local: true, state, busy: state === "starting", stopServiceOnQuit: false });
  expect(local.map(item => item.action)).toEqual(["open", "status", state === "running" ? "stop" : "start", "quit"]);
  expect(local[2]?.enabled).toBe(state !== "starting" && state !== "updating");
  expect(local.at(-1)?.label).toContain("keep local services running");
});
