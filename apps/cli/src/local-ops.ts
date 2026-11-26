import { existsSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import type { CliOptions } from "./arguments";
import {
  installationExists,
  normalizeProjectName,
  parseEnvironment,
  readManifest,
  replaceEnvironmentValue,
  writeFileAtomic,
  writeManifest,
  type InstallationManifest,
  type InstallationPaths,
} from "./config";
import { PROJECT_NAME } from "./constants";
import { redactDeployText } from "./deploy-events";
import { availableDiskBytes, parseMemoryBytes, validMemorySize } from "./deploy-resources";
import { requireComposeProject } from "./docker";
import { commandDiagnostic } from "./docker-diagnostics";
import { ExternalEngine } from "./engine/external";
import { ManagedEngine } from "./engine/managed";
import { ManagedLimaEngine } from "./engine/managed-lima";
import { ManagedWslEngine } from "./engine/managed-wsl";
import { requireRecordedEngine } from "./engine/select";
import { EngineError, type EngineKind } from "./engine/types";
import { CliError } from "./errors";
import { waitForHealth } from "./health";
import { cliTranslate } from "./localization";
import type { CommandRunner } from "./process";
import { statusJson } from "./status";
import { acquireUpdateLock } from "./update-safety";
import {
  defaultWslConfigPath,
  readWslConfig,
  updateWslConfig,
  type LocalWslConfigInfo,
} from "./wsl-config";

export const CORE_SERVICES = [
  "server",
  "worker",
  "computer",
  "postgres",
  "computer-memory-init",
  "caddy",
] as const;

export const INIT_SERVICES = [
  "migrate",
  "agent-data-init",
  "asset-store-init",
  "computer-home-init",
  "box-store-init",
  "workspace-init",
] as const;

export const CORE_SERVICE_SET: ReadonlySet<string> = new Set(CORE_SERVICES);
export const ALLOWED_LOG_SERVICES: ReadonlySet<string> = new Set([
  ...CORE_SERVICES,
  ...INIT_SERVICES,
]);

export interface LocalContainerStats {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
}

export interface LocalContainerInfo {
  service: string;
  containerName: string;
  role: "core" | "init";
  state: string;
  health: "healthy" | "starting" | "unhealthy" | "none";
  statusText: string;
  image: string;
  exitCode: number | null;
  restartable: boolean;
  stats: LocalContainerStats | null;
  diskUsageBytes?: number | null;
}

export interface LocalContainersSnapshot {
  schemaVersion: 1;
  engineRunning: boolean;
  containers: LocalContainerInfo[];
}

export interface LocalContainerLogs {
  schemaVersion: 1;
  service: string;
  lines: string[];
  truncated: boolean;
}

const requireInstalledManifest = (
  paths: InstallationPaths
): InstallationManifest & { engine: NonNullable<InstallationManifest["engine"]> } => {
  if (!installationExists(paths)) {
    throw new EngineError(
      "ENGINE_UNAVAILABLE",
      cliTranslate("OutcomeGo is not installed at {directory}. Run outcomego install first.", {
        directory: paths.directory,
      })
    );
  }
  const manifest = readManifest(paths);
  if (!manifest) {
    throw new EngineError(
      "ENGINE_UNAVAILABLE",
      cliTranslate("OutcomeGo installation manifest is missing at {path}", {
        path: paths.manifest,
      })
    );
  }
  return manifest;
};

const manifestProjectName = (manifest: InstallationManifest): string =>
  normalizeProjectName(manifest.projectName || PROJECT_NAME);

export const hasMemoryInitService = (paths: InstallationPaths): boolean =>
  existsSync(paths.compose) && /^  computer-memory-init:/m.test(readFileSync(paths.compose, "utf8"));

export const parseByteSize = (raw: string): number => {
  const trimmed = raw.trim();
  const match = /^(\d+(?:\.\d+)?)\s*(b|kib|kb|k|mib|mb|m|gib|gb|g|tib|tb|t)?$/i.exec(trimmed);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return 0;
  const unit = (match[2] ?? "b").toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    k: 1000,
    kb: 1000,
    kib: 1024,
    m: 1000 ** 2,
    mb: 1000 ** 2,
    mib: 1024 ** 2,
    g: 1000 ** 3,
    gb: 1000 ** 3,
    gib: 1024 ** 3,
    t: 1000 ** 4,
    tb: 1000 ** 4,
    tib: 1024 ** 4,
  };
  return Math.round(value * (multipliers[unit] ?? 1));
};

export const parsePercent = (raw: string): number => {
  const match = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(raw.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

export const parseDockerStatsOutput = (stdout: string): Map<string, LocalContainerStats> => {
  const map = new Map<string, LocalContainerStats>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(trimmed);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      parsed = value as Record<string, unknown>;
    } catch {
      continue;
    }
    const rawName = typeof parsed.Name === "string" ? parsed.Name.trim().replace(/^\/+/, "") : "";
    if (!rawName) continue;
    const cpuPercent = typeof parsed.CPUPerc === "string" ? parsePercent(parsed.CPUPerc) : 0;
    const memPerc = typeof parsed.MemPerc === "string" ? parsePercent(parsed.MemPerc) : 0;
    const memUsageStr = typeof parsed.MemUsage === "string" ? parsed.MemUsage : "";
    const [usagePart = "", limitPart = ""] = memUsageStr.split("/");
    const memoryUsageBytes = parseByteSize(usagePart);
    const memoryLimitBytes = parseByteSize(limitPart);
    const computedPercent =
      memPerc > 0
        ? memPerc
        : memoryLimitBytes > 0
          ? Number(((memoryUsageBytes / memoryLimitBytes) * 100).toFixed(2))
          : 0;
    map.set(rawName, {
      cpuPercent,
      memoryUsageBytes,
      memoryLimitBytes,
      memoryPercent: computedPercent,
    });
  }
  return map;
};

