import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArguments } from "../src/arguments";
import { bootstrapCommand, watchBootstrapCancellation } from "../src/bootstrap";
import { installationPaths, parseEnvironment, readManifest } from "../src/config";
import { DEFAULT_IMAGE_PREFIX } from "../src/constants";
import { ComposeProject } from "../src/docker";
import type { DeployProgressEvent } from "../src/deploy-events";
import { imageSourcesPath, registrySources } from "../src/engine/image-sources";
import type { CommandRunner, RunOptions, RunResult } from "../src/process";
import { ManagedEngine } from "../src/engine/managed";

const password = "bootstrap-test-sentinel-9Z!";
const request = JSON.stringify({ schemaVersion: 1, owner: { username: "local-owner", password } });
const image = `registry.invalid/computer@sha256:${"a".repeat(64)}`;
const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });

class FakeRunner implements CommandRunner {
  calls: string[] = [];
  cached = true;
  incompatible = false;
  fail = "";
  computer = image;

  run(command: string, args: readonly string[], _options?: RunOptions): RunResult {
    const action = args.includes("--file") ? args[args.indexOf("--file") + 2] : args[0];
    this.calls.push(action!);
    if (this.fail === action) return { status: 1, stdout: "", stderr: password };
    if (command !== "docker") throw new Error(`Unexpected command: ${command}`);
    if (action === "--version") return ok("Docker version 29.9.2");
    if (action === "info") return ok(JSON.stringify({ ServerVersion: "29.9.2", CgroupVersion: "2", OSType: "linux", MemTotal: 8 * 1024 ** 3 }));
    if (action === "compose") return ok("Docker Compose version v2.20.0");
    if (action === "context") return ok("unix:///tmp/docker.sock");
    if (action === "config") return ok(JSON.stringify({ services: { computer: { image: this.computer }, "computer-memory-init": { image: this.computer }, server: { image: "registry.invalid/server:1" } } }));
    if (action === "ps" || action === "down") return ok();
    if (action === "image") return args.at(-1) !== image || this.cached ? ok("sha256:cached") : { status: 1, stdout: "", stderr: "No such image" };
    if (action === "run") return ok(`systempaths\ncgroup\n${this.incompatible ? "no-" : ""}tun\n`);
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  }
}

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "outcomego-bootstrap-"));
  const paths = installationPaths(join(root, "isolated"));
  const options = parseArguments(["bootstrap", "--json-progress", "--version", "1.2.3", "--api-port", "18787"]);
  const runner = new FakeRunner();
  const lines: string[] = [];
  const controller = new AbortController();
  const dependencies = {
    managed: null,
    signal: controller.signal,
    readInput: async () => request,
    write: (line: string) => lines.push(line),
    diskBytes: () => 16 * 1024 ** 3,
    hostMemoryBytes: () => 16 * 1024 ** 3,
    findConflict: async () => null,
    download: async () => {
      if (runner.fail === "release") throw new Error("offline");
      return { version: "1.2.3", composeUrl: "https://example.invalid/compose.yaml", checksumUrl: "https://example.invalid/SHA256SUMS", signatureUrl: "https://example.invalid/sig", compose: "services: {}\n" };
    },
    stream: async (_command: string, args: readonly string[], runOptions: { input?: string; env?: NodeJS.ProcessEnv; onStdoutLine?: (line: string) => void } = {}) => {
      const action = args[args.indexOf("--file") + 2]!;
      runner.calls.push(action);
      expect(args.join(" ")).not.toContain(password);
      expect(JSON.stringify(runOptions.env)).not.toContain(password);
      if (action === "exec") expect(JSON.parse(runOptions.input!)).toEqual({ operation: "setup", username: "local-owner", password });
      else expect(runOptions.input).toBeUndefined();
      runOptions.onStdoutLine?.(password);
      if (runner.fail === "cancel") controller.abort();
      if (action === "pull") runner.cached = true;
      return { status: runner.fail === action ? 1 : 0 };
    },
    health: async () => ({ ok: runner.fail !== "health", url: "http://127.0.0.1:18787/api/v0/health", detail: "ready", version: "1.2.3" }),
    enableUpdates: () => undefined,
  };
  return { root, paths, options, runner, lines, dependencies, run: () => bootstrapCommand(paths, options, runner, dependencies), events: () => lines.map((line) => JSON.parse(line) as DeployProgressEvent) };
};

