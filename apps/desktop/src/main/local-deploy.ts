import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, openSync, readSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { safeErrorMessage } from "@outcomego/product-core/redaction";
import { canManageLocalInstallation, readManagedInstallation, readPendingDeployment } from "./local-installation";

import {
  actions, codes, engineProbeStates, engines, fields, stackStates, stages, statuses,
  type Action, type Code, type DeployPayload, type DeployProgress, type EngineProbe, type EngineProbes,
  type HostResources, type LocalAutostartStatus, type LocalContainerLogs, type LocalContainersSnapshot,
  type LocalDeployRequest, type LocalProxyConfig, type LocalProxyTestResult, type LocalProxyUpdate,
  type LocalResourceSnapshot, type LocalResourceUpdate, type LocalServerStatus, type Stage,
} from "../renderer/lib/local-deploy-contract";

const CORE_SERVICES = new Set(["server", "worker", "computer", "postgres", "computer-memory-init", "caddy"]);
const LOG_SERVICES = new Set([
  "server",
  "worker",
  "computer",
  "postgres",
  "computer-memory-init",
  "caddy",
  "migrate",
  "agent-data-init",
  "asset-store-init",
  "computer-home-init",
  "box-store-init",
  "workspace-init",
]);
const PROXY_MODES = new Set(["off", "system", "manual"]);
const PROXY_PROTOCOLS = new Set(["http", "https", "socks5"]);
const UNSAFE_CHARS = /[\r\n\0\t"'`$&;|<>]/;

const parseJsonOutput = <T>(raw: string, requireSchemaVersion = true): T => {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("UNKNOWN");
  if (requireSchemaVersion && parsed.schemaVersion !== 1) throw new Error("CLI_VERSION_MISMATCH");
  return parsed as T;
};

export const validateRestartService = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !CORE_SERVICES.has(value)) throw new Error("INVALID_INPUT");
  return value;
};

export const validateLogsRequest = (value: unknown): { service: string; tail: number } => {
  const input = record(value);
  if (!input || Object.keys(input).some((k) => k !== "service" && k !== "tail")) {
    throw new Error("INVALID_INPUT");
  }
  if (typeof input.service !== "string" || !LOG_SERVICES.has(input.service)) {
    throw new Error("INVALID_INPUT");
  }
  const tail = input.tail === undefined ? 200 : input.tail;
  if (typeof tail !== "number" || !Number.isInteger(tail) || tail < 10 || tail > 1000) {
    throw new Error("INVALID_INPUT");
  }
  return { service: input.service, tail };
};

export const validateContainersRequest = (value: unknown): { includeStats: boolean } => {
  if (value === undefined) return { includeStats: false };
  const input = record(value);
  if (!input || Object.keys(input).some((k) => k !== "includeStats")) {
    throw new Error("INVALID_INPUT");
  }
  if (input.includeStats !== undefined && typeof input.includeStats !== "boolean") {
    throw new Error("INVALID_INPUT");
  }
  return { includeStats: input.includeStats === true };
};

export const validateResourceUpdate = (value: unknown): LocalResourceUpdate => {
  const input = record(value);
  const allowed = new Set([
    "computerMemory",
    "desktopMemory",
    "computerCpu",
    "workerConcurrency",
    "engineMemory",
    "engineCpu",
    "applyWslconfig",
    "restartWsl",
  ]);
  if (!input || Object.keys(input).length === 0 || Object.keys(input).some((k) => !allowed.has(k))) {
    throw new Error("INVALID_INPUT");
  }
  const memPattern = /^\d{1,16}[kmgt]?i?b?$/i;
  if (input.computerMemory !== undefined && (typeof input.computerMemory !== "string" || !memPattern.test(input.computerMemory))) {
    throw new Error("INVALID_INPUT");
  }
  if (input.desktopMemory !== undefined && (typeof input.desktopMemory !== "string" || !memPattern.test(input.desktopMemory))) {
    throw new Error("INVALID_INPUT");
  }
  if (input.computerCpu !== undefined && input.computerCpu !== null) {
    if (typeof input.computerCpu !== "number" || !Number.isFinite(input.computerCpu) || input.computerCpu < 1 || input.computerCpu > 256) {
      throw new Error("INVALID_INPUT");
    }
  }
  if (input.workerConcurrency !== undefined) {
    if (typeof input.workerConcurrency !== "number" || !Number.isInteger(input.workerConcurrency) || input.workerConcurrency < 1 || input.workerConcurrency > 64) {
      throw new Error("INVALID_INPUT");
    }
  }
  if (input.engineMemory !== undefined && (typeof input.engineMemory !== "string" || !memPattern.test(input.engineMemory))) {
    throw new Error("INVALID_INPUT");
  }
  if (input.engineCpu !== undefined) {
    if (typeof input.engineCpu !== "number" || !Number.isInteger(input.engineCpu) || input.engineCpu < 1 || input.engineCpu > 256) {
      throw new Error("INVALID_INPUT");
    }
  }
  if (input.applyWslconfig !== undefined && typeof input.applyWslconfig !== "boolean") {
    throw new Error("INVALID_INPUT");
  }
  if (input.restartWsl !== undefined && typeof input.restartWsl !== "boolean") {
    throw new Error("INVALID_INPUT");
  }
  return input as unknown as LocalResourceUpdate;
};