interface ComposePsRow {
  Name?: unknown;
  Service?: unknown;
  State?: unknown;
  Health?: unknown;
  Status?: unknown;
  Image?: unknown;
  ExitCode?: unknown;
}

const normalizeHealth = (raw: unknown): LocalContainerInfo["health"] => {
  if (raw === "healthy" || raw === "starting" || raw === "unhealthy") return raw;
  return "none";
};

const serviceSortKey = (service: string): [number, number, string] => {
  const coreIndex = (CORE_SERVICES as readonly string[]).indexOf(service);
  if (coreIndex >= 0) return [0, coreIndex, service];
  return [1, 0, service];
};

export const parseComposePsContainers = (stdout: string): LocalContainerInfo[] => {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let rows: unknown[];
  try {
    rows = trimmed.startsWith("[")
      ? (JSON.parse(trimmed) as unknown[])
      : trimmed
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
  } catch {
    throw new CliError(
      "Could not inspect OutcomeGo services: Docker Compose returned invalid container metadata."
    );
  }
  if (!Array.isArray(rows)) {
    throw new CliError(
      "Could not inspect OutcomeGo services: Docker Compose returned invalid container metadata."
    );
  }
  const containers: LocalContainerInfo[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as ComposePsRow;
    if (typeof row.Service !== "string" || !row.Service.trim()) continue;
    const service = row.Service.trim();
    const state = typeof row.State === "string" && row.State.trim() ? row.State.trim().toLowerCase() : "unknown";
    const containerName =
      typeof row.Name === "string" && row.Name.trim()
        ? row.Name.trim().replace(/^\/+/, "")
        : service;
    const role: "core" | "init" = CORE_SERVICE_SET.has(service) ? "core" : "init";
    const statusText =
      typeof row.Status === "string" && row.Status.trim() ? row.Status.trim() : state;
    const image =
      typeof row.Image === "string" ? row.Image.trim().slice(0, 256) : "";
    const exitCode =
      state === "running"
        ? null
        : typeof row.ExitCode === "number" && Number.isInteger(row.ExitCode)
          ? row.ExitCode
          : null;
    containers.push({
      service,
      containerName,
      role,
      state,
      health: normalizeHealth(row.Health),
      statusText,
      image,
      exitCode,
      restartable: role === "core",
      stats: null,
      diskUsageBytes: null,
    });
  }
  containers.sort((a, b) => {
    const ka = serviceSortKey(a.service);
    const kb = serviceSortKey(b.service);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2].localeCompare(kb[2]);
  });
  return containers;
};

interface DockerDfImageRow {
  ID?: unknown;
  Repository?: unknown;
  Tag?: unknown;
  Size?: unknown;
}

interface DockerDfContainerRow {
  Names?: unknown;
  Image?: unknown;
  Size?: unknown;
  Mounts?: unknown;
  Labels?: unknown;
}

interface DockerDfVolumeRow {
  Name?: unknown;
  Size?: unknown;
}

const extractComposeImageLabel = (labels: string): string | null => {
  for (const part of labels.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === "com.docker.compose.image") {
      const value = part.slice(eq + 1).trim();
      if (value) return value;
    }
  }
  return null;
};

const normalizeImageIdKeys = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const keys = new Set<string>([trimmed]);
  const digestIndex = trimmed.indexOf("@sha256:");
  const hashPart =
    digestIndex >= 0
      ? trimmed.slice(digestIndex + 1)
      : trimmed;
  keys.add(hashPart);
  if (hashPart.startsWith("sha256:")) {
    const hex = hashPart.slice("sha256:".length);
    if (hex) {
      keys.add(hex);
      if (hex.length >= 12) keys.add(hex.slice(0, 12));
    }
  } else if (/^[a-f0-9]{12,64}$/i.test(hashPart)) {
    keys.add(`sha256:${hashPart}`);
    keys.add(hashPart.slice(0, 12));
  }
  return [...keys];
};

const preferredVolumeOwnerService = (volumeName: string): string | null => {
  const lower = volumeName.toLowerCase();
  if (lower.includes("postgres")) return "postgres";
  if (
    lower.includes("computer") ||
    lower.includes("box_store") ||
    lower.includes("workspace") ||
    lower.includes("agent_data")
  ) {
    return "computer";
  }
  if (lower.includes("assets")) return "server";
  if (lower.includes("caddy")) return "caddy";
  return null;
};

