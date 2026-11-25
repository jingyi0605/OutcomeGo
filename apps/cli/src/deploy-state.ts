import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, type InstallationPaths } from "./config";

type PendingDeployment = { awaiting: "reboot" | "elevation"; ownerUsername: string };
const pathFor = (paths: InstallationPaths) => join(paths.directory, "deploy-state.json");

export const readDeployState = (paths: InstallationPaths) => {
  try {
    const value = JSON.parse(readFileSync(pathFor(paths), "utf8"));
    if (value?.schemaVersion === 1 && value.engineKind === "managed-wsl" &&
      (value.awaiting === "reboot" || value.awaiting === "elevation") &&
      typeof value.ownerUsername === "string" && /^[\w.-]{3,30}$/.test(value.ownerUsername) && typeof value.startedAt === "string") {
      return { awaiting: value.awaiting as PendingDeployment["awaiting"], ownerUsername: value.ownerUsername as string,
        engineKind: "managed-wsl" as const, startedAt: value.startedAt as string };
    }
  } catch {}
  return null;
};

export const writeDeployState = (paths: InstallationPaths, input: PendingDeployment) => {
  const now = new Date().toISOString();
  writeFileAtomic(pathFor(paths), JSON.stringify({ schemaVersion: 1, engineKind: "managed-wsl",
    phase: input.awaiting === "reboot" ? "awaiting-reboot" : "detect", awaiting: input.awaiting,
    ownerUsername: input.ownerUsername, startedAt: readDeployState(paths)?.startedAt ?? now, updatedAt: now }), 0o600);
};

export const clearDeployState = (paths: InstallationPaths) => rmSync(pathFor(paths), { force: true });
