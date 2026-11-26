import { existsSync, readFileSync, rmSync } from "node:fs";
import { createConnection, isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import {
  installationExists,
  normalizeProjectName,
  readManifest,
  setOrClearEnvironmentValue,
  writeFileAtomic,
  type InstallationPaths,
} from "./config";
import { PROJECT_NAME } from "./constants";
import { requireComposeProject } from "./docker";
import { ManagedEngine } from "./engine/managed";
import { requireRecordedEngine } from "./engine/select";
import { EngineError, type EngineKind, type EngineProvider } from "./engine/types";
import { cliTranslate } from "./localization";
import { hasMemoryInitService, redactSensitiveText } from "./local-ops";
import type { CommandRunner } from "./process";
import { acquireUpdateLock } from "./update-safety";

export const MANDATORY_NO_PROXY_ENTRIES = [
  "127.0.0.1",
  "localhost",
  "::1",
  "postgres",
  "server",
  "worker",
  "computer",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "host.docker.internal",
] as const;

export type ProxyMode = "off" | "system" | "manual";
export type ProxyProtocol = "http" | "https" | "socks5";

export interface SystemProxySnapshot {
  httpProxy: string | null;
  httpsProxy: string | null;
  noProxy: string | null;
}

export interface StoredProxyConfig {
  schemaVersion: 1;
  mode: ProxyMode;
  protocol?: ProxyProtocol;
  host?: string;
  port?: number;
  username?: string | null;
  password?: string | null;
  noProxy: string;
  applyToContainers: boolean;
  applyToDockerDaemon: boolean;
  systemResolved?: SystemProxySnapshot | null;
}

export interface LocalProxyConfig {
  schemaVersion: 1;
  mode: ProxyMode;
  protocol?: ProxyProtocol;
  host?: string;
  port?: number;
  username?: string | null;
  hasPassword: boolean;
  noProxy: string;
  applyToContainers: boolean;
  applyToDockerDaemon: boolean;
  loopbackMappedHost: string | null;
  systemResolved: SystemProxySnapshot | null;
}

export interface LocalProxyUpdate {
  schemaVersion?: 1;
  mode: ProxyMode;
  protocol?: ProxyProtocol;
  host?: string;
  port?: number;
  username?: string | null;
  password?: string | null;
  clearPassword?: boolean;
  noProxy?: string;
  applyToContainers?: boolean;
  applyToDockerDaemon?: boolean;
  systemResolved?: SystemProxySnapshot | null;
}

export interface LocalProxyCheckResult {
  target: "proxy-tcp" | "model-api" | "github" | "registry";
  ok: boolean;
  latencyMs: number | null;
  statusCode?: number;
  error?: string;
}

export interface LocalProxyTestResult {
  schemaVersion: 1;
  ok: boolean;
  effectiveProxy: string | null;
  loopbackMappedHost: string | null;
  checks: LocalProxyCheckResult[];
}

const VALID_PROTOCOLS: ReadonlySet<string> = new Set(["http", "https", "socks5"]);
const VALID_MODES: ReadonlySet<string> = new Set(["off", "system", "manual"]);

const hasUnsafeChars = (value: string): boolean =>
  /[\r\n\0\t"'`$&;|<>]/.test(value);

export const validateProxyHost = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 253 || /[\s/\\@#?]/.test(trimmed) || hasUnsafeChars(trimmed)) {
    throw new EngineError("INVALID_INPUT", cliTranslate("Proxy host is invalid."));
  }
  const bare = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  if (isIP(bare)) return bare;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(bare)) {
    throw new EngineError("INVALID_INPUT", cliTranslate("Proxy host must be a valid hostname or IP address."));
  }
  return bare;
};

export const validateProxyPort = (raw: unknown): number => {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new EngineError("INVALID_INPUT", cliTranslate("Proxy port must be an integer between 1 and 65535."));
  }
  return value;
};

export const isLoopbackHost = (host: string): boolean => {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
  );
};

export const isPrivateOrHostMapped = (host: string): boolean => {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "host.docker.internal" || normalized === "host.lima.internal") return true;
  if (isIP(normalized) === 4) {
    const [a = 0, b = 0] = normalized.split(".").map(Number);
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(normalized) === 6) {
    return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
};

