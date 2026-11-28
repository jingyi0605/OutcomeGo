import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { LocalDeployManager, localDeployRequest } from "../src/main/local-deploy";
import { stackStates } from "../src/renderer/lib/local-deploy-contract";

const password = "local-owner-sentinel-004";
const request = { username: "local-owner", password };
const event = { schemaVersion: 1, ts: "2026-11-24T00:00:00Z", type: "stage", stage: "detect", status: "started" };
const result = { schemaVersion: 1, ts: event.ts, type: "result", result: { url: "http://127.0.0.1:8787", username: "local-owner", directory: "/isolated", version: "1.2.3", engine: "external" } };

const fixture = (platform: NodeJS.Platform = "darwin") => {
  const events: unknown[] = [];
  const calls: unknown[] = [];
  const input: string[] = [];
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 123 });
  child.stdin.on("data", (chunk) => input.push(String(chunk)));
  let install: { apiPort: string; directory: string; version: string } | null = null;
  const prepare = Promise.withResolvers<string>();
  const spawn = Promise.withResolvers<void>();
  const manager = new LocalDeployManager({
    directory: "/isolated", version: "1.2.3", platform,
    installation: () => install,
    prepare: () => prepare.promise,
    spawn: ((program, args, options) => {
      calls.push([program, args, options]);
      spawn.resolve();
      return child;
    }) as ConstructorParameters<typeof LocalDeployManager>[0]["spawn"],
    terminate: (process) => { calls.push(["terminate", process.pid]); child.emit("close", 130); },
  });
  const send = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`);
  return {
    manager, calls, input, events, child, prepare, spawn, send,
    setInstalled: () => { install = { apiPort: "8787", directory: "/isolated", version: "1.2.3" }; },
    start: (serverUrl?: string) => manager.start(request, (value) => events.push(value), serverUrl),
  };
};

test("deployment request rejects credentials or routing fields of the wrong shape", () => {
  expect(localDeployRequest(request)).toEqual(request);
  for (const value of [[], { ...request, apiPort: 0 }, { ...request, engine: [] }, { ...request, acceptLowMemory: 1 }, { ...request, password: "x".repeat(1025) }, { ...request, serverUrl: "https://remote.invalid" }])
    expect(() => localDeployRequest(value)).toThrow("INVALID_INPUT");
});

test("never spawns writes for a non-loopback or wrong port on an existing installation", () => {
  const entry = fixture();
  entry.setInstalled();
  expect(() => entry.start("https://remote.invalid")).toThrow("INVALID_INPUT");
  expect(() => entry.start("http://127.0.0.1:8900")).toThrow("INVALID_INPUT");
  expect(entry.calls).toEqual([]);
});

test("lease rejects overlapping operations and accepts cancellation before the carrier is ready", async () => {
  const entry = fixture();
  const deployment = entry.start();
  expect(() => entry.start()).toThrow("BUSY");
  const finished = entry.manager.cancel(deployment.deployId);
  entry.prepare.resolve("/stable/outcomego");
  await finished;
  expect(entry.calls).toEqual([]);
  expect(entry.events.at(-1)).toMatchObject({ type: "error", code: "CANCELLED" });
});

test("writes credentials once through stdin, reconstructs half-lines, and redacts a leaked sentinel", async () => {
  const entry = fixture();
  entry.start();
  entry.prepare.resolve("/stable/outcomego");
  await entry.spawn.promise;
  expect(entry.input).toHaveLength(1);
  expect(JSON.parse(entry.input[0]!)).toEqual({ schemaVersion: 1, owner: request });
  expect(JSON.stringify(entry.calls)).not.toContain(password);
  const line = JSON.stringify({ ...event, message: `testing ${password}` });
  entry.child.stdout.write(line.slice(0, 40));
  expect(entry.events).not.toContainEqual(expect.objectContaining({ status: "started" }));
  entry.child.stdout.write(line.slice(40) + "\n");
  entry.send(result);
  entry.child.emit("close", 0);
  await Promise.resolve();
  expect(entry.events).toContainEqual(expect.objectContaining({ stage: "detect", message: "testing [REDACTED]" }));
  expect(entry.events.at(-1)).toMatchObject({ type: "result" });
  expect(JSON.stringify(entry.events)).not.toContain(password);
});

test("forwards valid image retry progress from the CLI", async () => {
  const entry = fixture();
  entry.start();
  entry.prepare.resolve("/stable/outcomego");
  await entry.spawn.promise;
  const retry = { type: "pull-retry", stage: "pull", attempt: 1, total: 2 };
  entry.send({ ...event, ...retry, attempt: 0 });
  entry.send({ ...event, ...retry, attempt: 3 });
  entry.send({ ...event, ...retry, stage: "start" });
  entry.send({ ...event, ...retry });
  entry.send(result);
  entry.child.emit("close", 0);
  await Promise.resolve();
  expect(entry.events).toEqual([expect.objectContaining(retry), expect.objectContaining({ type: "result" })]);
});

test("unknown event schema terminates the child and reports CLI_VERSION_MISMATCH", async () => {
  const entry = fixture();
  entry.start();
  entry.prepare.resolve("/stable/outcomego");
  await entry.spawn.promise;
  entry.send({ ...event, schemaVersion: 2 });
  await Promise.resolve();
  expect(entry.calls.at(-1)).toEqual(["terminate", 123]);
  expect(entry.events.at(-1)).toMatchObject({ type: "error", code: "CLI_VERSION_MISMATCH" });
});

test("cancelling a spawned deployment uses the process tree terminator and releases the lease", async () => {
  const entry = fixture();
  const deployment = entry.start();
  entry.prepare.resolve("/stable/outcomego");
  await entry.spawn.promise;
  await entry.manager.cancel(deployment.deployId);
  expect(entry.calls.at(-1)).toEqual(["terminate", 123]);
  expect(entry.events.at(-1)).toMatchObject({ type: "error", code: "CANCELLED" });
  expect(entry.manager.busy).toBe(false);
});

test("Windows requests cooperative cancellation after closing credential stdin", async () => {
  const entry = fixture("win32");
  const deployment = entry.start();
  entry.prepare.resolve("/stable/outcomego.exe");
  await entry.spawn.promise;
  const calls = entry.calls as Array<[string, string[], { env: NodeJS.ProcessEnv }]>;
  const marker = calls[0]![2].env.OUTCOMEGO_BOOTSTRAP_CANCEL_FILE!;
  try {
    expect(entry.child.stdin.writableEnded).toBe(true);
    expect(existsSync(dirname(marker))).toBe(true);
    expect(existsSync(marker)).toBe(false);
    const cancelled = entry.manager.cancel(deployment.deployId);
    expect(readFileSync(marker, "utf8")).toBe("");
    expect(entry.calls).toHaveLength(1);
    entry.child.emit("close", 130);
    await cancelled;
    expect(existsSync(dirname(marker))).toBe(false);
    expect(entry.manager.busy).toBe(false);
    expect(entry.events.at(-1)).toMatchObject({ type: "error", code: "CANCELLED" });
  } finally {
    entry.child.emit("close", 130);
    await entry.manager.cancel(deployment.deployId);
  }
});

const statusFixture = (directory: string, snapshot: unknown, doctor = "Doctor fixture", installed = true) => {
  const calls: string[][] = [];
  const manager = new LocalDeployManager({
    directory, version: "1.2.3", executablePath: "/desktop", bundledCli: "/bundled-cli.js",
    installation: () => installed ? { directory, apiPort: "8787", version: "1.2.3" } : null,
    spawn: ((_program, args: string[]) => {
      calls.push(args);
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
      child.stdout.once("end", () => child.emit("close", snapshot === null ? 1 : 0));
      queueMicrotask(() => child.stdout.end(args.includes("doctor") ? doctor : JSON.stringify(snapshot)));
      return child;
    }) as ConstructorParameters<typeof LocalDeployManager>[0]["spawn"],
  });
  return { manager, calls };
};

test.each(stackStates)("reads %s from the CLI without invoking a write command", async state => {
  const entry = statusFixture("/isolated", { stack: { state, services: [] } });
  expect((await entry.manager.status()).stack.state).toBe(state);
  expect(entry.calls).toEqual([["/bundled-cli.js", "status", "--json", "--dir", "/isolated"]]);
});

test("a failed status command resolves to unhealthy with a reason", async () => {
  expect(await statusFixture("/isolated", null).manager.status()).toMatchObject({ stack: { state: "unhealthy" }, reason: "ENGINE_UNAVAILABLE" });
});

const enginesFixture = (outputs: Record<string, unknown>, platform: NodeJS.Platform = "darwin") => {
  const calls: string[][] = [];
  const manager = new LocalDeployManager({
    directory: "/isolated", version: "1.2.3", executablePath: "/desktop", bundledCli: "/bundled-cli.js", platform,
    installation: () => null,
    spawn: ((_program, args: string[]) => {
      calls.push(args);
      const answer = outputs[args[args.indexOf("--engine") + 1]!];
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
      child.stdout.once("end", () => child.emit("close", answer === undefined ? 1 : 0));
      queueMicrotask(() => child.stdout.end(answer === undefined ? "" : JSON.stringify(answer)));
      return child;
    }) as ConstructorParameters<typeof LocalDeployManager>[0]["spawn"],
  });
  return { manager, calls };
};

test("engine probes read each engine and local host resources without starting anything", async () => {
  const entry = enginesFixture({
    external: { state: "ready", reasons: [], engineVersion: "27.3.1", memoryBytes: 8 * 1024 ** 3, engine: { kind: "external", name: "Docker", version: "27.3.1" } },
    managed: { state: "needs-setup", reasons: [], code: "WSL_NOT_ENABLED", engine: { kind: "managed-wsl", name: "OutcomeGo engine" } },
  });
  const result = await entry.manager.engines();
  expect(result.external).toEqual({ state: "ready", reasons: [], name: "Docker", version: "27.3.1", memoryBytes: 8 * 1024 ** 3 });
  expect(result.managed).toEqual({ state: "needs-setup", code: "WSL_NOT_ENABLED", reasons: [], name: "OutcomeGo engine" });
  expect(result.resources).toMatchObject({
    apiPort: 8787,
    arch: expect.any(String),
    cpuCores: expect.any(Number),
    memoryBytes: expect.any(Number),
  });
  expect(typeof result.resources?.apiPortAvailable).toBe("boolean");
  expect(entry.calls.map(args => args.slice(0, 5)).sort()).toEqual([
    ["/bundled-cli.js", "engine", "status", "--json", "--engine"], ["/bundled-cli.js", "engine", "status", "--json", "--engine"],
  ]);
  expect(entry.calls.flat().filter(argument => ["bootstrap", "start", "uninstall", "enable-wsl"].includes(argument))).toEqual([]);
});

test("a failed or malformed engine probe reports unknown instead of failing the screen", async () => {
  const entry = enginesFixture({ external: { state: "exploded", reasons: [] } });
  const result = await entry.manager.engines();
  expect(result.external).toEqual({ state: "unknown", reasons: [] });
  expect(result.managed).toEqual({ state: "unknown", reasons: [] });
  expect(result.resources?.apiPort).toBe(8787);
});

test("engine probes keep reasons bounded and redact secret-looking lines", async () => {
  const entry = enginesFixture({
    external: { state: "unsupported", code: "ENGINE_INCOMPATIBLE", reasons: ["a", "OUTCOMEGO_AUTH_SECRET=leaked", "x".repeat(401), "b", "c", "d", "e"] },
    managed: { state: "ready", reasons: [] },
  });
  const { external } = await entry.manager.engines();
  expect(external.reasons).toEqual(["a", "OUTCOMEGO_AUTH_SECRET=[REDACTED]", "b", "c"]);
  expect(JSON.stringify(external)).not.toContain("leaked");
});

test("a computer without a managed engine is only probed for its own", async () => {
  const entry = enginesFixture({ external: { state: "stopped", reasons: ["Start Docker."] } }, "linux");
  const result = await entry.manager.engines();
  expect(result.external).toEqual({ state: "stopped", reasons: ["Start Docker."] });
  expect(result.managed).toBeNull();
  expect(result.resources?.apiPort).toBe(8787);
  expect(entry.calls).toHaveLength(1);
});

test("diagnostics returns the failed stage and strips credential values", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-diagnostic-"));
  try {
    const log = join(directory, "logs");
    mkdirSync(log);
    writeFileSync(join(log, "bootstrap-2026-11-24T00-00-00.000Z-00000000-0000-0000-0000-000000000000.log"),
      `stage=pull failed\nOUTCOMEGO_OWNER_PASSWORD=${password}\nOUTCOMEGO_CONTROL_TOKEN=ControlSentinel\n`);
    const snapshot = { stack: { state: "unhealthy", services: [] }, engine: { engine: { kind: "external" } } };
    const diagnostic = await statusFixture(directory, snapshot, "Doctor fixture\nOUTCOMEGO_AUTH_SECRET=AuthSentinel").manager.diagnostics();
    expect(diagnostic).toContain("stage=pull failed");
    expect(diagnostic).toContain("external");
    expect(diagnostic).toContain("Doctor fixture");
    for (const secret of [password, "ControlSentinel", "AuthSentinel"]) expect(diagnostic).not.toContain(secret);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("awaiting deployment can prefill the owner before installation exists", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-awaiting-"));
  try {
    writeFileSync(join(directory, "deploy-state.json"), JSON.stringify({ schemaVersion: 1, awaiting: "reboot", ownerUsername: "local-owner" }));
    const { manager } = statusFixture(directory, { stack: { state: "not-installed", services: [] } }, "", false);
    expect(await manager.status()).toMatchObject({ awaiting: "reboot", ownerUsername: "local-owner" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test.each(["stopped", "removed", "pending", "remote", "quitting"] as const)("background recovery only starts the selected installed stack (%s)", async scenario => {
  const directory = "/isolated";
  const manager = new LocalDeployManager({ directory, version: "1.2.3", installation: () => ({
    directory, version: "1.2.3", apiPort: "8787", ownerUsername: "local-owner", uninstalled: scenario === "removed",
  }) });
  const deferred = Promise.withResolvers<Awaited<ReturnType<typeof manager.status>>>();
  const calls: string[] = [];
  let server = "http://127.0.0.1:8787";
  let quitting = false;
  manager.status = () => deferred.promise;
  manager.service = async (action) => { calls.push(action); return deferred.promise; };
  const recovery = manager.restore(() => server, () => quitting);
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(calls).toEqual([]);
  if (scenario === "remote") server = "https://remote.invalid";
  if (scenario === "quitting") quitting = true;
  deferred.resolve({ stack: { state: "stopped", services: [] }, engine: null, version: "1.2.3", apiPort: 8787,
    ownerUsername: "local-owner", awaiting: scenario === "pending" ? "reboot" : null });
  await recovery;
  expect(calls).toEqual(scenario === "stopped" ? ["start"] : []);
});

test("saveProxy passes credentials exclusively via stdin and enforces BUSY mutex", async () => {
  const capturedArgs: string[][] = [];
  const capturedStdin: string[] = [];
  let releaseSecond: (() => void) | null = null;
  const manager = new LocalDeployManager({
    directory: "/isolated",
    version: "1.2.3",
    installation: () => ({ directory: "/isolated", version: "1.2.3", apiPort: "8787", ownerUsername: "owner" }),
    prepare: async () => "/fake-cli",
    spawn: (_command, args) => {
      capturedArgs.push([...args]);
      const child = new EventEmitter() as unknown as ReturnType<NonNullable<ConstructorParameters<typeof LocalDeployManager>[0]["spawn"]>>;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      let buf = "";
      stdin.on("data", (c) => { buf += String(c); });
      stdin.on("end", () => { capturedStdin.push(buf); });
      Object.assign(child, { stdout, stderr, stdin, kill: () => true });
      const finish = () => {
        stdout.end(JSON.stringify({
          schemaVersion: 1,
          mode: "manual",
          protocol: "http",
          host: "127.0.0.1",
          port: 7890,
          username: "alice",
          hasPassword: true,
          noProxy: "",
          applyToContainers: true,
          applyToDockerDaemon: true,
          loopbackMappedHost: "host.docker.internal",
          systemResolved: null,
        }) + "\n");
        queueMicrotask(() => child.emit("close", 0));
      };
      if (capturedArgs.length === 1) {
        releaseSecond = finish;
      } else {
        setTimeout(finish, 0);
      }
      return child;
    },
  });

  const first = manager.saveProxy(
    {
      mode: "manual",
      protocol: "http",
      host: "127.0.0.1",
      port: 7890,
      username: "alice",
      password: "SuperSecretProxyPwd!",
    },
    "http://127.0.0.1:8787"
  );
  await new Promise((r) => setTimeout(r, 5));
  await expect(manager.setAutostart(true, "http://127.0.0.1:8787")).rejects.toThrow("BUSY");
  releaseSecond?.();
  const saved = await first;
  expect(saved.hasPassword).toBe(true);
  expect(capturedArgs[0]?.join(" ")).not.toContain("SuperSecretProxyPwd!");
  expect(capturedArgs[0]).toContain("--config-stdin");
  expect(capturedStdin[0]).toContain("SuperSecretProxyPwd!");
});
