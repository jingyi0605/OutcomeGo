import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { totalmem } from "node:os";
import { join, relative, sep } from "node:path";
import { ensureDirectory, readManifest, writeFileAtomic } from "../config";
import { API_PORT, VIEWER_PORT_END, VIEWER_PORT_START } from "../constants";
import { cliTranslate } from "../localization";
import { ManagedEngine, type EngineStartOptions, type ManagedOptions } from "./managed";
import { MANAGED_ENGINE_NAME, supportsManagedHost } from "./managed-host";
import { EngineError, type EngineDetection } from "./types";

const entry = (path: string) => lstatSync(path, { throwIfNoEntry: false });
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const runtimeRecord = "outcomego-runtime.sha256";

export const limaConfiguration = (directory: string, image: string, architecture: string, hostMemory: number, apiPort: number) => ({
  vmType: "vz", arch: architecture === "arm64" ? "aarch64" : "x86_64", mountType: "virtiofs",
  memory: `${Math.floor(Math.min(8 * 1024, Math.max(4 * 1024, hostMemory / 2 / 1024 ** 2)))}MiB`,
  images: [{ location: image, arch: architecture === "arm64" ? "aarch64" : "x86_64" }],
  mounts: [{ location: directory, mountPoint: directory, writable: false }],
  containerd: { system: false, user: false },
  portForwards: [
    { guestIP: "127.0.0.1", guestPort: apiPort, hostIP: "127.0.0.1", hostPort: apiPort },
    { guestIP: "127.0.0.1", guestPortRange: [VIEWER_PORT_START, VIEWER_PORT_END], hostIP: "127.0.0.1", hostPortRange: [VIEWER_PORT_START, VIEWER_PORT_END] },
    { guestPortRange: [1, 65535], ignore: true },
  ],
});

export class ManagedLimaEngine extends ManagedEngine {
  override readonly kind = "managed-lima";
  private readonly directory: string;
  private readonly runtime: string;
  private readonly home: string;
  private readonly executable: string;
  protected override assetNames: readonly string[];
  constructor(options: ManagedOptions & { hostMemory?: number }) {
    super(options);
    this.directory = join(options.paths.directory, "engine");
    this.runtime = join(this.directory, "lima-runtime");
    this.home = join(this.directory, "lima");
    this.executable = join(this.runtime, "bin", "limactl");
    this.hostMemory = options.hostMemory ?? totalmem();
    this.assetNames = [`outcomego-engine-darwin-${options.architecture}.tar.gz`, `outcomego-engine-darwin-${options.architecture}.qcow2`];
  }

  private readonly hostMemory: number;
  private get instance() { return join(this.home, MANAGED_ENGINE_NAME); }
  private get owner() { return join(this.home, "outcomego-instance.json"); }
  private get assets() { return join(this.directory, "assets"); }

  private safeDirectories() {
    try {
      return [this.options.paths.directory, this.directory, this.home, this.instance, this.runtime, join(this.runtime, "bin"), this.assets]
        .every(path => entry(path)?.isDirectory() ?? true);
    } catch { return false; }
  }

  private verifiedRuntime() {
    try {
      const record = join(this.runtime, runtimeRecord);
      return entry(this.executable)?.isFile() && entry(record)?.isFile() && readFileSync(record, "utf8") === digest(this.executable);
    } catch { return false; }
  }

  protected override owned() {
    try {
      return supportsManagedHost("darwin", this.options.architecture, this.options.release) &&
        this.safeDirectories() && entry(this.instance)?.isDirectory() === true && entry(this.owner)?.isFile() === true &&
        JSON.parse(readFileSync(this.owner, "utf8")).directory === this.options.paths.directory && this.verifiedRuntime() === true;
    } catch { return false; }
  }

  override guestPath(path: string) {
    const fromInstall = relative(this.options.paths.directory, path);
    if (fromInstall === ".." || fromInstall.startsWith(`..${sep}`)) throw new EngineError("INVALID_INPUT");
    return path;
  }

  private lima(args: readonly string[]) {
    const env = { ...process.env, LIMA_HOME: this.home };
    for (const key of Object.keys(env)) if (/^(?:LIMA_|SSH_|DOCKER_)/.test(key) && key !== "LIMA_HOME") delete (env as NodeJS.ProcessEnv)[key];
    return { command: this.executable, args, env };
  }

  protected override guest(args: readonly string[], cwd?: string) {
    return this.lima(["shell", "--workdir", cwd ?? "/", MANAGED_ENGINE_NAME, "--", "/usr/bin/sudo", "-n", ...args]);
  }

  override async detect(): Promise<EngineDetection> {
    if (!supportsManagedHost("darwin", this.options.architecture, this.options.release)) return this.blocked("MACOS_UNSUPPORTED", "unsupported", cliTranslate("Managed deployment requires macOS 13.5 or later on Apple Silicon or Intel. Use an existing container engine or server instead."));
    if (!this.safeDirectories()) return this.blocked("ENGINE_UNAVAILABLE", "unsupported", cliTranslate("The managed engine could not verify ownership of outcomego-engine."));
    if (!entry(this.instance)) return { state: "needs-setup", reasons: [] };
    if (!this.owned()) return this.blocked("ENGINE_UNAVAILABLE", "unsupported", cliTranslate("The managed engine could not verify ownership of outcomego-engine."));
    const invocation = this.lima(["list", "--json", MANAGED_ENGINE_NAME]);
    const result = this.runner.run(invocation.command, invocation.args, { env: invocation.env, timeoutMs: 10_000 });
    try {
      const snapshot = JSON.parse(result.stdout.trim());
      if (result.status !== 0 || snapshot.name !== MANAGED_ENGINE_NAME || !["Running", "Stopped"].includes(snapshot.status)) throw new Error();
      return snapshot.status === "Running" ? super.detect() : { state: "stopped", reasons: [] };
    } catch { return this.blocked("ENGINE_UNAVAILABLE", "unsupported", cliTranslate("The managed virtual machine could not report its state.")); }
  }