export const mergeNoProxy = (userNoProxy: string | null | undefined): string => {
  if (userNoProxy && /[\r\n\0]/.test(userNoProxy)) {
    throw new EngineError("INVALID_INPUT", "NO_PROXY must not contain newline or null characters.");
  }
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (entry: string) => {
    const cleaned = entry.trim();
    if (!cleaned) return;
    if (hasUnsafeChars(cleaned) || /\s/.test(cleaned)) {
      throw new EngineError("INVALID_INPUT", `Invalid NO_PROXY entry: ${cleaned}`);
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  };
  for (const mandatory of MANDATORY_NO_PROXY_ENTRIES) {
    push(mandatory);
  }
  if (userNoProxy) {
    for (const part of userNoProxy.split(/[,;]/)) {
      push(part);
    }
  }
  return result.join(",");
};

export const formatProxyUrl = (
  options: {
    protocol: ProxyProtocol;
    host: string;
    port: number;
    username?: string | null;
    password?: string | null;
  },
  redactCredentials = false
): string => {
  const hostPart = isIP(options.host) === 6 ? `[${options.host}]` : options.host;
  let auth = "";
  if (options.username) {
    const user = encodeURIComponent(options.username);
    if (options.password) {
      auth = redactCredentials
        ? `${user}:[REDACTED]@`
        : `${user}:${encodeURIComponent(options.password)}@`;
    } else {
      auth = `${user}@`;
    }
  }
  return `${options.protocol}://${auth}${hostPart}:${options.port}`;
};

export const redactProxyUrlString = (raw: string | null | undefined): string | null => {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.password) {
      parsed.password = "REDACTED";
      return parsed.toString().replace(/\/$/, "").replace(":REDACTED@", ":[REDACTED]@");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return redactSensitiveText(raw.trim());
  }
};

export const sanitizeSystemProxySnapshot = (
  raw: SystemProxySnapshot | null | undefined
): SystemProxySnapshot | null => {
  if (!raw) return null;
  const check = (value: string | null | undefined): string | null => {
    if (!value || !value.trim()) return null;
    const trimmed = value.trim();
    if (hasUnsafeChars(trimmed)) {
      throw new EngineError("INVALID_INPUT", "System proxy URL contains invalid characters.");
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new EngineError("INVALID_INPUT", "System proxy URL is malformed.");
    }
    const proto = parsed.protocol.replace(":", "").toLowerCase();
    if (!VALID_PROTOCOLS.has(proto) && proto !== "socks5h") {
      throw new EngineError("INVALID_INPUT", "Unsupported system proxy protocol.");
    }
    if (!parsed.hostname) {
      throw new EngineError("INVALID_INPUT", "System proxy URL is missing a hostname.");
    }
    return trimmed;
  };
  const httpProxy = check(raw.httpProxy);
  const httpsProxy = check(raw.httpsProxy);
  const noProxy = raw.noProxy?.trim() || null;
  if (noProxy && /[\r\n\0]/.test(noProxy)) {
    throw new EngineError("INVALID_INPUT", "System NO_PROXY contains invalid characters.");
  }
  if (!httpProxy && !httpsProxy && !noProxy) return null;
  return { httpProxy, httpsProxy, noProxy };
};

export const parseProxyUrlComponents = (
  rawUrl: string
): {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
} | null => {
  try {
    const parsed = new URL(rawUrl);
    const rawProto = parsed.protocol.replace(":", "").toLowerCase();
    const protocol: ProxyProtocol =
      rawProto === "socks5h" || rawProto === "socks5"
        ? "socks5"
        : rawProto === "https"
          ? "https"
          : "http";
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const port = parsed.port
      ? Number(parsed.port)
      : protocol === "https"
        ? 443
        : protocol === "socks5"
          ? 1080
          : 80;
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      protocol,
      host,
      port,
      username: parsed.username ? decodeURIComponent(parsed.username) : null,
      password: parsed.password ? decodeURIComponent(parsed.password) : null,
    };
  } catch {
    return null;
  }
};

export const mapLoopbackHostForEngine = (
  host: string,
  engineKind: EngineKind,
  engine?: EngineProvider
): { mappedHost: string; loopbackMappedHost: string | null } => {
  if (!isLoopbackHost(host)) {
    return { mappedHost: host, loopbackMappedHost: null };
  }
  if (engineKind === "managed-wsl") {
    const gw = engine instanceof ManagedEngine ? engine.hostGatewayIp() : null;
    const mapped = gw || "host.docker.internal";
    return { mappedHost: mapped, loopbackMappedHost: mapped };
  }
  if (engineKind === "managed-lima") {
    return { mappedHost: "host.lima.internal", loopbackMappedHost: "host.lima.internal" };
  }
  return { mappedHost: "host.docker.internal", loopbackMappedHost: "host.docker.internal" };
};

