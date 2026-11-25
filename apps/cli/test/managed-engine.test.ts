import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installationPaths } from "../src/config";
import { readDeployState, writeDeployState } from "../src/deploy-state";
import { limaConfiguration, ManagedLimaEngine } from "../src/engine/managed-lima";
import { MANAGED_WSL_AUTOSTART_TASK, ManagedWslEngine } from "../src/engine/managed-wsl";
import { supportsManagedHost, wslPath, wslRegistrationPath } from "../src/engine/managed-host";
import { validateEngineArtifact } from "../src/engine/managed-assets";
import { createHash } from "node:crypto";
import type { CommandRunner, RunOptions, RunResult } from "../src/process";
import { EngineError } from "../src/engine/types";
import { verifyArtifactSignature } from "../src/release";

test("checks Windows build families and macOS Darwin minor version", () => {
  expect(supportsManagedHost("win32", "x64", "10.0.19045")).toBe(true);
  expect(supportsManagedHost("win32", "x64", "10.0.22000")).toBe(false);
  expect(supportsManagedHost("win32", "x64", "10.0.22631")).toBe(true);
  expect(supportsManagedHost("win32", "arm64", "10.0.26100")).toBe(false);
  expect(supportsManagedHost("darwin", "arm64", "22.4.0")).toBe(false);
  expect(supportsManagedHost("darwin", "x64", "22.5.0")).toBe(true);
  expect(supportsManagedHost("darwin", "arm64", "23.0.0")).toBe(true);
});

test("WSL path conversion preserves spaces, unicode, and non-system drives", () => {
  expect(wslPath("E:\\Users\\测试 User\\OutcomeGo")).toBe("/mnt/e/Users/测试 User/OutcomeGo");
  expect(() => wslPath("\\\\network\\share")).toThrow();
  expect(wslRegistrationPath("    BasePath    REG_SZ    \\\\?\\E:\\Users\\测试 User\\engine\r\n")).toBe("e:\\users\\测试 user\\engine");
});

test("Lima uses native virtualization, read-only mounts and a loopback allowlist", () => {
  const config = limaConfiguration("/private/OutcomeGo", "/private/engine.qcow2", "arm64", 32 * 1024 ** 3, 18800);
  expect(config).toMatchObject({ vmType: "vz", arch: "aarch64", memory: "8192MiB", mounts: [{ location: "/private/OutcomeGo", mountPoint: "/private/OutcomeGo", writable: false }] });
  expect(config.portForwards).toEqual([
    { guestIP: "127.0.0.1", guestPort: 18800, hostIP: "127.0.0.1", hostPort: 18800 },
    { guestIP: "127.0.0.1", guestPortRange: [6200, 6299], hostIP: "127.0.0.1", hostPortRange: [6200, 6299] },
    { guestPortRange: [1, 65535], ignore: true },
  ]);
  expect(limaConfiguration("/home", "/image", "x64", 6 * 1024 ** 3, 8787).memory).toBe("4096MiB");
});