  override async ensureReady(_onEvent?: (message: string) => void, { apiPort, signal, assets }: EngineStartOptions = {}) {
    const detection = await this.detect();
    if (detection.code || detection.state === "unsupported") throw new EngineError(detection.code ?? "ENGINE_INCOMPATIBLE", detection.reasons.join(" "));
    const port = apiPort ?? Number(API_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port >= VIEWER_PORT_START && port <= VIEWER_PORT_END) throw new EngineError("INVALID_INPUT");
    let needsStart = detection.state !== "ready";
    if (detection.state === "needs-setup") {
      const architecture = this.options.architecture;
      if (entry(this.runtime) && !this.verifiedRuntime()) throw new EngineError("ASSET_VERIFICATION_FAILED");
      const [runtime, image] = assets ?? await this.engineAssets(this.assetNames, signal);
      if (!runtime || !image) throw new EngineError("ASSET_VERIFICATION_FAILED");
      if (!entry(this.runtime)) {
        ensureDirectory(this.directory);
        const staged = mkdtempSync(join(this.directory, ".lima-runtime-"));
        try {
          await this.invoke({ command: "/usr/bin/tar", args: ["-xzf", runtime, "-C", staged], env: {} }, signal);
          const binary = join(staged, "bin", "limactl");
          if (!entry(join(staged, "bin"))?.isDirectory() || !entry(binary)?.isFile() || this.runner.run("/usr/bin/codesign", ["--verify", "--strict", binary], { timeoutMs: 15_000 }).status !== 0)
            throw new EngineError("ASSET_VERIFICATION_FAILED");
          writeFileAtomic(join(staged, runtimeRecord), digest(binary));
          renameSync(staged, this.runtime);
        } finally { rmSync(staged, { recursive: true, force: true }); }
      }
      const config = join(this.directory, "lima-config.yaml");
      writeFileAtomic(config, JSON.stringify(limaConfiguration(this.options.paths.directory, image, architecture, this.hostMemory, port)));
      if (entry(this.instance)) throw new EngineError("ENGINE_UNAVAILABLE");
      writeFileAtomic(this.owner, JSON.stringify({ directory: this.options.paths.directory, apiPort: port }));
      await this.invoke(this.lima(["create", "--tty=false", "--name", MANAGED_ENGINE_NAME, config]), signal);
    } else if (apiPort !== undefined) {
      const installedPort = JSON.parse(readFileSync(this.owner, "utf8")).apiPort;
      if (installedPort !== port) {
        if (readManifest(this.options.paths)) throw new EngineError("PORT_IN_USE", cliTranslate("Retry with the original API port: {port}.", { port: installedPort }));
        if (detection.state !== "stopped") await this.invoke(this.lima(["stop", MANAGED_ENGINE_NAME]), signal);
        await this.invoke(this.lima(["edit", "--tty=false", "--set", `.portForwards[0].guestPort = ${port} | .portForwards[0].hostPort = ${port}`, MANAGED_ENGINE_NAME]), signal);
        writeFileAtomic(this.owner, JSON.stringify({ directory: this.options.paths.directory, apiPort: port }));
        needsStart = true;
      }
    }
    if (!needsStart) return;
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    await this.invoke(this.lima(["start", "--tty=false", MANAGED_ENGINE_NAME]), signal);
    await this.waitForDocker(signal);
  }

  override async stop() {
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    await this.invoke(this.lima(["stop", MANAGED_ENGINE_NAME]));
  }

  override async checkpoint() { await this.stop(); }

  override async replaceEngine(directory: string) {
    if (!this.owned() || (await this.detect()).state !== "stopped") throw new EngineError("ENGINE_UNAVAILABLE");
    renameSync(this.home, join(directory, "lima"));
    renameSync(this.runtime, join(directory, "lima-runtime"));
  }

  override async restoreEngine(directory: string) {
    if (!this.safeDirectories()) throw new EngineError("ENGINE_UNAVAILABLE");
    const savedHome = join(directory, "lima");
    const savedRuntime = join(directory, "lima-runtime");
    if (entry(savedHome)) {
      if (!entry(savedHome)?.isDirectory() || (entry(savedRuntime) && !entry(savedRuntime)?.isDirectory())) throw new EngineError("ENGINE_UNAVAILABLE");
      if (entry(this.instance)) {
        const detection = await this.detect();
        if (detection.code) throw new EngineError(detection.code);
        if (detection.state !== "stopped") await this.stop();
      }
      if (entry(this.home)) renameSync(this.home, join(directory, "failed-lima"));
      if (entry(savedRuntime)) {
        if (entry(this.runtime)) renameSync(this.runtime, join(directory, "failed-runtime"));
        renameSync(savedRuntime, this.runtime);
      }
      renameSync(savedHome, this.home);
    }
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
  }

  override async remove({ purgeData }: { purgeData: boolean }) {
    if (!purgeData) throw new EngineError("INVALID_INPUT");
    if (!this.safeDirectories()) throw new EngineError("ENGINE_UNAVAILABLE");
    if (!entry(this.instance)) return;
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    await this.invoke(this.lima(["delete", "--force", MANAGED_ENGINE_NAME]));
  }
}