const remapUrlForEngine = (
  rawUrl: string | null,
  engineKind: EngineKind,
  engine?: EngineProvider
): { url: string | null; loopbackMappedHost: string | null; hostTarget: string | null } => {
  if (!rawUrl) return { url: null, loopbackMappedHost: null, hostTarget: null };
  const parsed = parseProxyUrlComponents(rawUrl);
  if (!parsed) return { url: null, loopbackMappedHost: null, hostTarget: null };
  const { mappedHost, loopbackMappedHost } = mapLoopbackHostForEngine(
    parsed.host,
    engineKind,
    engine
  );
  const url = formatProxyUrl({ ...parsed, host: mappedHost }, false);
  const hostTarget =
    isPrivateOrHostMapped(mappedHost)
      ? `${isIP(mappedHost) === 6 ? `[${mappedHost}]` : mappedHost}:${parsed.port}`
      : null;
  return { url, loopbackMappedHost, hostTarget };
};

export interface ResolvedEffectiveProxy {
  httpProxy: string | null;
  httpsProxy: string | null;
  noProxy: string | null;
  hostProxyTarget: string | null;
  loopbackMappedHost: string | null;
  hostSideProxyUrl: string | null;
  hostSideRedactedUrl: string | null;
}

export const resolveEffectiveProxy = (
  stored: StoredProxyConfig,
  engineKind: EngineKind,
  engine?: EngineProvider
): ResolvedEffectiveProxy => {
  if (stored.mode === "off") {
    return {
      httpProxy: null,
      httpsProxy: null,
      noProxy: null,
      hostProxyTarget: null,
      loopbackMappedHost: null,
      hostSideProxyUrl: null,
      hostSideRedactedUrl: null,
    };
  }
  if (stored.mode === "manual") {
    if (!stored.protocol || !stored.host || !stored.port) {
      return {
        httpProxy: null,
        httpsProxy: null,
        noProxy: null,
        hostProxyTarget: null,
        loopbackMappedHost: null,
        hostSideProxyUrl: null,
        hostSideRedactedUrl: null,
      };
    }
    const { mappedHost, loopbackMappedHost } = mapLoopbackHostForEngine(
      stored.host,
      engineKind,
      engine
    );
    const containerUrl = formatProxyUrl(
      {
        protocol: stored.protocol,
        host: mappedHost,
        port: stored.port,
        username: stored.username,
        password: stored.password,
      },
      false
    );
    const hostSideProxyUrl = formatProxyUrl(
      {
        protocol: stored.protocol,
        host: stored.host,
        port: stored.port,
        username: stored.username,
        password: stored.password,
      },
      false
    );
    const hostSideRedactedUrl = formatProxyUrl(
      {
        protocol: stored.protocol,
        host: stored.host,
        port: stored.port,
        username: stored.username,
        password: stored.password,
      },
      true
    );
    const hostProxyTarget = isPrivateOrHostMapped(mappedHost)
      ? `${isIP(mappedHost) === 6 ? `[${mappedHost}]` : mappedHost}:${stored.port}`
      : null;
    return {
      httpProxy: containerUrl,
      httpsProxy: containerUrl,
      noProxy: mergeNoProxy(stored.noProxy),
      hostProxyTarget,
      loopbackMappedHost,
      hostSideProxyUrl,
      hostSideRedactedUrl,
    };
  }
  // mode === "system"
  const sys = stored.systemResolved;
  const rawHttp = sys?.httpProxy ?? sys?.httpsProxy ?? null;
  const rawHttps = sys?.httpsProxy ?? sys?.httpProxy ?? null;
  if (!rawHttp && !rawHttps) {
    return {
      httpProxy: null,
      httpsProxy: null,
      noProxy: null,
      hostProxyTarget: null,
      loopbackMappedHost: null,
      hostSideProxyUrl: null,
      hostSideRedactedUrl: null,
    };
  }
  const httpMapped = remapUrlForEngine(rawHttp, engineKind, engine);
  const httpsMapped = remapUrlForEngine(rawHttps, engineKind, engine);
  const combinedUserNoProxy = [sys?.noProxy, stored.noProxy].filter(Boolean).join(",");
  return {
    httpProxy: httpMapped.url,
    httpsProxy: httpsMapped.url,
    noProxy: mergeNoProxy(combinedUserNoProxy),
    hostProxyTarget: httpsMapped.hostTarget ?? httpMapped.hostTarget,
    loopbackMappedHost: httpsMapped.loopbackMappedHost ?? httpMapped.loopbackMappedHost,
    hostSideProxyUrl: rawHttps ?? rawHttp,
    hostSideRedactedUrl: redactProxyUrlString(rawHttps ?? rawHttp),
  };
};

