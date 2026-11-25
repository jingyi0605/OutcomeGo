import { lstatSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../config";
import { cliTranslate } from "../localization";
import type { RunOptions, RunResult } from "../process";
import { EngineError } from "./types";

const projectLabel = "com.docker.compose.project";
const volumeLabel = "com.docker.compose.volume";
const namePattern = /^[a-z0-9][a-z0-9_.-]*$/i;
export type MigratableVolume = { name: string; mountpoint: string; key: string };
type Docker = (args: readonly string[], options?: RunOptions) => RunResult;
type Guest = (args: readonly string[], options: RunOptions) => RunResult;

const incompatible = () => new EngineError("ENGINE_INCOMPATIBLE", cliTranslate("Engine upgrade requires private Compose volumes without custom drivers or mounts."));
const check = (result: RunResult) => {
  if (result.status !== 0) throw new EngineError("ENGINE_START_FAILED");
  return result.stdout.trim();
};

export const migratableVolumes = (entries: unknown, project: string, root: string): MigratableVolume[] => {
  if (typeof root !== "string" || !/^\/(?:[\w.-]+\/)*[\w.-]+$/.test(root) || root.split("/").some(part => part === "." || part === "..") || !Array.isArray(entries)) throw incompatible();
  const seen = new Set<string>();
  return entries.map(volume => {
    const { Name: name, Mountpoint: mountpoint, Labels: labels, Driver: driver, Scope: scope, Options: options } = volume ?? {};
    const key = labels?.[volumeLabel];
    if (typeof name !== "string" || !namePattern.test(name) || seen.has(name) ||
      driver !== "local" || scope !== "local" || (options != null && (typeof options !== "object" || Array.isArray(options) || Object.keys(options).length)) ||
      labels?.[projectLabel] !== project || typeof key !== "string" || !namePattern.test(key) || mountpoint !== `${root}/volumes/${name}/_data`) throw incompatible();
    seen.add(name);
    return { name, mountpoint, key };
  });
};

const dockerRoot = (docker: Docker) => JSON.parse(check(docker(["info", "--format", "{{json .DockerRootDir}}"]))) as string;
const names = (output: string) => output.split(/\r?\n/).filter(Boolean);
const inspect = (docker: Docker, volumeNames: string[], project: string) => volumeNames.length ?
  migratableVolumes(JSON.parse(check(docker(["volume", "inspect", "--", ...volumeNames]))), project, dockerRoot(docker)) : [];
const archive = (directory: string, index: number) => join(directory, `volume-${index}.tar`);
const tar = ["/usr/bin/tar", "--numeric-owner", "--acls", "--xattrs", "--xattrs-include=*"];
const transferTimeout = 60 * 60_000;

export const volumeInventory = (docker: Docker, project: string, workingDirectory: string) => {
  const volumeNames = names(check(docker(["volume", "ls", "--quiet"])));
  if (volumeNames.some(name => !namePattern.test(name))) throw incompatible();
  const volumes = inspect(docker, volumeNames, project);
  if (!volumes.length || volumes.length !== volumeNames.length || volumeNames.some(name => !volumes.some(volume => volume.name === name))) throw incompatible();
  const ownedVolumes = new Set(volumes.map(volume => volume.name));
  const containers = names(check(docker(["ps", "--all", "--no-trunc", "--format", '{{.ID}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.project.working_dir"}}'])));
  if (!containers.length) throw incompatible();
  for (const container of containers) {
    const [id, owner, directory] = container.split("|", 3);
    if (!id || !/^[a-f0-9]{64}$/.test(id) || owner !== project || directory !== workingDirectory) throw incompatible();
    const mounts = JSON.parse(check(docker(["inspect", "--format", "{{json .Mounts}}", id])));
    if (!Array.isArray(mounts) || mounts.some(mount => !(mount?.Type === "volume" && ownedVolumes.has(mount.Name)) && mount?.Type !== "tmpfs")) throw incompatible();
  }
  return volumes;
};

export const backupVolumes = (docker: Docker, guest: Guest, directory: string, volumes: MigratableVolume[]) => {
  if (check(docker(["ps", "--quiet"]))) throw incompatible();
  for (const [index, volume] of volumes.entries()) {
    const outputFile = archive(directory, index);
    check(guest([...tar, "--sparse", "--one-file-system", "-C", volume.mountpoint, "-cf", "-", "."], { outputFile, timeoutMs: transferTimeout }));
    const file = lstatSync(outputFile, { throwIfNoEntry: false });
    if (!file?.isFile() || file.size < 1024 || file.size % 512 !== 0) throw new EngineError("ENGINE_START_FAILED");
  }
  writeFileAtomic(join(directory, "volumes.json"), JSON.stringify(volumes.map(({ name, key }, index) => ({ name, key, archive: `volume-${index}.tar` }))));
};

export const restoreVolumes = (docker: Docker, guest: Guest, project: string, directory: string, volumes: MigratableVolume[]) => {
  if (check(docker(["ps", "--all", "--quiet"])) || check(docker(["volume", "ls", "--quiet"]))) throw incompatible();
  for (const [index, volume] of volumes.entries()) {
    const name = check(docker(["volume", "create", "--driver", "local", "--label", `${projectLabel}=${project}`, "--label", `${volumeLabel}=${volume.key}`, volume.name]));
    if (name !== volume.name) throw incompatible();
    const [target] = inspect(docker, [name], project);
    if (!target || target.name !== name || target.key !== volume.key) throw incompatible();
    check(guest([...tar, "--same-owner", "--same-permissions", "-C", target.mountpoint, "-xf", "-"], { inputFile: archive(directory, index), timeoutMs: transferTimeout }));
  }
};
