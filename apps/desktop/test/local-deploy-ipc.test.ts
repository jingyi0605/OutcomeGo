import { expect, test } from "bun:test";
import { registerLocalDeployIpc } from "../src/main/local-deploy-ipc";
import { LocalDeployManager, localServiceArguments } from "../src/main/local-deploy";

const fixture = () => {
  const accepted = {};
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const manager = new LocalDeployManager({ directory: "/isolated", version: "1.2.3", installation: () => null });
  const server = { stack: { state: "not-installed" as const, services: [] }, awaiting: null, apiPort: null, engine: null, ownerUsername: null, version: null };
  manager.status = async () => server;
  let loaded = 0;
  registerLocalDeployIpc({
    handle: (channel, handler) => handlers.set(channel, handler as (event: unknown, ...args: unknown[]) => unknown),
    requireAuthSender: event => { if (event !== accepted) throw new Error("Authentication is unavailable"); },
    load: async () => { loaded++; return { manager, localServiceArguments }; },
    isSupported: () => true,
    currentServer: () => undefined,
    onProgress: () => undefined,
  });
  return {
    handlers,
    loaded: () => loaded,
    call: (channel: string, ...args: unknown[]) => handlers.get(`outcomego:${channel}`)!(accepted, ...args),
  };
};

test("IPC rejects a foreign sender before loading the local CLI manager", async () => {
  const entry = fixture();
  expect(entry.handlers.size).toBe(22);
  for (const handler of entry.handlers.values()) {
    await expect(Promise.resolve().then(() => handler({}))).rejects.toThrow("Authentication is unavailable");
  }
  expect(entry.loaded()).toBe(0);
});

test.each([
  ["local-deploy:start", [{ username: "a", password: "x".repeat(1025) }]],
  ["local-deploy:cancel", [123]],
  ["local-deploy:enable-wsl", [false]],
  ["local-deploy:engines", [true]],
  ["local-server:status", [false]],
  ["local-server:start", [{ apiPort: 65536 }]],
  ["local-server:stop", ["server"]],
  ["local-server:remove", [{ purgeData: "false" }]],
  ["local-server:diagnostics", [123]],
  ["local-server:resources", [{ computerMemory: "-g", desktopMemory: "1g" }]],
  ["local-server:restart", ["migrate"]],
  ["local-server:restart", ["server;rm -rf /"]],
  ["local-server:containers", [{ includeStats: "yes" }]],
  ["local-server:logs", [{ service: "evil", tail: 200 }]],
  ["local-server:logs", [{ service: "server", tail: 5 }]],
  ["local-server:open-logs-folder", ["extra"]],
  ["local-server:autostart-status", ["extra"]],
  ["local-server:autostart-set", ["true"]],
  ["local-server:resources-status", ["extra"]],
  ["local-server:resources-update", [{}]],
  ["local-server:resources-update", [{ workerConcurrency: 99 }]],
  ["local-server:proxy-status", ["extra"]],
  ["local-server:system-proxy", ["extra"]],
  ["local-server:proxy-save", [{ mode: "manual", protocol: "ftp", host: "127.0.0.1", port: 7890 }]],
  ["local-server:proxy-test", [{ mode: "manual", protocol: "http", host: "bad host\n", port: 7890 }]],
] as const)("IPC rejects malformed parameters for %s", async (channel, args) => {
  await expect(Promise.resolve().then(() => fixture().call(channel, ...args))).rejects.toThrow("INVALID_INPUT");
});
