import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "../src/arguments";
import { installationPaths, writeManifest, type InstallationPaths } from "../src/config";
import {
  collectContainerLogs,
  collectContainers,
  parseByteSize,
  parseDockerStatsOutput,
  parseDockerSystemDfDiskUsage,
  redactSensitiveText,
  restartCommand,
} from "../src/local-ops";
import type { CommandRunner, RunOptions, RunResult } from "../src/process";

const makeInstallation = (dir: string): InstallationPaths => {
  const paths = installationPaths(dir);
  writeFileSync(
    paths.compose,
    [
      "name: outcomego",
      "services:",
      "  postgres:",
      "    image: postgres:17-alpine",
      "  computer:",
      "    image: ghcr.io/test/outcomego-computer:0.1.0",
      "  computer-memory-init:",
      "    image: ghcr.io/test/outcomego-computer:0.1.0",
      "  server:",
      "    image: ghcr.io/test/outcomego-server:0.1.0",
      "  worker:",
      "    image: ghcr.io/test/outcomego-worker:0.1.0",
    ].join("\n") + "\n"
  );
  writeFileSync(
    paths.environment,
    [
      "OUTCOMEGO_VERSION=0.1.0",
      "OUTCOMEGO_API_PORT=8787",
      "OUTCOMEGO_POSTGRES_PASSWORD=super-secret-db-pass",
      "OUTCOMEGO_CONTROL_TOKEN=control-token-xyz123",
      "OUTCOMEGO_HTTP_PROXY=http://alice:proxy-secret-999@172.24.160.1:7890",
    ].join("\n") + "\n"
  );
  writeManifest(paths, {
    schemaVersion: 1,
    repository: "test/OutcomeGo",
    version: "0.1.0",
    composeUrl: "https://example.com/compose.yaml",
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ownerUsername: "admin",
    engine: { kind: "external" },
  });
  return paths;
};

class MockDockerRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: readonly string[]; options?: RunOptions }> = [];
  engineRunning = true;
  psOutput = JSON.stringify([
    {
      Name: "outcomego-migrate-1",
      Service: "migrate",
      State: "exited",
      Health: "",
      Status: "Exited (0) 2 hours ago",
      Image: "ghcr.io/test/outcomego-migrate:0.1.0",
      ExitCode: 0,
    },
    {
      Name: "outcomego-worker-1",
      Service: "worker",
      State: "running",
      Health: "healthy",
      Status: "Up 2 hours (healthy)",
      Image: "ghcr.io/test/outcomego-worker:0.1.0",
      ExitCode: 0,
    },
    {
      Name: "outcomego-server-1",
      Service: "server",
      State: "running",
      Health: "healthy",
      Status: "Up 2 hours (healthy)",
      Image: "ghcr.io/test/outcomego-server:0.1.0",
      ExitCode: 0,
    },
    {
      Name: "outcomego-computer-1",
      Service: "computer",
      State: "running",
      Health: "healthy",
      Status: "Up 2 hours (healthy)",
      Image: "ghcr.io/test/outcomego-computer:0.1.0",
      ExitCode: 0,
    },
    {
      Name: "outcomego-computer-memory-init-1",
      Service: "computer-memory-init",
      State: "running",
      Health: "",
      Status: "Up 2 hours",
      Image: "ghcr.io/test/outcomego-computer:0.1.0",
      ExitCode: 0,
    },
    {
      Name: "outcomego-postgres-1",
      Service: "postgres",
      State: "running",
      Health: "healthy",
      Status: "Up 2 hours (healthy)",
      Image: "postgres:17-alpine",
      ExitCode: 0,
    },
  ]);
  statsOutput = [
    JSON.stringify({
      Name: "outcomego-server-1",
      CPUPerc: "1.25%",
      MemUsage: "128MiB / 4GiB",
      MemPerc: "3.12%",
    }),
    JSON.stringify({
      Name: "outcomego-computer-1",
      CPUPerc: "12.50%",
      MemUsage: "2.5GiB / 12GiB",
      MemPerc: "20.83%",
    }),
  ].join("\n");
  logsOutput = [
    "2026-01-01T00:00:01Z server started",
    "2026-01-01T00:00:02Z proxy=http://alice:proxy-secret-999@172.24.160.1:7890",
    "2026-01-01T00:00:03Z Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret",
    "2026-01-01T00:00:04Z key=sk-abcdefghijklmnopqrstuvwxyz1234",
    "2026-01-01T00:00:05Z db=super-secret-db-pass token=control-token-xyz123",
  ].join("\n");

  run(command: string, args: readonly string[], options?: RunOptions): RunResult {
    this.calls.push({ command, args, options });
    if (command === "docker" && args[0] === "--version") {
      return { status: 0, stdout: "Docker version 27.0.0", stderr: "" };
    }
    if (command === "docker" && args[0] === "info") {
      if (!this.engineRunning) {
        return { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          ServerVersion: "27.0.0",
          CgroupVersion: "2",
          MemTotal: 8 * 1024 ** 3,
          OSType: "linux",
          SecurityOptions: [],
        }),
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "context") {
      return { status: 0, stdout: "unix:///var/run/docker.sock", stderr: "" };
    }
    if (command === "docker" && args[0] === "compose" && args[1] === "version") {
      return { status: 0, stdout: "Docker Compose version v2.30.0", stderr: "" };
    }
    if (command === "docker" && args[0] === "stats") {
      return { status: 0, stdout: this.statsOutput, stderr: "" };
    }
    if (command === "docker" && args[0] === "compose" && args.includes("ps")) {
      return { status: 0, stdout: this.psOutput, stderr: "" };
    }
    if (command === "docker" && args[0] === "compose" && args.includes("logs")) {
      return { status: 0, stdout: this.logsOutput, stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  }
}

describe("CLI local-ops arguments", () => {
  test("parses containers, restart, and logs --json options", () => {
    expect(parseArguments(["containers", "--json", "--stats"])).toMatchObject({
      command: "containers",
      json: true,
      stats: true,
    });
    expect(parseArguments(["restart", "computer", "--json", "--yes"])).toMatchObject({
      command: "restart",
      service: "computer",
      json: true,
      yes: true,
    });
    expect(parseArguments(["restart", "--json"])).toMatchObject({
      command: "restart",
      service: undefined,
      json: true,
    });
    expect(parseArguments(["logs", "server", "--tail", "100", "--json"])).toMatchObject({
      command: "logs",
      service: "server",
      tail: "100",
      json: true,
    });
  });
});

describe("CLI containers command", () => {
  test("classifies core/init containers and merges docker stats when requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-local-ops-"));
    try {
      const paths = makeInstallation(dir);
      const runner = new MockDockerRunner();

      const withoutStats = await collectContainers(paths, runner, { includeStats: false });
      expect(withoutStats.schemaVersion).toBe(1);
      expect(withoutStats.engineRunning).toBe(true);
      expect(withoutStats.containers.map((c) => c.service)).toEqual([
        "server",
        "worker",
        "computer",
        "postgres",
        "computer-memory-init",
        "migrate",
      ]);
      expect(withoutStats.containers.find((c) => c.service === "server")).toMatchObject({
        role: "core",
        restartable: true,
        health: "healthy",
        exitCode: null,
        stats: null,
      });
      expect(withoutStats.containers.find((c) => c.service === "migrate")).toMatchObject({
        role: "init",
        restartable: false,
        health: "none",
        exitCode: 0,
      });

      const withStats = await collectContainers(paths, runner, { includeStats: true });
      const server = withStats.containers.find((c) => c.service === "server");
      expect(server?.stats).toEqual({
        cpuPercent: 1.25,
        memoryUsageBytes: 128 * 1024 * 1024,
        memoryLimitBytes: 4 * 1024 ** 3,
        memoryPercent: 3.12,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns engineRunning=false cleanly when container engine is stopped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-local-ops-stopped-"));
    try {
      const paths = makeInstallation(dir);
      const runner = new MockDockerRunner();
      runner.engineRunning = false;
      const result = await collectContainers(paths, runner, { includeStats: true });
      expect(result).toEqual({ schemaVersion: 1, engineRunning: false, containers: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parses byte sizes and docker stats JSONL", () => {
    expect(parseByteSize("512KiB")).toBe(512 * 1024);
    expect(parseByteSize("1.5GiB")).toBe(Math.round(1.5 * 1024 ** 3));
    const stats = parseDockerStatsOutput(
      JSON.stringify({ Name: "/outcomego-worker-1", CPUPerc: "4.2%", MemUsage: "256MiB / 2GiB", MemPerc: "12.5%" })
    );
    expect(stats.get("outcomego-worker-1")?.cpuPercent).toBe(4.2);
  });

  test("parses docker system df -v disk usage without double counting shared images or volumes", () => {
    const containers = [
      {
        service: "server",
        containerName: "outcomego-server-1",
        role: "core" as const,
        state: "running",
        health: "healthy" as const,
        statusText: "Up 1m",
        image: "ghcr.io/test/server@sha256:aaaa",
        exitCode: null,
        restartable: true,
        stats: null,
      },
      {
        service: "computer",
        containerName: "outcomego-computer-1",
        role: "core" as const,
        state: "running",
        health: "healthy" as const,
        statusText: "Up 1m",
        image: "ghcr.io/test/computer@sha256:cccc",
        exitCode: null,
        restartable: true,
        stats: null,
      },
      {
        service: "postgres",
        containerName: "outcomego-postgres-1",
        role: "core" as const,
        state: "running",
        health: "healthy" as const,
        statusText: "Up 1m",
        image: "postgres:17-alpine@sha256:dddd",
        exitCode: null,
        restartable: true,
        stats: null,
      },
      {
        service: "computer-memory-init",
        containerName: "outcomego-computer-memory-init-1",
        role: "core" as const,
        state: "running",
        health: "none" as const,
        statusText: "Up 1m",
        image: "ghcr.io/test/computer@sha256:cccc",
        exitCode: null,
        restartable: true,
        stats: null,
      },
    ];

    const dfJson = JSON.stringify({
      Images: [
        { ID: "sha256:aaaa", Size: "400MB" },
        { ID: "sha256:cccc", Size: "5GB" },
        { ID: "sha256:dddd", Size: "400MB" },
      ],
      Containers: [
        {
          Names: "outcomego-server-1",
          Size: "2MB",
          Labels: "com.docker.compose.image=sha256:aaaa",
          Mounts: "outcomego_assets,outcomego_workspace",
        },
        {
          Names: "outcomego-computer-1",
          Size: "3MB",
          Labels: "com.docker.compose.image=sha256:cccc",
          Mounts: "outcomego_computer_home,outcomego_workspace",
        },
        {
          Names: "outcomego-postgres-1",
          Size: "1MB",
          Labels: "com.docker.compose.image=sha256:dddd",
          Mounts: "outcomego_postgres",
        },
        {
          Names: "outcomego-computer-memory-init-1",
          Size: "4kB",
          Labels: "com.docker.compose.image=sha256:cccc",
          Mounts: "",
        },
      ],
      Volumes: [
        { Name: "outcomego_assets", Size: "10MB" },
        { Name: "outcomego_workspace", Size: "200MB" },
        { Name: "outcomego_computer_home", Size: "50MB" },
        { Name: "outcomego_postgres", Size: "100MB" },
      ],
    });

    const diskMap = parseDockerSystemDfDiskUsage(dfJson, containers);
    expect(diskMap.get("outcomego-server-1")).toBe(412_000_000);
    expect(diskMap.get("outcomego-computer-1")).toBe(5_253_000_000);
    expect(diskMap.get("outcomego-postgres-1")).toBe(501_000_000);
    // Shares image with computer, so only its own writable layer is counted
    expect(diskMap.get("outcomego-computer-memory-init-1")).toBe(4_000);
  });
});

describe("CLI restart command", () => {
  test("co-recreates computer and computer-memory-init when restarting computer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-local-ops-restart-"));
    try {
      const paths = makeInstallation(dir);
      const runner = new MockDockerRunner();
      const snapshot = await restartCommand(
        paths,
        runner,
        { service: "computer", json: false, yes: true },
        { waitReady: async () => undefined }
      );
      expect(snapshot.schemaVersion).toBe(1);
      const composeCall = runner.calls.find(
        (call) => call.command === "docker" && call.args.includes("--force-recreate")
      );
      expect(composeCall?.args.slice(-6)).toEqual([
        "up",
        "-d",
        "--no-deps",
        "--force-recreate",
        "computer",
        "computer-memory-init",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("restarts a single non-computer core service and rejects init or unknown services", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-local-ops-restart-svc-"));
    try {
      const paths = makeInstallation(dir);
      const runner = new MockDockerRunner();
      await restartCommand(
        paths,
        runner,
        { service: "worker", json: false, yes: true },
        { waitReady: async () => undefined }
      );
      const restartCall = runner.calls.find(
        (call) => call.command === "docker" && call.args.includes("restart")
      );
      expect(restartCall?.args.slice(-2)).toEqual(["restart", "worker"]);

      await expect(
        restartCommand(paths, runner, { service: "migrate", json: true, yes: true })
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        restartCommand(paths, runner, { service: "evil;rm -rf /", json: true, yes: true })
      ).rejects.toThrow("INVALID_INPUT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI logs --json and redaction", () => {
  test("validates service whitelist and tail range and redacts sensitive secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-local-ops-logs-"));
    try {
      const paths = makeInstallation(dir);
      const runner = new MockDockerRunner();
      const result = await collectContainerLogs(paths, runner, { service: "server", tail: "200" });
      expect(result.schemaVersion).toBe(1);
      expect(result.service).toBe("server");
      const joined = result.lines.join("\n");
      expect(joined).not.toContain("proxy-secret-999");
      expect(joined).not.toContain("eyJhbGciOiJIUzI1NiJ9.secret");
      expect(joined).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234");
      expect(joined).not.toContain("super-secret-db-pass");
      expect(joined).not.toContain("control-token-xyz123");
      expect(joined).toContain("[REDACTED]");

      await expect(
        collectContainerLogs(paths, runner, { service: "unknown-svc", tail: "200" })
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        collectContainerLogs(paths, runner, { service: "server", tail: "5" })
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        collectContainerLogs(paths, runner, { service: "server", tail: "2000" })
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        collectContainerLogs(paths, runner, { service: "server", tail: "200", follow: true })
      ).rejects.toThrow("INVALID_INPUT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("redactSensitiveText strips proxy credentials and API keys", () => {
    const output = redactSensitiveText(
      'Connecting via socks5://user:myPass123@127.0.0.1:1080 with {"apiKey": "secret-val"}'
    );
    expect(output).not.toContain("myPass123");
    expect(output).not.toContain("secret-val");
  });
});