export const parseDockerSystemDfDiskUsage = (
  stdout: string,
  containers: readonly LocalContainerInfo[]
): Map<string, number> => {
  const result = new Map<string, number>();
  const trimmed = stdout.trim();
  if (!trimmed || containers.length === 0) return result;

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(trimmed);
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    parsed = value as Record<string, unknown>;
  } catch {
    return result;
  }

  const imageSizes = new Map<string, { canonicalId: string; bytes: number }>();
  if (Array.isArray(parsed.Images)) {
    for (const raw of parsed.Images) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as DockerDfImageRow;
      const id = typeof row.ID === "string" ? row.ID.trim() : "";
      const sizeStr = typeof row.Size === "string" ? row.Size : "";
      const bytes = parseByteSize(sizeStr);
      if (!id) continue;
      const entry = { canonicalId: id, bytes };
      for (const key of normalizeImageIdKeys(id)) {
        imageSizes.set(key, entry);
      }
      if (
        typeof row.Repository === "string" &&
        row.Repository &&
        row.Repository !== "<none>" &&
        typeof row.Tag === "string" &&
        row.Tag &&
        row.Tag !== "<none>"
      ) {
        imageSizes.set(`${row.Repository}:${row.Tag}`, entry);
      }
    }
  }

  const volumeSizes = new Map<string, number>();
  if (Array.isArray(parsed.Volumes)) {
    for (const raw of parsed.Volumes) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as DockerDfVolumeRow;
      const name = typeof row.Name === "string" ? row.Name.trim() : "";
      const sizeStr = typeof row.Size === "string" ? row.Size : "";
      if (name) {
        volumeSizes.set(name, parseByteSize(sizeStr));
      }
    }
  }

  const dfByContainerName = new Map<
    string,
    { rwBytes: number; imageCandidates: string[]; mounts: string[] }
  >();
  if (Array.isArray(parsed.Containers)) {
    for (const raw of parsed.Containers) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as DockerDfContainerRow;
      const name = typeof row.Names === "string" ? row.Names.trim().replace(/^\/+/, "") : "";
      if (!name) continue;
      const sizeRaw = typeof row.Size === "string" ? row.Size.split("(")[0] ?? "" : "";
      const rwBytes = parseByteSize(sizeRaw);
      const labels = typeof row.Labels === "string" ? row.Labels : "";
      const imageLabel = extractComposeImageLabel(labels);
      const imageField = typeof row.Image === "string" ? row.Image.trim() : "";
      const imageCandidates = [
        ...(imageLabel ? normalizeImageIdKeys(imageLabel) : []),
        ...(imageField ? normalizeImageIdKeys(imageField) : []),
      ];
      const mounts =
        typeof row.Mounts === "string"
          ? row.Mounts.split(",")
              .map((m) => m.trim())
              .filter(Boolean)
          : [];
      dfByContainerName.set(name, { rwBytes, imageCandidates, mounts });
    }
  }

  // Attribute each mounted volume once to a single owner container (preferring core services)
  const volumeMounters = new Map<string, LocalContainerInfo[]>();
  for (const container of containers) {
    const dfRow = dfByContainerName.get(container.containerName);
    if (!dfRow) continue;
    for (const mount of dfRow.mounts) {
      if (!volumeSizes.has(mount)) continue;
      const list = volumeMounters.get(mount) ?? [];
      list.push(container);
      volumeMounters.set(mount, list);
    }
  }

  const ownedVolumeBytes = new Map<string, number>();
  for (const [volumeName, mounters] of volumeMounters.entries()) {
    const coreMounters = mounters.filter((c) => c.role === "core");
    const candidates = coreMounters.length > 0 ? coreMounters : mounters;
    const preferredService = preferredVolumeOwnerService(volumeName);
    const owner =
      (preferredService ? candidates.find((c) => c.service === preferredService) : undefined) ??
      candidates[0];
    if (!owner) continue;
    const bytes = volumeSizes.get(volumeName) ?? 0;
    ownedVolumeBytes.set(owner.containerName, (ownedVolumeBytes.get(owner.containerName) ?? 0) + bytes);
  }

  // Attribute each container image once (in sorted core-first order) to avoid double counting shared images
  const attributedImages = new Set<string>();
  for (const container of containers) {
    const dfRow = dfByContainerName.get(container.containerName);
    if (!dfRow) continue;
    let imageBytes = 0;
    const candidateKeys = [
      ...dfRow.imageCandidates,
      ...normalizeImageIdKeys(container.image),
    ];
    for (const key of candidateKeys) {
      const matched = imageSizes.get(key);
      if (matched) {
        if (!attributedImages.has(matched.canonicalId)) {
          attributedImages.add(matched.canonicalId);
          imageBytes = matched.bytes;
        }
        break;
      }
    }
    const volumesBytes = ownedVolumeBytes.get(container.containerName) ?? 0;
    result.set(container.containerName, dfRow.rwBytes + imageBytes + volumesBytes);
  }

  return result;
};

