import { existsSync, readFileSync } from "node:fs";
import semver from "semver";
import { parseEnvironment, type InstallationPaths } from "../config";
import { CliError } from "../errors";
import { cliTranslate } from "../localization";
import type { CommandRunner, RunOptions, RunResult } from "../process";
import { startExternalDockerDesktop } from "./external-preflight";
import { externalEngineStartAdvice } from "./external-guidance";
import type { ComposeCommand, ComposeTarget, EngineDetection, EngineInfo, EngineKind, EngineProvider } from "./types";

export const MINIMUM_COMPOSE_VERSION = "2.20.0";
export const ADDRESS_POOLS_EXHAUSTED = "all predefined address pools have been fully subnetted";

export const composeProcessEnvironment = (
  paths: InstallationPaths,
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv => {
  const environment = { ...inherited };
  if (!existsSync(paths.environment)) return environment;
  for (const key of parseEnvironment(readFileSync(paths.environment, "utf8")).keys()) {
    delete environment[key];
  }
  return environment;
};

interface DockerInfo {
  ServerVersion?: string;
  CgroupVersion?: string;
  MemTotal?: number;
  OSType?: string;
  SecurityOptions?: string[];
}

export class ExternalEngine implements EngineProvider {
  readonly kind: EngineKind = "external";
  private info: DockerInfo = {};

  constructor(protected readonly runner: CommandRunner) {}

  docker(args: readonly string[], options?: RunOptions): RunResult {
    return this.runner.run("docker", args, options);
  }

  version(): RunResult {
    return this.docker(["--version"]);
  }

  daemon(): RunResult {
    return this.docker(["info", "--format", "{{.ServerVersion}}"]);
  }

  isLocal(environment: NodeJS.ProcessEnv = process.env): boolean {
    const context = environment.DOCKER_CONTEXT?.trim();
    let endpoint = context ? undefined : environment.DOCKER_HOST?.trim();
    if (!endpoint) {
      const result = this.docker([
        "context", "inspect", "--format", "{{.Endpoints.docker.Host}}", ...(context ? [context] : []),
      ], { timeoutMs: 5_000 });
      if (result.status !== 0) return false;
      endpoint = result.stdout.trim();
    }
    return /^unix:\/\/\/(?!\/)/.test(endpoint) || /^npipe:\/\/\/\/\.\/pipe\//i.test(endpoint);
  }

  probeCompose(options?: RunOptions): {
    command: ComposeCommand | null;
    failures: Array<{ command: string; result: RunResult }>;
  } {
    const command = (executable: string, prefix: readonly string[], version: string) => {
      const parsed = semver.coerce(version);
      return {
        executable,
        prefix,
        version,
        supported: Boolean(parsed && semver.gte(parsed, MINIMUM_COMPOSE_VERSION)),
      };
    };
    const plugin = this.docker(["compose", "version"], options);
    if (plugin.status === 0) {
      return { command: command("docker", ["compose"], plugin.stdout.trim()), failures: [] };
    }
    if (this.kind !== "external") return { command: null, failures: [{ command: "docker compose version", result: plugin }] };
    const standalone = this.runner.run("docker-compose", ["version"], options);
    if (standalone.status === 0) {
      return { command: command("docker-compose", [], standalone.stdout.trim()), failures: [] };
    }
    return {
      command: null,
      failures: [
        { command: "docker compose version", result: plugin },
        { command: "docker-compose version", result: standalone },
      ],
    };
  }

  async detect(): Promise<EngineDetection> {
    this.info = {};
    const options = { timeoutMs: 10_000, killSignal: "SIGKILL" } as const;
    const cli = this.docker(["--version"], options);
    if (cli.status !== 0) {
      return {
        state: "needs-setup",
        reasons: [cliTranslate("Install or repair a Docker-compatible container engine and its CLI.")],
      };
    }
    const info = this.docker(["info", "--format", "{{json .}}"], options);
    if (info.status !== 0) {
      return {
        state: "stopped",
        reasons: [
          externalEngineStartAdvice(`${info.stderr}\n${info.stdout}`) ??
          cliTranslate("Start your container engine or check the current Docker connection."),
        ],
      };
    }
    try {
      const parsed = JSON.parse(info.stdout);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.info = parsed;
    } catch {
      return {
        state: "unsupported",
        reasons: [cliTranslate("The container engine did not report its capabilities as JSON.")],
      };
    }
    const compose = this.probeCompose(options).command;
    const reasons: string[] = [];
    if (!compose?.supported) {
      reasons.push(cliTranslate("Install or update Compose to {version} or newer.", { version: MINIMUM_COMPOSE_VERSION }));
    }
    if (this.info.OSType !== "linux") {
      reasons.push(cliTranslate("The container engine must report Linux container support."));
    }
    if (String(this.info.CgroupVersion) !== "2") {
      reasons.push(cliTranslate("The container engine must report cgroup v2 support."));
    }
    if (Array.isArray(this.info.SecurityOptions) && this.info.SecurityOptions.includes("name=rootless")) {
      reasons.push(cliTranslate("OutcomeGo requires a rootful container engine."));
    }
    return {
      state: reasons.length ? "unsupported" : "ready",
      reasons,
      engineVersion: typeof this.info.ServerVersion === "string" ? this.info.ServerVersion : undefined,
      composeVersion: semver.coerce(compose?.version)?.version,
      cgroupVersion: typeof this.info.CgroupVersion === "string" ? this.info.CgroupVersion : undefined,
      memoryBytes: this.memoryBytes() ?? undefined,
    };
  }

  async ensureReady(onEvent?: (message: string) => void, _options?: Parameters<EngineProvider["ensureReady"]>[1]): Promise<void> {
    const current = await this.detect();
    if (current.state === "ready") return;
    const started =
      (current.state === "stopped" || current.state === "needs-setup") &&
      (await this.startDockerDesktop({
        output: {
          isTTY: true,
          write: (text) => {
            const message = String(text).trim();
            if (message) onEvent?.(message);
            return true;
          },
        },
        animate: false,
      }));
    const result = started === "ready" ? await this.detect() : current;
    if (result.state !== "ready") throw new CliError(result.reasons.join(" "), 2);
  }

  startDockerDesktop(options: Parameters<typeof startExternalDockerDesktop>[1] = {}) {
    return startExternalDockerDesktop(this, {
      ...options,
      open: (application) => this.runner.run("open", ["-a", application]).status === 0,
    });
  }

  composeInvocation(target: ComposeTarget, args: readonly string[]): ReturnType<EngineProvider["composeInvocation"]> {
    const { paths, projectName, command, composeFile } = target;
    return {
      command: command.executable,
      args: [
        ...command.prefix,
        "--project-name", projectName,
        "--project-directory", paths.directory,
        "--env-file", paths.environment,
        "--file", composeFile,
        ...args,
      ],
      cwd: paths.directory,
      env: composeProcessEnvironment(paths),
    };
  }

  memoryBytes(): number | null {
    const value = this.info.MemTotal;
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  describe(): EngineInfo {
    return {
      kind: this.kind,
      name: cliTranslate("Docker-compatible engine"),
      version: typeof this.info.ServerVersion === "string" ? this.info.ServerVersion : undefined,
    };
  }
}

export const dockerDaemon = (runner: CommandRunner): RunResult => new ExternalEngine(runner).daemon();
export const findCompose = (runner: CommandRunner): ComposeCommand | null =>
  new ExternalEngine(runner).probeCompose().command;

export const addressPoolsExhausted = (engine: EngineProvider): boolean => {
  const name = `outcomego-subnet-probe-${process.pid}`;
  const probe = engine.docker(["network", "create", name]);
  if (probe.status === 0) {
    engine.docker(["network", "rm", name]);
    return false;
  }
  return `${probe.stderr}${probe.stdout}`.includes(ADDRESS_POOLS_EXHAUSTED);
};
