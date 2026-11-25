import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "../src/arguments";
import { createEnvironment, installationPaths, parseEnvironment, resourceLimits, writeFileAtomic, writeManifest } from "../src/config";
import { checkDeployResources } from "../src/deploy-resources";
import { resourcesSetCommand } from "../src/lifecycle";
import type { CommandRunner, RunResult } from "../src/process";

const GIB = 1024 ** 3;

test.each([
  [4, { computerLimit: 3 * GIB, desktopLimit: 2 * GIB }],
  [6, { computerLimit: 4.5 * GIB, desktopLimit: 3.5 * GIB }],
  [16, null],
] as const)("calculates and configures memory for a %s GiB guest", (guest, expected) => {
  expect(resourceLimits(guest * GIB)).toEqual(expected);
  const environment = parseEnvironment(createEnvironment({ version: "1.2.3", guestMemoryBytes: guest * GIB }));
  expect(environment.get("OUTCOMEGO_COMPUTER_MEMORY_LIMIT")).toBe(expected ? String(expected.computerLimit) : undefined);
  expect(environment.get("OUTCOMEGO_DESKTOP_MEMORY_LIMIT")).toBe(expected ? String(expected.desktopLimit) : undefined);
});

test.each([
  [{ diskBytes: () => 7 * GIB }, "DISK_SPACE_LOW", "free-disk"],
  [{ hostMemoryBytes: () => 7 * GIB }, "MEMORY_LOW", "confirm-low-memory"],
  [{ guestMemoryBytes: 3 * GIB }, "MEMORY_LOW", "confirm-low-memory"],
  [{ findConflict: async () => ({ port: 8787, host: "127.0.0.1", container: "other-server" }) }, "PORT_IN_USE", "free-port"],
] as const)("resource preflight reports %j as %s", async (overrides, code, kind) => {
  const issue = await checkDeployResources({
    directory: "test-install", apiPort: 8787, guestMemoryBytes: 4 * GIB,
    hostMemoryBytes: () => 8 * GIB, diskBytes: () => 8 * GIB,
    findConflict: async () => null,
    ...overrides,
  });
  expect(issue).toMatchObject({ code, action: { kind } });
  if (code === "PORT_IN_USE") expect(issue?.message).toContain("other-server");
});

test("resource preflight checks the asset filesystem and supports explicit low-memory consent", async () => {
  const checks: string[] = [];
  const options = {
    directory: "install", assetDirectory: "engine-assets", apiPort: 8787,
    guestMemoryBytes: 3 * GIB, hostMemoryBytes: () => 7 * GIB, acceptLowMemory: true,
    diskBytes: (directory: string) => {
      checks.push(directory);
      return directory === "engine-assets" ? 7 * GIB : 8 * GIB;
    },
    findConflict: async () => null,
  };
  expect(await checkDeployResources(options)).toMatchObject({ code: "DISK_SPACE_LOW" });
  expect(checks).toEqual(["install", "engine-assets"]);
  expect(await checkDeployResources({ ...options, diskBytes: () => 8 * GIB })).toBeNull();
});

class FakeRunner implements CommandRunner {
  readonly calls: string[][] = [];
  fail = false;

  run(command: string, args: readonly string[]): RunResult {
    this.calls.push([command, ...args]);
    if (args.join(" ") === "compose version") {
      return { status: 0, stdout: "Docker Compose version v2.20.0", stderr: "" };
    }
    if (args.includes("up")) return { status: this.fail ? 1 : 0, stdout: "", stderr: "" };
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  }
}

test.each(["10x", "15m", "0", "2.5g"])("resources set rejects invalid size %s before touching the engine", async (size) => {
  const runner = new FakeRunner();
  const options = parseArguments(["resources", "set", "--computer-memory", size, "--desktop-memory", "1g", "--yes"]);
  await expect(resourcesSetCommand(installationPaths("missing"), options, runner)).rejects.toMatchObject({ exitCode: 2 });
  expect(runner.calls).toEqual([]);
});

test("resources set recreates only the selected services and restores configuration on failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-resources-"));
  try {
    const paths = installationPaths(directory);
    const environment = createEnvironment({ version: "1.2.3" });
    writeFileAtomic(paths.environment, environment);
    writeFileAtomic(paths.compose, "services: {}\n");
    writeManifest(paths, { schemaVersion: 1, repository: "org/repo", version: "1.2.3", composeUrl: "https://example.invalid", installedAt: "2026-11-23", updatedAt: "2026-11-23", projectName: "isolated" });
    const runner = new FakeRunner();
    const options = parseArguments(["resources", "set", "--computer-memory", "4608m", "--desktop-memory", "3584m", "--yes"]);
    runner.fail = true;
    await expect(resourcesSetCommand(paths, options, runner)).rejects.toThrow();
    expect(readFileSync(paths.environment, "utf8")).toBe(environment);
    runner.fail = false;
    await resourcesSetCommand(paths, options, runner);
    expect(runner.calls.at(-1)?.slice(-6)).toEqual(["up", "-d", "--no-deps", "--force-recreate", "computer", "computer-memory-init"]);
    expect(runner.calls.at(-1)).toContain("isolated");
    const updated = parseEnvironment(readFileSync(paths.environment, "utf8"));
    expect(updated.get("OUTCOMEGO_COMPUTER_MEMORY_LIMIT")).toBe("4608m");
    expect(updated.get("OUTCOMEGO_DESKTOP_MEMORY_LIMIT")).toBe("3584m");
    expect(updated.get("OUTCOMEGO_AUTH_SECRET")).toBe(parseEnvironment(environment).get("OUTCOMEGO_AUTH_SECRET"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
