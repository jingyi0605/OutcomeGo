import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { CliOptions } from "./arguments";
import { DESKTOP_CLI_VERSION_ENV, verifyDesktopCliVersion } from "./cli-update";
import {
  createEnvironment, installationExists, normalizeProjectName, normalizeVersion, parseEnvironment,
  readManifest, replaceEnvironmentValue, writeFileAtomic, writeManifest, type InstallationPaths,
} from "./config";
import { API_PORT, CLI_VERSION, DEFAULT_REPOSITORY, PROJECT_NAME, VIEWER_PORT_END, VIEWER_PORT_START } from "./constants";
import {
  createDeployLog, deployErrorExitCodes, deployErrorText, emitDeployEvent, type DeployAction, type DeployErrorCode,
  type DeployEventInput, type DeployStage,
} from "./deploy-events";
import { checkDeployResources } from "./deploy-resources";
import { ComposeProject } from "./docker";
import { probeComputerCapabilities } from "./engine/computer-capabilities";
import { ExternalEngine } from "./engine/external";
import { hasImageSources, imageSourcesPath, pullDeploymentImage, rankImageSources, registrySources } from "./engine/image-sources";
import { managedEngine, selectEngine } from "./engine/select";
import { ManagedEngine } from "./engine/managed";
import { EngineError } from "./engine/types";
import { clearDeployState, writeDeployState } from "./deploy-state";
import { CliError } from "./errors";
import { checkHealth, type HealthResult } from "./health";
import { cliTranslate } from "./localization";
import { runStreaming, type CommandRunner } from "./process";
import { downloadRelease, ReleaseVerificationError } from "./release";
import { validateOwnerPassword, validateOwnerUsername } from "./setup-values";
import { findPortConflict, portRequirementsFromEnvironment, runningServices } from "./stack";
import { ensureUpdateAgent } from "./update-agent";
import { acquireUpdateLock } from "./update-safety";
import { assertNoEngineRecovery } from "./engine/upgrade-transaction";

type ResourceOverrides = Pick<Parameters<typeof checkDeployResources>[0], "diskBytes" | "hostMemoryBytes" | "findConflict">;
interface BootstrapDependencies extends Partial<ResourceOverrides> {
  signal?: AbortSignal;
  write?: (line: string) => unknown;
  readInput?: () => Promise<string>;
  download?: typeof downloadRelease;
  stream?: typeof runStreaming;
  rankSources?: typeof rankImageSources;
  health?: (paths: InstallationPaths, version: string) => Promise<HealthResult>;
  enableUpdates?: (paths: InstallationPaths) => void;
  managed?: ManagedEngine | null;
  platform?: NodeJS.Platform;
}

type Field = "username" | "password" | "apiPort" | "stdin";
const nonRetryable = new Set<DeployErrorCode>([
  "VIRTUALIZATION_DISABLED", "WSL_NOT_ENABLED", "REBOOT_REQUIRED", "WINDOWS_UNSUPPORTED",
  "MACOS_UNSUPPORTED", "ENGINE_UNAVAILABLE", "ENGINE_INCOMPATIBLE", "ASSET_VERIFICATION_FAILED",
]);

class BootstrapError extends Error {
  constructor(readonly code: DeployErrorCode, message?: string, readonly field?: Field, readonly action?: DeployAction) {
    super(message);
  }
}

const invalid = (field?: Field) => new BootstrapError("INVALID_INPUT", cliTranslate("The deployment input is invalid."), field);

export const watchBootstrapCancellation = (marker: string | undefined, controller: AbortController) => {
  if (!marker) return () => undefined;
  const check = () => { if (existsSync(marker)) controller.abort(); };
  check();
  const timer = setInterval(check, 100);
  timer.unref();
  return () => clearInterval(timer);
};