export const validateProxyUpdate = (value: unknown): LocalProxyUpdate => {
  const input = record(value);
  const allowed = new Set([
    "mode",
    "protocol",
    "host",
    "port",
    "username",
    "password",
    "clearPassword",
    "noProxy",
    "applyToContainers",
    "applyToDockerDaemon",
    "systemResolved",
  ]);
  if (!input || Object.keys(input).some((k) => !allowed.has(k))) {
    throw new Error("INVALID_INPUT");
  }
  if (typeof input.mode !== "string" || !PROXY_MODES.has(input.mode)) {
    throw new Error("INVALID_INPUT");
  }
  if (input.protocol !== undefined && (typeof input.protocol !== "string" || !PROXY_PROTOCOLS.has(input.protocol))) {
    throw new Error("INVALID_INPUT");
  }
  if (input.host !== undefined && (typeof input.host !== "string" || input.host.length > 253 || UNSAFE_CHARS.test(input.host) || /[\s/\\@#?]/.test(input.host))) {
    throw new Error("INVALID_INPUT");
  }
  if (input.port !== undefined && (typeof input.port !== "number" || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) {
    throw new Error("INVALID_INPUT");
  }
  if (input.username !== undefined && input.username !== null && (typeof input.username !== "string" || input.username.length > 128 || UNSAFE_CHARS.test(input.username))) {
    throw new Error("INVALID_INPUT");
  }
  if (input.password !== undefined && input.password !== null && (typeof input.password !== "string" || input.password.length > 256 || /[\r\n\0]/.test(input.password))) {
    throw new Error("INVALID_INPUT");
  }
  if (input.clearPassword !== undefined && typeof input.clearPassword !== "boolean") {
    throw new Error("INVALID_INPUT");
  }
  if (input.noProxy !== undefined && (typeof input.noProxy !== "string" || input.noProxy.length > 2048 || /[\r\n\0]/.test(input.noProxy))) {
    throw new Error("INVALID_INPUT");
  }
  if (input.applyToContainers !== undefined && typeof input.applyToContainers !== "boolean") {
    throw new Error("INVALID_INPUT");
  }
  if (input.applyToDockerDaemon !== undefined && typeof input.applyToDockerDaemon !== "boolean") {
    throw new Error("INVALID_INPUT");
  }
  if (input.systemResolved !== undefined && input.systemResolved !== null) {
    const sys = record(input.systemResolved);
    if (!sys || Object.keys(sys).some((k) => !["httpProxy", "httpsProxy", "noProxy"].includes(k))) {
      throw new Error("INVALID_INPUT");
    }
    for (const k of ["httpProxy", "httpsProxy", "noProxy"] as const) {
      const v = sys[k];
      if (v !== null && v !== undefined && (typeof v !== "string" || v.length > 2048 || /[\r\n\0]/.test(v))) {
        throw new Error("INVALID_INPUT");
      }
    }
  }
  if (input.mode === "manual") {
    if (!input.protocol || typeof input.host !== "string" || !input.host.trim() || typeof input.port !== "number") {
      throw new Error("INVALID_INPUT");
    }
  }
  return input as unknown as LocalProxyUpdate;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const member = <Value extends string>(values: readonly Value[], value: unknown): value is Value =>
  typeof value === "string" && values.includes(value as Value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const localDeployRequest = (value: unknown): LocalDeployRequest => {
  const input = record(value);
  if (!input || Object.keys(input).some(key => !["username", "password", "engine", "apiPort", "acceptLowMemory"].includes(key)) ||
    !text(input.username, 256) || !text(input.password, 1024) ||
    (input.engine !== undefined && !member(["auto", "external", "managed"], input.engine)) ||
    (input.apiPort !== undefined && (!count(input.apiPort) || input.apiPort < 1 || input.apiPort > 65535)) ||
    (input.acceptLowMemory !== undefined && typeof input.acceptLowMemory !== "boolean")) throw new Error("INVALID_INPUT");
  return { username: input.username, password: input.password, engine: input.engine as LocalDeployRequest["engine"],
    apiPort: input.apiPort as number | undefined, acceptLowMemory: input.acceptLowMemory as boolean | undefined };
};

export const localServiceArguments = (action: "start" | "stop" | "uninstall" | "resources", args: unknown[]): string[] => {
  if (action === "start" || action === "stop") {
    if (args.length) throw new Error("INVALID_INPUT");
    return [];
  }
  const input = args.length === 1 ? record(args[0]) : null;
  if (action === "uninstall" && input && Object.keys(input).length === 1 && typeof input.purgeData === "boolean") {
    return ["--yes", ...(input.purgeData ? ["--purge"] : [])];
  }
  if (action === "resources" && input && Object.keys(input).length === 2 &&
    typeof input.computerMemory === "string" && /^\d{1,16}[kmgt]?b?$/i.test(input.computerMemory) &&
    typeof input.desktopMemory === "string" && /^\d{1,16}[kmgt]?b?$/i.test(input.desktopMemory)) {
    return ["set", "--computer-memory", input.computerMemory, "--desktop-memory", input.desktopMemory, "--yes"];
  }
  throw new Error("INVALID_INPUT");
};

const maxText = 4_096;
const redact = (value: string) => safeErrorMessage(value.slice(0, maxText)).replace(
  /\b((?:DATABASE_URL|[A-Z][A-Z0-9_]*(?:_PASSWORD|_TOKEN|_SECRET|_KEY))[ \t]*=[ \t]*).*/g,
  "$1[REDACTED]"
);

const deploymentRedactor = (password: string) => {
  const key = randomBytes(32);
  const digest = (value: string) => createHmac("sha256", key).update(value).digest("hex");
  const length = password.length;
  const fingerprint = digest(password);
  return (value: string) => {
    let bounded = value.slice(0, maxText + length);
    if (length) {
      for (let index = 0; index <= Math.min(maxText, bounded.length - length); index++) {
        if (digest(bounded.slice(index, index + length)) === fingerprint) {
          bounded = `${bounded.slice(0, index)}[REDACTED]${bounded.slice(index + length)}`;
          index += "[REDACTED]".length - 1;
        }
      }
    }
    return redact(bounded);
  };
};

const decode = (value: unknown, clean: (text: string) => string, directory: string, port: string) => {
  const event = record(value);
  if (!event) return null;
  if (event.schemaVersion !== 1) throw new Error("CLI_VERSION_MISMATCH");
  const stage = member(stages, event.stage) ? event.stage : undefined;
  const parseAction = (value: unknown): Action | undefined => {
    const action = record(value);
    return action && member(actions, action.kind) ? {
      kind: action.kind, ...(typeof action.detail === "string" ? { detail: clean(action.detail) } : {}),
    } : undefined;
  };
  let payload: DeployPayload;
  if (event.type === "stage" && stage && member(statuses, event.status)) {
    payload = { type: "stage", stage, status: event.status, ...(count(event.current) && count(event.total) && event.current <= event.total ? { current: event.current, total: event.total } : {}) };
  } else if (event.type === "log") {
    payload = { type: "log", stage };
  } else if (event.type === "action-required") {
    const action = parseAction(event.action);
    if (!action) return null;
    payload = { type: "action-required", action };
  } else if (event.type === "error" && stage && member(codes, event.code) && typeof event.retryable === "boolean") {
    payload = { type: "error", stage, code: event.code, retryable: event.retryable,
      ...(member(fields, event.field) ? { field: event.field } : {}), action: parseAction(event.action) };
  } else if (event.type === "result") {
    const result = record(event.result);
    if (!result || !text(result.username, 256) || !text(result.version, 64) ||
      !member(engines, result.engine) || result.directory !== directory || result.url !== `http://127.0.0.1:${port}`) return null;
    payload = { type: "result", result: { url: clean(result.url as string), username: clean(result.username), directory: clean(directory), version: clean(result.version), engine: result.engine } };
  } else return null;
  return { ...payload, ...(typeof event.message === "string" ? { message: clean(event.message) } : {}),
    ts: text(event.ts, 40) && Number.isFinite(Date.parse(event.ts)) ? new Date(event.ts).toISOString() : new Date().toISOString() };
};

const receiveLines = (stream: NodeJS.ReadableStream, receive: (line: string) => void) => {
  const decoder = new StringDecoder("utf8");
  let buffered = "";
  let discarded = false;
  const append = (fragment: string) => {
    if (discarded) return;
    if (buffered.length + fragment.length > 64 * 1024) {
      discarded = true;
      buffered = "";
    } else buffered += fragment;
  };
  const flush = () => {
    if (buffered && !discarded) receive(buffered);
    buffered = "";
    discarded = false;
  };
  stream.on("data", (bytes: Buffer) => {
    const parts = decoder.write(bytes).split("\n");
    parts.forEach((part, index) => { append(part); if (index < parts.length - 1) flush(); });
  });
  stream.on("end", () => { append(decoder.end()); flush(); });
};

type Child = ReturnType<typeof spawn>;
const terminateTree = (child: Child) => {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", () => child.kill());
    return;
  }
  const signal = (value: NodeJS.Signals) => { try { process.kill(-pid, value); } catch {} };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), 35_000);
  timer.unref();
  child.once("close", () => { clearTimeout(timer); signal("SIGKILL"); });
};

const DEFAULT_API_PORT = 8787;

const availableDiskBytes = (target: string): number | null => {
  try {
    let directory = target;
    while (!existsSync(directory)) {
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    const filesystem = statfsSync(directory);
    const bytes = Number(filesystem.bavail) * Number(filesystem.bsize);
    return Number.isFinite(bytes) && bytes >= 0 ? Math.floor(bytes) : null;
  } catch {
    return null;
  }
};

const isPortFree = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (free: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(free);
    };
    const timer = setTimeout(() => {
      try { server.close(); } catch {}
      finish(false);
    }, 2_000);
    timer.unref();
    server.unref();
    server.once("error", () => finish(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => finish(true));
    });
  });