export const collectContainers = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: { includeStats?: boolean } = {}
): Promise<LocalContainersSnapshot> => {
  const manifest = requireInstalledManifest(paths);
  const engine = requireRecordedEngine(paths, runner, manifest.engine.kind);
  const detection = await engine.detect();
  if (detection.state !== "ready") {
    return { schemaVersion: 1, engineRunning: false, containers: [] };
  }
  const project = requireComposeProject(paths, runner, manifestProjectName(manifest));
  const psResult = project.run(["ps", "--all", "--format", "json"], { timeoutMs: 10_000 });
  if (psResult.status !== 0) {
    throw new CliError(
      `Could not inspect OutcomeGo containers: ${commandDiagnostic("Docker Compose ps", psResult)}`
    );
  }
  const containers = parseComposePsContainers(psResult.stdout);
  if (options.includeStats) {
    const runningNames = containers
      .filter((container) => container.state === "running")
      .map((container) => container.containerName);
    if (runningNames.length > 0) {
      const statsResult = engine.docker(
        ["stats", "--no-stream", "--format", "{{json .}}", ...runningNames],
        { timeoutMs: 10_000 }
      );
      if (statsResult.status === 0 && statsResult.stdout.trim()) {
        const statsMap = parseDockerStatsOutput(statsResult.stdout);
        for (const container of containers) {
          container.stats = statsMap.get(container.containerName) ?? null;
        }
      }
    }
    if (containers.length > 0) {
      const dfResult = engine.docker(
        ["system", "df", "-v", "--format", "{{json .}}"],
        { timeoutMs: 10_000 }
      );
      if (dfResult.status === 0 && dfResult.stdout.trim()) {
        const diskMap = parseDockerSystemDfDiskUsage(dfResult.stdout, containers);
        for (const container of containers) {
          if (diskMap.has(container.containerName)) {
            container.diskUsageBytes = diskMap.get(container.containerName) ?? null;
          }
        }
      }
    }
  }
  return {
    schemaVersion: 1,
    engineRunning: true,
    containers,
  };
};

export const containersCommand = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: Pick<CliOptions, "stats" | "json">
): Promise<LocalContainersSnapshot> => {
  const snapshot = await collectContainers(paths, runner, { includeStats: Boolean(options.stats) });
  if (options.json) {
    console.log(JSON.stringify(snapshot));
  } else if (!snapshot.engineRunning) {
    console.log(cliTranslate("Container engine is stopped."));
  } else {
    for (const item of snapshot.containers) {
      const statsText = item.stats
        ? ` cpu=${item.stats.cpuPercent.toFixed(1)}% mem=${Math.round(item.stats.memoryUsageBytes / (1024 * 1024))}MiB`
        : "";
      const diskText =
        typeof item.diskUsageBytes === "number"
          ? ` disk=${(item.diskUsageBytes / 1000 ** 3).toFixed(2)}GB`
          : "";
      console.log(`${item.service}\t${item.role}\t${item.state}\t${item.health}\t${item.statusText}${statsText}${diskText}`);
    }
  }
  return snapshot;
};