test.each([true, false])("bootstrap probes the signed image on the right side of pull (cached: %s)", async (cached) => {
  const entry = fixture();
  try {
    entry.runner.cached = cached;
    const started = Date.now();
    expect(await entry.run()).toBe(0);
    expect(Date.parse(entry.events()[0]!.ts) - started).toBeLessThan(2_000);
    expect(entry.events().at(-1)).toMatchObject({ type: "result", result: { url: "http://127.0.0.1:18787", engine: "external", username: "local-owner", version: "1.2.3" } });
    expect((entry.runner.calls.indexOf("run") < entry.runner.calls.indexOf("pull"))).toBe(cached);
    expect(entry.runner.calls.indexOf("run")).toBeLessThan(entry.runner.calls.indexOf("up"));
    expect(readManifest(entry.paths)?.ownerUsername).toBe("local-owner");
    const config = readFileSync(entry.paths.environment, "utf8");
    const environment = parseEnvironment(config);
    expect(environment.get("OUTCOMEGO_BIND_HOST")).toBe("127.0.0.1");
    expect(environment.get("OUTCOMEGO_VIEWER_BIND_HOST")).toBe("127.0.0.1");
    expect(environment.get("OUTCOMEGO_API_PORT")).toBe("18787");
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    entry.runner.calls.length = 0;
    expect(await entry.run()).toBe(0);
    expect(hash(readFileSync(entry.paths.environment, "utf8"))).toBe(hash(config));
    expect(entry.runner.calls).not.toContain("exec");
    expect(entry.runner.calls).not.toContain("pull");
    expect(entry.lines.join("")).not.toContain(password);
    for (const name of readdirSync(entry.paths.directory, { recursive: true, withFileTypes: true })) {
      if (name.isFile()) expect(readFileSync(join(name.parentPath, name.name), "utf8")).not.toContain(password);
    }
  } finally {
    rmSync(entry.root, { recursive: true, force: true });
  }
});

class ManagedFixture extends ManagedEngine {
  readonly kind = "managed-lima";
  constructor(private readonly entry: ReturnType<typeof fixture>) {
    super({ paths: entry.paths, runner: entry.runner, architecture: "arm64", release: "22.5.0" });
    const original = entry.runner.run.bind(entry.runner);
    entry.runner.run = (command, args, options) => command === "fake-lima" ? original("docker", args, options) : original(command, args, options);
  }
  override async detect() { return { state: "needs-setup" as const, reasons: [] }; }
  override async ensureReady(_event?: (message: string) => void, options?: { apiPort?: number }) {
    expect(options?.apiPort).toBe(18787);
    this.entry.runner.calls.push("managed-ready");
  }
  override memoryBytes() { return 6 * 1024 ** 3; }
  protected owned() { return true; }
  protected guest(args: readonly string[]) { return { command: "fake-lima", args, env: {} }; }
  override docker(args: readonly string[], options?: RunOptions) { return this.entry.runner.run("docker", args, options); }
  guestPath(path: string) { return path; }
  async stop() {}
  async remove() {}
}

test("managed bootstrap initializes the recorded provider before Compose and keeps bindings local", async () => {
  const entry = fixture();
  try {
    entry.dependencies.stream = async (program, args, options) => {
      expect(program).toBe("fake-lima");
      expect(args).toContain("--host=unix:///var/run/docker.sock");
      const action = args[args.indexOf("--file") + 2]!;
      entry.runner.calls.push(action);
      if (action === "exec") expect(JSON.parse(options?.input ?? "").password).toBe(password);
      return { status: 0 };
    };
    expect(await bootstrapCommand(entry.paths, { ...entry.options, engine: "managed" }, entry.runner, {
      ...entry.dependencies, managed: new ManagedFixture(entry), platform: "darwin",
    })).toBe(0);
    expect(entry.runner.calls.indexOf("managed-ready")).toBeLessThan(entry.runner.calls.indexOf("up"));
    expect(entry.events().at(-1)).toMatchObject({ type: "result", result: { engine: "managed-lima" } });
    expect(readManifest(entry.paths)?.engine.kind).toBe("managed-lima");
    const values = parseEnvironment(readFileSync(entry.paths.environment, "utf8"));
    expect(values.get("OUTCOMEGO_BIND_HOST")).toBe("127.0.0.1");
    expect(values.get("OUTCOMEGO_VIEWER_BIND_HOST")).toBe("127.0.0.1");
    expect(entry.lines.join("")).not.toContain(password);
  } finally { rmSync(entry.root, { recursive: true, force: true }); }
});

