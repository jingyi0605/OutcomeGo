import { readManifest, type InstallationPaths } from "../config";
import { arch, release } from "node:os";
import { CliError } from "../errors";
import { cliTranslate } from "../localization";
import type { CommandRunner } from "../process";
import { ExternalEngine } from "./external";
import { ManagedWslEngine } from "./managed-wsl";
import { ManagedLimaEngine } from "./managed-lima";
import type { EngineKind, EngineProvider } from "./types";

const unavailable = () => new CliError(
  `ENGINE_UNAVAILABLE: ${cliTranslate("The selected container engine is unavailable on this host.")}`,
  2
);

export const recordedEngine = (paths?: InstallationPaths): EngineKind | undefined =>
  paths ? readManifest(paths)?.engine.kind : undefined;

export const managedEngine = (paths: InstallationPaths, runner: CommandRunner, platform = process.platform) => {
  const options = { paths, runner, architecture: arch(), release: release() };
  if (platform === "win32") {
    const arm = [process.env.PROCESSOR_ARCHITEW6432, process.env.PROCESSOR_ARCHITECTURE].some(value => value?.toUpperCase() === "ARM64");
    return new ManagedWslEngine({ ...options, architecture: arm ? "arm64" : options.architecture });
  }
  if (platform === "darwin") return new ManagedLimaEngine(options);
};

export const requireRecordedEngine = (paths: InstallationPaths, runner: CommandRunner, kind = recordedEngine(paths)) => {
  if (kind && kind !== "external") {
    const managed = managedEngine(paths, runner);
    if (managed?.kind !== kind) throw unavailable();
    return managed;
  }
  return new ExternalEngine(runner);
};

export const selectEngine = async (
  external: EngineProvider,
  options: {
    platform?: NodeJS.Platform;
    recorded?: EngineKind;
    requested?: "auto" | "external" | "managed";
    managed?: EngineProvider;
    requireLocalExternal?: () => boolean;
  } = {}
): Promise<EngineProvider> => {
  const { recorded, requested = "auto", platform = process.platform } = options;
  if (recorded && requested !== "auto" && (recorded === "external") !== (requested === "external")) {
    throw new CliError(`ENGINE_UNAVAILABLE: ${cliTranslate("The recorded engine of an existing installation cannot be changed.")}`, 2);
  }
  const managedKind =
    platform === "win32" ? "managed-wsl" : platform === "darwin" ? "managed-lima" : null;
  const managed = options.managed?.kind === managedKind ? options.managed : undefined;
  if (recorded === "external" || (!recorded && requested === "external")) return external;
  if (recorded || requested === "managed") {
    if (managed && (!recorded || recorded === managed.kind)) return managed;
    throw unavailable();
  }
  if (!managed || ((await external.detect()).state === "ready" && (options.requireLocalExternal?.() ?? true))) return external;
  return managed;
};