const probeApiPortAvailable = async (platformName: NodeJS.Platform, port = DEFAULT_API_PORT): Promise<boolean | null> => {
  try {
    const hosts = platformName === "linux" ? ["127.0.0.1"] : ["127.0.0.1", "0.0.0.0"];
    for (const host of hosts) {
      if (!(await isPortFree(host, port))) return false;
    }
    return true;
  } catch {
    return null;
  }
};

export const probeHostResources = async (directory: string, platformName: NodeJS.Platform): Promise<HostResources> => {
  const memory = totalmem();
  const cores = cpus().length;
  const apiPortAvailable = await probeApiPortAvailable(platformName, DEFAULT_API_PORT);
  return {
    memoryBytes: Number.isFinite(memory) && memory > 0 ? Math.floor(memory) : null,
    diskAvailableBytes: availableDiskBytes(directory),
    cpuCores: Number.isSafeInteger(cores) && cores > 0 ? cores : null,
    arch: arch(),
    apiPort: DEFAULT_API_PORT,
    apiPortAvailable,
  };
};

interface ManagerOptions {
  directory: string;
  version: string;
  bundledCli?: string;
  executablePath?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  installation?: typeof readManagedInstallation;
  resources?: () => Promise<HostResources>;
  prepare?: (signal: AbortSignal) => Promise<string>;
  spawn?: typeof spawn;
  terminate?: (child: Child) => void;
}