test.each([true, false])("managed bootstrap uses the selected digest through restart and rollback (mirror succeeds: %s)", async (mirrorWorks) => {
  const entry = fixture();
  try {
    const managed = new ManagedFixture(entry);
    const official = entry.runner.computer = `${DEFAULT_IMAGE_PREFIX}-computer@sha256:${"a".repeat(64)}`;
    const mirror = registrySources(official)[1]!.reference;
    const local = new Set<string>();
    const pulls: string[] = [];
    const originalRun = entry.runner.run.bind(entry.runner);
    entry.runner.run = (command, args, options) => {
      if (args[0] === "image") return local.has(args.at(-1)!) ? ok("sha256:cached") : { status: 1, stdout: "", stderr: "No such image" };
      if (args[0] === "run") expect(args).toContain(mirrorWorks ? mirror : official);
      return originalRun(command, args, options);
    };
    const download = await entry.dependencies.download();
    expect(await bootstrapCommand(entry.paths, { ...entry.options, engine: "managed" }, entry.runner, {
      ...entry.dependencies, managed, platform: "darwin",
      rankSources: async () => [mirror, official],
      stream: async (command, args, options) => {
        expect(command).toBe("fake-lima");
        const action = args[args.lastIndexOf("--file") + 2];
        if (action === "pull" && args.at(-1) === "computer") {
          pulls.push(official); local.add(official);
        }
        if (args.includes("image") && args.at(-2) === "pull") {
          expect(options?.input).toBeUndefined();
          pulls.push(args.at(-1)!);
          if (args.at(-1) === official || mirrorWorks) { local.add(args.at(-1)!); return { status: 0 }; }
          return { status: 1 };
        }
        if (action === "up") expect(args.includes(imageSourcesPath(entry.paths.compose))).toBe(mirrorWorks);
        return { status: 0 };
      },
    })).toBe(0);
    expect(pulls).toEqual(mirrorWorks ? [mirror] : [mirror, official]);
    expect(readFileSync(entry.paths.compose, "utf8")).toBe(download.compose);
    expect(entry.lines.join("")).not.toContain(password);
    if (mirrorWorks) {
      const override = imageSourcesPath(entry.paths.compose);
      expect(JSON.parse(readFileSync(override, "utf8"))).toEqual({ services: { computer: { image: mirror }, "computer-memory-init": { image: mirror } } });
      const project = new ComposeProject(entry.paths, managed.probeCompose().command!, entry.runner, undefined, managed);
      const next = `${entry.paths.compose}.next`;
      writeFileSync(next, download.compose);
      expect(project.invocation(["pull"], next).args).not.toContain(override);
      expect(project.invocation(["up"]).args).toContain(override);
      writeFileSync(entry.paths.compose, `${download.compose}\n`);
      expect(project.invocation(["up"]).args).not.toContain(override);
      writeFileSync(entry.paths.compose, download.compose);
      expect(project.invocation(["up"]).args).toContain(override);
    }
  } finally { rmSync(entry.root, { recursive: true, force: true }); }
});

