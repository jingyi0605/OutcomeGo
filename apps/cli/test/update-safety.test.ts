import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { registerDatabaseBackup, retainDatabaseBackups } from "../src/disk-maintenance";
import { installationPaths } from "../src/config";
import type { ComposeProject } from "../src/docker";
import type { EngineKind } from "../src/engine/types";
import {
  activeUpdateProcess,
  acquireUpdateLock,
  assertUpdatePreflight,
  readUpdateEvents,
  readUpdateState,
  writeUpdateState,
} from "../src/update-safety";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("update transaction safety", () => {
  test("rejects concurrent updates and releases the installation lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "outcomego-update-lock-"));
    temporaryDirectories.push(directory);
    const paths = installationPaths(directory);
    const release = acquireUpdateLock(paths);
    expect(() => acquireUpdateLock(paths)).toThrow("already running");
    release();
    expect(existsSync(paths.updateLock)).toBe(false);
    const releaseAgain = acquireUpdateLock(paths);
    releaseAgain();
  });

  test("persists update jobs atomically for reconnecting clients", () => {
    const directory = mkdtempSync(join(tmpdir(), "outcomego-update-state-"));
    temporaryDirectories.push(directory);
    const paths = installationPaths(directory);
    const initial = writeUpdateState(paths, {
      schemaVersion: 1,
      jobId: "job-1",
      status: "running",
      phase: "pulling",
      fromVersion: "1.2.3",
      targetVersion: "1.3.0",
      message: "Pulling images",
      startedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(readUpdateState(paths)).toMatchObject({
      jobId: "job-1",
      status: "running",
      phase: "pulling",
      sequence: 0,
    });
    writeUpdateState(paths, {
      ...initial,
      phase: "complete",
      status: "complete",
      message: "Update complete",
    });
    expect(readUpdateEvents(paths, "job-1").map((event) => event.sequence)).toEqual([0, 1]);
  });

  test("treats the detached CLI bootstrap as active before it takes the server lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "outcomego-update-bootstrap-"));
    temporaryDirectories.push(directory);
    const paths = installationPaths(directory);
    writeUpdateState(paths, {
      schemaVersion: 1,
      jobId: "job-1",
      workerPid: process.pid,
      status: "running",
      phase: "updating-cli",
      fromVersion: "1.2.3",
      targetVersion: "1.3.0",
      message: "Downloading command-line tools",
      startedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(activeUpdateProcess(paths)).toBe(process.pid);
  });

  test("keeps the newest update backups and the current one, and nothing else is touched", () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "outcomego-update-backups-")));
    temporaryDirectories.push(directory);
    const paths = installationPaths(directory);
    writeFileSync(paths.environment, "");
    mkdirSync(paths.backups);
    const backup = (from: string, to: string, at: string) =>
      `postgres-${from}-before-${to}-${at}-${randomUUID()}.sql`;
    const names = [
      backup("0.0.7", "0.0.8", "2026-10-24T10-00-00-000Z"),
      backup("0.0.8", "0.0.9", "2026-10-26T10-00-00-000Z"),
      backup("0.0.9", "0.0.10", "2026-10-26T18-00-00-000Z"),
      backup("0.0.10", "0.0.11", "2026-11-02T09-00-00-000Z"),
      backup("0.0.11", "0.0.12", "2026-11-09T09-00-00-000Z"),
      "my-own-dump.sql",
      "postgres-notes.txt",
    ];
    for (const name of names) writeFileSync(join(paths.backups, name), "SELECT 1;\n");
    for (const name of names.slice(0, 5)) registerDatabaseBackup(paths, join(paths.backups, name));
    // A clock set back makes this update's own backup sort as the oldest; rollback still needs it.
    const current = join(paths.backups, names[0]!);
    retainDatabaseBackups(paths, current);
    expect(readdirSync(paths.backups).sort()).toEqual([names[0]!, ...names.slice(2)].sort());
    writeFileSync(paths.environment, "OUTCOMEGO_BACKUP_RETENTION_COUNT=1\n");
    retainDatabaseBackups(paths, null);
    expect(readdirSync(paths.backups).sort()).toEqual(
      [names[4]!, "my-own-dump.sql", "postgres-notes.txt"].sort()
    );
  });
});

describe("update preflight", () => {
  const preflight = (kind: EngineKind, status: number) => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "outcomego-update-preflight-")));
    temporaryDirectories.push(directory);
    const asked: Array<readonly string[]> = [];
    const checked: string[] = [];
    // Only the engine the installation runs on can answer; there is no host `docker` to ask.
    const project = {
      engine: {
        kind,
        docker: (args: readonly string[]) => {
          asked.push(args);
          return { status, stdout: "28.0.0", stderr: "" };
        },
      },
      runOrThrow: (args: readonly string[]) => void checked.push(args[0]!),
    } as unknown as ComposeProject;
    const composeFile = join(directory, "compose.yaml.next");
    writeFileSync(composeFile, "services: {}\n");
    return { run: () => assertUpdatePreflight(installationPaths(directory), project, composeFile), asked, checked };
  };

  test.each(["external", "managed-lima", "managed-wsl"] as const)(
    "asks the %s engine whether its daemon answers, then validates the new Compose file",
    (kind) => {
      const check = preflight(kind, 0);
      expect(check.run).not.toThrow();
      expect(check.asked).toEqual([["info", "--format", "{{.ServerVersion}}"]]);
      expect(check.checked).toEqual(["config"]);
    }
  );

  test("names the engine that is down, and stops before validating anything", () => {
    const docker = preflight("external", 1);
    expect(docker.run).toThrow("The Docker daemon is not reachable.");
    expect(docker.checked).toEqual([]);
    for (const kind of ["managed-lima", "managed-wsl"] as const) {
      expect(preflight(kind, 1).run).toThrow("The OutcomeGo engine is not reachable.");
    }
  });
});
