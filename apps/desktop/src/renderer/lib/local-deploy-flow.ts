import type { Action, Code, DeployProgress, EngineProbe, EngineProbes, Stage } from "./local-deploy-contract";

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

export type EngineKind = "external" | "managed";
type Platform = string | undefined;

export type EngineTone = "checking" | "ready" | "setup" | "attention" | "blocked" | "unknown";
export interface EngineOption {
  kind: EngineKind;
  tone: EngineTone;
  /** English copy; callers translate it. */
  about: string;
  status: string;
  detail: string;
  /** The engine's own name and version when it reported them; shown as is. */
  meta?: string;
  selectable: boolean;
  recommended: boolean;
}

const unknownProbe: EngineProbe = { state: "unknown", reasons: [] };
const meta = (probe: EngineProbe) => [probe.name, probe.version].filter(Boolean).join(" ") || undefined;

const externalOption = (probe: EngineProbe | null, resuming: boolean): Omit<EngineOption, "recommended"> => {
  const base = { kind: "external" as const, about: "Already on this computer", selectable: !resuming };
  if (resuming) return { ...base, tone: "unknown", status: "Not used", detail: "This deployment continues with the OutcomeGo engine." };
  if (!probe) return { ...base, tone: "checking", status: "Checking…", detail: "Looking for a container engine on this computer." };
  switch (probe.state) {
    case "ready": return { ...base, tone: "ready", status: "Ready to use", detail: "A compatible engine is running.", meta: meta(probe) };
    case "stopped": return { ...base, tone: "attention", status: "Installed, not running", detail: "Start your container engine, then check again.", meta: meta(probe) };
    case "needs-setup": return { ...base, tone: "setup", status: "Not installed", detail: "No Docker-compatible engine found." };
    case "unsupported": return { ...base, tone: "blocked", status: "Not compatible", detail: probe.reasons[0] ?? deployIssue("ENGINE_INCOMPATIBLE"), meta: meta(probe), selectable: false };
    default: return { ...base, tone: "unknown", status: "Couldn't check", detail: "OutcomeGo checks again when you deploy." };
  }
};

/** Why the OutcomeGo engine can't run here, in one line. */
const blockedReason = (probe: EngineProbe): string =>
  probe.code === "MACOS_UNSUPPORTED" ? "Requires macOS 13.5 or later."
    : probe.code === "WINDOWS_UNSUPPORTED" ? "Requires 64-bit Windows 10 22H2 or Windows 11 23H2 or later."
      : probe.code === "VIRTUALIZATION_DISABLED" ? "Turn on virtualization in your firmware first."
        : probe.code ? deployIssue(probe.code) : probe.reasons[0] ?? deployIssue("ENGINE_UNAVAILABLE");

const managedOption = (probe: EngineProbe | null, platform: Platform): Omit<EngineOption, "recommended"> => {
  const base = {
    kind: "managed" as const, selectable: true,
    about: platform === "darwin" ? "Runs in a lightweight virtual machine" : "Runs in a WSL 2 environment",
  };
  if (!probe) return { ...base, tone: "checking", status: "Checking…", detail: "Looking at what this computer supports." };
  switch (probe.state) {
    case "ready": return { ...base, tone: "ready", status: "Ready to use", detail: "Already set up and running." };
    case "stopped": return { ...base, tone: "ready", status: "Installed", detail: "Starts automatically when you deploy." };
    case "needs-setup":
      if (probe.code === "WSL_NOT_ENABLED") return { ...base, tone: "attention", status: "Needs one-time setup", detail: "Windows asks for administrator approval to enable WSL and may restart once." };
      if (probe.code === "REBOOT_REQUIRED") return { ...base, tone: "attention", status: "Restart needed", detail: deployIssue("REBOOT_REQUIRED") };
      return { ...base, tone: "setup", status: "Installs automatically", detail: "Set up for you automatically on the first deploy." };
    case "unsupported": return { ...base, tone: "blocked", status: "Not available", detail: blockedReason(probe), selectable: false };
    default: return { ...base, tone: "unknown", status: "Couldn't check", detail: "OutcomeGo checks again when you deploy." };
  }
};

/**
 * The two places a deployment can run, with what was found on this computer and which one to
 * suggest. A running engine of your own is preferred; otherwise OutcomeGo's engine, which
 * installs itself. Nothing is suggested while the look is still running or has failed.
 */
export const engineOptions = (probes: EngineProbes | null, platform: Platform, resuming = false): EngineOption[] => {
  const external = externalOption(probes?.external ?? null, resuming);
  const managed = managedOption(probes ? probes.managed ?? unknownProbe : null, platform);
  const ownState = probes?.external.state;
  const managedState = probes ? (probes.managed ?? unknownProbe).state : "unknown";
  const recommended: EngineKind | null = !probes ? null
    : resuming && managed.selectable ? "managed"
      : ownState === "ready" && external.selectable ? "external"
        : managed.selectable && managedState !== "unknown" ? "managed"
          : ownState === "stopped" && external.selectable ? "external" : null;
  return [external, managed].map(option => ({ ...option, recommended: option.kind === recommended }));
};

/** The choice to start from: the suggested one. */
export const suggestedEngine = (options: readonly EngineOption[]): EngineKind | null => options.find(option => option.recommended)?.kind ?? null;