const readInput = async (signal?: AbortSignal): Promise<string> => {
  if (process.stdin.isTTY) throw invalid("stdin");
  const chunks: Buffer[] = [];
  let size = 0;
  const stop = () => process.stdin.destroy();
  const timer = setTimeout(stop, 1_500);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 4_096) throw invalid("stdin");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    throw invalid("stdin");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
};

const ownerInput = (text: string): { username: string; password: string } => {
  let input;
  try { input = JSON.parse(text); } catch { throw invalid("stdin"); }
  if (input?.schemaVersion !== 1 || !input.owner || typeof input.owner !== "object") throw invalid("stdin");
  let username: string;
  let password: string;
  try {
    if (typeof input.owner.username !== "string") throw invalid("username");
    username = validateOwnerUsername(input.owner.username);
  } catch { throw invalid("username"); }
  try {
    if (typeof input.owner.password !== "string") throw invalid("password");
    password = validateOwnerPassword(input.owner.password);
  } catch { throw invalid("password"); }
  return { username, password };
};

const localEnvironment = (version: string, apiPort: number, guestMemoryBytes: number | null): string => {
  let text = createEnvironment({ version, guestMemoryBytes });
  text = replaceEnvironmentValue(text, "OUTCOMEGO_API_PORT", String(apiPort));
  text = replaceEnvironmentValue(text, "OUTCOMEGO_VIEWER_PORT_START", String(VIEWER_PORT_START));
  text = replaceEnvironmentValue(text, "OUTCOMEGO_VIEWER_PORT_END", String(VIEWER_PORT_END));
  for (const key of ["OUTCOMEGO_PUBLIC_URL", "OUTCOMEGO_AUTH_URL"])
    text = replaceEnvironmentValue(text, key, `http://127.0.0.1:${apiPort}`);
  return text;
};

const canonicalDirectory = (directory: string): string => {
  let path = directory;
  try { path = realpathSync(directory); } catch {}
  return process.platform === "win32" ? path.toLowerCase() : path;
};

const releaseImages = (project: ComposeProject): { computer: string; images: Map<string, string[]> } => {
  try {
    const result = project.run(["config", "--format", "json"], { timeoutMs: 10_000, useImageSources: false });
    if (result.status !== 0) throw new Error();
    const services = JSON.parse(result.stdout).services as Record<string, { image?: unknown; profiles?: string[] }>;
    const computer = services.computer?.image;
    if (typeof computer !== "string" || !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(computer)) throw new Error();
    const enabled = new Set((parseEnvironment(readFileSync(project.paths.environment, "utf8")).get("COMPOSE_PROFILES") || "").split(","));
    const images = new Map<string, string[]>();
    for (const [service, configuration] of Object.entries(services)) {
      if (configuration.profiles?.length && !configuration.profiles.some((profile) => enabled.has(profile))) continue;
      if (typeof configuration.image !== "string" || !configuration.image || !/^[a-z0-9][a-z0-9._-]*$/i.test(service)) throw new Error();
      const names = images.get(configuration.image) ?? [];
      names.push(service);
      images.set(configuration.image, names);
    }
    return { computer, images };
  } catch {
    throw new BootstrapError("ASSET_VERIFICATION_FAILED", cliTranslate("The verified release does not specify valid deployment images."));
  }
};

const awaitHealth = async (paths: InstallationPaths, version: string, signal?: AbortSignal) => {
  const deadline = Date.now() + 30_000;
  let result = await checkHealth(paths, version);
  while (!result.ok && !signal?.aborted && Date.now() < deadline) {
    await sleep(500, undefined, { signal });
    result = await checkHealth(paths, version);
  }
  return result;
};

