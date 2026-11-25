import type { InstallationPaths } from "../config";
import type { CommandRunner } from "../process";
import { ExternalEngine } from "./external";
import { managedEngine, recordedEngine, requireRecordedEngine, selectEngine } from "./select";
import { EngineError } from "./types";

export const engineStatus = async (runner: CommandRunner, paths?: InstallationPaths, requested?: string) => {
  const external = new ExternalEngine(runner);
  if (requested !== undefined && requested !== "auto" && requested !== "external" && requested !== "managed") throw new EngineError("INVALID_INPUT");
  const engine = paths ? (requested ? await selectEngine(external, { requested, recorded: recordedEngine(paths), managed: managedEngine(paths, runner) }) : requireRecordedEngine(paths, runner)) : external;
  const detection = await engine.detect();
  return { ...detection, engine: engine.describe() };
};