export const redactSensitiveText = (
  text: string,
  extraSecrets: readonly string[] = []
): string => {
  let output = redactDeployText(text, extraSecrets);
  // Proxy / URL userinfo credentials
  output = output.replace(
    /\b(https?|socks5h?|postgresql|postgres|redis):\/\/([^:@/\s]+):([^@/\s]+)@/gi,
    "$1://[REDACTED]@"
  );
  // HTTP Authorization / Proxy-Authorization headers
  output = output.replace(
    /\b((?:Proxy-)?Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s"',;]+/gi,
    "$1[REDACTED]"
  );
  // JSON / key-value secret fields
  output = output.replace(
    /("(?:password|pass|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|private[_-]?key)"\s*:\s*")([^"]*)(")/gi,
    "$1[REDACTED]$3"
  );
  output = output.replace(
    /\b((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|secret[_-]?key|control[_-]?token|auth[_-]?secret|proxy[_-]?secret)\s*[=:]\s*)([^\s"',;]+)/gi,
    "$1[REDACTED]"
  );
  // Common provider key prefixes
  output = output.replace(/\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED]");
  return output;
};

const collectInstallationSecrets = (paths: InstallationPaths): string[] => {
  const secrets: string[] = [];
  if (existsSync(paths.environment)) {
    try {
      const env = parseEnvironment(readFileSync(paths.environment, "utf8"));
      for (const [key, value] of env.entries()) {
        if (!value || value.length < 4) continue;
        if (/(?:_PASSWORD|_TOKEN|_SECRET|_KEY|DATABASE_URL)$/i.test(key)) {
          secrets.push(value);
        }
        if (/^OUTCOMEGO_(?:HTTP|HTTPS)_PROXY$/i.test(key)) {
          try {
            const parsed = new URL(value);
            if (parsed.password) {
              secrets.push(parsed.password);
              secrets.push(decodeURIComponent(parsed.password));
            }
          } catch {}
        }
      }
    } catch {}
  }
  if (existsSync(paths.proxyConfig)) {
    try {
      const parsed = JSON.parse(readFileSync(paths.proxyConfig, "utf8")) as Record<string, unknown>;
      if (typeof parsed.password === "string" && parsed.password.length >= 1) {
        secrets.push(parsed.password);
      }
    } catch {}
  }
  return secrets;
};

export const collectContainerLogs = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: { service?: string; tail?: string | number; follow?: boolean }
): Promise<LocalContainerLogs> => {
  const service = options.service?.trim();
  if (!service || !ALLOWED_LOG_SERVICES.has(service)) {
    throw new EngineError("INVALID_INPUT", cliTranslate("Unknown or unsupported service name."));
  }
  if (options.follow) {
    throw new EngineError("INVALID_INPUT", "--follow cannot be combined with --json.");
  }
  const tailValue = options.tail === undefined ? 200 : Number(options.tail);
  if (!Number.isInteger(tailValue) || tailValue < 10 || tailValue > 1000) {
    throw new EngineError("INVALID_INPUT", "--tail must be an integer between 10 and 1000.");
  }
  const manifest = requireInstalledManifest(paths);
  const engine = requireRecordedEngine(paths, runner, manifest.engine.kind);
  const detection = await engine.detect();
  if (detection.state !== "ready") {
    throw new EngineError("ENGINE_UNAVAILABLE");
  }
  const project = requireComposeProject(paths, runner, manifestProjectName(manifest));
  const result = project.run(
    ["logs", "--no-color", "--timestamps", "--tail", String(tailValue), service],
    { timeoutMs: 15_000 }
  );
  if (result.status !== 0) {
    throw new CliError(
      `Could not read logs for ${service}: ${commandDiagnostic("Docker Compose logs", result)}`
    );
  }
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const rawLines = combined.split(/\r?\n/);
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  const secrets = collectInstallationSecrets(paths);
  const truncated = rawLines.length >= tailValue;
  const trimmed = rawLines.slice(-tailValue);
  const lines = trimmed.map((line) => redactSensitiveText(line, secrets));
  return {
    schemaVersion: 1,
    service,
    lines,
    truncated,
  };
};

export const logsJsonCommand = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: Pick<CliOptions, "service" | "tail" | "follow">
): Promise<LocalContainerLogs> => {
  const payload = await collectContainerLogs(paths, runner, options);
  console.log(JSON.stringify(payload));
  return payload;
};

export const restartCommand = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: Pick<CliOptions, "service" | "json" | "yes">,
  dependencies: {
    waitReady?: (paths: InstallationPaths, expectedVersion?: string) => Promise<unknown>;
  } = {}
): Promise<Record<string, unknown>> => {
  const targetService = options.service?.trim();
  if (targetService && !CORE_SERVICE_SET.has(targetService)) {
    throw new EngineError(
      "INVALID_INPUT",
      cliTranslate("Only core services can be restarted: {services}.", {
        services: CORE_SERVICES.join(", "),
      })
    );
  }
  const manifest = requireInstalledManifest(paths);
  const releaseLock = acquireUpdateLock(paths);
  try {
    const engine = requireRecordedEngine(paths, runner, manifest.engine.kind);
    if (engine instanceof ManagedEngine) {
      await engine.ensureReady();
    }
    const project = requireComposeProject(paths, runner, manifestProjectName(manifest));
    const includeMemoryInit = hasMemoryInitService(paths);
    try {
      if (!targetService) {
        project.runOrThrow(["stop"]);
        if (includeMemoryInit) {
          project.runOrThrow(["up", "-d", "--no-deps", "--force-recreate", "computer", "computer-memory-init"]);
        }
        project.runOrThrow(["up", "-d", "--remove-orphans"]);
      } else if (targetService === "computer") {
        project.runOrThrow([
          "up",
          "-d",
          "--no-deps",
          "--force-recreate",
          "computer",
          ...(includeMemoryInit ? ["computer-memory-init"] : []),
        ]);
      } else if (targetService === "computer-memory-init") {
        project.runOrThrow(["up", "-d", "--no-deps", "--force-recreate", "computer-memory-init"]);
      } else {
        project.runOrThrow(["restart", targetService]);
      }
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError(
        "STACK_START_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    }

    if (!targetService || targetService === "server" || targetService === "computer") {
      const wait =
        dependencies.waitReady ??
        ((p: InstallationPaths, v?: string) => waitForHealth(p, 60_000, v));
      await wait(paths, manifest.version).catch(() => undefined);
    }
  } finally {
    releaseLock();
  }

  const snapshot = {
    schemaVersion: 1 as const,
    ...(await statusJson(paths, runner)),
  };
  if (options.json) {
    console.log(JSON.stringify(snapshot));
  } else {
    console.log(
      targetService
        ? cliTranslate("Restarted service {service}.", { service: targetService })
        : cliTranslate("Restarted OutcomeGo local services.")
    );
  }
  return snapshot;
};

export interface LocalAutostartStatus {
  schemaVersion: 1;
  serviceSupported: boolean;
  serviceEnabled: boolean;
  serviceRegistered: boolean;
  engineKind: EngineKind;
  unsupportedReason: string | null;
}

export const collectAutostartStatus = (
  paths: InstallationPaths,
  runner: CommandRunner
): LocalAutostartStatus => {
  const manifest = requireInstalledManifest(paths);
  const engineKind = manifest.engine.kind;
  if (engineKind === "external") {
    return {
      schemaVersion: 1,
      serviceSupported: false,
      serviceEnabled: false,
      serviceRegistered: false,
      engineKind,
      unsupportedReason: cliTranslate(
        "Autostart is managed by your external container engine (for example Docker Desktop or OrbStack)."
      ),
    };
  }
  const engine = requireRecordedEngine(paths, runner, engineKind);
  const registered = engine instanceof ManagedEngine ? engine.isAutostartRegistered() : false;
  const enabled = manifest.autostart?.enabled !== false;
  return {
    schemaVersion: 1,
    serviceSupported: true,
    serviceEnabled: enabled,
    serviceRegistered: registered,
    engineKind,
    unsupportedReason: null,
  };
};

export const autostartStatusCommand = (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: Pick<CliOptions, "json">
): LocalAutostartStatus => {
  const status = collectAutostartStatus(paths, runner);
  if (options.json) {
    console.log(JSON.stringify(status));
  } else if (!status.serviceSupported) {
    console.log(status.unsupportedReason ?? cliTranslate("Autostart is managed externally."));
  } else {
    console.log(
      cliTranslate("Local service autostart: {state}", {
        state: status.serviceEnabled ? "enabled" : "disabled",
      })
    );
  }
  return status;
};

export const autostartSetCommand = (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: Pick<CliOptions, "enabled" | "json">
): LocalAutostartStatus => {
  if (typeof options.enabled !== "boolean") {
    throw new EngineError("INVALID_INPUT", "--enabled must be true or false.");
  }
  const manifest = requireInstalledManifest(paths);
  if (manifest.engine.kind === "external") {
    throw new EngineError(
      "INVALID_INPUT",
      cliTranslate("Autostart is managed by your external container engine (for example Docker Desktop or OrbStack).")
    );
  }
  const releaseLock = acquireUpdateLock(paths);
  try {
    const engine = requireRecordedEngine(paths, runner, manifest.engine.kind);
    if (!(engine instanceof ManagedEngine)) {
      throw new EngineError("ENGINE_UNAVAILABLE");
    }
    if (options.enabled) {
      if (!engine.ensureAutostart()) {
        throw new EngineError(
          "ENGINE_UNAVAILABLE",
          cliTranslate("Could not register the autostart task for the managed engine.")
        );
      }
    } else {
      engine.removeAutostart();
    }
    writeManifest(paths, {
      ...manifest,
      autostart: { enabled: options.enabled },
      updatedAt: new Date().toISOString(),
    });
  } finally {
    releaseLock();
  }
  return autostartStatusCommand(paths, runner, options);
};

export interface LocalResourceSnapshot {
  schemaVersion: 1;
  host: {
    memoryBytes: number;
    cpuCores: number;
    diskAvailableBytes: number | null;
  };
  containers: {
    computerMemory: string;
    desktopMemory: string;
    computerCpu: number | null;
    workerConcurrency: number;
  };
  engine: {
    kind: EngineKind;
    memoryBytes: number | null;
    cpuCores: number | null;
    configurable: "direct" | "wslconfig" | "readonly";
    wslConfig?: LocalWslConfigInfo;
  };
}

export const readLocalComputerCpu = (paths: InstallationPaths): number | null => {
  if (!existsSync(paths.localCompose)) return null;
  try {
    const content = readFileSync(paths.localCompose, "utf8");
    const match = /^\s+cpus:\s*([0-9]+(?:\.[0-9]+)?)\s*$/m.exec(content);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

export const formatLocalComposeYaml = (computerCpu: number | null): string | null => {
  if (computerCpu === null) return null;
  return `services:\n  computer:\n    cpus: ${computerCpu}\n`;
};

const safeDiskBytes = (directory: string): number | null => {
  try {
    return availableDiskBytes(directory);
  } catch {
    return null;
  }
};

export const collectResourceSnapshot = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  dependencies: {
    hostMemoryBytes?: () => number;
    hostCpuCores?: () => number;
    diskBytes?: (dir: string) => number | null;
    wslConfigPath?: string;
  } = {}
): Promise<LocalResourceSnapshot> => {
  const manifest = requireInstalledManifest(paths);
  const env = existsSync(paths.environment)
    ? parseEnvironment(readFileSync(paths.environment, "utf8"))
    : new Map<string, string>();
  const computerMemory = env.get("OUTCOMEGO_COMPUTER_MEMORY_LIMIT")?.trim() || "12g";
  const desktopMemory = env.get("OUTCOMEGO_DESKTOP_MEMORY_LIMIT")?.trim() || "10g";
  const workerRaw = Number(env.get("OUTCOMEGO_WORKER_CONCURRENCY") || "8");
  const workerConcurrency =
    Number.isInteger(workerRaw) && workerRaw >= 1 && workerRaw <= 64 ? workerRaw : 8;
  const computerCpu = readLocalComputerCpu(paths);

  const engine = requireRecordedEngine(paths, runner, manifest.engine.kind);
  let detectionMemory: number | null = null;
  let engineCpu: number | null = null;
  try {
    const detection = await engine.detect();
    detectionMemory = detection.memoryBytes ?? engine.memoryBytes();
    if (engine instanceof ExternalEngine) {
      engineCpu = engine.cpuCores();
    }
  } catch {
    detectionMemory = engine.memoryBytes();
  }

  let memoryBytes = detectionMemory;
  let cpuCores = engineCpu;
  let configurable: "direct" | "wslconfig" | "readonly" = "readonly";
  let wslConfig: LocalWslConfigInfo | undefined;

  if (manifest.engine.kind === "managed-lima") {
    configurable = "direct";
    if (engine instanceof ManagedLimaEngine) {
      const limaRes = engine.readLimaResources();
      memoryBytes = limaRes.memoryBytes ?? memoryBytes;
      cpuCores = limaRes.cpuCores ?? cpuCores;
    }
  } else if (manifest.engine.kind === "managed-wsl") {
    configurable = "wslconfig";
    wslConfig = readWslConfig(dependencies.wslConfigPath ?? defaultWslConfigPath());
  }

  return {
    schemaVersion: 1,
    host: {
      memoryBytes: (dependencies.hostMemoryBytes ?? totalmem)(),
      cpuCores: (dependencies.hostCpuCores ?? availableParallelism)(),
      diskAvailableBytes: (dependencies.diskBytes ?? safeDiskBytes)(paths.directory),
    },
    containers: {
      computerMemory,
      desktopMemory,
      computerCpu,
      workerConcurrency,
    },
    engine: {
      kind: manifest.engine.kind,
      memoryBytes,
      cpuCores,
      configurable,
      ...(wslConfig ? { wslConfig } : {}),
    },
  };
};

export const resourcesStatusCommand = async (
  paths: InstallationPaths,
  runner: CommandRunner,
  options: Pick<CliOptions, "json">,
  dependencies: Parameters<typeof collectResourceSnapshot>[2] = {}
): Promise<LocalResourceSnapshot> => {
  const snapshot = await collectResourceSnapshot(paths, runner, dependencies);
  if (options.json) {
    console.log(JSON.stringify(snapshot));
  } else {
    console.log(
      `computer=${snapshot.containers.computerMemory} desktop=${snapshot.containers.desktopMemory} cpu=${snapshot.containers.computerCpu ?? "unlimited"} worker=${snapshot.containers.workerConcurrency}`
    );
  }
  return snapshot;
};

const parseComputerCpuOption = (
  raw: string | undefined,
  maxCores: number
): number | null | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "none" || trimmed === "unlimited" || trimmed === "0") return null;
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new EngineError("INVALID_INPUT", "--computer-cpu must be a number (for example 2 or 2.5) or none.");
  }
  const value = Number(trimmed);
  const maxAllowed = Math.max(1, maxCores);
  if (
    !Number.isFinite(value) ||
    value < 1 ||
    value > maxAllowed ||
    Math.round(value * 2) !== value * 2
  ) {
    throw new EngineError(
      "INVALID_INPUT",
      `--computer-cpu must be between 1 and ${maxAllowed} in 0.5 increments, or none.`
    );
  }
  return value;
};