export class LocalDeployManager {
  private active?: { id: string; controller: AbortController; done: Promise<void> };
  private mutating = false;
  private operation?: "starting" | "removing";
  constructor(private readonly options: ManagerOptions) {}

  get busy() { return this.mutating; }
  get environment(): NodeJS.ProcessEnv {
    const environment = { ...(this.options.environment ?? process.env) };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.OUTCOMEGO_DESKTOP_CLI_PREPARE;
    delete environment.OUTCOMEGO_BOOTSTRAP_CANCEL_FILE;
    if ((this.options.platform ?? process.platform) === "darwin") {
      environment.PATH = [environment.PATH, "/usr/local/bin", "/opt/homebrew/bin", "/Applications/Docker.app/Contents/Resources/bin", "/usr/bin", "/bin"].filter(Boolean).join(delimiter);
    }
    return environment;
  }

  private spawn(command: string, args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal, marker?: string): Child {
    if (signal.aborted) throw new Error("CANCELLED");
    const child = (this.options.spawn ?? spawn)(command, args, { env, detached: (this.options.platform ?? process.platform) !== "win32", shell: false, windowsHide: true, stdio: "pipe" });
    const kill = () => (this.options.terminate ?? terminateTree)(child);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      if (marker) {
        try {
          writeFileSync(marker, "", { flag: "wx", mode: 0o600 });
          timer = setTimeout(kill, 60_000);
          timer.unref();
          return;
        } catch {}
      }
      kill();
    };
    signal.addEventListener("abort", terminate, { once: true });
    child.once("close", () => {
      signal.removeEventListener("abort", terminate);
      clearTimeout(timer);
    });
    child.stdin?.on("error", () => undefined);
    return child;
  }

  async carrier(signal: AbortSignal): Promise<string> {
    if (this.options.prepare) return this.options.prepare(signal);
    const { executablePath, bundledCli, version } = this.options;
    if (!executablePath || !bundledCli) throw new Error("CLI_VERSION_MISMATCH");
    const child = this.spawn(executablePath, [bundledCli, "--version"], {
      ...this.environment, ELECTRON_RUN_AS_NODE: "1", OUTCOMEGO_DESKTOP_CLI_PREPARE: version,
    }, signal);
    child.stdin?.end();
    let executable: string | undefined;
    let mismatch = false;
    receiveLines(child.stdout!, line => {
      try {
        const value = JSON.parse(line).executable;
        if (text(value, maxText) && isAbsolute(value)) executable = value;
      } catch {}
    });
    receiveLines(child.stderr!, line => { mismatch ||= line.includes("CLI_VERSION_MISMATCH"); });
    const status = await this.wait(child);
    if (signal.aborted) throw new Error("CANCELLED");
    if (status !== 0 || !executable) throw new Error(mismatch ? "CLI_VERSION_MISMATCH" : "ASSET_DOWNLOAD_FAILED");
    return executable;
  }

  private wait(child: Child): Promise<number | null> {
    return new Promise(resolve => { child.once("error", () => resolve(1)); child.once("close", resolve); });
  }

  private async command(
    args: string[],
    options: { bundled?: boolean; timeout?: number; stdin?: string; secretValues?: readonly string[] } = {}
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout ?? 240_000);
    const { bundledCli, executablePath, directory, version } = this.options;
    try {
      const bundled = options.bundled && !!bundledCli && !!executablePath;
      const executable = bundled ? executablePath : await this.carrier(controller.signal);
      const child = this.spawn(executable, [...(bundled ? [bundledCli] : []), ...args, "--dir", directory], {
        ...this.environment, ...(bundled ? { ELECTRON_RUN_AS_NODE: "1" } : { OUTCOMEGO_DESKTOP_CLI_VERSION: version }),
      }, controller.signal);
      const stdout: string[] = [];
      let size = 0;
      let code: Code | undefined;
      receiveLines(child.stdout!, line => { size += line.length; if (size <= 512 * 1024) stdout.push(line); else controller.abort(); });
      receiveLines(child.stderr!, line => { code ??= codes.find(candidate => new RegExp(`\\b${candidate}\\b`).test(line)); });
      if (options.stdin !== undefined) {
        child.stdin?.write(options.stdin);
      }
      child.stdin?.end();
      const status = await this.wait(child);
      let output = stdout.join("\n");
      if (options.secretValues?.length) {
        for (const secret of options.secretValues) {
          if (secret) output = output.replaceAll(secret, "[REDACTED]");
        }
      }
      return { status, code, output };
    } finally { clearTimeout(timer); }
  }

  installDirectory(): string {
    return this.options.directory;
  }

  logsDirectory(): string {
    const logs = join(this.options.directory, "logs");
    return existsSync(logs) ? logs : this.options.directory;
  }

  private assertCanManage(serverUrl?: string) {
    const installation = (this.options.installation ?? readManagedInstallation)(this.environment);
    if (
      !installation ||
      installation.directory !== this.options.directory ||
      !canManageLocalInstallation(serverUrl ?? `http://127.0.0.1:${installation.apiPort}`, installation)
    ) {
      throw new Error("INVALID_INPUT");
    }
    return installation;
  }

  async status(): Promise<LocalServerStatus> {
    const installation = (this.options.installation ?? readManagedInstallation)(this.environment);
    const pending = readPendingDeployment(this.options.directory);
    const empty: LocalServerStatus = { stack: { state: this.operation ?? "not-installed", services: [] }, engine: null,
      version: installation?.version ?? null, apiPort: installation ? Number(installation.apiPort) : null,
      ownerUsername: pending?.ownerUsername ?? installation?.ownerUsername ?? null, awaiting: pending?.awaiting ?? null,
      directory: installation?.directory ?? this.options.directory };
    try {
      const { status, output } = await this.command(["status", "--json"], { bundled: true, timeout: 20_000 });
      const snapshot = JSON.parse(output);
      if (status !== 0 || !member(stackStates, snapshot?.stack?.state) || !Array.isArray(snapshot.stack.services)) throw new Error();
      const detection = record(snapshot.engine);
      const engine = record(detection?.engine);
      return { ...empty, stack: { state: this.operation ?? snapshot.stack.state, services: snapshot.stack.services.map((value: unknown) => {
        const service = record(value);
        return { Service: typeof service?.Service === "string" ? redact(service.Service) : undefined,
          State: typeof service?.State === "string" ? redact(service.State) : undefined,
          Health: typeof service?.Health === "string" ? redact(service.Health) : undefined,
          ExitCode: count(service?.ExitCode) ? service.ExitCode : undefined };
      }) }, engine: detection ? { state: typeof detection.state === "string" ? redact(detection.state) : undefined,
        memoryBytes: count(detection.memoryBytes) ? detection.memoryBytes : undefined,
        engine: member(engines, engine?.kind) ? { kind: engine.kind } : undefined,
        reasons: Array.isArray(detection.reasons) ? detection.reasons.slice(0, 10).filter((item): item is string => typeof item === "string").map(redact) : [] } : null };
    } catch {
      return { ...empty, stack: { state: this.operation ?? (installation ? "unhealthy" : "not-installed"), services: [] }, reason: "ENGINE_UNAVAILABLE" };
    }
  }

  /**
   * A read-only look at each container engine a deployment could use, for the engine choice
   * screen. It starts nothing and takes no deployment lock. A look that fails or times out
   * reports "unknown" instead of failing, so the screen can still offer both choices.
   */
  async engines(): Promise<EngineProbes> {
    const probe = async (kind: "external" | "managed"): Promise<EngineProbe> => {
      const unknown: EngineProbe = { state: "unknown", reasons: [] };
      try {
        const { status, output } = await this.command(["engine", "status", "--json", "--engine", kind], { bundled: true, timeout: 25_000 });
        const detection = record(JSON.parse(output));
        if (status !== 0 || !detection || !member(engineProbeStates, detection.state) || detection.state === "unknown") return unknown;
        const described = record(detection.engine);
        const label = (value: unknown) => typeof value === "string" && value.length <= 80 ? redact(value) : undefined;
        const name = label(described?.name);
        const version = label(described?.version) ?? label(detection.engineVersion);
        return {
          state: detection.state,
          ...(member(codes, detection.code) ? { code: detection.code } : {}),
          reasons: Array.isArray(detection.reasons)
            ? detection.reasons.slice(0, 5).filter((item): item is string => typeof item === "string" && item.length <= 400).map(redact) : [],
          ...(name ? { name } : {}),
          ...(version ? { version } : {}),
          ...(count(detection.memoryBytes) ? { memoryBytes: detection.memoryBytes } : {}),
        };
      } catch { return unknown; }
    };
    const platformName = this.options.platform ?? process.platform;
    const readResources = async (): Promise<HostResources | undefined> => {
      try {
        return await (this.options.resources ?? (() => probeHostResources(this.options.directory, platformName)))();
      } catch {
        return undefined;
      }
    };
    const [external, managed, resources] = await Promise.all([
      probe("external"),
      platformName === "win32" || platformName === "darwin" ? probe("managed") : Promise.resolve(null),
      readResources(),
    ]);
    return { external, managed, ...(resources ? { resources } : {}) };
  }

  async service(action: "start" | "stop" | "uninstall" | "resources", args: string[], serverUrl?: string): Promise<LocalServerStatus> {
    await this.mutate(async () => {
      this.assertCanManage(serverUrl);
      this.operation = action === "start" ? "starting" : action === "uninstall" ? "removing" : undefined;
      try {
        const { status } = await this.command([action, ...args]);
        if (status !== 0) throw new Error(action === "start" ? "STACK_START_FAILED" : "UNKNOWN");
      } finally { this.operation = undefined; }
    });
    return this.status();
  }

  async restart(service?: string, serverUrl?: string): Promise<LocalServerStatus> {
    const validated = validateRestartService(service);
    await this.mutate(async () => {
      this.assertCanManage(serverUrl);
      this.operation = "starting";
      try {
        const args = ["restart", ...(validated ? [validated] : []), "--json", "--yes"];
        const { status, code } = await this.command(args, { bundled: true });
        if (status !== 0) throw new Error(code ?? "STACK_START_FAILED");
      } finally {
        this.operation = undefined;
      }
    });
    return this.status();
  }

  async containers(options?: { includeStats?: boolean }, serverUrl?: string): Promise<LocalContainersSnapshot> {
    const validated = validateContainersRequest(options);
    this.assertCanManage(serverUrl);
    const { status, code, output } = await this.command(
      ["containers", "--json", ...(validated.includeStats ? ["--stats"] : [])],
      { bundled: true, timeout: 15_000 }
    );
    if (status !== 0) throw new Error(code ?? "ENGINE_UNAVAILABLE");
    return parseJsonOutput<LocalContainersSnapshot>(output);
  }

  async logs(options: { service: string; tail?: number }, serverUrl?: string): Promise<LocalContainerLogs> {
    const validated = validateLogsRequest(options);
    this.assertCanManage(serverUrl);
    const { status, code, output } = await this.command(
      ["logs", validated.service, "--tail", String(validated.tail), "--json"],
      { bundled: true, timeout: 15_000 }
    );
    if (status !== 0) throw new Error(code ?? "ENGINE_UNAVAILABLE");
    return parseJsonOutput<LocalContainerLogs>(output);
  }

  async autostartStatus(serverUrl?: string): Promise<LocalAutostartStatus> {
    this.assertCanManage(serverUrl);
    const { status, code, output } = await this.command(["autostart", "status", "--json"], {
      bundled: true,
      timeout: 15_000,
    });
    if (status !== 0) throw new Error(code ?? "ENGINE_UNAVAILABLE");
    return parseJsonOutput<LocalAutostartStatus>(output);
  }

  async setAutostart(enabled: boolean, serverUrl?: string): Promise<LocalAutostartStatus> {
    if (typeof enabled !== "boolean") throw new Error("INVALID_INPUT");
    return this.mutate(async () => {
      this.assertCanManage(serverUrl);
      const { status, code, output } = await this.command(
        [
          "autostart",
          "set",
          "--enabled",
          enabled ? "true" : "false",
          "--json",
        ],
        { bundled: true, timeout: 30_000 }
      );
      if (status !== 0) throw new Error(code ?? "UNKNOWN");
      return parseJsonOutput<LocalAutostartStatus>(output);
    });
  }

  async resourcesStatus(serverUrl?: string): Promise<LocalResourceSnapshot> {
    this.assertCanManage(serverUrl);
    const { status, code, output } = await this.command(["resources", "status", "--json"], {
      bundled: true,
      timeout: 20_000,
    });
    if (status !== 0) throw new Error(code ?? "ENGINE_UNAVAILABLE");
    return parseJsonOutput<LocalResourceSnapshot>(output);
  }

  async updateResources(input: LocalResourceUpdate, serverUrl?: string): Promise<LocalResourceSnapshot> {
    const validated = validateResourceUpdate(input);
    return this.mutate(async () => {
      this.assertCanManage(serverUrl);
      const args = ["resources", "set"];
      if (validated.computerMemory !== undefined) args.push("--computer-memory", validated.computerMemory);
      if (validated.desktopMemory !== undefined) args.push("--desktop-memory", validated.desktopMemory);
      if (validated.computerCpu !== undefined) {
        args.push("--computer-cpu", validated.computerCpu === null ? "none" : String(validated.computerCpu));
      }
      if (validated.workerConcurrency !== undefined) {
        args.push("--worker-concurrency", String(validated.workerConcurrency));
      }
      if (validated.engineMemory !== undefined) args.push("--engine-memory", validated.engineMemory);
      if (validated.engineCpu !== undefined) args.push("--engine-cpu", String(validated.engineCpu));
      if (validated.applyWslconfig) args.push("--apply-wslconfig");
      if (validated.restartWsl) args.push("--restart-wsl");
      args.push("--json", "--yes");
      const { status, code, output } = await this.command(args, { bundled: true });
      if (status !== 0) throw new Error(code ?? "STACK_START_FAILED");
      return parseJsonOutput<LocalResourceSnapshot>(output);
    });
  }

  async proxyStatus(serverUrl?: string): Promise<LocalProxyConfig> {
    this.assertCanManage(serverUrl);
    const { status, code, output } = await this.command(["proxy", "status", "--json"], {
      bundled: true,
      timeout: 15_000,
    });
    if (status !== 0) throw new Error(code ?? "ENGINE_UNAVAILABLE");
    return parseJsonOutput<LocalProxyConfig>(output);
  }

  async saveProxy(input: LocalProxyUpdate, serverUrl?: string): Promise<LocalProxyConfig> {
    const validated = validateProxyUpdate(input);
    const secretValues = validated.password ? [validated.password] : [];
    return this.mutate(async () => {
      this.assertCanManage(serverUrl);
      const { status, code, output } = await this.command(
        ["proxy", "set", "--config-stdin", "--yes", "--json"],
        { bundled: true, stdin: JSON.stringify(validated), secretValues }
      );
      if (status !== 0) throw new Error(code ?? "STACK_START_FAILED");
      return parseJsonOutput<LocalProxyConfig>(output);
    });
  }

  async testProxy(input: LocalProxyUpdate, serverUrl?: string): Promise<LocalProxyTestResult> {
    const validated = validateProxyUpdate(input);
    const secretValues = validated.password ? [validated.password] : [];
    this.assertCanManage(serverUrl);
    const { status, code, output } = await this.command(
      ["proxy", "test", "--config-stdin", "--json"],
      { bundled: true, timeout: 30_000, stdin: JSON.stringify(validated), secretValues }
    );
    if (status !== 0) throw new Error(code ?? "UNKNOWN");
    return parseJsonOutput<LocalProxyTestResult>(output);
  }

  async restore(currentServer: () => string | undefined, quitting: () => boolean): Promise<LocalServerStatus | null> {
    const installation = (this.options.installation ?? readManagedInstallation)(this.environment);
    if (!installation?.ownerUsername || installation.uninstalled || quitting()) return null;
    const snapshot = await this.status();
    if (snapshot.awaiting || snapshot.stack.state !== "stopped" || quitting()) return snapshot;
    const server = currentServer();
    if (server && !canManageLocalInstallation(server, installation)) return snapshot;
    return this.service("start", [], server);
  }

  async enableWsl(serverUrl?: string): Promise<{ code: Code | null }> {
    return this.mutate(async () => {
      if ((this.options.platform ?? process.platform) !== "win32") throw new Error("WINDOWS_UNSUPPORTED");
      const installation = (this.options.installation ?? readManagedInstallation)(this.environment);
      const pending = readPendingDeployment(this.options.directory);
      if (pending?.awaiting !== "elevation" || (installation && installation.engine !== "managed-wsl") ||
        (serverUrl && !canManageLocalInstallation(serverUrl, installation))) throw new Error("INVALID_INPUT");
      const result = await this.command(["engine", "enable-wsl", "--yes"], { timeout: 310_000 });
      return { code: result.status === 0 ? null : result.code ?? "ENGINE_START_FAILED" };
    });
  }

  async diagnostics(): Promise<string> {
    const snapshot = await this.status();
    const directory = join(this.options.directory, "logs");
    let log = "";
    try {
      const latest = readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && /^bootstrap-[0-9T.Z-]+-[a-f0-9-]{36}\.log$/.test(file.name)).map(file => file.name).sort().at(-1);
      if (latest) {
        const file = join(directory, latest);
        const size = statSync(file).size;
        const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
        const descriptor = openSync(file, "r");
        try { log = buffer.subarray(0, readSync(descriptor, buffer, 0, buffer.length, size - buffer.length)).toString("utf8"); }
        finally { closeSync(descriptor); }
      }
    } catch {}
    const doctor = await this.command(["doctor"], { bundled: true, timeout: 20_000 }).catch(() => null);
    return [`${platform()} ${release()} ${arch()}`, JSON.stringify(snapshot), ...log.split(/\r?\n/).slice(-200), ...(doctor?.output.split(/\r?\n/).slice(-200) ?? [])].map(redact).join("\n");
  }

  async mutate<Result>(work: () => Promise<Result>): Promise<Result> {
    if (this.mutating) throw new Error("BUSY");
    this.mutating = true;
    try { return await work(); } finally { this.mutating = false; }
  }

  start(value: unknown, send: (event: DeployProgress) => void, serverUrl?: string): { deployId: string } {
    if (this.busy) throw new Error("BUSY");
    const input = localDeployRequest(value);
    const installed = (this.options.installation ?? readManagedInstallation)(this.environment);
    const apiPort = installed?.apiPort ?? String(input.apiPort ?? 8787);
    const target = installed ?? { directory: this.options.directory, version: this.options.version, apiPort };
    if (target.directory !== this.options.directory || !canManageLocalInstallation(serverUrl ?? `http://127.0.0.1:${apiPort}`, target)) throw new Error("INVALID_INPUT");
    const deployId = randomUUID();
    const controller = new AbortController();
    const publish = (payload: DeployPayload & { ts?: string; message?: string }) => send({ ts: new Date().toISOString(), ...payload, schemaVersion: 1, deployId });
    const done = this.mutate(async () => {
      let stage: Stage = "detect";
      let result: ReturnType<typeof decode> = null;
      let errorSent = false;
      let protocolError: Code | undefined;
      let cancellationDirectory: string | undefined;
      const fail = (code: Code) => publish({ type: "error", code, retryable: true, stage });
      try {
        const executable = await this.carrier(controller.signal);
        const clean = deploymentRedactor(input.password);
        if ((this.options.platform ?? process.platform) === "win32") cancellationDirectory = mkdtempSync(join(tmpdir(), "outcomego-deploy-"));
        const marker = cancellationDirectory ? join(cancellationDirectory, "cancel") : undefined;
        const child = this.spawn(executable, ["bootstrap", "--json-progress", "--dir", target.directory, "--engine", input.engine ?? "auto",
          "--api-port", apiPort, ...(input.acceptLowMemory ? ["--accept-low-memory"] : [])],
        { ...this.environment, OUTCOMEGO_DESKTOP_CLI_VERSION: this.options.version, ...(marker ? { OUTCOMEGO_BOOTSTRAP_CANCEL_FILE: marker } : {}) }, controller.signal, marker);
        const exited = this.wait(child);
        receiveLines(child.stdout!, line => {
          if (controller.signal.aborted) return;
          try {
            const event = decode(JSON.parse(line), clean, target.directory, apiPort);
            if (!event) return;
            if (event.type === "result") result = event;
            else {
              if ("stage" in event && event.stage) stage = event.stage;
              if (event.type === "error") errorSent = true;
              publish(event);
            }
          } catch (error) {
            protocolError = error instanceof Error && error.message === "CLI_VERSION_MISMATCH" ? "CLI_VERSION_MISMATCH" : "UNKNOWN";
            controller.abort();
          }
        });
        child.stderr?.resume();
        child.stdin?.write(JSON.stringify({ schemaVersion: 1, owner: { username: input.username, password: input.password } }));
        child.stdin?.end();
        input.password = "";
        const status = await exited;
        if (protocolError) fail(protocolError);
        else if (controller.signal.aborted || status === 130) fail("CANCELLED");
        else if (status === 0 && result) publish(result);
        else if (!errorSent) fail("UNKNOWN");
      } catch (error) {
        const code = error instanceof Error ? error.message : null;
        fail(controller.signal.aborted ? "CANCELLED" : member(codes, code) ? code : "UNKNOWN");
      } finally {
        input.password = "";
        if (cancellationDirectory) {
          try { rmSync(cancellationDirectory, { recursive: true, force: true }); } catch {}
        }
        this.active = undefined;
      }
    });
    this.active = { id: deployId, controller, done };
    return { deployId };
  }

  async cancel(deployId: unknown): Promise<void> {
    if (typeof deployId !== "string" || !/^[0-9a-f-]{36}$/.test(deployId)) throw new Error("INVALID_INPUT");
    if (!this.active || this.active.id !== deployId) return;
    const { controller, done } = this.active;
    controller.abort();
    await done;
  }
}