export const formatDockerProxyDropIn = (resolved: {
  httpProxy: string | null;
  httpsProxy: string | null;
  noProxy: string | null;
}): string | null => {
  if (!resolved.httpProxy && !resolved.httpsProxy) return null;
  const escapeSystemd = (value: string) =>
    value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
  const lines = ["[Service]"];
  if (resolved.httpProxy) lines.push(`Environment="HTTP_PROXY=${escapeSystemd(resolved.httpProxy)}"`);
  if (resolved.httpsProxy) lines.push(`Environment="HTTPS_PROXY=${escapeSystemd(resolved.httpsProxy)}"`);
  if (resolved.noProxy) lines.push(`Environment="NO_PROXY=${escapeSystemd(resolved.noProxy)}"`);
  return `${lines.join("\n")}\n`;
};

export const defaultStoredProxyConfig = (engineKind: EngineKind): StoredProxyConfig => ({
  schemaVersion: 1,
  mode: "off",
  noProxy: "",
  applyToContainers: true,
  applyToDockerDaemon: engineKind !== "external",
  systemResolved: null,
});

export const readStoredProxyConfig = (
  paths: InstallationPaths,
  engineKind: EngineKind
): StoredProxyConfig => {
  if (!existsSync(paths.proxyConfig)) {
    return defaultStoredProxyConfig(engineKind);
  }
  try {
    const raw = JSON.parse(readFileSync(paths.proxyConfig, "utf8")) as Partial<StoredProxyConfig>;
    const mode: ProxyMode =
      raw.mode && VALID_MODES.has(raw.mode) ? (raw.mode as ProxyMode) : "off";
    return {
      schemaVersion: 1,
      mode,
      protocol:
        raw.protocol && VALID_PROTOCOLS.has(raw.protocol)
          ? (raw.protocol as ProxyProtocol)
          : undefined,
      host: typeof raw.host === "string" ? raw.host : undefined,
      port: typeof raw.port === "number" ? raw.port : undefined,
      username: typeof raw.username === "string" ? raw.username : null,
      password: typeof raw.password === "string" ? raw.password : null,
      noProxy: typeof raw.noProxy === "string" ? raw.noProxy : "",
      applyToContainers: raw.applyToContainers !== false,
      applyToDockerDaemon: engineKind === "external" ? false : raw.applyToDockerDaemon !== false,
      systemResolved: raw.systemResolved ?? null,
    };
  } catch {
    return defaultStoredProxyConfig(engineKind);
  }
};

export const toPublicProxyConfig = (
  stored: StoredProxyConfig,
  engineKind: EngineKind,
  engine?: EngineProvider
): LocalProxyConfig => {
  const resolved = resolveEffectiveProxy(stored, engineKind, engine);
  return {
    schemaVersion: 1,
    mode: stored.mode,
    ...(stored.protocol ? { protocol: stored.protocol } : {}),
    ...(stored.host ? { host: stored.host } : {}),
    ...(stored.port !== undefined ? { port: stored.port } : {}),
    username: stored.username ?? null,
    hasPassword: Boolean(stored.password),
    noProxy: stored.noProxy,
    applyToContainers: stored.applyToContainers,
    applyToDockerDaemon: engineKind === "external" ? false : stored.applyToDockerDaemon,
    loopbackMappedHost: resolved.loopbackMappedHost,
    systemResolved: stored.systemResolved
      ? {
          httpProxy: redactProxyUrlString(stored.systemResolved.httpProxy),
          httpsProxy: redactProxyUrlString(stored.systemResolved.httpsProxy),
          noProxy: stored.systemResolved.noProxy ?? null,
        }
      : null,
  };
};