export const bootstrapCommand = async (
  paths: InstallationPaths,
  options: Pick<CliOptions, "version" | "apiPort" | "engine" | "acceptLowMemory">,
  runner: CommandRunner,
  dependencies: BootstrapDependencies = {}
): Promise<number> => {
  const { signal, write } = dependencies;
  let stage: DeployStage = "detect";
  let owner: ReturnType<typeof ownerInput> | undefined;
  let log: ReturnType<typeof createDeployLog> | undefined;
  let releaseLock: (() => void) | undefined;
  let project: ComposeProject | undefined;
  let fresh = false;
  let startAttempted = false;
  const originals = new Map<string, string | null>();
  const logSecrets: string[] = [];
  const emit = (event: DeployEventInput) => emitDeployEvent(event, { write, secretValues: owner?.password ? [owner.password] : [] });
  const record = (message: string) => {
    log?.write(message);
    emit({ type: "log", stage, message });
  };
  const cancelled = () => { if (signal?.aborted) throw new BootstrapError("CANCELLED"); };
  const step = async <Result>(name: DeployStage, work: () => Result | Promise<Result>): Promise<Result> => {
    stage = name;
    cancelled();
    emit({ type: "stage", stage, status: "started" });
    const result = await work();
    cancelled();
    emit({ type: "stage", stage, status: "completed" });
    return result;
  };
  const skip = (name: DeployStage) => emit({ type: "stage", stage: name, status: "skipped" });
  const save = (path: string, contents: string) => {
    if (fresh && !originals.has(path)) originals.set(path, existsSync(path) ? readFileSync(path, "utf8") : null);
    writeFileAtomic(path, contents);
  };
  const compose = async (args: string[], code: DeployErrorCode, input?: string, useImageSources = true) => {
    cancelled();
    const invocation = project!.invocation(args, undefined, useImageSources);
    const pending = (dependencies.stream ?? runStreaming)(invocation.command, invocation.args, {
      cwd: invocation.cwd, env: invocation.env, signal, input,
      ...(input === undefined ? { onStdoutLine: record, onStderrLine: record } : {}),
    });
    input = undefined;
    const result = await pending;
    if (result.status === 130 || signal?.aborted) throw new BootstrapError("CANCELLED");
    if (result.status !== 0) throw new BootstrapError(code);
  };
  try {
    cancelled();
    emit({ type: "log", message: cliTranslate("Preparing local deployment.") });
    owner = ownerInput(await (dependencies.readInput?.() ?? readInput(signal)));
    const expectedCliVersion = process.env[DESKTOP_CLI_VERSION_ENV];
    if (expectedCliVersion !== undefined) {
      try { verifyDesktopCliVersion(expectedCliVersion, CLI_VERSION); }
      catch { throw new BootstrapError("CLI_VERSION_MISMATCH", cliTranslate("The desktop app requires a compatible CLI version.")); }
    }
    let version: string;
    try { version = normalizeVersion(options.version ?? CLI_VERSION); } catch { throw invalid(); }
    const apiPort = Number(options.apiPort ?? API_PORT);
    if ((options.apiPort !== undefined && !/^\d+$/.test(options.apiPort)) || apiPort < 1 || apiPort > 65_535) throw invalid("apiPort");
    const requested = options.engine ?? "auto";
    if (requested !== "auto" && requested !== "external" && requested !== "managed") throw invalid();
    try { releaseLock = acquireUpdateLock(paths); }
    catch (error) {
      if (error instanceof CliError) throw new BootstrapError("BUSY", error.message);
      throw error;
    }
    assertNoEngineRecovery(paths);
    const existing = readManifest(paths);
    if (existing && !installationExists(paths)) throw new BootstrapError("UNKNOWN", cliTranslate("Some installation files are missing."));
    fresh = !existing;
    const complete = Boolean(existing?.ownerUsername);
    const external = new ExternalEngine(runner);
    const managed = dependencies.managed === null ? undefined : dependencies.managed ?? managedEngine(paths, runner, dependencies.platform);
    const projectName = normalizeProjectName(existing?.projectName || PROJECT_NAME);
    let environment = existing ? readFileSync(paths.environment, "utf8") : "";
    let manifest = existing;
    const engine = await step("detect", async () => {
      let selected;
      try { selected = await selectEngine(external, { platform: dependencies.platform, recorded: existing?.engine.kind, requested, managed, requireLocalExternal: () => external.isLocal() }); }
      catch (error) { throw new BootstrapError("ENGINE_UNAVAILABLE", (error as Error).message); }
      const detection = await selected.detect();
      if (detection.code || detection.state === "unsupported") {
        const code = detection.code ?? "ENGINE_INCOMPATIBLE";
        const awaiting = code === "WSL_NOT_ENABLED" ? "elevation" : code === "REBOOT_REQUIRED" ? "reboot" : undefined;
        if (awaiting) writeDeployState(paths, { awaiting, ownerUsername: owner!.username });
        throw new BootstrapError(code, detection.reasons.join(" "), undefined, awaiting ? { kind: awaiting === "reboot" ? "reboot" : "elevate" } : undefined);
      }
      if (selected.kind === "external" && detection.state !== "ready") {
        const message = detection.reasons.join(" ");
        throw new BootstrapError("ENGINE_UNAVAILABLE", message, undefined, { kind: "install-engine", detail: message });
      }
      if (selected.kind === "external" && !external.isLocal()) {
        throw new BootstrapError("ENGINE_UNAVAILABLE", cliTranslate("Local deployment requires a local Docker socket or named pipe."));
      }
      if (selected === external || selected instanceof ManagedEngine && detection.state === "ready") {
        const command = (selected as ExternalEngine).probeCompose({ timeoutMs: 10_000 }).command;
        if (!command?.supported) throw new BootstrapError("ENGINE_UNAVAILABLE");
        project = new ComposeProject(paths, command, runner, projectName, selected);
      }
      if (!existing) environment = localEnvironment(version, apiPort, selected.memoryBytes());
      const values = parseEnvironment(environment);
      if (values.get("OUTCOMEGO_BIND_HOST") !== "127.0.0.1" || values.get("OUTCOMEGO_VIEWER_BIND_HOST") !== "127.0.0.1") {
        throw new BootstrapError("INVALID_INPUT", cliTranslate("Local deployment requires loopback bindings."));
      }
      if (!complete) {
        if (!existing && apiPort >= VIEWER_PORT_START && apiPort <= VIEWER_PORT_END) {
          const message = cliTranslate("Choose an API port outside the screen-viewer port range.");
          throw new BootstrapError("PORT_IN_USE", message, undefined, { kind: "free-port", detail: message });
        }
        const conflict = () => findPortConflict(runner, portRequirementsFromEnvironment(values, existing && project ? runningServices(project) : new Set()));
        const issue = await checkDeployResources({
          directory: paths.directory, apiPort: Number(values.get("OUTCOMEGO_API_PORT") ?? API_PORT),
          guestMemoryBytes: selected.memoryBytes(), acceptLowMemory: options.acceptLowMemory,
          findConflict: dependencies.findConflict ?? conflict,
          diskBytes: dependencies.diskBytes, hostMemoryBytes: dependencies.hostMemoryBytes,
        });
        if (issue) throw new BootstrapError(issue.code, issue.message, undefined, issue.action);
      }
      logSecrets.push(owner!.password);
      log = createDeployLog(paths.directory, new Date(), logSecrets);
      return selected;
    });
    if (engine instanceof ManagedEngine) {
      await step("engine", async () => {
        await engine.ensureReady(record, { apiPort: Number(parseEnvironment(environment).get("OUTCOMEGO_API_PORT") ?? API_PORT), signal });
        if (!existing) environment = localEnvironment(version, apiPort, engine.memoryBytes());
        if (!complete) {
          const issue = await checkDeployResources({ directory: paths.directory, apiPort, guestMemoryBytes: engine.memoryBytes(),
            acceptLowMemory: options.acceptLowMemory, findConflict: async () => null,
            diskBytes: dependencies.diskBytes, hostMemoryBytes: dependencies.hostMemoryBytes });
          if (issue) throw new BootstrapError(issue.code, issue.message, undefined, issue.action);
        }
        const command = engine.probeCompose({ timeoutMs: 10_000 }).command;
        if (!command?.supported) throw new BootstrapError("ENGINE_UNAVAILABLE");
        project = new ComposeProject(paths, command, runner, projectName, engine);
      });
    } else skip("engine");
    {
      const containers = engine.docker([
        "ps", "--all", "--filter", `label=com.docker.compose.project=${projectName}`,
        "--format", '{{.Label "com.docker.compose.project.working_dir"}}|{{.ID}}',
      ], { timeoutMs: 10_000 });
      if (containers.status !== 0) throw new BootstrapError("ENGINE_UNAVAILABLE");
      const directory = engine instanceof ManagedEngine ? engine.guestPath(paths.directory) : canonicalDirectory(paths.directory);
      if (containers.stdout.trim().split(/\r?\n/).filter(Boolean).some((line) =>
        !line.includes("|") || (engine instanceof ManagedEngine ? line.slice(0, line.lastIndexOf("|")) : canonicalDirectory(line.slice(0, line.lastIndexOf("|")))) !== directory)) {
        throw new BootstrapError("PORT_IN_USE", cliTranslate("The Compose project name is already used by another installation."));
      }
    }
    if (complete) {
      skip("release");
      skip("configure");
      skip("pull");
    } else {
      const release = fresh ? await step("release", async () => {
        try { return await (dependencies.download ?? downloadRelease)({ repository: DEFAULT_REPOSITORY, version, signal }); }
        catch (error) {
          throw new BootstrapError(error instanceof ReleaseVerificationError ? "ASSET_VERIFICATION_FAILED" : "ASSET_DOWNLOAD_FAILED", (error as Error).message);
        }
      }) : null;
      if (!release) skip("release");
      if (release) {
        await step("configure", () => {
          save(paths.compose, release.compose);
          save(paths.environment, environment);
          const now = new Date().toISOString();
          manifest = { schemaVersion: 1, repository: DEFAULT_REPOSITORY, version, composeUrl: release.composeUrl,
            installedAt: now, updatedAt: now, projectName, engine: { ...engine.describe(), createdAt: now } };
        });
      } else skip("configure");
      const { computer, images } = releaseImages(project!);
      const probe = (reference: string) => {
        const capability = probeComputerCapabilities(engine, reference);
        if (capability.state === "incompatible") throw new BootstrapError("ENGINE_INCOMPATIBLE",
          cliTranslate("The engine is missing required capabilities: {capabilities}.", { capabilities: capability.missing.join(", ") }));
        if (capability.state === "failed") throw new BootstrapError("ENGINE_START_FAILED", cliTranslate("The engine capability probe could not finish."));
        return capability.state;
      };
      const cached = probe(computer) === "passed";
      await step("pull", async () => {
        let current = 0;
        let computerReference = computer;
        const overrides: Record<string, { image: string }> = Object.create(null);
        for (const [image, services] of images) {
          if (image !== computer || !cached) {
            const [official] = engine instanceof ManagedEngine ? registrySources(image) : [];
            if (engine instanceof ManagedEngine && official) {
              const selected = await pullDeploymentImage(image, {
                signal, rank: dependencies.rankSources ?? rankImageSources,
                cached: reference => engine.docker(["image", "inspect", "--format", "{{.Id}}", reference], { timeoutMs: 10_000 }).status === 0,
                pull: async reference => {
                  const mirrored = reference !== image;
                  const registry = mirrored ? reference.split("/", 1)[0]! : official.registry;
                  record(cliTranslate("Pulling {service} from {registry}.", { service: services[0]!, registry }));
                  const invocation = mirrored ? engine.pullInvocation(reference) : project!.invocation(["pull", services[0]!], undefined, false);
                  const deadline = mirrored ? AbortSignal.timeout(30 * 60_000) : undefined;
                  const pullSignal = signal && deadline ? AbortSignal.any([signal, deadline]) : signal ?? deadline;
                  const result = await (dependencies.stream ?? runStreaming)(invocation.command, invocation.args, {
                    cwd: invocation.cwd, env: invocation.env, signal: pullSignal,
                    onStdoutLine: record, onStderrLine: record,
                  });
                  cancelled();
                  if (result.status === 130 && !deadline?.aborted) throw new BootstrapError("CANCELLED");
                  if (result.status === 0) return true;
                  record(cliTranslate("Image pull failed from {registry}.", { registry }));
                  return false;
                },
              });
              if (!selected) throw new BootstrapError("IMAGE_PULL_FAILED");
              if (image === computer) computerReference = selected;
              if (selected !== image) for (const service of services) overrides[service] = { image: selected };
            } else await compose(["pull", services[0]!], "IMAGE_PULL_FAILED", undefined, false);
          }
          emit({ type: "stage", stage, status: "progress", current: ++current, total: images.size });
        }
        if (!cached && probe(computerReference) !== "passed") throw new BootstrapError("IMAGE_PULL_FAILED", cliTranslate("The pulled computer image is not available by its verified digest."));
        if (engine instanceof ManagedEngine) {
          const path = imageSourcesPath(paths.compose);
          if (Object.keys(overrides).length || hasImageSources(path)) save(path, JSON.stringify({ services: overrides }));
        }
      });
    }
    await step("start", () => {
      startAttempted = true;
      return compose(["up", "--detach", "--wait", "--wait-timeout", "180"], "STACK_START_FAILED");
    });
    await step("health", async () => {
      const health = await (dependencies.health ?? ((paths, version) => awaitHealth(paths, version, signal)))(paths, manifest!.version);
      if (!health.ok) throw new BootstrapError("HEALTH_TIMEOUT", health.detail);
    });
    const username = manifest!.ownerUsername ?? owner.username;
    if (complete) skip("owner");
    else await step("owner", async () => {
      const pending = compose(["exec", "--no-TTY", "server", "bun", "main.js", "owner-credentials"],
        "OWNER_CREATE_FAILED", JSON.stringify({ operation: "setup", username, password: owner!.password }));
      owner = undefined;
      logSecrets.length = 0;
      await pending;
    });
    if (!complete || manifest!.uninstalledAt) {
      if (fresh) originals.set(paths.manifest, null);
      writeManifest(paths, { ...manifest!, ownerUsername: username, uninstalledAt: undefined });
    }
    clearDeployState(paths);
    try { (dependencies.enableUpdates ?? ensureUpdateAgent)(paths); }
    catch { emit({ type: "log", message: cliTranslate("Automatic server updates could not be enabled.") }); }
    const port = parseEnvironment(environment).get("OUTCOMEGO_API_PORT") ?? API_PORT;
    emit({ type: "result", result: { url: `http://127.0.0.1:${port}`, username, directory: paths.directory, engine: engine.kind, version: manifest!.version } });
    return 0;
  } catch (cause) {
    if (fresh && releaseLock) {
      if (project && startAttempted) project.run(["down"], { timeoutMs: 30_000 });
      for (const [file, original] of originals) {
        if (original === null) rmSync(file, { force: true });
        else writeFileAtomic(file, original);
      }
    }
    const error = signal?.aborted ? new BootstrapError("CANCELLED") : cause instanceof BootstrapError ? cause :
      cause instanceof EngineError ? new BootstrapError(cause.code, cause.detail) : new BootstrapError("UNKNOWN");
    const { code, field, action } = error;
    log?.write(`${stage}: ${code}`);
    if (error.message) log?.write(error.message);
    if (action) emit({ type: "action-required", action });
    emit({ type: "stage", stage, status: "failed" });
    emit({ type: "error", stage, code, retryable: !nonRetryable.has(code), message: error.message || deployErrorText(code), field, action });
    return deployErrorExitCodes[code];
  } finally {
    logSecrets.length = 0;
    try { log?.close(); } finally { releaseLock?.(); }
  }
};
