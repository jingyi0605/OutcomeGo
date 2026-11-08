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
  replaceEnvironmentValue,
  writeFileAtomic,
} from "../src/config";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("installation configuration", () => {
  test("uses a cross-platform per-user installation directory", () => {
    expect(defaultInstallDirectory({}, "darwin", "/Users/tester")).toBe("/Users/tester/.aiteamos");
    expect(defaultInstallDirectory({ XDG_CONFIG_HOME: "/config" }, "linux", "/home/tester")).toBe(
      "/config/aiteamos"
    );
    expect(
      defaultInstallDirectory(
        { LOCALAPPDATA: "C:\\Users\\tester\\Local" },
        "win32",
        "C:\\Users\\tester"
      )
    ).toContain("aiTeamOS");
  });

  test("creates random single-line secrets and stable release settings", () => {
    const first = parseEnvironment(
      createEnvironment({ version: "1.2.3", workerConcurrency: "8" })
    );
    const second = parseEnvironment(
      createEnvironment({ version: "1.2.3", workerConcurrency: "8" })
    );
    expect(first.get("AITEAMOS_VERSION")).toBe("1.2.3");
    expect(first.get("AITEAMOS_UPDATE_CHANNEL")).toBe("stable");
    expect(first.get("AITEAMOS_BIND_HOST")).toBe("127.0.0.1");
    expect(first.get("AITEAMOS_VIEWER_BIND_HOST")).toBe("127.0.0.1");
    expect(first.get("AITEAMOS_PUBLIC_HOST")).toBe("127.0.0.1");
    expect(first.get("AITEAMOS_PUBLIC_URL")).toBe("http://127.0.0.1:8787");
    expect(first.get("AITEAMOS_ACCESS_MODE")).toBe("local");
    expect(first.get("AITEAMOS_WORKER_CONCURRENCY")).toBe("8");
    expect(first.get("COMPOSE_PROFILES")).toBe("direct");
    expect(first.get("AITEAMOS_AUTH_MODE")).toBe("required");
    expect(first.has("AITEAMOS_PI_PROVIDER")).toBe(false);
    expect(first.has("AITEAMOS_PI_MODEL")).toBe(false);
    expect(first.has("AITEAMOS_PI_THINKING")).toBe(false);
    expect(first.get("AITEAMOS_CONTROL_TOKEN")).toHaveLength(64);
    expect(first.get("AITEAMOS_AUTH_SECRET")).toHaveLength(64);
    expect(first.get("AITEAMOS_PROXY_SECRET")).toHaveLength(64);
    expect(first.get("AITEAMOS_POSTGRES_PASSWORD")).toHaveLength(64);
    expect(first.get("AITEAMOS_CONTROL_TOKEN")).not.toBe(second.get("AITEAMOS_CONTROL_TOKEN"));
    expect(first.get("AITEAMOS_AUTH_SECRET")).not.toBe(second.get("AITEAMOS_AUTH_SECRET"));
    expect(first.get("AITEAMOS_PROXY_SECRET")).not.toBe(second.get("AITEAMOS_PROXY_SECRET"));
  });

  test("marks prerelease installations as beta channel", () => {
    expect(
      parseEnvironment(createEnvironment({ version: "1.2.3-beta.1" })).get("AITEAMOS_UPDATE_CHANNEL")
    ).toBe("beta");
  });

  test("chooses a safe task limit from the available CPU count", () => {
    expect(detectWorkerConcurrency(1)).toBe("1");
    expect(detectWorkerConcurrency(4)).toBe("4");
    expect(detectWorkerConcurrency(32)).toBe("8");
  });

  test("updates one environment setting without changing secrets", () => {
    const original = createEnvironment({ version: "1.0.0" });
    const updated = replaceEnvironmentValue(original, "AITEAMOS_VERSION", "1.1.0");
    const before = parseEnvironment(original);
    const after = parseEnvironment(updated);
    expect(after.get("AITEAMOS_VERSION")).toBe("1.1.0");
    expect(after.get("AITEAMOS_CONTROL_TOKEN")).toBe(before.get("AITEAMOS_CONTROL_TOKEN"));
    expect(after.get("AITEAMOS_AUTH_SECRET")).toBe(before.get("AITEAMOS_AUTH_SECRET"));
    expect(after.get("AITEAMOS_POSTGRES_PASSWORD")).toBe(before.get("AITEAMOS_POSTGRES_PASSWORD"));
  });

  test("writes secret files privately and atomically", () => {
    const directory = mkdtempSync(join(tmpdir(), "aiteamos-cli-config-"));
    temporaryDirectories.push(directory);
    const paths = installationPaths(directory);
    writeFileAtomic(paths.environment, "SECRET=value\n", 0o600);
    expect(readFileSync(paths.environment, "utf8")).toBe("SECRET=value\n");
    if (process.platform !== "win32") expect(statSync(paths.environment).mode & 0o077).toBe(0);
  });

  test("normalizes release identifiers", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeRepository("https://github.com/owner/repo.git")).toBe("owner/repo");
    expect(() => normalizeVersion("latest")).toThrow("Invalid aiTeamOS version");
    expect(() => normalizeRepository("not-a-repository")).toThrow("Invalid GitHub repository");
  });
});
