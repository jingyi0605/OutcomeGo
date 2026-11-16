import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DingTalkActionInput, DingTalkOperation, DingTalkStatus } from "@outcomego/contracts";
import { PluginPackageCache } from "./plugin-package-cache";
import { assignAgentOwnership, sanitizedAgentEnvironment, spawnAgentProcess } from "./agent-process";

const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const DINGTALK_CLI_ACCESS_DOC_URL =
  "https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli#admin-enable-cli-access-for-your-organization";
const initialStatus = (): DingTalkStatus => ({
  computer: "bot",
  installed: false,
  version: null,
  connection: "unknown",
  latestVersion: null,
  updateAvailable: false,
  updateCheck: "unavailable",
});
const jsonOutput = (output: string): Record<string, unknown> | null => {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(output.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

/** Only browser challenges are projected; raw CLI output and credentials never leave the Computer. */
export function authorizationFromOutput(output: string): DingTalkOperation["authorization"] {
  let result: DingTalkOperation["authorization"];
  for (const match of output.matchAll(/https:\/\/[^\s<>"'\x1b]+/g)) {
    try {
      const url = new URL(match[0]);
      const device = ["login.dingtalk.com", "login.dingtalk.io"].includes(url.hostname) && url.pathname === "/oauth2/device/verify.htm";
      const pat = url.hostname === "open-dev.dingtalk.com" && url.pathname === "/fe/old";
      if (url.username || url.port || (!device && !pat)) continue;
      const params = new URLSearchParams(url.hash.split("?")[1] ?? "");
      const code = url.searchParams.get("user_code") ?? url.searchParams.get("userCode") ?? params.get("userCode");
      if (!code || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) continue;
      result = { url: url.href, userCode: code, stage: device ? "device" : "pat" };
    } catch { /* Ignore non-URL console text. */ }
  }
  return result;
}

export function promptFromOutput(output: string): DingTalkOperation["prompt"] {
  if (!/Enter a number between \d+ and \d+:\s*$/.test(output)) return undefined;
  const lines = output.split(/[\r\n]+/);
  const options = lines.flatMap((line) => {
    const item = /^\s*(\d+)\.\s*(✓\s*)?(.+?)\s*$/.exec(line);
    return item && item[1] !== "0" ? [{ value: item[1]!, label: item[3]!, selected: Boolean(item[2]) }] : [];
  });
  if (!options.length) return undefined;
  const unique = [...new Map(options.map((option) => [option.value, option])).values()];
  return { id: randomUUID(), kind: /Confirm selection/.test(output) ? "domains" : "scope", options: unique };
}

export function isDingTalkCliAccessDenied(output: string): boolean {
  return /当前组织未授权您通过 CLI 访问个人数据|暂无 CLI 数据访问权限|this organization has not enabled CLI access|organization hasn't enabled CLI access|cli_not_enabled|user_forbidden|user_not_allowed/i.test(output);
}

export function updateStatusFromOutput(
  output: string
): Pick<DingTalkStatus, "latestVersion" | "updateAvailable" | "updateCheck"> | undefined {
  const data = jsonOutput(output);
  if (!data || typeof data.latest_version !== "string" || typeof data.needs_upgrade !== "boolean") return undefined;
  return {
    latestVersion: data.latest_version,
    updateAvailable: data.needs_upgrade,
    updateCheck: data.needs_upgrade ? "available" : "current",
  };
}

function failureMessage(output: string): string {
  // Error messages can include diagnostic identifiers, but never project arbitrary JSON fields.
  const match = /"message"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(output);
  const message = isDingTalkCliAccessDenied(output) ? "Your organization has not enabled CLI access to personal data." :
    match ? String(JSON.parse(match[1]!)) :
    "DWS could not complete the operation. Check the organization permissions and try again.";
  return message.replace(/https?:\/\/\S+/g, "[authorization page]")
    .replace(/(?:access[_ -]?token|refresh[_ -]?token|bearer|appsecret)\s*[:=]?\s*\S+/gi, "[credential]").slice(0, 1000);
}

type ProcessResult = { code: number | null; stdout: string; stderr: string };
type ProcessOptions = {
  input?: (child: ChildProcess, chunk: string) => void;
  noUpdateCheck?: boolean;
  signal?: AbortSignal;
  timeout?: number;
};

export class DingTalkRuntime {
  private state = initialStatus();
  private operation?: DingTalkOperation;
  private controller?: AbortController;
  private child?: ChildProcess;
  private pendingValues: string[] = [];
  private promptText = "";
  private authOutput = "";
  private reading?: Promise<DingTalkStatus>;
  private checkedAt = 0;
  private readonly cache: PluginPackageCache;
  private readonly directory: string;

  constructor(root = process.env.OUTCOMEGO_AGENT_DATA_ROOT ?? "/agent-data") {
    this.directory = join(root, "dingtalk-packages");
    this.cache = new PluginPackageCache(this.directory);
  }

  private async scripts(packageFiles: unknown): Promise<string> {
    const config = await this.cache.resolve({
      packageFiles,
      scripts: "${PLUGIN_ROOT}/skills/dingtalk-setup/scripts",
    }) as { scripts: string };
    if (!config.scripts || config.scripts.includes("${")) throw new Error("The DingTalk package is unavailable.");
    await assignAgentOwnership([this.directory], true);
    return config.scripts;
  }

  private process(script: string, args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const environment = sanitizedAgentEnvironment(
        process.env,
        options.noUpdateCheck === false ? {} : { DWS_NO_UPDATE_CHECK: "1" }
      );
      if (options.noUpdateCheck === false) delete environment.DWS_NO_UPDATE_CHECK;
      const child = spawnAgentProcess("bash", [script, ...args], {
        env: environment,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      let stopped = false;
      const stop = () => {
        stopped = true;
        if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
      };
      const timer = setTimeout(stop, options.timeout ?? 60_000);
      const onData = (stream: "stdout" | "stderr", chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (stream === "stdout") stdout += text; else stderr += text;
        if (stdout.length + stderr.length > 512_000) { stop(); return; }
        options.input?.(child, text);
      };
      child.stdout!.on("data", (chunk) => onData("stdout", chunk));
      child.stderr!.on("data", (chunk) => onData("stderr", chunk));
      child.stdin!.on("error", () => {});
      options.signal?.addEventListener("abort", stop, { once: true });
      if (options.signal?.aborted) stop();
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", stop);
        if (stopped) reject(new Error(options.signal?.aborted ? "Operation cancelled." : "The DWS operation timed out."));
        else resolve({ code, stdout, stderr });
      });
    });
  }

  private snapshot(): DingTalkStatus {
    return structuredClone({ ...this.state, ...(this.operation ? { operation: this.operation } : {}) });
  }

  async status(packageFiles: unknown, force = false): Promise<DingTalkStatus> {
    if (this.operation?.status === "running" && !force) return this.snapshot();
    if (!force && Date.now() - this.checkedAt < 5000) return this.snapshot();
    if (this.reading) return this.reading;
    this.reading = this.inspect(packageFiles).finally(() => { this.reading = undefined; });
    return this.reading;
  }

  private async inspect(packageFiles: unknown): Promise<DingTalkStatus> {
    try {
      const scripts = await this.scripts(packageFiles);
      const binary = await this.process(join(scripts, "ensure-dws.sh"), ["--check"]);
      if (binary.code !== 0) {
        const missing = /Managed DWS CLI is missing/.test(binary.stderr);
        this.state = { ...initialStatus(), connection: missing ? "disconnected" : "unknown", ...(!missing ? { error: "The managed DWS installation could not be verified." } : {}) };
      } else {
        const version = await this.process(join(scripts, "dws.sh"), ["--version"]);
        const auth = await this.process(join(scripts, "dws-status.sh"), []);
        const update = await this.process(
          join(scripts, "dws.sh"),
          ["upgrade", "--check", "--format", "json"],
          { noUpdateCheck: false, timeout: 45_000 }
        );
        const data = auth.code === 0 ? jsonOutput(auth.stdout) : null;
        const connected = data?.authenticated === true && (data.token_valid === true || data.refresh_token_valid === true);
        const updateStatus = update.code === 0 ? updateStatusFromOutput(update.stdout) : undefined;
        this.state = {
          computer: "bot", installed: true,
          version: /dws version (v[^\s]+)/.exec(version.stdout)?.[1] ?? null,
          connection: connected ? "connected" : data?.authenticated === false ? "disconnected" : "unknown",
          ...(updateStatus ?? {
            latestVersion: null,
            updateAvailable: false,
            updateCheck: "unavailable" as const,
          }),
          ...(connected ? { account: { userName: String(data.user_name ?? ""), corpName: String(data.corp_name ?? "") } } : {}),
          ...(auth.code !== 0 ? { error: failureMessage(auth.stdout + auth.stderr) } : {}),
          ...(updateStatus || update.code === 0 ? {} : { updateError: "Could not check for a newer DWS version." }),
        };
      }
    } catch {
      this.state = { ...this.state, connection: "unknown", error: "Could not read DWS status on the Bot Computer." };
    }
    this.checkedAt = Date.now();
    return this.snapshot();
  }

  async action(input: DingTalkActionInput, packageFiles: unknown): Promise<DingTalkStatus> {
    if (input.action === "cancel") {
      this.assertOperation(input.operationId);
      this.controller?.abort();
      return this.snapshot();
    }
    if (input.action === "respond") return this.respond(input);
    if (!["install", "upgrade", "authenticate"].includes(input.action)) throw new Error("Unknown DingTalk action.");
    if (this.operation?.status === "running") return this.snapshot();
    const kind = input.action as DingTalkOperation["kind"];
    // Claim before package resolution so concurrent clicks cannot start two logins/upgrades.
    this.operation = { id: randomUUID(), kind, status: "running" };
    this.controller = new AbortController();
    const operation = this.operation;
    const signal = this.controller.signal;
    void this.perform(kind, packageFiles, signal).then(async () => {
      signal.throwIfAborted();
      await this.status(packageFiles, true);
      if (kind === "authenticate" && this.state.connection !== "connected") throw new Error("DWS did not confirm a valid saved login. Please authenticate again.");
      if (!this.state.installed || !this.state.version) throw new Error("DWS installation could not be verified.");
      signal.throwIfAborted();
      operation.status = "succeeded";
    }).catch((error) => {
      operation.status = signal.aborted ? "cancelled" : "failed";
      operation.error = error instanceof Error ? error.message : "The DWS operation failed.";
      this.checkedAt = 0;
    }).finally(() => {
      delete operation.authorization;
      delete operation.prompt;
      this.child = undefined;
      this.pendingValues = [];
      this.promptText = "";
      this.authOutput = "";
    });
    return this.snapshot();
  }

  private assertOperation(id?: string) {
    if (!id || id !== this.operation?.id || this.operation.status !== "running")
      throw new Error("This DingTalk operation is no longer active. Refresh and try again.");
  }

  private respond(input: DingTalkActionInput): DingTalkStatus {
    this.assertOperation(input.operationId);
    const prompt = this.operation?.prompt;
    if (!prompt || prompt.id !== input.promptId || !Array.isArray(input.values) || !input.values.length)
      throw new Error("Choose the requested DingTalk authorization options.");
    const values = [...new Set(input.values)];
    if (values.some((value) => !prompt.options.some((option) => option.value === value)) || (prompt.kind === "scope" && values.length !== 1))
      throw new Error("Invalid DingTalk authorization selection.");
    this.pendingValues = prompt.kind === "scope" ? values : [
      ...prompt.options.filter((option) => Boolean(option.selected) !== values.includes(option.value)).map((option) => option.value), "0",
    ];
    delete this.operation!.prompt;
    this.sendNext();
    return this.snapshot();
  }

  private sendNext() {
    const value = this.pendingValues.shift();
    this.promptText = "";
    if (value !== undefined) this.child?.stdin?.write(value + "\n");
  }

  private async perform(kind: DingTalkOperation["kind"], packageFiles: unknown, signal: AbortSignal) {
    const scripts = await this.scripts(packageFiles);
    signal.throwIfAborted();
    const script = kind === "install" ? "ensure-dws.sh" : kind === "upgrade" ? "dws-upgrade.sh" : "dws.sh";
    const args = kind === "install" ? ["--install"] : kind === "upgrade" ? [] : ["auth", "login", "--device", "--no-browser"];
    this.authOutput = "";
    this.promptText = "";
    const result = await this.process(join(scripts, script), args, {
      signal,
      timeout: kind === "authenticate" ? 26 * 60_000 : 8 * 60_000,
      ...(kind === "authenticate" ? { input: (child: ChildProcess, text: string) => {
        this.child = child;
        this.authOutput = (this.authOutput + text).replace(ansi, "");
        this.promptText = (this.promptText + text).replace(ansi, "");
        const authorization = authorizationFromOutput(this.authOutput);
        if (authorization) this.operation!.authorization = authorization;
        if (this.operation!.prompt) return;
        const prompt = promptFromOutput(this.promptText);
        if (prompt) {
          if (this.pendingValues.length) this.sendNext();
          else this.operation!.prompt = prompt;
        }
      } } : {}),
    });
    if (result.code !== 0) {
      const output = result.stdout + result.stderr;
      if (isDingTalkCliAccessDenied(output)) {
        this.operation!.organizationAccess = {
          code: "cli_access_required",
          documentationUrl: DINGTALK_CLI_ACCESS_DOC_URL,
        };
      }
      throw new Error(failureMessage(output));
    }
  }

  stop() { this.controller?.abort(); }
}