export const normalizeProxyUpdate = (
  input: unknown,
  existing: StoredProxyConfig,
  engineKind: EngineKind
): StoredProxyConfig => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new EngineError("INVALID_INPUT", "Proxy configuration payload must be a JSON object.");
  }
  const raw = input as Partial<LocalProxyUpdate>;
  if (!raw.mode || !VALID_MODES.has(raw.mode)) {
    throw new EngineError("INVALID_INPUT", "Proxy mode must be off, system, or manual.");
  }
  const mode = raw.mode as ProxyMode;
  const noProxy = typeof raw.noProxy === "string" ? raw.noProxy.trim() : existing.noProxy;
  // Validate user NO_PROXY syntax immediately
  mergeNoProxy(noProxy);

  const applyToContainers =
    typeof raw.applyToContainers === "boolean" ? raw.applyToContainers : true;
  const applyToDockerDaemon =
    engineKind === "external"
      ? false
      : typeof raw.applyToDockerDaemon === "boolean"
        ? raw.applyToDockerDaemon
        : true;

  if (mode === "off") {
    return {
      schemaVersion: 1,
      mode: "off",
      noProxy,
      applyToContainers,
      applyToDockerDaemon,
      systemResolved: null,
    };
  }

  if (mode === "system") {
    const systemResolved = sanitizeSystemProxySnapshot(raw.systemResolved ?? null);
    return {
      schemaVersion: 1,
      mode: "system",
      noProxy,
      applyToContainers,
      applyToDockerDaemon,
      systemResolved,
    };
  }

  // manual
  if (!raw.protocol || !VALID_PROTOCOLS.has(raw.protocol)) {
    throw new EngineError("INVALID_INPUT", "Manual proxy protocol must be http, https, or socks5.");
  }
  if (typeof raw.host !== "string") {
    throw new EngineError("INVALID_INPUT", "Manual proxy host is required.");
  }
  const host = validateProxyHost(raw.host);
  const port = validateProxyPort(raw.port);

  let username: string | null = null;
  if (raw.username !== undefined && raw.username !== null && raw.username !== "") {
    if (typeof raw.username !== "string" || raw.username.length > 128 || hasUnsafeChars(raw.username)) {
      throw new EngineError("INVALID_INPUT", "Proxy username is invalid.");
    }
    username = raw.username;
  }

  let password: string | null = null;
  if (raw.clearPassword) {
    password = null;
  } else if (typeof raw.password === "string" && raw.password.length > 0) {
    if (/[\r\n\0]/.test(raw.password) || raw.password.length > 256) {
      throw new EngineError("INVALID_INPUT", "Proxy password is invalid.");
    }
    password = raw.password;
  } else if (raw.password === undefined) {
    password = existing.password ?? null;
  }

  return {
    schemaVersion: 1,
    mode: "manual",
    protocol: raw.protocol as ProxyProtocol,
    host,
    port,
    username,
    password,
    noProxy,
    applyToContainers,
    applyToDockerDaemon,
    systemResolved: null,
  };
};

export const readProxyConfigFromStdin = async (
  stream: AsyncIterable<Buffer | string> = process.stdin
): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    total += buf.byteLength;
    if (total > 64 * 1024) {
      throw new EngineError("INVALID_INPUT", "Proxy configuration payload is too large.");
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    throw new EngineError("INVALID_INPUT", "Proxy configuration JSON is required on stdin.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new EngineError("INVALID_INPUT", "Proxy configuration stdin is not valid JSON.");
  }
};

export const applyStoredProxyToEnvironment = (
  paths: InstallationPaths,
  env: NodeJS.ProcessEnv = process.env
): void => {
  if (!existsSync(paths.proxyConfig)) return;
  const manifest = readManifest(paths);
  const engineKind: EngineKind = manifest?.engine.kind ?? "external";
  const stored = readStoredProxyConfig(paths, engineKind);
  if (stored.mode === "off") return;
  const resolved = resolveEffectiveProxy(stored, engineKind);
  if (!resolved.hostSideProxyUrl) return;
  if (!env.HTTP_PROXY && !env.http_proxy) {
    env.HTTP_PROXY = resolved.hostSideProxyUrl;
    env.http_proxy = resolved.hostSideProxyUrl;
  }
  if (!env.HTTPS_PROXY && !env.https_proxy) {
    env.HTTPS_PROXY = resolved.hostSideProxyUrl;
    env.https_proxy = resolved.hostSideProxyUrl;
  }
  if (!env.NO_PROXY && !env.no_proxy && resolved.noProxy) {
    env.NO_PROXY = resolved.noProxy;
    env.no_proxy = resolved.noProxy;
  }
};

export const collectProxyStatus = (
  paths: InstallationPaths,
  runner: CommandRunner
): LocalProxyConfig => {
  if (!installationExists(paths)) {
    throw new EngineError("ENGINE_UNAVAILABLE");
  }
  const manifest = readManifest(paths);
  if (!manifest) throw new EngineError("ENGINE_UNAVAILABLE");
  const engine = requireRecordedEngine(paths, runner, manifest.engine.kind);
  const stored = readStoredProxyConfig(paths, manifest.engine.kind);
  return toPublicProxyConfig(stored, manifest.engine.kind, engine);
};

export const proxyStatusCommand = (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: { json?: boolean }
): LocalProxyConfig => {
  const status = collectProxyStatus(paths, runner);
  if (options.json) {
    console.log(JSON.stringify(status));
  } else {
    console.log(`proxy mode=${status.mode}`);
  }
  return status;
};

