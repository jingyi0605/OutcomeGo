import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "../src/arguments";
import { installationPaths, readManifest, writeManifest } from "../src/config";
import { ManagedEngine, type EngineStartOptions } from "../src/engine/managed";
import { upgradeEngineCommand } from "../src/engine/upgrade";
import { assertNoEngineRecovery, runEngineUpgrade, type EngineUpgradeOperations } from "../src/engine/upgrade-transaction";
import { migratableVolumes } from "../src/engine/volume-migration";
import type { RunOptions } from "../src/process";
import { acquireUpdateLock } from "../src/update-safety";

const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-engine-upgrade-"));
  const paths = installationPaths(directory);
  const calls: string[] = [];
  const operations: EngineUpgradeOperations = {
    prepare: async () => { calls.push("prepare"); },
    backup: async (backup) => { calls.push("backup"); writeFileSync(join(backup, "volume.tar"), "old data"); },
    replace: async (backup) => { expect(existsSync(join(backup, "volume.tar"))).toBe(true); calls.push("replace"); },
    verify: async () => { calls.push("verify"); },
    restore: async (_backup, phase) => { calls.push(`restore:${phase}`); },
  };
  return { paths, operations, calls, close: () => rmSync(directory, { recursive: true, force: true }) };
};

test("engine upgrade backs up before replacing and commits only after verification", async () => {
  const entry = fixture();
  try {
    await runEngineUpgrade(entry.paths, entry.operations, false);
    expect(entry.calls).toEqual(["prepare", "backup", "replace", "verify"]);
    expect(() => assertNoEngineRecovery(entry.paths)).not.toThrow();
  } finally { entry.close(); }
});

test("a failed backup restarts the original stack without replacing the engine", async () => {
  const entry = fixture();
  try {
    entry.operations.backup = async () => { throw new Error("disk full"); };
    await expect(runEngineUpgrade(entry.paths, entry.operations, false)).rejects.toThrow("disk full");
    expect(entry.calls).toEqual(["prepare", "restore:quiescing"]);
    expect(() => assertNoEngineRecovery(entry.paths)).not.toThrow();
  } finally { entry.close(); }
});

test("failed verification rolls back, and failed rollback persists across invocations", async () => {
  const entry = fixture();
  try {
    const restore = entry.operations.restore;
    entry.operations.verify = async () => { throw new Error("health failed"); };
    entry.operations.restore = async () => { throw new Error("restore failed"); };
    await expect(runEngineUpgrade(entry.paths, entry.operations, false)).rejects.toThrow("engine rollback --yes");
    expect(() => assertNoEngineRecovery(entry.paths)).toThrow("engine rollback --yes");
    expect(() => acquireUpdateLock(entry.paths)).toThrow("engine rollback --yes");
    entry.operations.restore = restore;
    await runEngineUpgrade(entry.paths, entry.operations, true);
    expect(entry.calls).toEqual(["prepare", "backup", "replace", "restore:replacing"]);
    expect(() => assertNoEngineRecovery(entry.paths)).not.toThrow();
  } finally { entry.close(); }
});

test("engine upgrade and rollback flags belong to explicit commands", () => {
  expect(parseArguments(["engine", "upgrade", "--version", "0.2.0", "--yes"])).toMatchObject({ command: "engine-upgrade", version: "0.2.0", yes: true });
  expect(parseArguments(["engine", "rollback", "--yes"])).toMatchObject({ command: "engine-rollback", yes: true });
  expect(() => parseArguments(["engine", "rollback", "--version", "0.2.0"])).toThrow();
});

test("failed asset verification never enters the stopped window", async () => {
  const entry = fixture();
  try {
    entry.operations.prepare = async () => { throw new Error("bad signature"); };
    await expect(runEngineUpgrade(entry.paths, entry.operations, false)).rejects.toThrow("bad signature");
    expect(entry.calls).toEqual([]);
    expect(() => assertNoEngineRecovery(entry.paths)).not.toThrow();
  } finally { entry.close(); }
});

test("volume migration retains names and rejects foreign, bind-backed and unexpected mountpoints", () => {
  const volume = { Name: "outcomego_outcomego_workspace", Driver: "local", Scope: "local", Options: null,
    Mountpoint: "/var/lib/docker/volumes/outcomego_outcomego_workspace/_data",
    Labels: { "com.docker.compose.project": "outcomego", "com.docker.compose.volume": "outcomego_workspace" } };
  expect(migratableVolumes([volume], "outcomego", "/var/lib/docker")).toEqual([
    { name: volume.Name, mountpoint: volume.Mountpoint, key: volume.Labels["com.docker.compose.volume"] },
  ]);
  for (const invalid of [{ ...volume, Options: { device: "/other" } }, { ...volume, Labels: {} }, { ...volume, Mountpoint: "/other" }]) {
    expect(() => migratableVolumes([invalid], "outcomego", "/var/lib/docker")).toThrow("ENGINE_INCOMPATIBLE");
  }
});

const result = (stdout = "") => ({ status: 0, stdout, stderr: "" });

