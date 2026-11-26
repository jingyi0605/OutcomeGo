import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "../src/arguments";
import { installationPaths, readManifest, writeManifest } from "../src/config";
import {
  buildLimaLaunchAgentPlist,
  MANAGED_LIMA_AUTOSTART_LABEL,
  ManagedLimaEngine,
} from "../src/engine/managed-lima";
import { MANAGED_WSL_AUTOSTART_TASK, ManagedWslEngine } from "../src/engine/managed-wsl";
import { stopCommand } from "../src/lifecycle";
import { autostartSetCommand, collectAutostartStatus } from "../src/local-ops";
import type { CommandRunner, RunOptions, RunResult } from "../src/process";

const makeInstall = (dir: string, engineKind: "external" | "managed-wsl" | "managed-lima") => {
  const paths = installationPaths(dir);
  writeFileSync(paths.compose, "name: outcomego\nservices:\n  server:\n    image: alpine\n");
  writeFileSync(
    paths.environment,
    "OUTCOMEGO_VERSION=0.1.0\nOUTCOMEGO_BIND_HOST=127.0.0.1\nOUTCOMEGO_VIEWER_BIND_HOST=127.0.0.1\nOUTCOMEGO_ACCESS_MODE=local\n"
  );
  writeManifest(paths, {
    schemaVersion: 1,
    repository: "test/OutcomeGo",
    version: "0.1.0",
    composeUrl: "https://example.com/compose.yaml",
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ownerUsername: "admin",
    engine: { kind: engineKind },
  });
  return paths;
};

describe("CLI autostart arguments & external engine", () => {
  test("parses autostart status and set options", () => {
    expect(parseArguments(["autostart", "status", "--json"])).toMatchObject({
      command: "autostart-status",
      json: true,
    });
    expect(parseArguments(["autostart", "set", "--enabled", "false", "--json"])).toMatchObject({
      command: "autostart-set",
      enabled: false,
      json: true,
    });
    expect(() => parseArguments(["autostart", "set", "--enabled", "maybe"])).toThrow("INVALID_INPUT");
  });

  test("returns read-only status for external engine and rejects set", () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-autostart-ext-"));
    try {
      const paths = makeInstall(dir, "external");
      const runner: CommandRunner = {
        run: () => ({ status: 0, stdout: "", stderr: "" }),
      };
      const status = collectAutostartStatus(paths, runner);
      expect(status).toMatchObject({
        schemaVersion: 1,
        serviceSupported: false,
        serviceEnabled: false,
        serviceRegistered: false,
        engineKind: "external",
      });
      expect(status.unsupportedReason).toBeTruthy();
      expect(() =>
        autostartSetCommand(paths, runner, { enabled: true, json: true })
      ).toThrow("INVALID_INPUT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ManagedLimaEngine LaunchAgent autostart", () => {
  test("generates XML plist and supports idempotent register, query, and remove", () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-lima-autostart-"));
    try {
      const paths = makeInstall(dir, "managed-lima");
      const runtimeBin = join(dir, "engine", "lima-runtime", "bin");
      const limactl = join(runtimeBin, "limactl");
      const limaHome = join(dir, "engine", "lima");
      const instanceDir = join(limaHome, "outcomego-engine");
      const launchAgentsDir = join(dir, "LaunchAgents");
      const carrierPath = join(dir, "bin", "outcomego");
      mkdirSync(runtimeBin, { recursive: true });
      mkdirSync(instanceDir, { recursive: true });
      mkdirSync(join(dir, "bin"), { recursive: true });
      writeFileSync(limactl, "#!/bin/sh\nexit 0\n");
      writeFileSync(
        join(dir, "engine", "lima-runtime", "outcomego-runtime.sha256"),
        createHash("sha256").update(readFileSync(limactl)).digest("hex")
      );
      writeFileSync(join(limaHome, "outcomego-instance.json"), JSON.stringify({ directory: dir, apiPort: 8787 }));
      writeFileSync(carrierPath, "#!/bin/sh\nexit 0\n");

      const calls: Array<{ command: string; args: readonly string[] }> = [];
      const runner: CommandRunner = {
        run(command, args) {
          calls.push({ command, args });
          return { status: 0, stdout: "", stderr: "" };
        },
      };

      const engine = new ManagedLimaEngine({
        paths,
        runner,
        architecture: "arm64",
        release: "24.0.0",
        launchAgentsDir,
        carrierPath,
      });

      expect(engine.isAutostartRegistered()).toBe(false);
      expect(engine.ensureAutostart()).toBe(true);
      expect(engine.isAutostartRegistered()).toBe(true);
      expect(existsSync(engine.launchAgentPath)).toBe(true);

      const plistText = readFileSync(engine.launchAgentPath, "utf8");
      expect(plistText).toContain(`<string>${MANAGED_LIMA_AUTOSTART_LABEL}</string>`);
      expect(plistText).toContain(`<string>${carrierPath}</string>`);
      expect(plistText).toContain("<string>start</string>");
      expect(plistText).toContain("<key>RunAtLoad</key>");
      expect(calls.some((c) => c.command === "/bin/launchctl" && c.args[0] === "bootstrap")).toBe(true);

      expect(engine.removeAutostart()).toBe(true);
      expect(engine.isAutostartRegistered()).toBe(false);
      expect(existsSync(engine.launchAgentPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("escapes XML special characters in LaunchAgent plist", () => {
    const plist = buildLimaLaunchAgentPlist({
      programArguments: ["/Users/a&b/outcomego", "start", "--dir", "/tmp/<test>"],
      logPath: "/tmp/a'b.log",
      limaHome: "/tmp/lima",
    });
    expect(plist).toContain("/Users/a&amp;b/outcomego");
    expect(plist).toContain("/tmp/&lt;test&gt;");
    expect(plist).toContain("/tmp/a&apos;b.log");
  });
});

describe("ManagedWslEngine autostart query and stopCommand decoupling", () => {
  test("queries scheduled task registration status", () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-wsl-autostart-"));
    try {
      const paths = makeInstall(dir, "managed-wsl");
      let registered = true;
      const runner: CommandRunner = {
        run(_command, args) {
          const cmd = args.join(" ");
          if (cmd.includes("GetTask") && cmd.includes(MANAGED_WSL_AUTOSTART_TASK)) {
            return { status: 0, stdout: registered ? "registered\r\n" : "missing\r\n", stderr: "" };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      };
      const engine = new ManagedWslEngine({
        paths,
        runner,
        architecture: "x64",
        release: "10.0.22631",
      });
      expect(engine.isAutostartRegistered()).toBe(true);
      registered = false;
      expect(engine.isAutostartRegistered()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stopCommand preserves autostart preference and does not delete scheduled task", () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-stop-decouple-"));
    try {
      const paths = makeInstall(dir, "external");
      writeManifest(paths, {
        ...readManifest(paths)!,
        autostart: { enabled: true },
      });
      const calls: Array<{ command: string; args: readonly string[]; options?: RunOptions }> = [];
      const runner: CommandRunner = {
        run(command, args, options): RunResult {
          calls.push({ command, args, options });
          if (command === "docker" && args[0] === "compose" && args[1] === "version") {
            return { status: 0, stdout: "Docker Compose version v2.30.0", stderr: "" };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      };
      stopCommand(paths, runner);
      expect(calls.some((c) => c.args.join(" ").includes("DeleteTask"))).toBe(false);
      expect(calls.some((c) => c.command === "/bin/launchctl")).toBe(false);
      expect(readManifest(paths)?.autostart?.enabled).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