export const proxySetCommand = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: { json?: boolean; yes?: boolean; configStdin?: boolean },
  dependencies: { payload?: unknown; readStdin?: () => Promise<unknown> } = {}
): Promise<LocalProxyConfig> => {
  if (!installationExists(paths)) throw new EngineError("ENGINE_UNAVAILABLE");
  const manifest = readManifest(paths);
  if (!manifest) throw new EngineError("ENGINE_UNAVAILABLE");
  if (!options.configStdin && dependencies.payload === undefined) {
    throw new EngineError("INVALID_INPUT", "Pass --config-stdin to supply proxy configuration JSON via stdin.");
  }
  const rawPayload =
    dependencies.payload !== undefined
      ? dependencies.payload
      : await (dependencies.readStdin ?? readProxyConfigFromStdin)();

  const engineKind = manifest.engine.kind;
  const existing = readStoredProxyConfig(paths, engineKind);
  const nextStored = normalizeProxyUpdate(rawPayload, existing, engineKind);
  const secretValues = nextStored.password ? [nextStored.password] : [];

  const releaseLock = acquireUpdateLock(paths);
  try {
    const engine = requireRecordedEngine(paths, runner, engineKind);
    const resolved = resolveEffectiveProxy(nextStored, engineKind, engine);
    const projectName = normalizeProjectName(manifest.projectName || PROJECT_NAME);
    const project = requireComposeProject(paths, runner, projectName);

    const previousProxyFile = existsSync(paths.proxyConfig)
      ? readFileSync(paths.proxyConfig, "utf8")
      : null;
    const previousEnv = readFileSync(paths.environment, "utf8");
    const isManaged = engine instanceof ManagedEngine;
    const previousDropIn = isManaged ? engine.readDockerProxyDropIn() : null;

    const containerProxyEnabled = nextStored.mode !== "off" && nextStored.applyToContainers;
    let updatedEnv = previousEnv;
    updatedEnv = setOrClearEnvironmentValue(
      updatedEnv,
      "OUTCOMEGO_HTTP_PROXY",
      containerProxyEnabled ? resolved.httpProxy : null
    );
    updatedEnv = setOrClearEnvironmentValue(
      updatedEnv,
      "OUTCOMEGO_HTTPS_PROXY",
      containerProxyEnabled ? resolved.httpsProxy : null
    );
    updatedEnv = setOrClearEnvironmentValue(
      updatedEnv,
      "OUTCOMEGO_NO_PROXY",
      containerProxyEnabled ? resolved.noProxy : null
    );
    updatedEnv = setOrClearEnvironmentValue(
      updatedEnv,
      "OUTCOMEGO_HOST_PROXY_TARGET",
      containerProxyEnabled ? resolved.hostProxyTarget : null
    );

    const nextDropIn =
      isManaged && nextStored.mode !== "off" && nextStored.applyToDockerDaemon
        ? formatDockerProxyDropIn(resolved)
        : null;
    const dropInChanged = isManaged && nextDropIn !== previousDropIn;

    let dropInApplied = false;
    try {
      writeFileAtomic(paths.proxyConfig, `${JSON.stringify(nextStored, null, 2)}\n`, 0o600);
      writeFileAtomic(paths.environment, updatedEnv, 0o600);
      if (isManaged && dropInChanged) {
        await engine.applyDockerProxyDropIn(nextDropIn);
        dropInApplied = true;
      }
      const recreateServices = [
        "computer",
        ...(hasMemoryInitService(paths) ? ["computer-memory-init"] : []),
        "server",
        "worker",
      ];
      project.runOrThrow(["up", "-d", "--no-deps", "--force-recreate", ...recreateServices]);
    } catch (error) {
      // Roll back proxy.json, .env, Docker daemon drop-in, and best-effort restore containers
      if (previousProxyFile !== null) {
        writeFileAtomic(paths.proxyConfig, previousProxyFile, 0o600);
      } else {
        rmSync(paths.proxyConfig, { force: true });
      }
      writeFileAtomic(paths.environment, previousEnv, 0o600);
      if (isManaged && dropInApplied) {
        await engine.applyDockerProxyDropIn(previousDropIn).catch(() => undefined);
      }
      try {
        const recreateServices = [
          "computer",
          ...(hasMemoryInitService(paths) ? ["computer-memory-init"] : []),
          "server",
          "worker",
        ];
        project.run(["up", "-d", "--no-deps", "--force-recreate", ...recreateServices]);
      } catch {}
      const detail = redactSensitiveText(
        error instanceof Error ? error.message : String(error),
        secretValues
      );
      throw new EngineError("STACK_START_FAILED", detail);
    }

    const result = toPublicProxyConfig(nextStored, engineKind, engine);
    if (options.json) {
      console.log(JSON.stringify(result));
    }
    return result;
  } finally {
    releaseLock();
  }
};

