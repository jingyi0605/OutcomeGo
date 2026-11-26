import { existsSync } from "node:fs";
import type { InstallationPaths } from "./config";
import { PROJECT_NAME } from "./constants";
import {
  ADDRESS_POOLS_EXHAUSTED,
  addressPoolsExhausted,
  ExternalEngine,
  MINIMUM_COMPOSE_VERSION,
} from "./engine/external";
import { EngineError, type ComposeCommand, type EngineProvider } from "./engine/types";
import { externalComposeAdvice } from "./engine/external-guidance";
import { requireRecordedEngine } from "./engine/select";
import { CliError } from "./errors";
import type { CommandRunner, RunResult } from "./process";

export { composeProcessEnvironment, findCompose, MINIMUM_COMPOSE_VERSION } from "./engine/external";
export type { ComposeCommand } from "./engine/types";

export const DOCKER_OUTPUT_HINT = "see the Docker output above";

const usefulFailure = (result: RunResult): string =>
  result.stderr.trim() ||
  result.stdout.trim() ||
  result.error?.message ||
  `command failed; ${DOCKER_OUTPUT_HINT}`;

export const ADDRESS_POOLS_EXHAUSTED_ADVICE =
  "Docker has no free subnets left for new networks. Remove unused networks with `docker network prune`, " +
  "or, if a VPN or cloud network route overlaps Docker's 172.17-31.x / 192.168.x defaults (check `ip route`), " +
  'set a non-overlapping pool in /etc/docker/daemon.json, e.g. {"default-address-pools":[{"base":"10.200.0.0/16","size":24}]}, ' +
  "restart Docker, and try again.";

export class ComposeProject {
  constructor(
    readonly paths: InstallationPaths,
    readonly command: ComposeCommand,
    private readonly runner: CommandRunner,
    readonly projectName = PROJECT_NAME,
    readonly engine: EngineProvider = new ExternalEngine(runner)
  ) {}

  invocation(args: readonly string[], composeFile = this.paths.compose, useImageSources = true) {
    if (!existsSync(composeFile)) throw new CliError(`Compose file not found: ${composeFile}`);
    const localComposeFile =
      composeFile === this.paths.compose && existsSync(this.paths.localCompose)
        ? this.paths.localCompose
        : undefined;
    return this.engine.composeInvocation(
      {
        paths: this.paths,
        projectName: this.projectName,
        command: this.command,
        composeFile,
        useImageSources,
        localComposeFile,
      },
      args
    );
  }

  run(
    args: readonly string[],
    options: {
      inherit?: boolean;
      composeFile?: string;
      useImageSources?: boolean;
      input?: string;
      inputFile?: string;
      outputFile?: string;
      timeoutMs?: number;
    } = {}
  ): RunResult {
    const invocation = this.invocation(args, options.composeFile, options.useImageSources);
    return this.runner.run(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      inherit: options.inherit,
      input: options.input,
      inputFile: options.inputFile,
      outputFile: options.outputFile,
      timeoutMs: options.timeoutMs,
    });
  }

  runOrThrow(
    args: readonly string[],
    options: { inherit?: boolean; composeFile?: string; input?: string; inputFile?: string } = {}
  ): void {
    const result = this.run(args, options);
    if (result.status !== 0) {
      // Ctrl-C reaches Docker Compose too; it stops and exits 130.
      if (result.status === 130) throw new CliError("Docker Compose was interrupted.", 130);
      const exhausted = options.inherit
        ? args[0] === "up" && addressPoolsExhausted(this.engine)
        : `${result.stderr}${result.stdout}`.includes(ADDRESS_POOLS_EXHAUSTED);
      if (exhausted) throw new CliError(ADDRESS_POOLS_EXHAUSTED_ADVICE);
      throw new CliError(`Docker Compose failed: ${usefulFailure(result)}`);
    }
  }
}

export const requireComposeProject = (
  paths: InstallationPaths,
  runner: CommandRunner,
  projectName = PROJECT_NAME
): ComposeProject => {
  const engine = requireRecordedEngine(paths, runner);
  if (engine.kind !== "external" && !engine.isLocal()) throw new EngineError("ENGINE_UNAVAILABLE");
  const compose = engine.probeCompose().command;
  if (!compose) {
    throw new CliError(
      `Docker Compose is not available. ${externalComposeAdvice(MINIMUM_COMPOSE_VERSION)}`
    );
  }
  if (!compose.supported) {
    throw new CliError(
      `OutcomeGo requires Docker Compose ${MINIMUM_COMPOSE_VERSION} or newer; found ${compose.version || "an unknown version"}. ${externalComposeAdvice(MINIMUM_COMPOSE_VERSION)}`
    );
  }
  return new ComposeProject(paths, compose, runner, projectName, engine);
};