test("a desktop cancellation marker aborts an active start and lets bootstrap roll back", async () => {
  const entry = fixture();
  const marker = join(entry.root, "cancel");
  const controller = new AbortController();
  const close = watchBootstrapCancellation(marker, controller);
  try {
    expect(await bootstrapCommand(entry.paths, entry.options, entry.runner, {
      ...entry.dependencies, signal: controller.signal,
      stream: async (command, args, options) => {
        if (args[args.indexOf("--file") + 2] !== "up") return entry.dependencies.stream(command, args, options);
        expect(controller.signal.aborted).toBe(false);
        writeFileSync(marker, "");
        await new Promise<void>(resolve => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
        return { status: 130 };
      },
    })).toBe(130);
    expect(entry.runner.calls).toContain("down");
    expect(existsSync(entry.paths.manifest)).toBe(false);
    expect(existsSync(entry.paths.environment)).toBe(false);
    expect(entry.events().at(-1)).toMatchObject({ type: "error", code: "CANCELLED" });
  } finally {
    close();
    rmSync(entry.root, { recursive: true, force: true });
  }
});

test.each([
  ["--version", "ENGINE_UNAVAILABLE", 2],
  ["release", "ASSET_DOWNLOAD_FAILED", 3],
  ["config", "ASSET_VERIFICATION_FAILED", 1],
  ["pull", "IMAGE_PULL_FAILED", 3],
  ["up", "STACK_START_FAILED", 3],
  ["health", "HEALTH_TIMEOUT", 3],
  ["exec", "OWNER_CREATE_FAILED", 3],
  ["cancel", "CANCELLED", 130],
] as const)("bootstrap fails closed at %s and allows retry", async (failure, code, exitCode) => {
  const entry = fixture();
  try {
    entry.runner.fail = failure;
    expect(await entry.run()).toBe(exitCode);
    expect(entry.events().at(-1)).toMatchObject({ type: "error", code });
    expect(existsSync(entry.paths.manifest)).toBe(false);
    expect(entry.lines.join("")).not.toContain(password);
    if (failure !== "cancel") {
      entry.runner.fail = "";
      expect(await entry.run()).toBe(0);
    }
  } finally {
    rmSync(entry.root, { recursive: true, force: true });
  }
});

test.each([true, false])("incompatible computer image always blocks compose up (cached: %s)", async (cached) => {
  const entry = fixture();
  try {
    entry.runner.cached = cached;
    entry.runner.incompatible = true;
    expect(await entry.run()).toBe(2);
    expect(entry.events().at(-1)).toMatchObject({ type: "error", code: "ENGINE_INCOMPATIBLE" });
    expect(entry.runner.calls).not.toContain("up");
    expect(entry.runner.calls.includes("pull")).toBe(!cached);
  } finally {
    rmSync(entry.root, { recursive: true, force: true });
  }
});

test.each(["username", "password", "stdin"] as const)("invalid %s fails before touching the installation", async (field) => {
  const entry = fixture();
  try {
    entry.dependencies.readInput = async () => field === "stdin" ? "invalid" : request.replace(field === "username" ? "local-owner" : password, "x");
    const started = Date.now();
    expect(await entry.run()).toBe(2);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(entry.events().at(-1)).toMatchObject({ type: "error", code: "INVALID_INPUT", field });
    expect(existsSync(entry.paths.directory)).toBe(false);
    expect(entry.runner.calls).toEqual([]);
  } finally {
    rmSync(entry.root, { recursive: true, force: true });
  }
});

test("a second bootstrap cannot write the same directory", async () => {
  const entry = fixture();
  const download = entry.dependencies.download;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  entry.dependencies.download = async () => { entered.resolve(); await release.promise; return download(); };
  const first = entry.run();
  try {
    await entered.promise;
    expect(await entry.run()).toBe(3);
    expect(entry.events().at(-1)).toMatchObject({ type: "error", code: "BUSY" });
  } finally {
    release.resolve();
    await first;
    rmSync(entry.root, { recursive: true, force: true });
  }
});

test.each([
  ["MEMORY_LOW", "confirm-low-memory"],
  ["DISK_SPACE_LOW", "free-disk"],
  ["PORT_IN_USE", "free-port"],
] as const)("bootstrap stops in detect on %s before pulling any image", async (code, kind) => {
  const entry = fixture();
  try {
    const dependencies = { ...entry.dependencies };
    if (code === "MEMORY_LOW") dependencies.hostMemoryBytes = () => 1;
    if (code === "DISK_SPACE_LOW") dependencies.diskBytes = () => 1;
    const findConflict = code === "PORT_IN_USE" ? async () => ({ host: "127.0.0.1", port: 18787 }) : dependencies.findConflict;
    expect(await bootstrapCommand(entry.paths, entry.options, entry.runner, { ...dependencies, findConflict })).toBe(2);
    expect(entry.events()).toContainEqual(expect.objectContaining({ type: "action-required", action: expect.objectContaining({ kind }) }));
    expect(entry.events().at(-1)).toMatchObject({ type: "error", stage: "detect", code });
    expect(entry.events().some((event) => event.type === "stage" && event.stage === "pull")).toBe(false);
    expect(entry.runner.calls).not.toContain("pull");
  } finally {
    rmSync(entry.root, { recursive: true, force: true });
  }
});

test("the CLI accepts a stdin pipe without echoing invalid credentials or creating the install directory", async () => {
  const entry = fixture();
  try {
    const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));
    const child = Bun.spawn([process.execPath, cli, "bootstrap", "--json-progress", "--dir", entry.paths.directory], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write(request.replace("local-owner", "x"));
    child.stdin.end();
    const started = Date.now();
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(status).toBe(2);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(stdout.trim().split("\n").map((line) => JSON.parse(line)).at(-1)).toMatchObject({ type: "error", code: "INVALID_INPUT", field: "username" });
    expect(stdout).not.toContain(password);
    expect(stderr).toBe("");
    expect(existsSync(entry.paths.directory)).toBe(false);
  } finally {
    rmSync(entry.root, { recursive: true, force: true });
  }
});

test("bootstrap rejects a remote engine and a foreign Compose project before writes", async () => {
  const entry = fixture();
  try {
    const run = entry.runner.run.bind(entry.runner);
    let endpoint = "ssh://remote.invalid";
    entry.runner.run = (command, args, options) => {
      if (args[0] === "context") return ok(endpoint);
      if (args[0] === "ps") return ok("/another/install|id\n");
      return run(command, args, options);
    };
    expect(await entry.run()).toBe(2);
    expect(entry.events().at(-1)).toMatchObject({ type: "error", code: "ENGINE_UNAVAILABLE" });
    endpoint = "unix:///tmp/docker.sock";
    expect(await entry.run()).toBe(2);
    expect(entry.events().at(-1)).toMatchObject({ type: "error", code: "PORT_IN_USE" });
    expect(entry.runner.calls).not.toContain("up");
    expect(existsSync(entry.paths.manifest)).toBe(false);
  } finally {
    rmSync(entry.root, { recursive: true, force: true });
  }
});
