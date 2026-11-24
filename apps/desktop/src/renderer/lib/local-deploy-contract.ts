export const stages = ["detect", "engine", "release", "configure", "pull", "start", "health", "owner"] as const;
export const codes = ["INVALID_INPUT", "VIRTUALIZATION_DISABLED", "WSL_NOT_ENABLED", "REBOOT_REQUIRED", "ELEVATION_DENIED", "WINDOWS_UNSUPPORTED", "MACOS_UNSUPPORTED", "ENGINE_UNAVAILABLE", "ENGINE_START_FAILED", "ENGINE_INCOMPATIBLE", "ASSET_DOWNLOAD_FAILED", "ASSET_VERIFICATION_FAILED", "PORT_IN_USE", "DISK_SPACE_LOW", "MEMORY_LOW", "IMAGE_PULL_FAILED", "STACK_START_FAILED", "HEALTH_TIMEOUT", "OWNER_CREATE_FAILED", "BUSY", "CLI_VERSION_MISMATCH", "CANCELLED", "UNKNOWN"] as const;
export const actions = ["elevate", "reboot", "install-engine", "free-disk", "free-port", "confirm-low-memory"] as const;
export const statuses = ["started", "progress", "completed", "skipped", "failed"] as const;
export const fields = ["username", "password", "apiPort", "stdin"] as const;
export const engines = ["external", "managed-wsl", "managed-lima"] as const;
export const stackStates = ["not-installed", "stopped", "starting", "running", "unhealthy", "updating", "removing"] as const;
export type Stage = (typeof stages)[number];
export type Code = (typeof codes)[number];
export type Action = { kind: (typeof actions)[number]; detail?: string };
export type DeploymentResult = { url: string; username: string; directory: string; version: string; engine: (typeof engines)[number] };
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
  engine: { state?: string; memoryBytes?: number; engine?: { kind?: string }; reasons?: string[] } | null;
  version: string | null;
  apiPort: number | null;
  ownerUsername: string | null;
  awaiting: "reboot" | "elevation" | null;
  reason?: string;
}
