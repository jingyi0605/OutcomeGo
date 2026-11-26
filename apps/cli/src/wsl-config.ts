import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { writeFileAtomic } from "./config";
import { EngineError } from "./engine/types";
import { parseMemoryBytes } from "./deploy-resources";

export interface LocalWslConfigInfo {
  path: string;
  exists: boolean;
  memory: string | null;
  processors: number | null;
}

export const defaultWslConfigPath = (
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): string => {
  if (platform === "win32") {
    const profile = environment.USERPROFILE?.trim() || home;
    return win32.join(profile, ".wslconfig");
  }
  return join(home, ".wslconfig");
};

export const wslConfigBackupPath = (configPath: string): string => `${configPath}.outcomego.bak`;

export const formatWslMemoryValue = (raw: string): string => {
  const bytes = parseMemoryBytes(raw);
  const gib = 1024 ** 3;
  const mib = 1024 ** 2;
  if (bytes === null || bytes < gib) {
    throw new EngineError("INVALID_INPUT", "WSL2 memory must be an integer size of at least 1 GiB.");
  }
  if (bytes % gib === 0) {
    return `${bytes / gib}GB`;
  }
  return `${Math.round(bytes / mib)}MB`;
};

export const readWslConfig = (configPath = defaultWslConfigPath()): LocalWslConfigInfo => {
  if (!existsSync(configPath)) {
    return { path: configPath, exists: false, memory: null, processors: null };
  }
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return { path: configPath, exists: true, memory: null, processors: null };
  }
  let inWsl2 = false;
  let memory: string | null = null;
  let processors: number | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const section = /^\[([^\]]+)\]$/.exec(trimmed);
    if (section) {
      inWsl2 = section[1]!.trim().toLowerCase() === "wsl2";
      continue;
    }
    if (!inWsl2) continue;
    const sep = trimmed.indexOf("=");
    if (sep <= 0) continue;
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const value = trimmed.slice(sep + 1).trim();
    if (key === "memory" && value) {
      memory = value;
    } else if (key === "processors" && /^\d+$/.test(value)) {
      const parsed = Number(value);
      if (parsed >= 1 && parsed <= 256) processors = parsed;
    }
  }
  return { path: configPath, exists: true, memory, processors };
};

export const updateWslConfig = (
  configPath: string,
  patch: { memory?: string; processors?: number }
): { backupPath: string | null; config: LocalWslConfigInfo } => {
  const nextMemory = patch.memory !== undefined ? formatWslMemoryValue(patch.memory) : undefined;
  const nextProcessors = patch.processors;
  if (
    nextProcessors !== undefined &&
    (!Number.isInteger(nextProcessors) || nextProcessors < 1 || nextProcessors > 256)
  ) {
    throw new EngineError("INVALID_INPUT", "WSL2 processors must be an integer between 1 and 256.");
  }
  if (nextMemory === undefined && nextProcessors === undefined) {
    return { backupPath: null, config: readWslConfig(configPath) };
  }

  let existing = "";
  let backupPath: string | null = null;
  if (existsSync(configPath)) {
    existing = readFileSync(configPath, "utf8");
    backupPath = wslConfigBackupPath(configPath);
    writeFileAtomic(backupPath, existing, 0o644);
  }

  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const lines = existing ? existing.split(/\r?\n/) : [];
  // Strip single trailing empty element produced by final newline
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  let wsl2Start = -1;
  let wsl2End = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    const section = /^\[([^\]]+)\]$/.exec(trimmed);
    if (!section) continue;
    if (section[1]!.trim().toLowerCase() === "wsl2") {
      wsl2Start = i;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\[([^\]]+)\]$/.test(lines[j]!.trim())) {
          wsl2End = j;
          break;
        }
      }
      break;
    }
  }

  if (wsl2Start === -1) {
    if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
      lines.push("");
    }
    lines.push("[wsl2]");
    if (nextMemory !== undefined) lines.push(`memory=${nextMemory}`);
    if (nextProcessors !== undefined) lines.push(`processors=${nextProcessors}`);
  } else {
    let memoryUpdated = nextMemory === undefined;
    let processorsUpdated = nextProcessors === undefined;
    for (let i = wsl2Start + 1; i < wsl2End; i += 1) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
      const sep = trimmed.indexOf("=");
      if (sep <= 0) continue;
      const key = trimmed.slice(0, sep).trim().toLowerCase();
      if (key === "memory" && nextMemory !== undefined) {
        lines[i] = `memory=${nextMemory}`;
        memoryUpdated = true;
      } else if (key === "processors" && nextProcessors !== undefined) {
        lines[i] = `processors=${nextProcessors}`;
        processorsUpdated = true;
      }
    }
    const insertions: string[] = [];
    if (!memoryUpdated && nextMemory !== undefined) insertions.push(`memory=${nextMemory}`);
    if (!processorsUpdated && nextProcessors !== undefined) insertions.push(`processors=${nextProcessors}`);
    if (insertions.length > 0) {
      let insertAt = wsl2End;
      while (insertAt > wsl2Start + 1 && lines[insertAt - 1]!.trim() === "") {
        insertAt -= 1;
      }
      lines.splice(insertAt, 0, ...insertions);
    }
  }

  writeFileAtomic(configPath, `${lines.join(newline)}${newline}`, 0o644);
  return { backupPath, config: readWslConfig(configPath) };
};
