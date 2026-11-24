import { expect, test } from "bun:test";
import { parseArguments } from "../src/arguments";
import { dockerFailureCheck } from "../src/docker-diagnostics";
import { renderDockerRequired } from "../src/docker-preflight";
import { engineStatus } from "../src/engine/status";
import { ExternalEngine } from "../src/engine/external";
import { selectEngine } from "../src/engine/select";
import type { EngineProvider } from "../src/engine/types";
import type { CommandRunner, RunResult } from "../src/process";

class FakeRunner implements CommandRunner {
  readonly commands: string[][] = [];

  constructor(
    private readonly state: "ready" | "missing" | "stopped",
    private readonly info = {
      ServerVersion: "28.0.0",
      CgroupVersion: "2",
      MemTotal: 8 * 1024 ** 3,
      OSType: "linux",
      SecurityOptions: [],
    },
    private readonly composeVersion = "2.20.0"
  ) {}

  run(command: string, args: readonly string[]): RunResult {
    this.commands.push([command, ...args]);
    if (command !== "docker") throw new Error(`Unexpected command: ${command}`);
    if (args[0] === "--version") {
      return this.state === "missing"
        ? { status: 1, stdout: "", stderr: "not found", error: Object.assign(new Error(), { code: "ENOENT" }) }
        : { status: 0, stdout: "Docker version 28.0.0", stderr: "" };
    }
    if (args[0] === "info") {
      return this.state === "stopped"
        ? { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" }
        : { status: 0, stdout: JSON.stringify(this.info), stderr: "" };
    }
    if (args.join(" ") === "compose version") {
      return { status: 0, stdout: `Docker Compose version v${this.composeVersion}`, stderr: "" };
    }
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  }
}

test.each([
  ["ready", "ready"],
  ["missing", "needs-setup"],
  ["stopped", "stopped"],
] as const)("engine status reports %s as %s", async (fixture, state) => {
  const runner = new FakeRunner(fixture);
  const report = await engineStatus(runner);
  expect(report).toMatchObject({ state, engine: { kind: "external" } });
  if (fixture === "ready") {
    expect(report).toMatchObject({ composeVersion: "2.20.0", cgroupVersion: "2", memoryBytes: 8 * 1024 ** 3 });
  }
  expect(runner.commands.every(([, arg]) => ["--version", "info", "compose"].includes(arg!))).toBe(true);
});

test("engine status stays read-only and managed operations require explicit arguments", () => {
  expect(parseArguments(["engine", "status", "--json", "--dir", "isolated"])).toMatchObject({
    command: "engine-status", json: true, directory: "isolated",
  });
  expect(parseArguments(["help", "engine", "status"])).toMatchObject({
    command: "help", helpTopic: "engine-status",
  });
  expect(() => parseArguments(["engine", "stop", "--json"])).toThrow("Unknown option");
  expect(parseArguments(["engine", "remove", "--purge-data"])).toMatchObject({ command: "engine-remove", purge: true });
  expect(parseArguments(["engine", "enable-wsl", "--yes"])).toMatchObject({ command: "engine-enable-wsl", yes: true });
  expect(parseArguments(["engine", "docker", "--dir", "local", "--", "compose", "--file", "/tmp/test.yml", "ps"])).toMatchObject({
    command: "engine-docker", directory: "local", dockerArgs: ["compose", "--file", "/tmp/test.yml", "ps"],
  });
});

test("engine diagnostics guide Colima users without telling them to start Docker Desktop", () => {
  const check = dockerFailureCheck("daemon", {
    status: 1,
    stdout: "",
    stderr: "Cannot connect to the Docker daemon at unix:///Users/example/.colima/default/docker.sock.",
  }, "darwin");
  expect(check.action).toContain("colima start");
  expect(check.action).not.toContain("Docker Desktop");
});

test.each(["darwin", "win32"] as const)("missing engine guidance on %s is vendor-neutral", (platform) => {
  const missing = dockerFailureCheck("cli", { status: 1, stdout: "", stderr: "docker not found" }, platform);
  expect(missing.action).toContain("Install a Docker-compatible engine");
  expect(renderDockerRequired("outcomego setup", { platform, width: 120, color: false })).toContain(
    "Install a Docker-compatible engine"
  );
});

test("engine status identifies a legacy Compose plugin and cgroup v1", async () => {
  const report = await engineStatus(new FakeRunner("ready", {
    ServerVersion: "28.0.0", CgroupVersion: "1", MemTotal: 0, OSType: "linux", SecurityOptions: [],
  }, "2.19.0"));
  expect(report.state).toBe("unsupported");
  expect(report.reasons.join(" ")).toContain("cgroup v2");
  expect(report.reasons.join(" ")).toContain("2.20.0");
});

test("engine selection honors the recorded provider before trying auto detection", async () => {
  const runner = new FakeRunner("ready");
  const external = new ExternalEngine(runner);
  const managed: EngineProvider = {
    kind: "managed-wsl",
    detect: external.detect.bind(external),
    ensureReady: external.ensureReady.bind(external),
    docker: external.docker.bind(external),
    composeInvocation: external.composeInvocation.bind(external),
    memoryBytes: () => null,
    describe: () => ({ kind: "managed-wsl", name: "outcomego-engine" }),
  };
  expect(await selectEngine(external, { platform: "win32", recorded: "managed-wsl", managed })).toBe(managed);
  expect(runner.commands).toEqual([]);
  expect(await selectEngine(external, { platform: "win32", managed })).toBe(external);
  const missing = new ExternalEngine(new FakeRunner("missing"));
  expect(await selectEngine(missing, { platform: "win32", managed })).toBe(managed);
  expect(await selectEngine(missing, { platform: "linux", managed })).toBe(missing);
  await expect(selectEngine(external, { platform: "linux", recorded: "managed-wsl", managed })).rejects.toThrow("ENGINE_UNAVAILABLE");
});

test.each(["ready", "missing", "stopped"] as const)("recorded external stays selected when Docker is %s", async (state) => {
  const runner = new FakeRunner(state);
  const external = new ExternalEngine(runner);
  expect(await selectEngine(external, { platform: "win32", recorded: "external" })).toBe(external);
  await expect(selectEngine(external, { platform: "win32", recorded: "external", requested: "managed" })).rejects.toThrow("ENGINE_UNAVAILABLE");
  expect(runner.commands).toEqual([]);
});
