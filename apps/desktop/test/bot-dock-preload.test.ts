import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BotDockBridge } from "../src/renderer/botdock/types";

const send = mock((_channel: string, ..._payload: unknown[]) => {});
const ipcRenderer = Object.assign(new EventEmitter(), { send });
let dockBridge: BotDockBridge;
mock.module("electron", () => ({
  contextBridge: {
    exposeInMainWorld(_key: string, bridge: BotDockBridge) {
      dockBridge = bridge;
    },
  },
  ipcRenderer,
}));
await import("../src/preload/botdock");

test("reports file hover separately from the capsule size and relays composer visibility", () => {
  dockBridge.resize(112, 64, "compact");
  dockBridge.setFileHover(true);
  dockBridge.setFileHover(false);
  expect(send.mock.calls).toEqual([
    ["botdock:resize", 112, 64, "compact"],
    ["botdock:file-hover", true],
    ["botdock:file-hover", false],
  ]);

  const onVisible = mock((_visible: boolean) => {});
  const stop = dockBridge.onSurfaceVisible(onVisible);
  ipcRenderer.emit("botdock:surface-visible", {}, true);
  ipcRenderer.emit("botdock:surface-visible", {}, false);
  stop();
  ipcRenderer.emit("botdock:surface-visible", {}, true);
  expect(onVisible.mock.calls).toEqual([[true], [false]]);
});