export const resourcesSetExtendedCommand = async (
  paths: InstallationPaths,
  options: Pick<
    CliOptions,
    | "computerMemory"
    | "desktopMemory"
    | "computerCpu"
    | "workerConcurrency"
    | "engineMemory"
    | "engineCpu"
    | "applyWslconfig"
    | "restartWsl"
    | "json"
    | "yes"
  >,
  runner: CommandRunner,
  dependencies: {
    confirm?: (warning: string) => Promise<boolean>;
    printWarning?: (warning: string) => void;
    hostMemoryBytes?: () => number;
    hostCpuCores?: () => number;
    diskBytes?: (dir: string) => number | null;
    wslConfigPath?: string;
  } = {}
): Promise<LocalResourceSnapshot | null> => {
  const gib = 1024 ** 3;
  const hostMemory = (dependencies.hostMemoryBytes ?? totalmem)();
  const hostCores = Math.max(1, (dependencies.hostCpuCores ?? availableParallelism)());

  // Validate syntax & bounds before touching installation or engine.
  if (options.computerMemory !== undefined && !validMemorySize(options.computerMemory)) {
    throw new EngineError(
      "INVALID_INPUT",
      cliTranslate("Memory limit must be an integer size of at least 1 GiB (for example 4g or 3584m).")
    );
  }
  if (options.desktopMemory !== undefined && !validMemorySize(options.desktopMemory)) {
    throw new EngineError(
      "INVALID_INPUT",
      cliTranslate("Memory limit must be an integer size of at least 1 GiB (for example 4g or 3584m).")
    );
  }
  const parsedComputerCpu = parseComputerCpuOption(options.computerCpu, hostCores);

  let parsedWorkerConcurrency: number | undefined;
  if (options.workerConcurrency !== undefined) {
    if (!/^\d+$/.test(options.workerConcurrency.trim())) {
      throw new EngineError("INVALID_INPUT", "--worker-concurrency must be an integer between 1 and 64.");
    }
    const parsed = Number(options.workerConcurrency.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 64) {
      throw new EngineError("INVALID_INPUT", "--worker-concurrency must be an integer between 1 and 64.");
    }
    parsedWorkerConcurrency = parsed;
  }

  let parsedEngineMemoryBytes: number | undefined;
  if (options.engineMemory !== undefined) {
    const bytes = parseMemoryBytes(options.engineMemory);
    if (bytes === null || bytes < 2 * gib || bytes > hostMemory) {
      throw new EngineError(
        "INVALID_INPUT",
        "Engine memory must be an integer size between 2 GiB and host memory."
      );
    }
    parsedEngineMemoryBytes = bytes;
  }

  let parsedEngineCpu: number | undefined;
  if (options.engineCpu !== undefined) {
    if (!/^\d+$/.test(options.engineCpu.trim())) {
      throw new EngineError("INVALID_INPUT", "--engine-cpu must be a positive integer.");
    }
    const parsed = Number(options.engineCpu.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > hostCores) {
      throw new EngineError("INVALID_INPUT", `--engine-cpu must be an integer between 1 and ${hostCores}.`);
    }
    parsedEngineCpu = parsed;
  }

  const hasAnyUpdate =
    options.computerMemory !== undefined ||
    options.desktopMemory !== undefined ||
    parsedComputerCpu !== undefined ||
    parsedWorkerConcurrency !== undefined ||
    parsedEngineMemoryBytes !== undefined ||
    parsedEngineCpu !== undefined;

  if (!hasAnyUpdate) {
    throw new EngineError("INVALID_INPUT", "Specify at least one resource option to update.");
  }

  const manifest = requireInstalledManifest(paths);
  const currentEnvText = readFileSync(paths.environment, "utf8");
  const currentEnv = parseEnvironment(currentEnvText);
  const currentComputerMemory = currentEnv.get("OUTCOMEGO_COMPUTER_MEMORY_LIMIT")?.trim() || "12g";
  const currentDesktopMemory = currentEnv.get("OUTCOMEGO_DESKTOP_MEMORY_LIMIT")?.trim() || "10g";
  const nextComputerMemory = options.computerMemory ?? currentComputerMemory;
  const nextDesktopMemory = options.desktopMemory ?? currentDesktopMemory;

  const computerBytes = parseMemoryBytes(nextComputerMemory);
  const desktopBytes = parseMemoryBytes(nextDesktopMemory);
  if (
    computerBytes === null ||
    desktopBytes === null ||
    computerBytes < gib ||
    desktopBytes < gib
  ) {
    throw new EngineError(
      "INVALID_INPUT",
      cliTranslate("Both memory limits must be integer sizes of at least 1 GiB (for example 4g or 3584m).")
    );
  }
  if (desktopBytes >= computerBytes) {
    throw new EngineError(
      "INVALID_INPUT",
      cliTranslate("Desktop memory limit must be strictly less than computer memory limit.")
    );
  }

  const engineChanging = parsedEngineMemoryBytes !== undefined || parsedEngineCpu !== undefined;
  if (engineChanging) {
    if (manifest.engine.kind === "external") {
      throw new EngineError(
        "INVALID_INPUT",
        cliTranslate("Engine CPU and memory cannot be modified for an external container engine.")
      );
    }
    if (manifest.engine.kind === "managed-wsl" && !options.applyWslconfig) {
      throw new EngineError(
        "INVALID_INPUT",
        "Updating Windows .wslconfig requires explicit --apply-wslconfig confirmation."
      );
    }
  }

  const warning = cliTranslate(
    "Changing resource limits restarts affected local services and interrupts running tasks."
  );
  if (!options.yes) {
    if (!dependencies.confirm) {
      throw new CliError(
        cliTranslate("Interactive confirmation is unavailable; pass --yes to confirm.")
      );
    }
    if (!(await dependencies.confirm(warning))) return null;
  } else if (!options.json) {
    dependencies.printWarning?.(warning);
  }

  const releaseLock = acquireUpdateLock(paths);
  try {
    const project = requireComposeProject(paths, runner, manifestProjectName(manifest));
    const previousEnv = readFileSync(paths.environment, "utf8");
    const previousLocalCompose = existsSync(paths.localCompose)
      ? readFileSync(paths.localCompose, "utf8")
      : null;

    let updatedEnv = previousEnv;
    const computerChanged =
      options.computerMemory !== undefined ||
      options.desktopMemory !== undefined ||
      parsedComputerCpu !== undefined;
    const workerChanged = parsedWorkerConcurrency !== undefined;

    if (options.computerMemory !== undefined) {
      updatedEnv = replaceEnvironmentValue(
        updatedEnv,
        "OUTCOMEGO_COMPUTER_MEMORY_LIMIT",
        nextComputerMemory
      );
    }
    if (options.desktopMemory !== undefined) {
      updatedEnv = replaceEnvironmentValue(
        updatedEnv,
        "OUTCOMEGO_DESKTOP_MEMORY_LIMIT",
        nextDesktopMemory
      );
    }
    if (parsedWorkerConcurrency !== undefined) {
      updatedEnv = replaceEnvironmentValue(
        updatedEnv,
        "OUTCOMEGO_WORKER_CONCURRENCY",
        String(parsedWorkerConcurrency)
      );
    }

    const restoreFiles = () => {
      writeFileAtomic(paths.environment, previousEnv);
      if (previousLocalCompose !== null) {
        writeFileAtomic(paths.localCompose, previousLocalCompose, 0o600);
      } else if (existsSync(paths.localCompose)) {
        rmSync(paths.localCompose, { force: true });
      }
    };

    if (updatedEnv !== previousEnv) {
      writeFileAtomic(paths.environment, updatedEnv);
    }
    if (parsedComputerCpu !== undefined) {
      const yaml = formatLocalComposeYaml(parsedComputerCpu);
      if (yaml === null) {
        rmSync(paths.localCompose, { force: true });
      } else {
        writeFileAtomic(paths.localCompose, yaml, 0o600);
      }
    }

    try {
      let stackRestarted = false;
      if (engineChanging) {
        if (project.engine instanceof ManagedLimaEngine) {
          await project.engine.updateResources(
            { memory: options.engineMemory, cpuCores: parsedEngineCpu },
            () => {
              project.run(["stop"]);
            }
          );
          project.runOrThrow(["up", "-d"]);
          stackRestarted = true;
        } else if (project.engine instanceof ManagedWslEngine) {
          updateWslConfig(dependencies.wslConfigPath ?? defaultWslConfigPath(), {
            memory: options.engineMemory,
            processors: parsedEngineCpu,
          });
          if (options.restartWsl) {
            project.engine.shutdownAllWsl();
            await project.engine.ensureReady();
            project.runOrThrow(["up", "-d"]);
            stackRestarted = true;
          }
        }
      }

      if (!stackRestarted) {
        if (computerChanged) {
          project.runOrThrow([
            "up",
            "-d",
            "--no-deps",
            "--force-recreate",
            "computer",
            "computer-memory-init",
          ]);
        }
        if (workerChanged) {
          project.runOrThrow(["up", "-d", "--no-deps", "--force-recreate", "worker"]);
        }
      }
    } catch (error) {
      restoreFiles();
      throw error;
    }
  } finally {
    releaseLock();
  }

  if (options.json) {
    return resourcesStatusCommand(paths, runner, { json: true }, dependencies);
  }
  return null;
};
