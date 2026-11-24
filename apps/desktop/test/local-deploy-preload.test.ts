import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

const invoke = mock(async (_channel: string, ..._args: unknown[]) => undefined);
const ipcRenderer = Object.assign(new EventEmitter(), { invoke });
let bridge: Window["outcomego"];
mock.module("electron", () => ({
  contextBridge: { exposeInMainWorld: (_name: string, value: Window["outcomego"]) => { bridge = value; } },
  ipcRenderer,
}));
await import("../src/preload/index");

test("preload exposes fixed local service routes and retains detect", async () => {
  const server = bridge!.localServer;
  await server.detect();
  await server.status();
  await server.start();
  await server.stop();
  await server.remove({ purgeData: false });
  await server.diagnostics();
  await server.resources({ computerMemory: "4g", desktopMemory: "3g" });
  expect(invoke.mock.calls).toEqual([
    ["outcomego:local-server:detect"], ["outcomego:local-server:status"],
    ["outcomego:local-server:start"], ["outcomego:local-server:stop"],
    ["outcomego:local-server:remove", { purgeData: false }], ["outcomego:local-server:diagnostics"],
    ["outcomego:local-server:resources", { computerMemory: "4g", desktopMemory: "3g" }],
  ]);
});

test("progress listeners receive only the event payload and can unsubscribe", () => {
  const progress = { schemaVersion: 1, deployId: "fixture", type: "log" as const, ts: "2026-11-24T00:00:00Z" };
  const receive = mock(() => undefined);
  const unsubscribe = bridge!.localDeploy.onProgress(receive);
  ipcRenderer.emit("outcomego:local-deploy:progress", { sender: ipcRenderer }, progress);
  unsubscribe();
  ipcRenderer.emit("outcomego:local-deploy:progress", { sender: ipcRenderer }, progress);
  expect(receive.mock.calls).toEqual([[progress]]);
});