const probeTcpConnect = (host: string, port: number, timeoutMs = 8_000): Promise<{ ok: boolean; latencyMs: number; error?: string }> =>
  new Promise((resolve) => {
    const start = Date.now();
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - start, ...(error ? { error } : {}) });
    };
    socket.setTimeout(timeoutMs, () => finish(false, "Connection timed out"));
    socket.once("connect", () => finish(true));
    socket.once("error", (err) => finish(false, err.message));
  });

const probeHttpsViaSocks5 = (
  proxy: { host: string; port: number; username: string | null; password: string | null },
  targetUrl: string,
  timeoutMs = 8_000
): Promise<{ ok: boolean; latencyMs: number; statusCode?: number; error?: string }> =>
  new Promise((resolve) => {
    const start = Date.now();
    const target = new URL(targetUrl);
    const targetHost = target.hostname;
    const targetPort = target.port ? Number(target.port) : target.protocol === "https:" ? 443 : 80;
    const socket = createConnection({ host: proxy.host, port: proxy.port });
    let settled = false;
    const finish = (ok: boolean, statusCode?: number, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        ok,
        latencyMs: Date.now() - start,
        ...(statusCode !== undefined ? { statusCode } : {}),
        ...(error ? { error } : {}),
      });
    };
    const timer = setTimeout(() => finish(false, undefined, "Connection timed out"), timeoutMs);
    const done = (ok: boolean, statusCode?: number, error?: string) => {
      clearTimeout(timer);
      finish(ok, statusCode, error);
    };

    const hasAuth = Boolean(proxy.username);
    let stage: "greeting" | "auth" | "connect" | "http" = "greeting";
    let buffer: Buffer = Buffer.alloc(0);

    const sendConnect = () => {
      stage = "connect";
      const hostBuf = Buffer.from(targetHost, "utf8");
      const req = Buffer.alloc(4 + 1 + hostBuf.length + 2);
      req[0] = 0x05;
      req[1] = 0x01; // CONNECT
      req[2] = 0x00;
      req[3] = 0x03; // DOMAINNAME
      req[4] = hostBuf.length;
      hostBuf.copy(req, 5);
      req.writeUInt16BE(targetPort, 5 + hostBuf.length);
      socket.write(req);
    };

    socket.once("error", (err) => done(false, undefined, err.message));
    socket.once("connect", () => {
      const methods = hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
      socket.write(methods);
    });

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "greeting" && buffer.length >= 2) {
        const version = buffer[0];
        const method = buffer[1];
        buffer = buffer.subarray(2);
        if (version !== 0x05 || method === 0xff) {
          done(false, undefined, "SOCKS5 authentication negotiation failed");
          return;
        }
        if (method === 0x02) {
          stage = "auth";
          const u = Buffer.from(proxy.username ?? "", "utf8");
          const p = Buffer.from(proxy.password ?? "", "utf8");
          const authBuf = Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]);
          socket.write(authBuf);
        } else {
          sendConnect();
        }
      } else if (stage === "auth" && buffer.length >= 2) {
        const status = buffer[1];
        buffer = buffer.subarray(2);
        if (status !== 0x00) {
          done(false, undefined, "SOCKS5 authentication rejected");
          return;
        }
        sendConnect();
      } else if (stage === "connect" && buffer.length >= 4) {
        const rep = buffer[1];
        const atyp = buffer[3];
        const expectedLen =
          atyp === 1 ? 10 : atyp === 4 ? 22 : atyp === 3 && buffer.length >= 5 ? 7 + buffer[4]! : 9999;
        if (buffer.length < expectedLen) return;
        if (rep !== 0x00) {
          done(false, undefined, `SOCKS5 CONNECT failed (code ${rep})`);
          return;
        }
        stage = "http";
        socket.removeAllListeners("data");
        const tlsSocket = tlsConnect({ socket, servername: targetHost, rejectUnauthorized: true });
        let responseText = "";
        tlsSocket.once("error", (err) => done(false, undefined, err.message));
        tlsSocket.once("secureConnect", () => {
          tlsSocket.write(
            `HEAD ${target.pathname || "/"} HTTP/1.1\r\nHost: ${targetHost}\r\nUser-Agent: outcomego-cli\r\nConnection: close\r\n\r\n`
          );
        });
        tlsSocket.on("data", (data: Buffer) => {
          responseText += data.toString("latin1");
          const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(responseText);
          if (match) {
            const code = Number(match[1]);
            tlsSocket.destroy();
            done(code < 500, code);
          }
        });
        tlsSocket.once("end", () => {
          if (!settled) done(false, undefined, "Empty HTTP response from upstream");
        });
      }
    });
  });

