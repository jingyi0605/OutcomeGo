import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvironment, readManifest, type InstallationPaths } from "../config";
import { CLI_VERSION } from "../constants";
import { cliTranslate } from "../localization";
import { runStreaming, type CommandRunner, type RunOptions, type RunResult } from "../process";
import { downloadEngineAsset, type EngineAssetLoader } from "./managed-assets";
import { composeProcessEnvironment, ExternalEngine } from "./external";
import { hasImageSources, imageSourcesPath } from "./image-sources";
import { MANAGED_ENGINE_NAME } from "./managed-host";
import { EngineError, type ComposeTarget, type EngineDetection, type EngineKind } from "./types";

export interface ManagedOptions {
  paths: InstallationPaths;
  runner: CommandRunner;
  architecture: NodeJS.Architecture;
  release: string;
  assets?: EngineAssetLoader;
  stream?: typeof runStreaming;
}

export type EngineInvocation = { command: string; args: readonly string[]; env: NodeJS.ProcessEnv };
export type EngineStartOptions = { apiPort?: number; signal?: AbortSignal; assets?: readonly string[] };

export abstract class ManagedEngine extends ExternalEngine {
  abstract override readonly kind: Exclude<EngineKind, "external">;
  protected constructor(protected readonly options: ManagedOptions) { super(options.runner); }
  abstract override ensureReady(onEvent?: (message: string) => void, options?: EngineStartOptions): Promise<void>;
  protected abstract guest(args: readonly string[], cwd?: string): EngineInvocation;
  protected abstract owned(): boolean;
  abstract guestPath(path: string): string;
  abstract stop(): Promise<void>;
  abstract remove(options: { purgeData: boolean }): Promise<void>;
  ensureAutostart(): boolean { return true; }
  removeAutostart(): boolean { return true; }
  protected assetNames: readonly string[] = [];

  async prepareUpgrade(version: string) {
    if (!this.owned() || !this.assetNames.length) throw new EngineError("ENGINE_UNAVAILABLE");
    return this.engineAssets(this.assetNames, undefined, version);
  }

  async checkpoint(_directory: string): Promise<void> { throw new EngineError("ENGINE_UNAVAILABLE"); }
  async replaceEngine(_directory: string): Promise<void> { throw new EngineError("ENGINE_UNAVAILABLE"); }
  async restoreEngine(_directory: string): Promise<void> { throw new EngineError("ENGINE_UNAVAILABLE"); }

  runGuest(args: readonly string[], options: RunOptions) {
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    const invocation = this.guest(args);
    return this.runner.run(invocation.command, invocation.args, { ...options, env: invocation.env });
  }

  override isLocal() { return this.owned(); }

  private dockerArguments(args: readonly string[]) {
    return ["/usr/bin/env", "-u", "DOCKER_CONTEXT", "-u", "DOCKER_HOST", "-u", "DOCKER_TLS_VERIFY", "-u", "DOCKER_CERT_PATH",
      "/usr/bin/docker", "--host=unix:///var/run/docker.sock", ...args];
  }

  override docker(args: readonly string[], options: RunOptions = {}): RunResult {
    if (!this.owned()) return { status: 2, stdout: "", stderr: "ENGINE_UNAVAILABLE" };
    const invocation = this.guest(this.dockerArguments(args));
    return this.runner.run(invocation.command, invocation.args, { timeoutMs: options.inherit ? 0 : 15_000, ...options, env: invocation.env });
  }

  pullInvocation(reference: string) {
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    return { ...this.guest(this.dockerArguments(["image", "pull", reference])), cwd: this.options.paths.directory };
  }

  override composeInvocation({ paths, projectName, composeFile, useImageSources }: ComposeTarget, args: readonly string[]) {
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    if (existsSync(paths.environment)) {
      const values = parseEnvironment(readFileSync(paths.environment, "utf8"));
      if (values.get("OUTCOMEGO_BIND_HOST") !== "127.0.0.1" || values.get("OUTCOMEGO_VIEWER_BIND_HOST") !== "127.0.0.1" ||
        (values.get("OUTCOMEGO_ACCESS_MODE") ?? "local") !== "local") {
        throw new EngineError("INVALID_INPUT", cliTranslate("Local deployment requires loopback bindings."));
      }
    }
    const directory = this.guestPath(paths.directory);
    const sources = useImageSources && composeFile === paths.compose ? imageSourcesPath(composeFile) : undefined;
    const invocation = this.guest(this.dockerArguments([
      "compose", "--project-name", projectName, "--project-directory", directory,
      "--env-file", this.guestPath(paths.environment), "--file", this.guestPath(composeFile),
      ...(sources && hasImageSources(sources) ? ["--file", this.guestPath(sources)] : []), ...args,
    ]), directory);
    return { ...invocation, cwd: paths.directory, env: { ...composeProcessEnvironment(paths), ...invocation.env } };
  }

  protected engineAssets(filenames: readonly string[], signal?: AbortSignal, version = CLI_VERSION) {
    const directory = join(this.options.paths.directory, "engine", "assets", version);
    for (const path of [this.options.paths.directory, join(this.options.paths.directory, "engine"), join(directory, ".."), directory]) {
      const entry = lstatSync(path, { throwIfNoEntry: false });
      if (entry && !entry.isDirectory()) throw new EngineError("ENGINE_UNAVAILABLE");
    }
    return Promise.all(filenames.map(filename => (this.options.assets ?? downloadEngineAsset)(directory, filename, signal, version)));
  }

  protected async invoke(invocation: EngineInvocation, signal?: AbortSignal) {
    const result = await (this.options.stream ?? runStreaming)(invocation.command, invocation.args, { env: invocation.env, signal });
    if (signal?.aborted || result.status === 130) throw new EngineError("CANCELLED");
    if (result.status !== 0) throw new EngineError("ENGINE_START_FAILED");
  }

  protected async waitForDocker(signal?: AbortSignal) {
    const deadline = Date.now() + 60_000;
    do {
      if (signal?.aborted) throw new EngineError("CANCELLED");
      const detection = await super.detect();
      if (detection.state === "ready") return;
      if (detection.state === "unsupported") throw new EngineError("ENGINE_INCOMPATIBLE", detection.reasons.join(" "));
      await sleep(500, undefined, { signal });
    } while (Date.now() < deadline);
    throw new EngineError("ENGINE_START_FAILED");
  }

  protected blocked(code: NonNullable<EngineDetection["code"]>, state: EngineDetection["state"], reason: string): EngineDetection {
    return { state, code, reasons: [reason] };
  }

  protected checkOperation(result: RunResult) {
    if (result.status !== 0) throw new EngineError("ENGINE_START_FAILED");
  }

  override describe() {
    const manifest = readManifest(this.options.paths);
    return { ...super.describe(), name: MANAGED_ENGINE_NAME, assetVersion: manifest ? manifest.engine.assetVersion : CLI_VERSION };
  }
}
