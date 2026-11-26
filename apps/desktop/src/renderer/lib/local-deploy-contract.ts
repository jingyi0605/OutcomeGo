export const stages = ["detect", "engine", "release", "configure", "pull", "start", "health", "owner"] as const;
export const codes = ["INVALID_INPUT", "VIRTUALIZATION_DISABLED", "WSL_NOT_ENABLED", "REBOOT_REQUIRED", "ELEVATION_DENIED", "WINDOWS_UNSUPPORTED", "MACOS_UNSUPPORTED", "ENGINE_UNAVAILABLE", "ENGINE_START_FAILED", "ENGINE_INCOMPATIBLE", "ASSET_DOWNLOAD_FAILED", "ASSET_VERIFICATION_FAILED", "PORT_IN_USE", "DISK_SPACE_LOW", "MEMORY_LOW", "IMAGE_PULL_FAILED", "STACK_START_FAILED", "HEALTH_TIMEOUT", "OWNER_CREATE_FAILED", "BUSY", "CLI_VERSION_MISMATCH", "CANCELLED", "UNKNOWN"] as const;
export const actions = ["elevate", "reboot", "install-engine", "free-disk", "free-port", "confirm-low-memory"] as const;
export const statuses = ["started", "progress", "completed", "skipped", "failed"] as const;
export const fields = ["username", "password", "apiPort", "stdin"] as const;
export const engines = ["external", "managed-wsl", "managed-lima"] as const;
export const stackStates = ["not-installed", "stopped", "starting", "running", "unhealthy", "updating", "removing"] as const;
export const engineProbeStates = ["ready", "stopped", "needs-setup", "unsupported", "unknown"] as const;
export type Stage = (typeof stages)[number];
export type Code = (typeof codes)[number];
export type EngineKind = (typeof engines)[number];
export type Action = { kind: (typeof actions)[number]; detail?: string };
/** What a read-only look at one container engine found; "unknown" means the look itself failed. */
export type EngineProbe = {
  state: (typeof engineProbeStates)[number];
  code?: Code;
  reasons: string[];
  name?: string;
  version?: string;
  memoryBytes?: number;
};
/** Read-only snapshot of the local machine's resources needed to host OutcomeGo. */
export type HostResources = {
  memoryBytes: number | null;
  diskAvailableBytes: number | null;
  cpuCores: number | null;
  arch: string;
  apiPort: number;
  apiPortAvailable: boolean | null;
};
/** `managed` is null on a computer that has no OutcomeGo-managed engine (anything but Windows and macOS). */
export type EngineProbes = { external: EngineProbe; managed: EngineProbe | null; resources?: HostResources };
export type DeploymentResult = { url: string; username: string; directory: string; version: string; engine: EngineKind };
export type DeployPayload =
  | { type: "stage"; stage: Stage; status: (typeof statuses)[number]; current?: number; total?: number }
  | { type: "log"; stage?: Stage }
  | { type: "action-required"; action: Action }
  | { type: "error"; stage: Stage; code: Code; retryable: boolean; field?: (typeof fields)[number]; action?: Action }
  | { type: "result"; result: DeploymentResult };
export type DeployProgress = DeployPayload & { schemaVersion: 1; ts: string; deployId: string; message?: string };

export interface LocalDeployRequest {
  username: string;
  password: string;
  engine?: "auto" | "external" | "managed";
  apiPort?: number;
  acceptLowMemory?: boolean;
}

export interface LocalServerStatus {
  stack: { state: (typeof stackStates)[number]; services: unknown[] };
  engine: { state?: string; memoryBytes?: number; engine?: { kind?: EngineKind | string }; reasons?: string[] } | null;
  version: string | null;
  apiPort: number | null;
  ownerUsername: string | null;
  awaiting: "reboot" | "elevation" | null;
  directory?: string | null;
  reason?: string;
}

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

export interface LocalAutostartStatus {
  schemaVersion: 1;
  serviceSupported: boolean;
  serviceEnabled: boolean;
  serviceRegistered: boolean;
  engineKind: EngineKind;
  unsupportedReason: string | null;
}

export interface LocalWslConfigInfo {
  path: string;
  exists: boolean;
  memory: string | null;
  processors: number | null;
}

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

export interface LocalResourceUpdate {
  computerMemory?: string;
  desktopMemory?: string;
  computerCpu?: number | null;
  workerConcurrency?: number;
  engineMemory?: string;
  engineCpu?: number;
  applyWslconfig?: boolean;
  restartWsl?: boolean;
}

export type ProxyMode = "off" | "system" | "manual";
export type ProxyProtocol = "http" | "https" | "socks5";

export interface SystemProxySnapshot {
  httpProxy: string | null;
  httpsProxy: string | null;
  noProxy: string | null;
}

export interface LocalProxyConfig {
  schemaVersion: 1;
  mode: ProxyMode;
  protocol?: ProxyProtocol;
  host?: string;
  port?: number;
  username?: string | null;
  hasPassword: boolean;
  noProxy: string;
  applyToContainers: boolean;
  applyToDockerDaemon: boolean;
  loopbackMappedHost: string | null;
  systemResolved: SystemProxySnapshot | null;
}

export interface LocalProxyUpdate {
  mode: ProxyMode;
  protocol?: ProxyProtocol;
  host?: string;
  port?: number;
  username?: string | null;
  password?: string | null;
  clearPassword?: boolean;
  noProxy?: string;
  applyToContainers?: boolean;
  applyToDockerDaemon?: boolean;
  systemResolved?: SystemProxySnapshot | null;
}

export interface LocalProxyCheckResult {
  target: "proxy-tcp" | "model-api" | "github" | "registry";
  ok: boolean;
  latencyMs: number | null;
  statusCode?: number;
  error?: string;
}

export interface LocalProxyTestResult {
  schemaVersion: 1;
  ok: boolean;
  effectiveProxy: string | null;
  loopbackMappedHost: string | null;
  checks: LocalProxyCheckResult[];
}

export interface BackgroundPreferenceState {
  warnedOnClose: boolean;
  stopServiceOnQuit: boolean;
  launchAtLogin: boolean;
  launchHidden: boolean;
}

export type BackgroundPreferencePatch = Partial<
  Pick<BackgroundPreferenceState, "stopServiceOnQuit" | "launchAtLogin" | "launchHidden">
>;
