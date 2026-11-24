import type { Action, Code, DeployProgress, Stage } from "./local-deploy-contract";

const issues: Record<Code, string> = {
  INVALID_INPUT: "The deployment input is invalid.",
  VIRTUALIZATION_DISABLED: "Enable virtualization in your firmware, then retry.",
  WSL_NOT_ENABLED: "Enable WSL before deploying the managed engine.",
  REBOOT_REQUIRED: "Restart your computer, then reopen OutcomeGo to continue deployment.",
  ELEVATION_DENIED: "Allow the system change or use an existing engine.",
  WINDOWS_UNSUPPORTED: "Managed deployment requires Windows x64 (Windows 10 22H2 or Windows 11 23H2 or later). Connect to an existing server on unsupported hardware.",
  MACOS_UNSUPPORTED: "Managed deployment requires macOS 13.5 or later on Apple Silicon or Intel. Use an existing container engine or server instead.",
  ENGINE_UNAVAILABLE: "Start a local Docker-compatible engine and retry.",
  ENGINE_START_FAILED: "The engine did not start. Check diagnostics and retry.",
  ENGINE_INCOMPATIBLE: "This engine lacks capabilities required by OutcomeGo.",
  ASSET_DOWNLOAD_FAILED: "Download failed. Check your connection or proxy and retry.",
  ASSET_VERIFICATION_FAILED: "The release could not be verified. Retry the download.",
  PORT_IN_USE: "Free the occupied port or choose another API port.",
  DISK_SPACE_LOW: "Free disk space before retrying deployment.",
  MEMORY_LOW: "Available memory is low. Add memory or confirm you want to continue.",
  IMAGE_PULL_FAILED: "Image download failed. Check your connection and retry.",
  STACK_START_FAILED: "Local services could not start. Check diagnostics and retry.",
  HEALTH_TIMEOUT: "Local services did not become healthy. Check diagnostics and retry.",
  OWNER_CREATE_FAILED: "The owner account could not be created. Check your credentials and retry.",
  BUSY: "A local service operation is already running.",
  CLI_VERSION_MISMATCH: "Update the desktop app to use a compatible command-line tool.",
  CANCELLED: "Deployment cancelled.",
  UNKNOWN: "Deployment did not finish. Copy diagnostics and retry.",
};

export const deployIssue = (code: Code): string => issues[code];
export const deployStage: Record<Stage, string> = {
  detect: "Checking deployment requirements",
  engine: "Preparing the container engine",
  release: "Checking the server release",
  configure: "Configuring local services",
  pull: "Downloading container images",
  start: "Starting local services",
  health: "Checking server health",
  owner: "Setting up the owner account",
};

interface Progress {
  stage: Stage;
  busy: boolean;
  issue: Extract<DeployProgress, { type: "error" }> | null;
  action?: Action;
  current?: number;
  total?: number;
}

export const emptyProgress = (): Progress => ({ stage: "detect", busy: true, issue: null });
export const deployProgress = (state: Progress, event: DeployProgress): Progress => {
  switch (event.type) {
    case "stage": return { ...state, stage: event.stage, current: event.current, total: event.total };
    case "action-required": return { ...state, action: event.action };
    case "error": return { ...state, busy: false, issue: event, action: event.action ?? state.action };
    default: return state;
  }
};
