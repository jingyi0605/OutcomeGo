import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { writeFileAtomic, type InstallationPaths } from "../config";
import { cliTranslate } from "../localization";
import { EngineError } from "./types";

type Phase = "quiescing" | "replacing";
type Recovery = { phase: Phase; backup: string };
export interface EngineUpgradeOperations {
  prepare(): Promise<void>;
  backup(directory: string): Promise<void>;
  replace(directory: string): Promise<void>;
  verify(): Promise<void>;
  restore(directory: string, phase: Phase): Promise<void>;
}

const journal = (paths: InstallationPaths) => join(paths.directory, "engine-recovery.json");
const recoveryRequired = () => new EngineError("BUSY", cliTranslate("Engine recovery is pending. Run outcomego engine rollback --yes for this installation."));
export const assertNoEngineRecovery = (paths: InstallationPaths) => {
  if (lstatSync(journal(paths), { throwIfNoEntry: false })) throw recoveryRequired();
};

export const runEngineUpgrade = async (paths: InstallationPaths, operations: EngineUpgradeOperations, rollback: boolean) => {
  const file = journal(paths);
  if (rollback) {
    if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) throw new EngineError("INVALID_INPUT");
    const state: Recovery = JSON.parse(readFileSync(file, "utf8"));
    if (!state || !/^engine-backup-[a-zA-Z0-9]{6}$/.test(state.backup) || !["quiescing", "replacing"].includes(state.phase)) throw recoveryRequired();
    const backup = join(paths.directory, state.backup);
    if (!lstatSync(backup, { throwIfNoEntry: false })?.isDirectory()) throw recoveryRequired();
    await operations.restore(backup, state.phase);
    rmSync(file);
    return backup;
  }
  assertNoEngineRecovery(paths);
  await operations.prepare();
  const directory = mkdtempSync(join(paths.directory, "engine-backup-"));
  const state: Recovery = { backup: basename(directory), phase: "quiescing" };
  writeFileAtomic(file, JSON.stringify(state));
  try {
    await operations.backup(directory);
    writeFileAtomic(file, JSON.stringify({ ...state, phase: "replacing" }));
    state.phase = "replacing";
    await operations.replace(directory);
    await operations.verify();
  } catch (error) {
    try { await operations.restore(directory, state.phase); }
    catch { throw recoveryRequired(); }
    rmSync(file);
    throw error;
  }
  rmSync(file);
  return directory;
};
