import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  applyStoredProxyToEnvironment,
  collectProxyStatus,
  formatDockerProxyDropIn,
  MANDATORY_NO_PROXY_ENTRIES,
  mapLoopbackHostForEngine,
  mergeNoProxy,
  proxySetCommand,
  proxyTestCommand,
  readStoredProxyConfig,
} from "../src/proxy-config";
import type { CommandRunner, RunResult } from "../src/process";

class ProxyRunner implements CommandRunner {
  readonly calls: string[][] = [];
  failUp = false;

  run(command: string, args: readonly string[]): RunResult {
    this.calls.push([command, ...args]);
    if (command === "docker" && args[0] === "compose" && args[1] === "version") {
      return { status: 0, stdout: "Docker Compose version v2.30.0", stderr: "" };
    }
    if (command === "docker" && args[0] === "compose" && args.includes("up")) {
      if (this.failUp) {
        return {
          status: 1,
          stdout: "",
          stderr: "compose failed with http://alice:superSecretPass@host.docker.internal:7890",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  }
}

const makeInstall = (dir: string) => {
  const paths = installationPaths(dir);
  writeFileAtomic(paths.environment, createEnvironment({ version: "1.2.3" }));
  writeFileAtomic(
    paths.compose,
    "name: outcomego\nservices:\n  computer:\n    image: a\n  computer-memory-init:\n    image: a\n  server:\n    image: b\n  worker:\n    image: c\n"
  );
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

describe("proxy-config invariants and helpers", () => {
  test("parses proxy CLI subcommands", () => {
    expect(parseArguments(["proxy", "status", "--json"])).toMatchObject({
      command: "proxy-status",
      json: true,
    });
    expect(parseArguments(["proxy", "set", "--config-stdin", "--yes", "--json"])).toMatchObject({
      command: "proxy-set",
      configStdin: true,
      yes: true,
      json: true,
    });
    expect(parseArguments(["proxy", "test", "--config-stdin", "--json"])).toMatchObject({
      command: "proxy-test",
      configStdin: true,
      json: true,
    });
  });

  test("mergeNoProxy always preserves all mandatory intranet entries", () => {
    for (const input of ["", "   ", "example.com,.corp.local", "localhost,example.com"]) {
      const merged = mergeNoProxy(input);
      const list = merged.split(",");
      for (const required of MANDATORY_NO_PROXY_ENTRIES) {
        expect(list).toContain(required);
      }
    }
    expect(() => mergeNoProxy("bad\nline")).toThrow("INVALID_INPUT");
    expect(() => mergeNoProxy("bad;rm -rf /")).toThrow("INVALID_INPUT");
  });

  test("maps loopback hosts by engine kind while keeping non-loopback hosts unchanged", () => {
    expect(mapLoopbackHostForEngine("127.0.0.1", "external")).toEqual({
      mappedHost: "host.docker.internal",
      loopbackMappedHost: "host.docker.internal",
    });
    expect(mapLoopbackHostForEngine("localhost", "managed-lima")).toEqual({
      mappedHost: "host.lima.internal",
      loopbackMappedHost: "host.lima.internal",
    });
    expect(mapLoopbackHostForEngine("192.168.1.20", "external")).toEqual({
      mappedHost: "192.168.1.20",
      loopbackMappedHost: null,
    });
  });

  test("formats systemd docker daemon proxy drop-in safely", () => {
    const dropIn = formatDockerProxyDropIn({
      httpProxy: "http://172.24.160.1:7890",
      httpsProxy: "http://172.24.160.1:7890",
      noProxy: "127.0.0.1,localhost",
    });
    expect(dropIn).toContain("[Service]");
    expect(dropIn).toContain('Environment="HTTP_PROXY=http://172.24.160.1:7890"');
    expect(dropIn).toContain('Environment="HTTPS_PROXY=http://172.24.160.1:7890"');
    expect(dropIn).toContain('Environment="NO_PROXY=127.0.0.1,localhost"');
    expect(formatDockerProxyDropIn({ httpProxy: null, httpsProxy: null, noProxy: null })).toBeNull();
  });
});

describe("proxySetCommand, rollback, redaction, and proxyTestCommand", () => {
  test("saves original loopback host in proxy.json, maps container env, and redacts password", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-proxy-set-"));
    try {
      const paths = makeInstall(dir);
      const runner = new ProxyRunner();

      const saved = await proxySetCommand(
        paths,
        runner,
        { json: false, yes: true, configStdin: true },
        {
          payload: {
            mode: "manual",
            protocol: "http",
            host: "127.0.0.1",
            port: 7890,
            username: "alice",
            password: "superSecretPass",
            noProxy: ".internal.local",
            applyToContainers: true,
            applyToDockerDaemon: true,
          },
        }
      );

      expect(saved).toMatchObject({
        schemaVersion: 1,
        mode: "manual",
        protocol: "http",
        host: "127.0.0.1",
        port: 7890,
        username: "alice",
        hasPassword: true,
        applyToContainers: true,
        applyToDockerDaemon: false, // external engine always false
        loopbackMappedHost: "host.docker.internal",
      });
      expect(JSON.stringify(saved)).not.toContain("superSecretPass");

      const env = parseEnvironment(readFileSync(paths.environment, "utf8"));
      expect(env.get("OUTCOMEGO_HTTP_PROXY")).toBe("http://alice:superSecretPass@host.docker.internal:7890");
      expect(env.get("OUTCOMEGO_HOST_PROXY_TARGET")).toBe("host.docker.internal:7890");
      expect(env.get("OUTCOMEGO_NO_PROXY")).toContain("postgres");
      expect(env.get("OUTCOMEGO_NO_PROXY")).toContain(".internal.local");

      // Stored proxy.json preserves raw 127.0.0.1
      const stored = readStoredProxyConfig(paths, "external");
      expect(stored.host).toBe("127.0.0.1");

      // Host-side CLI downloader environment uses original 127.0.0.1
      const cliEnv: NodeJS.ProcessEnv = {};
      applyStoredProxyToEnvironment(paths, cliEnv);
      expect(cliEnv.HTTPS_PROXY).toBe("http://alice:superSecretPass@127.0.0.1:7890");

      // Keeping password when omitted, clearing with clearPassword
      const kept = await proxySetCommand(
        paths,
        runner,
        { json: false, yes: true, configStdin: true },
        {
          payload: {
            mode: "manual",
            protocol: "socks5",
            host: "127.0.0.1",
            port: 1080,
            username: "alice",
          },
        }
      );
      expect(kept.hasPassword).toBe(true);

      const cleared = await proxySetCommand(
        paths,
        runner,
        { json: false, yes: true, configStdin: true },
        {
          payload: {
            mode: "manual",
            protocol: "socks5",
            host: "127.0.0.1",
            port: 1080,
            username: "alice",
            clearPassword: true,
          },
        }
      );
      expect(cleared.hasPassword).toBe(false);

      // Turning off clears env vars
      await proxySetCommand(
        paths,
        runner,
        { json: false, yes: true, configStdin: true },
        { payload: { mode: "off" } }
      );
      const offEnv = parseEnvironment(readFileSync(paths.environment, "utf8"));
      expect(offEnv.get("OUTCOMEGO_HTTP_PROXY")).toBeUndefined();
      expect(offEnv.get("OUTCOMEGO_HOST_PROXY_TARGET")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rolls back proxy.json and .env on recreate failure and redacts error output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-proxy-rollback-"));
    try {
      const paths = makeInstall(dir);
      const originalEnv = readFileSync(paths.environment, "utf8");
      const runner = new ProxyRunner();
      runner.failUp = true;

      let caught: Error | null = null;
      try {
        await proxySetCommand(
          paths,
          runner,
          { json: false, yes: true, configStdin: true },
          {
            payload: {
              mode: "manual",
              protocol: "http",
              host: "127.0.0.1",
              port: 7890,
              username: "alice",
              password: "superSecretPass",
            },
          }
        );
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).not.toBeNull();
      expect(caught?.message).not.toContain("superSecretPass");
      expect(readFileSync(paths.environment, "utf8")).toBe(originalEnv);
      expect(existsSync(paths.proxyConfig)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("proxyTestCommand probes without mutating saved config and redacts secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomego-proxy-test-"));
    try {
      const paths = makeInstall(dir);
      const runner = new ProxyRunner();
      const result = await proxyTestCommand(
        paths,
        runner,
        { json: false, configStdin: true },
        {
          payload: {
            mode: "manual",
            protocol: "http",
            host: "127.0.0.1",
            port: 7890,
            username: "bob",
            password: "topSecretPwd",
          },
          probeTcp: async () => ({ ok: true, latencyMs: 5 }),
          probeHttp: async (url) => ({
            ok: !url.includes("ghcr.io"),
            latencyMs: 42,
            statusCode: url.includes("ghcr.io") ? 502 : 200,
            ...(url.includes("ghcr.io") ? { error: "failed via http://bob:topSecretPwd@127.0.0.1:7890" } : {}),
          }),
        }
      );

      expect(result.schemaVersion).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.loopbackMappedHost).toBe("host.docker.internal");
      expect(result.effectiveProxy).toBe("http://bob:[REDACTED]@127.0.0.1:7890");
      expect(JSON.stringify(result)).not.toContain("topSecretPwd");
      expect(result.checks.map((c) => c.target)).toEqual(["proxy-tcp", "model-api", "github", "registry"]);
      expect(collectProxyStatus(paths, runner).mode).toBe("off");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
