import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeployLog, deployErrorExitCodes, emitDeployEvent } from "../src/deploy-events";

test("writes a versioned single JSON line and redacts credentials from text fields", () => {
  const password = 'sentinel"password';
  const token = "sentinel-token";
  const output: string[] = [];
  emitDeployEvent({
    type: "error", stage: "engine", retryable: true, code: "ENGINE_START_FAILED",
    message: `${password}\nOUTCOMEGO_CONTROL_TOKEN=${token}`,
    action: { kind: "install-engine", detail: `Bearer ${token}` },
  }, { write: (line) => output.push(line), secretValues: [password] });
  expect(output).toHaveLength(1);
  expect(output[0]!.split("\n")).toHaveLength(2);
  expect(output[0]).not.toContain(token);
  expect(output[0]).not.toContain("sentinel");
  expect(JSON.parse(output[0]!)).toMatchObject({
    schemaVersion: 1, type: "error", stage: "engine", code: "ENGINE_START_FAILED",
    message: "[REDACTED]\nOUTCOMEGO_CONTROL_TOKEN=[REDACTED]",
    action: { kind: "install-engine", detail: "Bearer [REDACTED]" },
  });
});

test("all Spec error codes have their expected exit code", () => {
  expect(deployErrorExitCodes).toEqual({
    INVALID_INPUT: 2, VIRTUALIZATION_DISABLED: 2, WSL_NOT_ENABLED: 2, REBOOT_REQUIRED: 2,
    ELEVATION_DENIED: 2, WINDOWS_UNSUPPORTED: 2, MACOS_UNSUPPORTED: 2, ENGINE_UNAVAILABLE: 2,
    ENGINE_START_FAILED: 3, ENGINE_INCOMPATIBLE: 2, ASSET_DOWNLOAD_FAILED: 3,
    ASSET_VERIFICATION_FAILED: 1, PORT_IN_USE: 2, DISK_SPACE_LOW: 2, MEMORY_LOW: 2,
    IMAGE_PULL_FAILED: 3, STACK_START_FAILED: 3, HEALTH_TIMEOUT: 3, OWNER_CREATE_FAILED: 3,
    BUSY: 3, CLI_VERSION_MISMATCH: 3, CANCELLED: 130, UNKNOWN: 1,
  });
});

test("logs are private, bounded, redacted, and retain only five runs", () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-deploy-log-"));
  const sentinel = "opaque-log-secret-value";
  try {
    for (let run = 0; run < 6; run++) {
      const log = createDeployLog(directory, new Date(Date.UTC(2026, 10, 23, run)));
      try {
        log.write(`run ${run} OUTCOMEGO_AUTH_SECRET=${sentinel}`);
        log.write(`DATABASE_URL=postgresql://owner:${sentinel}@localhost:5432/outcomego`);
        if (run === 5) log.write("x".repeat(10 * 1024 * 1024));
      } finally {
        log.close();
      }
    }
    const logs = readdirSync(join(directory, "logs")).sort();
    expect(logs).toHaveLength(5);
    expect(readFileSync(join(directory, "logs", logs[0]!), "utf8")).toStartWith("run 1");
    const newest = join(directory, "logs", logs.at(-1)!);
    const output = readFileSync(newest, "utf8");
    expect(output).not.toContain(sentinel);
    expect(output).toContain("DATABASE_URL=[REDACTED]");
    expect(statSync(newest).size).toBeLessThanOrEqual(10 * 1024 * 1024);
    if (process.platform !== "win32") expect(statSync(newest).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
