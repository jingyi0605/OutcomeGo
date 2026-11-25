import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { installationExists, normalizeProjectName, normalizeVersion, parseEnvironment, readManifest, writeFileAtomic, writeManifest, type InstallationPaths } from "../config";
import { API_PORT, PROJECT_NAME, VIEWER_PORT_END, VIEWER_PORT_START } from "../constants";
import { ComposeProject } from "../docker";
import { checkHealth, waitForHealth } from "../health";
import { acquireUpdateLock } from "../update-safety";
import type { CommandRunner } from "../process";
import { ManagedEngine } from "./managed";
import { EngineError } from "./types";
import { runEngineUpgrade } from "./upgrade-transaction";
import { backupVolumes, restoreVolumes, volumeInventory, type MigratableVolume } from "./volume-migration";

export const upgradeEngineCommand = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  engine: ManagedEngine,
  options: { yes: boolean; version?: string; rollback: boolean },
  health = { check: checkHealth, wait: waitForHealth },
) => {
  let target: string | undefined;
  if (!options.yes || (!options.rollback && !options.version)) throw new EngineError("INVALID_INPUT");
  if (!options.rollback) {
    try { target = normalizeVersion(options.version!); } catch { throw new EngineError("INVALID_INPUT"); }
    if (!semver.valid(target)) throw new EngineError("INVALID_INPUT");
  }
  if (!installationExists(paths) || !lstatSync(paths.directory, { throwIfNoEntry: false })?.isDirectory()) throw new EngineError("ENGINE_UNAVAILABLE");
  let unlock: () => void;
  try { unlock = acquireUpdateLock(paths, options.rollback); }
  catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError("BUSY");
  }
  try {
    const manifest = readManifest(paths);
    if (!manifest?.ownerUsername || manifest.uninstalledAt || manifest.engine.kind !== engine.kind) throw new EngineError("ENGINE_UNAVAILABLE");
    const projectName = normalizeProjectName(manifest.projectName ?? PROJECT_NAME);
    const env = parseEnvironment(readFileSync(paths.environment, "utf8"));
    const port = Number(env.get("OUTCOMEGO_API_PORT") ?? API_PORT);
    if (env.get("OUTCOMEGO_BIND_HOST") !== "127.0.0.1" || env.get("OUTCOMEGO_VIEWER_BIND_HOST") !== "127.0.0.1" || (env.get("OUTCOMEGO_ACCESS_MODE") ?? "local") !== "local" ||
      !Number.isInteger(port) || port < 1 || port > 65535 || (port >= VIEWER_PORT_START && port <= VIEWER_PORT_END)) throw new EngineError("INVALID_INPUT");
    if (target && manifest.engine.assetVersion && (!semver.valid(manifest.engine.assetVersion) || !semver.gt(target, manifest.engine.assetVersion))) throw new EngineError("INVALID_INPUT");

    const compose = (args: readonly string[]) => {
      const command = engine.probeCompose().command;
      if (!command?.supported) throw new EngineError("ENGINE_INCOMPATIBLE");
      const result = new ComposeProject(paths, command, runner, projectName, engine).run(args, { timeoutMs: 30 * 60_000 });
      if (result.status !== 0) throw new EngineError("STACK_START_FAILED");
    };
    const startAndCheck = async () => {
      compose(["up", "--detach", "--wait", "--wait-timeout", "180"]);
      if (!(await health.wait(paths, 60_000, manifest.version)).ok) throw new EngineError("HEALTH_TIMEOUT");
    };
    const docker = engine.docker.bind(engine);
    const guest = engine.runGuest.bind(engine);
    let assets: readonly string[] = [];
    let volumes: MigratableVolume[] = [];
    const versionFile = (directory: string) => join(directory, "previous-engine.json");
    return await runEngineUpgrade(paths, {
      prepare: async () => {
        if (!engine.isLocal() || (await engine.detect()).state !== "ready" || !(await health.check(paths, manifest.version)).ok) throw new EngineError("ENGINE_UNAVAILABLE");
        assets = await engine.prepareUpgrade(target!);
        volumeInventory(docker, projectName, engine.guestPath(paths.directory));
      },
      backup: async (directory) => {
        writeFileAtomic(versionFile(directory), JSON.stringify(manifest.engine.assetVersion ?? null));
        compose(["stop"]);
        volumes = volumeInventory(docker, projectName, engine.guestPath(paths.directory));
        backupVolumes(docker, guest, directory, volumes);
        await engine.checkpoint(directory);
      },
      replace: async (directory) => {
        await engine.replaceEngine(directory);
        await engine.ensureReady(undefined, { apiPort: port, assets });
        restoreVolumes(docker, guest, projectName, directory, volumes);
      },
      verify: async () => {
        await startAndCheck();
        engine.ensureAutostart();
        writeManifest(paths, { ...manifest, engine: { ...manifest.engine, assetVersion: target } });
      },
      restore: async (directory, phase) => {
        let previous: unknown = manifest.engine.assetVersion;
        if (phase === "replacing") {
          if (!lstatSync(versionFile(directory), { throwIfNoEntry: false })?.isFile()) throw new EngineError("ENGINE_UNAVAILABLE");
          previous = JSON.parse(readFileSync(versionFile(directory), "utf8"));
          if (previous !== null && (typeof previous !== "string" || !semver.valid(previous))) throw new EngineError("ENGINE_UNAVAILABLE");
          await engine.restoreEngine(directory);
        }
        if (!engine.isLocal()) throw new EngineError("ENGINE_UNAVAILABLE");
        await engine.ensureReady(undefined, { apiPort: port });
        await startAndCheck();
        engine.ensureAutostart();
        if (phase === "replacing") writeManifest(paths, { ...manifest, engine: { ...manifest.engine, assetVersion: typeof previous === "string" ? previous : undefined } });
      },
    }, options.rollback);
  } finally { unlock(); }
};