for (const outcome of ["success", "failed-health", "foreign-mount", "disk-full"] as const) {
  test(`managed upgrade command: ${outcome}`, async () => {
    const entry = fixture();
    const { paths, calls } = entry;
    const project = "private-project";
    const volumeName = `${project}_workspace`;
    const payload = Buffer.alloc(1024, 42);
    const asset = "/verified/engine.tar.gz";
    const volume = { Name: volumeName, Driver: "local", Scope: "local", Options: null,
      Labels: { "com.docker.compose.project": project, "com.docker.compose.volume": "workspace" },
      Mountpoint: `/var/lib/docker/volumes/${volumeName}/_data` };
    let running = true;
    let replacement = false;
    let hasVolume = true;
    const runner = { run: (_command: string, args: readonly string[]) => {
      const action = args[args.indexOf("--file") + 2];
      if (action === "stop") { running = false; calls.push("stop"); }
      else if (action === "up") { running = true; calls.push("up"); }
      else throw new Error(`Unexpected guest command ${args.join(" ")}`);
      return result();
    } };
    class FakeEngine extends ManagedEngine {
      override readonly kind = "managed-lima";
      constructor() { super({ paths, runner, architecture: "arm64", release: "22.5.0" }); }
      protected owned() { return true; }
      protected guest(args: readonly string[]) { return { command: "fixture", args, env: {} }; }
      guestPath(path: string) { return path; }
      async stop() { throw new Error("unexpected stop"); }
      async remove() { throw new Error("unexpected remove"); }
      override async detect() { return { state: "ready" as const, reasons: [] }; }
      override async prepareUpgrade(version: string) { calls.push(`prepare:${version}`); return [asset]; }
      override async checkpoint() { calls.push("checkpoint"); }
      override async replaceEngine() { expect(running).toBe(false); calls.push("replace"); replacement = true; hasVolume = false; }
      override async restoreEngine() { calls.push("restore"); replacement = false; hasVolume = true; }
      async ensureReady(_event?: (message: string) => void, options?: EngineStartOptions) {
        if (replacement) expect(options?.assets).toEqual([asset]);
        expect(options?.apiPort).toBe(18787);
      }
      override docker(args: readonly string[]) {
        if (args[0] === "compose") return result("Docker Compose version v2.20.0");
        if (args[0] === "ps" && args.includes("--format")) return result(`${"a".repeat(64)}|${project}|${paths.directory}`);
        if (args[0] === "ps") return result(running ? "abcdef" : "");
        if (args[0] === "inspect") return result(JSON.stringify(outcome === "foreign-mount" ? [{ Type: "bind", Source: "/foreign" }] : [{ Type: "volume", Name: volumeName }]));
        if (args[0] === "info") return result(JSON.stringify("/var/lib/docker"));
        if (args[1] === "ls") return result(hasVolume ? volumeName : "");
        if (args[1] === "inspect") return result(JSON.stringify([volume]));
        if (args[1] === "create") {
          expect(args).toEqual(["volume", "create", "--driver", "local", "--label", `com.docker.compose.project=${project}`, "--label", "com.docker.compose.volume=workspace", volumeName]);
          hasVolume = true;
          return result(volumeName);
        }
        throw new Error(`Unexpected Docker command ${args.join(" ")}`);
      }
      override runGuest(args: readonly string[], files: RunOptions) {
        expect(args).toContain("--numeric-owner");
        expect(args).toContain(volume.Mountpoint);
        if (files.outputFile) {
          if (outcome === "disk-full") return { ...result(), status: 1 };
          writeFileSync(files.outputFile, payload);
          calls.push("tar-out");
        } else {
          expect(args).toContain("--same-owner");
          expect(readFileSync(files.inputFile!)).toEqual(payload);
          calls.push("tar-in");
        }
        return result();
      }
    }
    try {
      writeFileSync(paths.environment, "OUTCOMEGO_BIND_HOST=127.0.0.1\nOUTCOMEGO_VIEWER_BIND_HOST=127.0.0.1\nOUTCOMEGO_API_PORT=18787\n");
      writeFileSync(paths.compose, "services: {}\n");
      writeManifest(paths, { schemaVersion: 1, repository: "owner/repo", version: "1.0.0", composeUrl: "fixture", installedAt: "fixture", updatedAt: "fixture", projectName: project, ownerUsername: "owner", engine: { kind: "managed-lima", assetVersion: "0.1.0" } });
      const health = (ok: boolean) => ({ ok, url: "fixture", detail: "fixture" });
      const command = () => upgradeEngineCommand(paths, runner, new FakeEngine(), { yes: true, version: "0.2.0", rollback: false }, {
        check: async () => health(true), wait: async (_paths, _timeout, version) => {
          expect(version).toBe("1.0.0");
          return health(outcome !== "failed-health" || !replacement);
        },
      });
      if (outcome === "success") {
        const backup = await command();
        expect(JSON.parse(readFileSync(join(backup, "volumes.json"), "utf8"))).toEqual([{ name: volumeName, key: "workspace", archive: "volume-0.tar" }]);
      }
      else await expect(command()).rejects.toThrow({ "failed-health": "HEALTH_TIMEOUT", "foreign-mount": "ENGINE_INCOMPATIBLE", "disk-full": "ENGINE_START_FAILED" }[outcome]);
      expect(readManifest(paths)?.engine.assetVersion).toBe(outcome === "success" ? "0.2.0" : "0.1.0");
      expect(calls).toEqual({
        success: ["prepare:0.2.0", "stop", "tar-out", "checkpoint", "replace", "tar-in", "up"],
        "failed-health": ["prepare:0.2.0", "stop", "tar-out", "checkpoint", "replace", "tar-in", "up", "restore", "up"],
        "foreign-mount": ["prepare:0.2.0"],
        "disk-full": ["prepare:0.2.0", "stop", "up"],
      }[outcome]);
      expect(running).toBe(true);
      expect(() => assertNoEngineRecovery(paths)).not.toThrow();
    } finally { entry.close(); }
  });
}