export type ProxyHttpProber = (
  url: string,
  proxyUrl: string | null,
  timeoutMs: number
) => Promise<{ ok: boolean; latencyMs: number; statusCode?: number; error?: string }>;

const defaultHttpProber: ProxyHttpProber = async (url, proxyUrl, timeoutMs) => {
  const start = Date.now();
  if (proxyUrl) {
    const parsed = parseProxyUrlComponents(proxyUrl);
    if (parsed && parsed.protocol === "socks5") {
      return probeHttpsViaSocks5(parsed, url, timeoutMs);
    }
  }
  try {
    const init: RequestInit & { proxy?: string } = {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "outcomego-cli" },
      signal: AbortSignal.timeout(timeoutMs),
      ...(proxyUrl ? { proxy: proxyUrl } : {}),
    };
    const response = await fetch(url, init);
    await response.body?.cancel().catch(() => undefined);
    return {
      ok: response.status < 500,
      latencyMs: Date.now() - start,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const proxyTestCommand = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: { json?: boolean; configStdin?: boolean },
  dependencies: {
    payload?: unknown;
    readStdin?: () => Promise<unknown>;
    probeTcp?: (host: string, port: number, timeoutMs?: number) => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
    probeHttp?: ProxyHttpProber;
  } = {}
): Promise<LocalProxyTestResult> => {
  if (!options.configStdin && dependencies.payload === undefined) {
    throw new EngineError("INVALID_INPUT", "Pass --config-stdin to supply proxy test configuration JSON via stdin.");
  }
  const rawPayload =
    dependencies.payload !== undefined
      ? dependencies.payload
      : await (dependencies.readStdin ?? readProxyConfigFromStdin)();

  const manifest = installationExists(paths) ? readManifest(paths) : null;
  const engineKind: EngineKind = manifest?.engine.kind ?? "external";
  const engine = manifest ? requireRecordedEngine(paths, runner, engineKind) : undefined;
  const existing = readStoredProxyConfig(paths, engineKind);
  const candidate = normalizeProxyUpdate(rawPayload, existing, engineKind);
  const secretValues = candidate.password ? [candidate.password] : [];
  const resolved = resolveEffectiveProxy(candidate, engineKind, engine);

  const checks: LocalProxyCheckResult[] = [];
  const tcpProbe = dependencies.probeTcp ?? probeTcpConnect;
  const httpProbe = dependencies.probeHttp ?? defaultHttpProber;

  if (candidate.mode !== "off") {
    const parsedProxy = resolved.hostSideProxyUrl
      ? parseProxyUrlComponents(resolved.hostSideProxyUrl)
      : null;
    if (!parsedProxy) {
      checks.push({
        target: "proxy-tcp",
        ok: false,
        latencyMs: null,
        error: cliTranslate("No active proxy address was detected."),
      });
    } else {
      const tcp = await tcpProbe(parsedProxy.host, parsedProxy.port, 8_000);
      checks.push({
        target: "proxy-tcp",
        ok: tcp.ok,
        latencyMs: tcp.latencyMs,
        ...(tcp.error ? { error: redactSensitiveText(tcp.error, secretValues) } : {}),
      });
    }
  } else {
    checks.push({ target: "proxy-tcp", ok: true, latencyMs: 0 });
  }

  const targets: Array<{ target: "model-api" | "github" | "registry"; url: string }> = [
    { target: "model-api", url: "https://api.deepseek.com" },
    { target: "github", url: "https://api.github.com/zen" },
    { target: "registry", url: "https://ghcr.io/v2/" },
  ];

  const httpResults = await Promise.all(
    targets.map(async ({ target, url }) => {
      if (candidate.mode !== "off" && !resolved.hostSideProxyUrl) {
        return {
          target,
          ok: false,
          latencyMs: null,
          error: cliTranslate("No active proxy address was detected."),
        } satisfies LocalProxyCheckResult;
      }
      const res = await httpProbe(url, resolved.hostSideProxyUrl, 8_000);
      return {
        target,
        ok: res.ok,
        latencyMs: res.latencyMs,
        ...(res.statusCode !== undefined ? { statusCode: res.statusCode } : {}),
        ...(res.error ? { error: redactSensitiveText(res.error, secretValues) } : {}),
      } satisfies LocalProxyCheckResult;
    })
  );
  checks.push(...httpResults);

  const result: LocalProxyTestResult = {
    schemaVersion: 1,
    ok: checks.every((c) => c.ok),
    effectiveProxy: resolved.hostSideRedactedUrl,
    loopbackMappedHost: resolved.loopbackMappedHost,
    checks,
  };
  if (options.json) {
    console.log(JSON.stringify(result));
  }
  return result;
};
