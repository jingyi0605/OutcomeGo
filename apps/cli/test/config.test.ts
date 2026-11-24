import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEnvironment,
  defaultInstallDirectory,
  detectWorkerConcurrency,
  installationPaths,
  normalizeRepository,
  normalizeVersion,
  parseEnvironment,
  readManifest,
  replaceEnvironmentValue,
  writeFileAtomic,
  writeManifest,
} from "../src/config";
import { requireComposeProject } from "../src/docker";

const temporaryDirectories: string[] = [];

const manifestFixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-cli-manifest-"));
  temporaryDirectories.push(directory);
  return {
    paths: installationPaths(directory),
    manifest: {
      schemaVersion: 1 as const,
      repository: "owner/repo",
      version: "1.2.3",
      composeUrl: "https://example.com/compose.yaml",
      installedAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    },
  };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("installation configuration", () => {
  test("uses a cross-platform per-user installation directory", () => {
    expect(defaultInstallDirectory({}, "darwin", "/Users/tester")).toBe("/Users/tester/.outcomego");
    expect(defaultInstallDirectory({ XDG_CONFIG_HOME: "/config" }, "linux", "/home/tester")).toBe(
      "/config/outcomego"
    );
    expect(
      defaultInstallDirectory(
        { LOCALAPPDATA: "C:\\Users\\tester\\Local" },
        "win32",
        "C:\\Users\\tester"
      )
    ).toContain("outcomeGo");
  });

  test("creates random single-line secrets and stable release settings", () => {
    const first = parseEnvironment(
      createEnvironment({ version: "1.2.3", workerConcurrency: "8" })
    );
    const second = parseEnvironment(
      createEnvironment({ version: "1.2.3", workerConcurrency: "8" })
    );
    expect(first.get("OUTCOMEGO_VERSION")).toBe("1.2.3");
    expect(first.get("OUTCOMEGO_UPDATE_CHANNEL")).toBe("stable");
    expect(first.get("OUTCOMEGO_BIND_HOST")).toBe("127.0.0.1");
    expect(first.get("OUTCOMEGO_VIEWER_BIND_HOST")).toBe("127.0.0.1");
    expect(first.get("OUTCOMEGO_PUBLIC_HOST")).toBe("127.0.0.1");
    expect(first.get("OUTCOMEGO_PUBLIC_URL")).toBe("http://127.0.0.1:8787");
    expect(first.get("OUTCOMEGO_ACCESS_MODE")).toBe("local");
    expect(first.get("OUTCOMEGO_WORKER_CONCURRENCY")).toBe("8");
    expect(first.get("COMPOSE_PROFILES")).toBe("direct");
    expect(first.get("OUTCOMEGO_AUTH_MODE")).toBe("required");
    expect(first.has("OUTCOMEGO_PI_PROVIDER")).toBe(false);
    expect(first.has("OUTCOMEGO_PI_MODEL")).toBe(false);
    expect(first.has("OUTCOMEGO_PI_THINKING")).toBe(false);
    expect(first.get("OUTCOMEGO_CONTROL_TOKEN")).toHaveLength(64);
    expect(first.get("OUTCOMEGO_AUTH_SECRET")).toHaveLength(64);
    expect(first.get("OUTCOMEGO_PROXY_SECRET")).toHaveLength(64);
    expect(first.get("OUTCOMEGO_POSTGRES_PASSWORD")).toHaveLength(64);
    expect(first.get("OUTCOMEGO_CONTROL_TOKEN")).not.toBe(second.get("OUTCOMEGO_CONTROL_TOKEN"));
    expect(first.get("OUTCOMEGO_AUTH_SECRET")).not.toBe(second.get("OUTCOMEGO_AUTH_SECRET"));
    expect(first.get("OUTCOMEGO_PROXY_SECRET")).not.toBe(second.get("OUTCOMEGO_PROXY_SECRET"));
  });

  test("marks prerelease installations as beta channel", () => {
    expect(
      parseEnvironment(createEnvironment({ version: "1.2.3-beta.1" })).get("OUTCOMEGO_UPDATE_CHANNEL")
    ).toBe("beta");
  });

  test("chooses a safe task limit from the available CPU count", () => {
    expect(detectWorkerConcurrency(1)).toBe("1");
    expect(detectWorkerConcurrency(4)).toBe("4");
    expect(detectWorkerConcurrency(32)).toBe("8");
  });

  test("updates one environment setting without changing secrets", () => {
    const original = createEnvironment({ version: "1.0.0" });
    const updated = replaceEnvironmentValue(original, "OUTCOMEGO_VERSION", "1.1.0");
    const before = parseEnvironment(original);
    const after = parseEnvironment(updated);
    expect(after.get("OUTCOMEGO_VERSION")).toBe("1.1.0");
    expect(after.get("OUTCOMEGO_CONTROL_TOKEN")).toBe(before.get("OUTCOMEGO_CONTROL_TOKEN"));
    expect(after.get("OUTCOMEGO_AUTH_SECRET")).toBe(before.get("OUTCOMEGO_AUTH_SECRET"));
    expect(after.get("OUTCOMEGO_POSTGRES_PASSWORD")).toBe(before.get("OUTCOMEGO_POSTGRES_PASSWORD"));
  });

  test("writes secret files privately and atomically", () => {
    const directory = mkdtempSync(join(tmpdir(), "outcomego-cli-config-"));
    temporaryDirectories.push(directory);
    const paths = installationPaths(directory);
    writeFileAtomic(paths.environment, "SECRET=value\n", 0o600);
    expect(readFileSync(paths.environment, "utf8")).toBe("SECRET=value\n");
    if (process.platform !== "win32") expect(statSync(paths.environment).mode & 0o077).toBe(0);
  });

  test("normalizes release identifiers", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeRepository("https://github.com/owner/repo.git")).toBe("owner/repo");
    expect(() => normalizeVersion("latest")).toThrow("Invalid OutcomeGo version");
    expect(() => normalizeRepository("not-a-repository")).toThrow("Invalid GitHub repository");
  });

  test("reads legacy v1 manifests as external without rewriting them", () => {
    const { paths, manifest } = manifestFixture();
    const original = JSON.stringify(manifest);
    writeFileAtomic(paths.manifest, original, 0o600);
    expect(readManifest(paths)).toEqual({ ...manifest, engine: { kind: "external" } });
    expect(readFileSync(paths.manifest, "utf8")).toBe(original);
    expect(() => writeManifest(paths, { ...manifest, engine: { kind: "managed-wsl" } })).toThrow("ENGINE_UNAVAILABLE");
    expect(readFileSync(paths.manifest, "utf8")).toBe(original);
  });

  test("records the external engine in new v1 manifests", () => {
    const { paths, manifest } = manifestFixture();
    writeManifest(paths, manifest);
    expect(JSON.parse(readFileSync(paths.manifest, "utf8"))).toEqual({
      ...manifest, engine: { kind: "external", createdAt: manifest.installedAt },
    });
  });

  test("keeps a recorded engine across manifest updates and refuses another kind", () => {
    const { paths, manifest } = manifestFixture();
    const engine = { kind: "managed-lima" as const, name: "outcomego-engine", version: "1.0.0" };
    writeManifest(paths, { ...manifest, engine });
    writeManifest(paths, { ...manifest, version: "1.2.4" });
    expect(readManifest(paths)).toEqual({ ...manifest, version: "1.2.4", engine });
    expect(() => writeManifest(paths, { ...manifest, engine: { kind: "external" } })).toThrow("ENGINE_UNAVAILABLE");
    expect(readManifest(paths)).toEqual({ ...manifest, version: "1.2.4", engine });
    expect(() => requireComposeProject(paths, { run: () => { throw new Error("incorrect Docker invocation"); } })).toThrow("ENGINE_UNAVAILABLE");
  });

  test("rejects unrecognized or malformed engine records instead of falling back to Docker", () => {
    const { paths, manifest } = manifestFixture();
    for (const engine of [{ kind: "unknown" }, { kind: "external", version: 42 }, null]) {
      writeFileAtomic(paths.manifest, JSON.stringify({ ...manifest, engine }), 0o600);
      expect(() => readManifest(paths)).toThrow("unsupported manifest shape");
    }
  });
});
