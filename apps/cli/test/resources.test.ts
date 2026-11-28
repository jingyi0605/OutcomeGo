import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "../src/arguments";
import {
  createEnvironment,
  installationPaths,
  parseEnvironment,
  writeFileAtomic,
  writeManifest,
} from "../src/config";
import {
  collectResourceSnapshot,
  readLocalComputerCpu,
  resourcesSetExtendedCommand,
} from "../src/local-ops";
import { readWslConfig, updateWslConfig, wslConfigBackupPath } from "../src/wsl-config";
import type { CommandRunner, RunResult } from "../src/process";

const GIB = 1024 ** 3;

class ResourcesRunner implements CommandRunner {
  readonly calls: string[][] = [];
  failUp = false;

  run(command: string, args: readonly string[]): RunResult {
    this.calls.push([command, ...args]);
    if (command === "docker" && args[0] === "--version") {
      return { status: 0, stdout: "Docker version 27.0.0", stderr: "" };
    }
    if (command === "docker" && args[0] === "info") {
      return {
        status: 0,
        stdout: JSON.stringify({
          ServerVersion: "27.0.0",
          CgroupVersion: "2",
          MemTotal: 16 * GIB,
          NCPU: 8,
          OSType: "linux",
          SecurityOptions: [],
        }),
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "compose" && args[1] === "version") {
      return { status: 0, stdout: "Docker Compose version v2.30.0", stderr: "" };
    }
    if (command === "docker" && args[0] === "compose" && args.includes("up")) {
      return { status: this.failUp ? 1 : 0, stdout: "", stderr: this.failUp ? "recreate failed" : "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  }
}

const setupInstall = (dir: string) => {
  const paths = installationPaths(dir);
  writeFileAtomic(paths.environment, createEnvironment({ version: "1.2.3", workerConcurrency: "6" }));
  writeFileAtomic(paths.compose, "name: outcomego\nservices:\n  computer:\n    image: alpine\n");
  writeManifest(paths, {
    schemaVersion: 1,
    repository: "test/OutcomeGo",
    version: "1.2.3",
    composeUrl: "https://example.com/compose.yaml",
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ownerUsername: "admin",
    engine: { kind: "external" },
  });
  return paths;
};

describe("CLI resources arguments & snapshot", () => {
  test("parses resources status and extended set flags", () => {
    expect(parseArguments(["resources", "status", "--json"])).toMatchObject({
      command: "resources-status",
      json: true,
    });
    expect(
      parseArguments([
        "resources",
        "set",
        "--computer-memory",
        "8g",
        "--desktop-memory",
        "6g",
        "--computer-cpu",
        "3.5",
        "--worker-concurrency",
        "4",
        "--engine-memory",
        "12g",
        "--engine-cpu",
        "6",
        "--apply-wslconfig",
        "--restart-wsl",
        "--json",
        "--yes",
      ])
    ).toMatchObject({
      command: "resources-set",
      computerMemory: "8g",
      desktopMemory: "6g",
      computerCpu: "3.5",
      workerConcurrency: "4",
      engineMemory: "12g",
      engineCpu: "6",
      applyWslconfig: true,
      restartWsl: true,
      json: true,
      yes: true,
    });
  });

  test("collectResourceSnapshot reads .env, compose.local.yaml, and engine limits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-res-snap-"));
    try {
      const paths = setupInstall(dir);
      writeFileAtomic(paths.localCompose, "services:\n  computer:\n    cpus: 3.5\n");
      const runner = new ResourcesRunner();
      const snap = await collectResourceSnapshot(paths, runner, {
        hostMemoryBytes: () => 32 * GIB,
        hostCpuCores: () => 12,
        diskBytes: () => 100 * GIB,
      });
      expect(snap).toEqual({
        schemaVersion: 1,
        host: { memoryBytes: 32 * GIB, cpuCores: 12, diskAvailableBytes: 100 * GIB },
        containers: {
          computerMemory: "12g",
          desktopMemory: "10g",
          computerCpu: 3.5,
          workerConcurrency: 6,
        },
        engine: {
          kind: "external",
          memoryBytes: 16 * GIB,
          cpuCores: 8,
          configurable: "readonly",
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI resources set validation and rollback", () => {
  test("rejects memory < 1 GiB, desktop >= computer, invalid CPU, and invalid concurrency", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-res-validate-"));
    try {
      const paths = setupInstall(dir);
      const runner = new ResourcesRunner();
      const deps = { hostMemoryBytes: () => 16 * GIB, hostCpuCores: () => 8 };

      await expect(
        resourcesSetExtendedCommand(paths, { computerMemory: "512m", desktopMemory: "256m", yes: true }, runner, deps)
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        resourcesSetExtendedCommand(paths, { computerMemory: "4g", desktopMemory: "4g", yes: true }, runner, deps)
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        resourcesSetExtendedCommand(paths, { computerMemory: "4g", desktopMemory: "6g", yes: true }, runner, deps)
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        resourcesSetExtendedCommand(paths, { computerCpu: "0.5", yes: true }, runner, deps)
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        resourcesSetExtendedCommand(paths, { computerCpu: "16", yes: true }, runner, deps)
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        resourcesSetExtendedCommand(paths, { workerConcurrency: "0", yes: true }, runner, deps)
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        resourcesSetExtendedCommand(paths, { workerConcurrency: "65", yes: true }, runner, deps)
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        resourcesSetExtendedCommand(paths, { engineMemory: "8g", yes: true }, runner, deps)
      ).rejects.toThrow("INVALID_INPUT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writes compose.local.yaml for computer CPU, recreates affected services, and rolls back on failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-res-rollback-"));
    try {
      const paths = setupInstall(dir);
      const originalEnv = readFileSync(paths.environment, "utf8");
      const runner = new ResourcesRunner();
      const deps = { hostMemoryBytes: () => 32 * GIB, hostCpuCores: () => 12 };

      // Failure must roll back both .env and compose.local.yaml
      runner.failUp = true;
      await expect(
        resourcesSetExtendedCommand(
          paths,
          { computerMemory: "8g", desktopMemory: "6g", computerCpu: "4", workerConcurrency: "12", yes: true },
          runner,
          deps
        )
      ).rejects.toThrow();
      expect(readFileSync(paths.environment, "utf8")).toBe(originalEnv);
      expect(existsSync(paths.localCompose)).toBe(false);

      // Success writes both and recreates computer (+ memory-init) and worker
      runner.failUp = false;
      const snap = await resourcesSetExtendedCommand(
        paths,
        {
          computerMemory: "8g",
          desktopMemory: "6g",
          computerCpu: "4",
          workerConcurrency: "12",
          json: true,
          yes: true,
        },
        runner,
        deps
      );
      expect(snap?.containers).toEqual({
        computerMemory: "8g",
        desktopMemory: "6g",
        computerCpu: 4,
        workerConcurrency: 12,
      });
      expect(readLocalComputerCpu(paths)).toBe(4);
      const env = parseEnvironment(readFileSync(paths.environment, "utf8"));
      expect(env.get("OUTCOMEGO_WORKER_CONCURRENCY")).toBe("12");
      expect(runner.calls.some((c) => c.includes("computer-memory-init"))).toBe(true);
      expect(runner.calls.some((c) => c.at(-1) === "worker")).toBe(true);

      // Clearing computerCpu removes compose.local.yaml
      await resourcesSetExtendedCommand(paths, { computerCpu: "none", yes: true }, runner, deps);
      expect(existsSync(paths.localCompose)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects container memory > 75% of engine memory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-res-engine-limit-"));
    try {
      const paths = setupInstall(dir);
      const runner = new ResourcesRunner();

      // Engine has 16 GiB (from ResourcesRunner mock), 75% = 12 GiB
      // Requesting 13g for computer should fail
      await expect(
        resourcesSetExtendedCommand(
          paths,
          { computerMemory: "13g", desktopMemory: "10g", yes: true },
          runner,
          { hostMemoryBytes: () => 32 * GIB, hostCpuCores: () => 8 }
        )
      ).rejects.toThrow("exceeds 75%");

      // Requesting 12.5g should also fail
      await expect(
        resourcesSetExtendedCommand(
          paths,
          { computerMemory: "12800m", desktopMemory: "10g", yes: true },
          runner,
          { hostMemoryBytes: () => 32 * GIB, hostCpuCores: () => 8 }
        )
      ).rejects.toThrow("exceeds 75%");

      // Within limits should succeed: 12g computer (= 75% threshold, allowed), 10g desktop
      await resourcesSetExtendedCommand(
        paths,
        { computerMemory: "12g", desktopMemory: "10g", yes: true },
        runner,
        { hostMemoryBytes: () => 32 * GIB, hostCpuCores: () => 8 }
      );
      let env = parseEnvironment(readFileSync(paths.environment, "utf8"));
      expect(env.get("OUTCOMEGO_COMPUTER_MEMORY_LIMIT")).toBe("12g");

      // 10g computer (< 12g threshold) with 4 CPU (< 8) should also succeed
      await resourcesSetExtendedCommand(
        paths,
        { computerMemory: "10g", desktopMemory: "8g", computerCpu: "4", yes: true },
        runner,
        { hostMemoryBytes: () => 32 * GIB, hostCpuCores: () => 8 }
      );
      env = parseEnvironment(readFileSync(paths.environment, "utf8"));
      expect(env.get("OUTCOMEGO_COMPUTER_MEMORY_LIMIT")).toBe("10g");
      expect(readLocalComputerCpu(paths)).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Windows .wslconfig safe backup and incremental update", () => {
  test("creates .wslconfig.outcomego.bak and preserves unrelated sections, keys, and comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-wslconfig-"));
    try {
      const cfgPath = join(dir, ".wslconfig");
      const original = [
        "# Global WSL configuration",
        "[wsl2]",
        "# keep this comment",
        "swap=4GB",
        "memory=6GB",
        "nestedVirtualization=true",
        "",
        "[experimental]",
        "autoMemoryReclaim=gradual",
        "",
      ].join("\r\n");
      writeFileSync(cfgPath, original, "utf8");

      const result = updateWslConfig(cfgPath, { memory: "10g", processors: 6 });
      expect(result.backupPath).toBe(wslConfigBackupPath(cfgPath));
      expect(readFileSync(wslConfigBackupPath(cfgPath), "utf8")).toBe(original);

      const updated = readFileSync(cfgPath, "utf8");
      expect(updated).toContain("# Global WSL configuration");
      expect(updated).toContain("# keep this comment");
      expect(updated).toContain("swap=4GB");
      expect(updated).toContain("memory=10GB");
      expect(updated).toContain("processors=6");
      expect(updated).toContain("nestedVirtualization=true");
      expect(updated).toContain("[experimental]\r\nautoMemoryReclaim=gradual");

      expect(readWslConfig(cfgPath)).toEqual({
        path: cfgPath,
        exists: true,
        memory: "10GB",
        processors: 6,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