test("saves only allowlisted reboot fields with private permissions", () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-resume-"));
  try {
    const paths = installationPaths(directory);
    const input = { awaiting: "reboot" as const, ownerUsername: "owner", password: "fixture-password" };
    writeDeployState(paths, input);
    expect(readDeployState(paths)).toMatchObject({ ownerUsername: "owner", awaiting: "reboot", engineKind: "managed-wsl" });
    expect(JSON.stringify(readDeployState(paths))).not.toContain("password");
    if (process.platform !== "win32") expect(statSync(join(directory, "deploy-state.json")).mode & 0o777).toBe(0o600);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("rejects a tampered or ambiguously listed engine asset before signature verification", async () => {
  const filename = "outcomego-engine-windows-x64.tar.gz";
  const content = Buffer.from("candidate");
  const checksum = `${createHash("sha256").update(content).digest("hex")}  ${filename}\n`;
  let verified = 0;
  const verify = async () => { verified++; };
  await validateEngineArtifact(filename, content, checksum, verify);
  await expect(validateEngineArtifact(filename, Buffer.from("Candidate"), checksum, verify)).rejects.toThrow("ASSET_VERIFICATION_FAILED");
  await expect(validateEngineArtifact(filename, content, checksum + checksum, verify)).rejects.toThrow("ASSET_VERIFICATION_FAILED");
  expect(verified).toBe(1);
  await expect(validateEngineArtifact(filename, content, checksum, async () => { throw new Error("bad signature"); })).rejects.toThrow("ASSET_VERIFICATION_FAILED");
});

test("the engine asset verifier rejects a one-byte change even with a matching checksum", async () => {
  const fixture = new URL("./fixtures/release-v0.1.0/openteam-compose.yaml", import.meta.url);
  const original = readFileSync(fixture);
  const serializedBundle = readFileSync(new URL("./fixtures/release-v0.1.0/openteam-compose.yaml.sigstore.json", import.meta.url), "utf8");
  const filename = "candidate-engine.tar.gz";
  const verify = (artifact: Buffer) => validateEngineArtifact(filename, artifact, `${createHash("sha256").update(artifact).digest("hex")}  ${filename}`, () => verifyArtifactSignature({
    repository: "raghavpillai/openteam", version: "0.1.0", artifact, serializedBundle,
  }));
  await verify(original);
  const tampered = Buffer.from(original);
  tampered[0] = tampered[0]! ^ 1;
  await expect(verify(tampered)).rejects.toThrow("ASSET_VERIFICATION_FAILED");
});

const commandResult = (stdout = "", status = 0): RunResult => ({ status, stdout, stderr: "" });
class WslRunner implements CommandRunner {
  calls: Array<{ command: string; args: readonly string[]; options?: RunOptions }> = [];
  registration: "owned" | "foreign" | "missing" = "owned";
  enabled = true;
  optionalFeaturesEnabled = true;
  successfulStatusWhenDisabled = false;
  running = true;
  wslVersion = 2;
  network = "nat";
  virtualization = "enabled";
  elevationResult = 1223;

  run(command: string, args: readonly string[], options?: RunOptions) {
    this.calls.push({ command, args, options });
    if (command.endsWith("powershell.exe")) {
      if (args.at(-1)?.includes("Win32_OptionalFeature")) return commandResult(this.optionalFeaturesEnabled ? "enabled" : "disabled");
      if (args.at(-1)?.includes("Start-Process")) return commandResult("", this.elevationResult);
      if (args.at(-1)?.includes("ConvertTo-Json")) {
        expect(args.at(-1)).toContain("UTF8Encoding");
        return this.registration === "missing" ? commandResult() : commandResult(JSON.stringify({
          BasePath: `E:\\A Space\\测试\\${this.registration === "owned" ? "engine\\wsl" : "another distribution"}`, Version: this.wslVersion,
        }));
      }
      return commandResult(this.virtualization);
    }
    if (args[0] === "--status") return this.enabled ? commandResult() : commandResult("0x8007019e", this.successfulStatusWhenDisabled ? 0 : 1);
    if (args[0] === "--list") return commandResult(this.registration === "missing" || args.includes("--running") && !this.running ? "Ubuntu\r\n" : "o\0u\0t\0c\0o\0m\0e\0g\0o\0-\0e\0n\0g\0i\0n\0e\0\r\nUbuntu\r\n");
    if (args.includes("--networking-mode")) {
      return args.at(-2) === "/usr/bin/wslinfo" ? commandResult(this.network) : commandResult("wslinfo missing", 1);
    }
    if (args.includes("--version")) return commandResult("Docker 28.0.0");
    if (args.includes("info")) return commandResult(JSON.stringify({ ServerVersion: "28.0.0", OSType: "linux", CgroupVersion: "2", MemTotal: 6 * 1024 ** 3 }));
    if (args.includes("compose")) return commandResult("Docker Compose version v2.20.0");
    return commandResult();
  }
}

const windowsPaths = { ...installationPaths("/isolated"), directory: "E:\\A Space\\测试", compose: "E:\\A Space\\测试\\compose.yaml", environment: "E:\\A Space\\测试\\.env" };
const windows = (runner: WslRunner) => new ManagedWslEngine({ paths: windowsPaths, runner, architecture: "x64", release: "10.0.22631" });

test("WSL inspects without launching a stopped distro and scopes commands to the owned VM", async () => {
  const runner = new WslRunner();
  runner.running = false;
  const engine = windows(runner);
  expect(await engine.detect()).toMatchObject({ state: "stopped" });
  expect(runner.calls.every(({ args }) => !args.includes("--exec"))).toBe(true);
  runner.running = true;
  expect(await engine.detect()).toMatchObject({ state: "ready", memoryBytes: 6 * 1024 ** 3 });
  const call = engine.composeInvocation({ paths: windowsPaths, projectName: "outcomego", command: engine.probeCompose().command!, composeFile: windowsPaths.compose }, ["ps"]);
  expect(call.args).toContain("/mnt/e/A Space/测试/compose.yaml");
  expect(call.args[call.args.indexOf("-c") + 1]).toContain("$(/usr/bin/wslinfo --networking-mode)");
  expect(call.args).toContain("--host=unix:///var/run/docker.sock");
  expect(call.args).not.toContain("-H");
  expect(call.args.join(" ")).not.toContain("tcp://");
  await engine.remove({ purgeData: true });
  expect(runner.calls.at(-1)?.args).toEqual(["--unregister", "outcomego-engine"]);
  runner.registration = "foreign";
  await expect(engine.remove({ purgeData: true })).rejects.toThrow("ENGINE_UNAVAILABLE");
  expect(runner.calls.filter(({ args }) => args.includes("--unregister"))).toHaveLength(1);
});

test("WSL rejects version 1 and refuses to start Docker without a confirmed NAT network", async () => {
  const runner = new WslRunner();
  const invoked: string[] = [];
  const engine = new ManagedWslEngine({ paths: windowsPaths, runner, architecture: "x64", release: "10.0.22631",
    stream: async (_program, args) => { invoked.push(...args); return { status: 0 }; } });
  runner.wslVersion = 1;
  expect((await engine.detect()).code).toBe("ENGINE_INCOMPATIBLE");
  await expect(engine.remove({ purgeData: true })).rejects.toThrow("ENGINE_UNAVAILABLE");
  runner.wslVersion = 2;
  runner.network = "mirrored";
  expect((await engine.detect()).code).toBe("ENGINE_INCOMPATIBLE");
  runner.running = false;
  await expect(engine.ensureReady()).rejects.toThrow("ENGINE_INCOMPATIBLE");
  expect(invoked).toEqual([]);
  expect(runner.calls.some(({ args }) => args.includes("--unregister") || args.includes("info"))).toBe(false);
});

test("WSL will not replace its distribution before a scoped VHDX checkpoint exists", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-wsl-checkpoint-"));
  try {
    const runner = new WslRunner();
    const file = join(directory, "wsl.vhdx");
    const engine = new ManagedWslEngine({ paths: windowsPaths, runner, architecture: "x64", release: "10.0.22631",
      stream: async (command, args) => {
        expect(command).toEndWith("wsl.exe");
        expect(runner.calls.at(-1)?.args).toEqual(["--terminate", "outcomego-engine"]);
        expect(args).toEqual(["--export", "outcomego-engine", file, "--vhd"]);
        writeFileSync(file, "vhdxfile");
        return { status: 0 };
      } });
    await expect(engine.replaceEngine(directory)).rejects.toThrow("ENGINE_START_FAILED");
    expect(runner.calls).toHaveLength(0);
    await engine.checkpoint(directory);
    await engine.replaceEngine(directory);
    expect(runner.calls.at(-1)?.args).toEqual(["--unregister", "outcomego-engine"]);
    expect(readFileSync(file, "utf8")).toBe("vhdxfile");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("WSL authorization requires pending consent; denial preserves state and reboot is explicit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-elevation-"));
  try {
    const paths = installationPaths(directory);
    const runner = new WslRunner();
    runner.enabled = false;
    const engine = new ManagedWslEngine({ paths, runner, architecture: "x64", release: "10.0.22631" });
    await expect(engine.enable()).rejects.toThrow("INVALID_INPUT");
    expect(runner.calls).toHaveLength(0);
    runner.virtualization = "disabled";
    expect((await engine.detect()).code).toBe("VIRTUALIZATION_DISABLED");
    runner.virtualization = "enabled";
    writeDeployState(paths, { awaiting: "elevation", ownerUsername: "owner" });
    await expect(engine.enable()).rejects.toThrow("ELEVATION_DENIED");
    expect(readDeployState(paths)?.awaiting).toBe("elevation");
    runner.elevationResult = 3010;
    await expect(engine.enable()).rejects.toThrow("REBOOT_REQUIRED");
    expect(readDeployState(paths)?.awaiting).toBe("reboot");
    expect((await engine.detect()).code).toBe("REBOOT_REQUIRED");
    expect(runner.calls.filter(({ args }) => args.at(-1)?.includes("Start-Process"))).toHaveLength(2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("WSL keepalive runs headlessly through conhost and autostart registers/removes a non-elevated logon task", async () => {
  const runner = new WslRunner();
  const engine = new ManagedWslEngine({
    paths: windowsPaths,
    runner,
    architecture: "x64",
    release: "10.0.22631",
    stream: async () => ({ status: 0 }),
  });

  await engine.ensureReady();
  const keepAliveCall = runner.calls.at(-1);
  expect(keepAliveCall?.command.toLowerCase()).toEndWith("powershell.exe");
  expect(keepAliveCall?.args).toContain("-WindowStyle");
  expect(keepAliveCall?.args).toContain("Hidden");
  const keepAliveScript = keepAliveCall?.args.at(-1) ?? "";
  expect(keepAliveScript).toContain("Start-Process -FilePath");
  expect(keepAliveScript.toLowerCase()).toContain("\\system32\\conhost.exe");
  expect(keepAliveScript).toContain("--headless");
  expect(keepAliveScript.toLowerCase()).toContain("\\system32\\wsl.exe");
  expect(keepAliveScript).toContain("--distribution outcomego-engine --user root --cd / --exec /usr/bin/flock -n /run/outcomego-keepalive.lock /bin/sleep infinity");
  expect(keepAliveScript).toContain("-WindowStyle Hidden");

  expect(engine.ensureAutostart()).toBe(true);
  const registerCall = runner.calls.at(-1);
  expect(registerCall?.command.toLowerCase()).toEndWith("powershell.exe");
  const registerScript = registerCall?.args.at(-1) ?? "";
  expect(registerScript).toContain("Schedule.Service");
  expect(registerScript).toContain(`RegisterTaskDefinition('${MANAGED_WSL_AUTOSTART_TASK}'`);
  expect(registerScript).toContain("$def.Principal.LogonType=3");
  expect(registerScript).toContain("$def.Principal.RunLevel=0");
  expect(registerScript).toContain("$def.Settings.Hidden=$true");
  expect(registerScript).toContain("$def.Settings.ExecutionTimeLimit='PT0S'");
  expect(registerScript).toContain("$trigger=$def.Triggers.Create(9)");
  expect(registerScript).toContain("--headless");
  expect(registerScript).toContain("--cd /");
  expect(registerScript).toContain("systemctl start docker.service");

  expect(engine.removeAutostart()).toBe(true);
  const removeCall = runner.calls.at(-1);
  const removeScript = removeCall?.args.at(-1) ?? "";
  expect(removeScript).toContain(`DeleteTask('${MANAGED_WSL_AUTOSTART_TASK}', 0)`);

  runner.calls.length = 0;
  await engine.remove({ purgeData: true });
  expect(runner.calls.some(({ args }) => args.at(-1)?.includes(`DeleteTask('${MANAGED_WSL_AUTOSTART_TASK}', 0)`))).toBe(true);
  expect(runner.calls.at(-1)?.args).toEqual(["--unregister", "outcomego-engine"]);

  runner.calls.length = 0;
  runner.registration = "foreign";
  expect(engine.ensureAutostart()).toBe(false);
  expect(runner.calls.some(({ args }) => args.at(-1)?.includes("RegisterTaskDefinition"))).toBe(false);
  await expect(engine.remove({ purgeData: true })).rejects.toThrow("ENGINE_UNAVAILABLE");
  expect(runner.calls.some(({ args }) => args.at(-1)?.includes("DeleteTask"))).toBe(false);
});

test("WSL detects disabled optional features when wsl --status exits successfully", async () => {
  const runner = new WslRunner();
  runner.enabled = false;
  runner.optionalFeaturesEnabled = false;
  runner.successfulStatusWhenDisabled = true;
  const engine = windows(runner);

  expect(await engine.detect()).toMatchObject({ state: "needs-setup", code: "WSL_NOT_ENABLED" });
  expect(runner.calls.every(({ args }) => !args.includes("--exec") && !args.includes("--import"))).toBe(true);
});

test("a rejected engine asset never imports a distro or creates a VM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-managed-assets-"));
  try {
    const runner = new WslRunner();
    runner.registration = "missing";
    const stream = async () => { throw new Error("unexpected engine mutation"); };
    const assets = async () => { throw new EngineError("ASSET_VERIFICATION_FAILED"); };
    const wsl = new ManagedWslEngine({ paths: windowsPaths, runner, architecture: "x64", release: "10.0.22631", stream, assets });
    await expect(wsl.ensureReady()).rejects.toThrow("ASSET_VERIFICATION_FAILED");
    const lima = new ManagedLimaEngine({ paths: installationPaths(directory), runner, architecture: "arm64", release: "22.5.0", stream, assets });
    await expect(lima.ensureReady()).rejects.toThrow("ASSET_VERIFICATION_FAILED");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Lima ignores ambient instance settings and deletes only the recorded private VM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-lima-"));
  try {
    const paths = installationPaths(directory);
    const home = join(directory, "engine", "lima");
    mkdirSync(join(home, "outcomego-engine"), { recursive: true });
    const runtime = join(directory, "engine", "lima-runtime", "bin");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, "limactl"), "fixture");
    const calls: Array<{ command: string; args: readonly string[]; home?: string }> = [];
    const engine = new ManagedLimaEngine({ paths, runner: { run: () => commandResult() }, architecture: "arm64", release: "22.5.0",
      stream: async (command, args, options) => { calls.push({ command, args, home: options?.env?.LIMA_HOME }); return { status: 0 }; } });
    await expect(engine.remove({ purgeData: true })).rejects.toThrow("ENGINE_UNAVAILABLE");
    expect(calls).toHaveLength(0);
    writeFileSync(join(home, "outcomego-instance.json"), JSON.stringify({ directory }));
    await expect(engine.remove({ purgeData: true })).rejects.toThrow("ENGINE_UNAVAILABLE");
    writeFileSync(join(runtime, "..", "outcomego-runtime.sha256"), createHash("sha256").update("fixture").digest("hex"));
    await engine.remove({ purgeData: true });
    expect(calls).toEqual([{ command: join(runtime, "limactl"), args: ["delete", "--force", "outcomego-engine"], home }]);
    writeFileSync(join(runtime, "limactl"), "tampered");
    await expect(engine.remove({ purgeData: true })).rejects.toThrow("ENGINE_UNAVAILABLE");
    expect(calls).toHaveLength(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("Lima refuses a redirected engine directory even if no instance exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "outcomego-lima-redirect-"));
  try {
    mkdirSync(join(root, "installation"));
    mkdirSync(join(root, "foreign"));
    symlinkSync(join(root, "foreign"), join(root, "installation", "engine"));
    const engine = new ManagedLimaEngine({ paths: installationPaths(join(root, "installation")), runner: new WslRunner(), architecture: "arm64", release: "22.5.0",
      assets: async () => { throw new Error("must not write through a symlink"); } });
    expect((await engine.detect()).code).toBe("ENGINE_UNAVAILABLE");
    await expect(engine.ensureReady()).rejects.toThrow("ENGINE_UNAVAILABLE");
    await expect(engine.remove({ purgeData: true })).rejects.toThrow("ENGINE_UNAVAILABLE");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Lima retries first deployment with a different loopback port without deleting guest data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-lima-port-"));
  try {
    const paths = installationPaths(directory);
    const home = join(directory, "engine", "lima");
    const runtime = join(directory, "engine", "lima-runtime");
    mkdirSync(join(home, "outcomego-engine"), { recursive: true });
    mkdirSync(join(runtime, "bin"), { recursive: true });
    writeFileSync(join(runtime, "bin", "limactl"), "fixture");
    writeFileSync(join(runtime, "outcomego-runtime.sha256"), createHash("sha256").update("fixture").digest("hex"));
    const owner = join(home, "outcomego-instance.json");
    writeFileSync(owner, JSON.stringify({ directory, apiPort: 8787 }));
    const guest = new WslRunner();
    const operations: Array<readonly string[]> = [];
    const engine = new ManagedLimaEngine({ paths, architecture: "arm64", release: "22.5.0",
      runner: { run: (command, args) => args[0] === "list" ? commandResult(JSON.stringify({ name: "outcomego-engine", status: "Stopped" })) : guest.run(command, args) },
      stream: async (_command, args) => { operations.push(args); return { status: 0 }; } });
    await engine.ensureReady(undefined, { apiPort: 18787 });
    expect(operations).toEqual([
      ["edit", "--tty=false", "--set", ".portForwards[0].guestPort = 18787 | .portForwards[0].hostPort = 18787", "outcomego-engine"],
      ["start", "--tty=false", "outcomego-engine"],
    ]);
    expect(JSON.parse(readFileSync(owner, "utf8")).apiPort).toBe(18787);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Lima restores the saved instance and runtime together and can retry restoration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-lima-checkpoint-"));
  try {
    const paths = installationPaths(directory);
    const engineDir = join(directory, "engine");
    const home = join(engineDir, "lima");
    const runtime = join(engineDir, "lima-runtime");
    const disk = join(home, "outcomego-engine", "diffdisk");
    const bin = join(runtime, "bin", "limactl");
    const backup = join(directory, "checkpoint");
    const install = (version: string) => {
      mkdirSync(join(home, "outcomego-engine"), { recursive: true });
      mkdirSync(join(runtime, "bin"), { recursive: true });
      writeFileSync(join(home, "outcomego-instance.json"), JSON.stringify({ directory, apiPort: 8787 }));
      writeFileSync(disk, `${version} state`);
      writeFileSync(bin, version);
      writeFileSync(join(runtime, "outcomego-runtime.sha256"), createHash("sha256").update(version).digest("hex"));
    };
    install("old");
    mkdirSync(backup);
    const engine = new ManagedLimaEngine({ paths, architecture: "arm64", release: "22.5.0",
      runner: { run: () => commandResult(JSON.stringify({ name: "outcomego-engine", status: "Stopped" })) } });
    await engine.replaceEngine(backup);
    expect(readFileSync(join(backup, "lima", "outcomego-engine", "diffdisk"), "utf8")).toBe("old state");
    install("new");
    await engine.restoreEngine(backup);
    await engine.restoreEngine(backup);
    expect(readFileSync(disk, "utf8")).toBe("old state");
    expect(readFileSync(bin, "utf8")).toBe("old");
    expect(readFileSync(join(backup, "failed-lima", "outcomego-engine", "diffdisk"), "utf8")).toBe("new state");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
