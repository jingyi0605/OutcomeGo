import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BotDockBridge } from "../src/renderer/botdock/types";

// Main starts the dock pages with this argument when OUTCOMEGO_DOCK_DEBUG=1.
process.argv.push("--outcomego-dock-debug");

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

test("turns diagnostics on from the argument main passes, and reports to the channel main logs", () => {
  expect(dockBridge.debug).toBe(true);
  dockBridge.debugLog?.({ event: "drop", types: ["Files"] });
  expect(send.mock.calls).toEqual([["botdock:debug", { event: "drop", types: ["Files"] }]]);
});
