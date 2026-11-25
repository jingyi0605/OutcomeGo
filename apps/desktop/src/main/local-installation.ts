import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isOutcomeGoVersion } from "@outcomego/contracts/version-compatibility";

export interface Installation {
  directory: string;
  version: string;
  apiPort: string;
  ownerUsername?: string;
  engine?: "external" | "managed-wsl" | "managed-lima";
  awaiting?: "reboot" | "elevation" | null;
  uninstalled?: boolean;
}

export const defaultInstallDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir()
) => {
  if (environment.OUTCOMEGO_HOME?.trim()) return resolve(environment.OUTCOMEGO_HOME.trim());
  if (platform === "win32") {
    return resolve(environment.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"), "OutcomeGo");
  }
  if (environment.XDG_CONFIG_HOME?.trim()) {
    return resolve(environment.XDG_CONFIG_HOME.trim(), "outcomego");
  }
  return resolve(home, ".outcomego");
};

const environmentValues = (contents: string) => {
  const result = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    result.set(key, value);
  }
  return result;
};

export const readManagedInstallation = (
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir()
): Installation | null => {
  const directory = defaultInstallDirectory(environment, platform, home);
  const manifestPath = join(directory, "installation.json");
  const environmentPath = join(directory, ".env");
  const composePath = join(directory, "compose.yaml");
  if (!existsSync(manifestPath) || !existsSync(environmentPath) || !existsSync(composePath)) {
    return null;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version?: unknown;
      ownerUsername?: unknown;
      uninstalledAt?: unknown;
      engine?: { kind?: unknown };
    };
    if (typeof manifest.version !== "string" || !isOutcomeGoVersion(manifest.version)) return null;
    const values = environmentValues(readFileSync(environmentPath, "utf8"));
    const engine = manifest.engine?.kind ?? "external";
    if (engine !== "external" && engine !== "managed-wsl" && engine !== "managed-lima") return null;
    const pending = readPendingDeployment(directory);
    return {
      directory,
      version: manifest.version,
      engine,
      ...(typeof manifest.uninstalledAt === "string" ? { uninstalled: true } : {}),
      ...(pending ? { awaiting: pending.awaiting } : {}),
      apiPort: values.get("OUTCOMEGO_API_PORT") || "8787",
      ...(typeof manifest.ownerUsername === "string" && manifest.ownerUsername
        ? { ownerUsername: manifest.ownerUsername }
        : {}),
    };
  } catch {
    return null;
  }
};

export const readPendingDeployment = (directory: string): {
  awaiting: "reboot" | "elevation";
  ownerUsername: string | null;
} | null => {
  try {
    const state = JSON.parse(readFileSync(join(directory, "deploy-state.json"), "utf8"));
    if (state.schemaVersion === 1 && (state.awaiting === "reboot" || state.awaiting === "elevation")) {
      return { awaiting: state.awaiting, ownerUsername: typeof state.ownerUsername === "string" && state.ownerUsername.length <= 256 ? state.ownerUsername : null };
    }
  } catch {}
  return null;
};

const loopbackHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export const canManageLocalInstallation = (
  serverUrl: string,
  installation: Installation | null
): boolean => {
  if (!installation) return false;
  try {
    const url = new URL(serverUrl);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return url.protocol === "http:" && loopbackHost(url.hostname) && port === installation.apiPort;
  } catch {
    return false;
  }
};
