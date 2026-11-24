import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { safeErrorMessage } from "@outcomego/product-core/redaction";
import { canManageLocalInstallation, readManagedInstallation, readPendingDeployment } from "./local-installation";

import {
  actions, codes, engineProbeStates, engines, fields, stackStates, stages, statuses,
  type Action, type Code, type DeployPayload, type DeployProgress, type EngineProbe, type EngineProbes,
  type LocalDeployRequest, type LocalServerStatus, type Stage,
} from "../renderer/lib/local-deploy-contract";

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

interface ManagerOptions {
  directory: string;
  version: string;
  bundledCli?: string;
  executablePath?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  installation?: typeof readManagedInstallation;
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

  private async command(args: string[], options: { bundled?: boolean; timeout?: number } = {}) {
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
      child.stdin?.end();
      const status = await this.wait(child);
      return { status, code, output: stdout.join("\n") };
    } finally { clearTimeout(timer); }
  }

  async status(): Promise<LocalServerStatus> {
    const installation = (this.options.installation ?? readManagedInstallation)(this.environment);
    const pending = readPendingDeployment(this.options.directory);
    const empty: LocalServerStatus = { stack: { state: this.operation ?? "not-installed", services: [] }, engine: null,
      version: installation?.version ?? null, apiPort: installation ? Number(installation.apiPort) : null,
      ownerUsername: pending?.ownerUsername ?? installation?.ownerUsername ?? null, awaiting: pending?.awaiting ?? null };
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
        };
      } catch { return unknown; }
    };
    const platformName = this.options.platform ?? process.platform;
    const [external, managed] = await Promise.all([
      probe("external"),
      platformName === "win32" || platformName === "darwin" ? probe("managed") : Promise.resolve(null),
    ]);
    return { external, managed };
  }

  async service(action: "start" | "stop" | "uninstall" | "resources", args: string[], serverUrl?: string): Promise<LocalServerStatus> {
    await this.mutate(async () => {
      const installation = (this.options.installation ?? readManagedInstallation)(this.environment);
      if (!installation || installation.directory !== this.options.directory ||
        !canManageLocalInstallation(serverUrl ?? `http://127.0.0.1:${installation.apiPort}`, installation)) throw new Error("INVALID_INPUT");
      this.operation = action === "start" ? "starting" : action === "uninstall" ? "removing" : undefined;
      try {
        const { status } = await this.command([action, ...args]);
        if (status !== 0) throw new Error(action === "start" ? "STACK_START_FAILED" : "UNKNOWN");
      } finally { this.operation = undefined; }
    });
    return this.status();
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
