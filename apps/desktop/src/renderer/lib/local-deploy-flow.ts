import { type Action, type Code, type DeployProgress, type EngineProbe, type EngineProbes, type Stage, stages } from "./local-deploy-contract";

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

export type EngineKind = "external" | "managed";
type Platform = string | undefined;

/** A stage's title and plain-language introduction; callers translate both. */
export const stageCopy = (stage: Stage, platform: Platform, engine: EngineKind | "auto"): { title: string; note: string } => {
  const title = stage === "engine" && platform === "darwin" && engine !== "external" ? "Preparing the virtual machine" : deployStage[stage];
  switch (stage) {
    case "detect":
      return { title, note: "Checking the system version, memory, disk space and free ports." };
    case "engine":
      return { title, note: engine === "external"
        ? "Connecting to your container engine and checking it can run OutcomeGo."
        : platform === "darwin" ? "Starting OutcomeGo's own small virtual machine to host your bots."
          : platform === "win32" ? "Setting up OutcomeGo's own WSL 2 environment to host your bots."
            : "Getting a container engine ready to host your bots." };
    case "release":
      return { title, note: "Downloading the server release and verifying it before installing." };
    case "configure":
      return { title, note: "Writing the port and access settings. Your data stays on this computer." };
    case "pull":
      return { title, note: "Downloading the images for your server, database and bots. Usually the longest step." };
    case "start":
      return { title, note: "Starting the database, task queue, server and bot computer." };
    case "health":
      return { title, note: "Waiting for every service to answer. The first start can take a minute or two." };
    case "owner":
      return { title, note: "Creating the account you just chose, then signing you in." };
  }
};

/** Where an image can come from, by the registry host the CLI reports. */
const IMAGE_SOURCES = {
  "ghcr.io": "official",
  "registry-1.docker.io": "official",
  "ghcr.nju.edu.cn": "nju",
  "docker.nju.edu.cn": "nju",
  "m.daocloud.io": "daocloud",
} as const;
export type ImageSource = (typeof IMAGE_SOURCES)[keyof typeof IMAGE_SOURCES];
export const imageSources: readonly { id: ImageSource; name: string; detail: string }[] = [
  { id: "official", name: "Official source", detail: "GitHub, Docker Hub" },
  { id: "nju", name: "Nanjing University", detail: "Mainland China mirror" },
  { id: "daocloud", name: "DaoCloud", detail: "Mainland China mirror" },
];
// A whole host name: not the tail of a longer one ("evil.ghcr.io") or the head of one ("ghcr.io.evil.example"),
// though a full stop that ends the sentence is fine.
const registryHost = /(?<![\w.-])(registry-1\.docker\.io|docker\.nju\.edu\.cn|ghcr\.nju\.edu\.cn|m\.daocloud\.io|ghcr\.io)(?![\w-]|\.[\w-])/;

/** The image source a CLI log line names ("Pulling server from ghcr.nju.edu.cn."), or null. */
export const sourceOfLog = (message: string | undefined): ImageSource | null => {
  const host = message ? registryHost.exec(message)?.[1] : undefined;
  return host ? IMAGE_SOURCES[host as keyof typeof IMAGE_SOURCES] : null;
};

type StageDone = "completed" | "skipped";
interface Progress {
  stage: Stage;
  busy: boolean;
  issue: Extract<DeployProgress, { type: "error" }> | null;
  action?: Action;
  current?: number;
  total?: number;
  imageRetry?: { attempt: number; total: number };
  /** Stages that finished, or were already satisfied. */
  done: Partial<Record<Stage, StageDone>>;
  /** Image sources in the order they were used; the last one is downloading now. */
  sources: ImageSource[];
}

export type DeployProgressState = Progress;
export const emptyProgress = (): Progress => ({ stage: "detect", busy: true, issue: null, done: {}, sources: [] });
export const deployProgress = (state: Progress, event: DeployProgress): Progress => {
  switch (event.type) {
    case "stage": return {
      ...state, stage: event.stage, current: event.current, total: event.total, imageRetry: undefined,
      done: event.status === "completed" || event.status === "skipped" ? { ...state.done, [event.stage]: event.status } : state.done,
    };
    case "pull-retry": return { ...state, imageRetry: { attempt: event.attempt, total: event.total } };
    case "log": {
      const source = sourceOfLog(event.message);
      return source && state.sources.at(-1) !== source ? { ...state, sources: [...state.sources, source].slice(-8) } : state;
    }
    case "action-required": return { ...state, action: event.action };
    case "error": return { ...state, busy: false, imageRetry: undefined, issue: event, action: event.action ?? state.action };
    default: return state;
  }
};

/** How heavy each stage is for the overall bar; the image download is by far the longest. */
export const stageWeights: Readonly<Record<Stage, number>> = { detect: 4, engine: 16, release: 6, configure: 3, pull: 42, start: 14, health: 10, owner: 5 };
const WEIGHT_TOTAL = stages.reduce((sum, stage) => sum + stageWeights[stage], 0);

/** The stage being worked on: the reported one, or the next unfinished one right after it completes. */
export const activeStage = (progress: Pick<Progress, "stage" | "done">): Stage =>
  progress.done[progress.stage] ? stages.find(stage => !progress.done[stage]) ?? progress.stage : progress.stage;

/** A stage that is working shows at least this much, so the bar visibly starts it. */
const WORKING_FILL = 0.08;

/**
 * How full one stage's segment is: finished, working (by its own count when it has one, never
 * less than a sliver), or not started. A count only grows, so the fill never goes backwards.
 */
export const stageFill = (progress: Pick<Progress, "stage" | "done" | "current" | "total">, stage: Stage): number => {
  if (progress.done[stage]) return 1;
  if (stage !== activeStage(progress)) return 0;
  return Math.max(WORKING_FILL, progress.total ? Math.min(1, (progress.current ?? 0) / progress.total) : 0);
};

/** 0 to 1 across the whole deployment. A stage without a count shows a sliver until it completes. */
export const deployFraction = (progress: Pick<Progress, "stage" | "done" | "current" | "total">): number =>
  Math.min(1, stages.reduce((sum, stage) => sum + stageWeights[stage] * stageFill(progress, stage), 0) / WEIGHT_TOTAL);

export type StepState = "done" | "skipped" | "active" | "pending" | "failed";
export const stepState = (progress: Pick<Progress, "stage" | "done" | "issue">, stage: Stage): StepState => {
  if (progress.done[stage]) return progress.done[stage] === "skipped" ? "skipped" : "done";
  if (stage !== activeStage(progress)) return "pending";
  return progress.issue ? "failed" : "active";
};

export type EngineTone = "checking" | "ready" | "setup" | "attention" | "unavailable" | "blocked" | "unknown";
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
    case "needs-setup": return { ...base, tone: "unavailable", status: "Not installed", detail: "No Docker-compatible engine found.", selectable: false };
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

export type AdviceTone = "checking" | "good" | "info" | "blocked";
export interface EngineAdvice {
  tone: AdviceTone;
  /** English copy; callers translate it. */
  headline: string;
  detail: string;
}

/**
 * What to tell the person about the choice as a whole: which engine is suggested and why. The
 * reason names what was found, so "use the OutcomeGo engine" never reads as arbitrary.
 */
export const engineAdvice = (options: readonly EngineOption[], resuming = false): EngineAdvice => {
  const external = options.find(option => option.kind === "external");
  const managed = options.find(option => option.kind === "managed");
  const suggested = suggestedEngine(options);
  if (options.some(option => option.tone === "checking")) {
    return { tone: "checking", headline: "Checking this computer…", detail: "Looking for a container engine and what this computer supports." };
  }
  if (suggested === "external") {
    // Also suggested when it is installed but stopped and the OutcomeGo engine can't run here.
    return external?.tone === "ready"
      ? { tone: "good", headline: "Use your existing engine", detail: "It's running and compatible, so there's nothing extra to set up." }
      : { tone: "info", headline: "Start your existing engine", detail: "Start your container engine, then check again." };
  }
  if (suggested === "managed") {
    const headline = "Use the OutcomeGo engine";
    const detail = resuming ? "This deployment continues with the OutcomeGo engine."
      : managed?.tone === "attention" ? "Windows asks for approval once to turn on WSL, and may restart."
        : external?.tone === "attention" ? "Your engine isn't running. OutcomeGo can set up its own, or start yours and check again."
          : external?.tone === "blocked" ? "Your engine can't run OutcomeGo, so OutcomeGo sets up its own."
            : external?.tone === "unavailable" ? "No container engine was found. OutcomeGo sets up its own on the first deploy."
              : "Nothing else to install: the OutcomeGo engine works on this computer.";
    return { tone: "good", headline, detail };
  }
  if (managed?.tone === "blocked" && external?.tone === "unavailable") {
    return { tone: "blocked", headline: "Install a container engine first", detail: "This computer can't run the OutcomeGo engine. Install a Docker-compatible engine, then check again." };
  }
  if (options.every(option => !option.selectable)) {
    return { tone: "blocked", headline: "Neither option can run here", detail: "Install a Docker-compatible engine, or connect to an existing server." };
  }
  return { tone: "info", headline: "OutcomeGo will choose for you", detail: "It checks again when you deploy and uses whatever works." };
};

export const REQUIRED_MEMORY_BYTES = 8 * 1024 ** 3;
export const REQUIRED_GUEST_MEMORY_BYTES = 4 * 1024 ** 3;
export const REQUIRED_DISK_BYTES = 8 * 1024 ** 3;
export const RECOMMENDED_CPU_CORES = 2;
export const DEFAULT_API_PORT = 8787;

export type ResourceTone = "checking" | "pass" | "warn" | "fail" | "unknown";

export interface ResourceCheckItem {
  id: "memory" | "disk" | "cpu" | "port";
  /** English copy; callers translate it. */
  label: string;
  requirement: string;
  requirementValues?: Record<string, string | number>;
  actual: string;
  actualValues?: Record<string, string | number>;
  /** The measured value alone, for under the dial; reads `actualValues`. Absent when unmeasured. */
  short?: string;
  status: string;
  tone: ResourceTone;
  /** Visual capacity meter fill (0..1) when applicable. */
  ratio?: number;
  /** Ratio (0..1) where the required threshold sits on the meter. */
  threshold?: number;
}

export interface HostResourceReport {
  tone: ResourceTone;
  /** English copy; callers translate it. */
  summary: string;
  items: ResourceCheckItem[];
  note?: { tone: "warn" | "fail"; text: string; values?: Record<string, string | number> };
}

const formatGb = (bytes: number): string => {
  const gb = bytes / 1024 ** 3;
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1).replace(/\.0$/, "")} GB`;
};

const clampRatio = (value: number, scale: number): number => Math.max(0.08, Math.min(1, value / scale));

/**
 * Evaluates local machine resources against OutcomeGo server requirements (matching CLI preflight:
 * 8 GB memory recommended / 4 GB engine minimum, 8 GB free disk required, 2+ CPU cores, port 8787).
 */
export const evaluateHostResources = (probes: EngineProbes | null, selected: EngineKind | null): HostResourceReport => {
  const checking = probes === null;
  const resources = probes?.resources;
  const apiPort = resources?.apiPort ?? DEFAULT_API_PORT;
  const activeProbe = selected === "external" ? probes?.external : selected === "managed" ? probes?.managed : null;
  const guestMemoryBytes = activeProbe?.state === "ready" && typeof activeProbe.memoryBytes === "number" ? activeProbe.memoryBytes : null;

  // 1. Memory
  let memory: ResourceCheckItem;
  if (checking) {
    memory = { id: "memory", label: "Memory", requirement: "≥ 8 GB recommended", actual: "Checking…", status: "Checking…", tone: "checking", threshold: 0.5 };
  } else if (resources?.memoryBytes != null) {
    const amount = formatGb(resources.memoryBytes);
    const ratio = clampRatio(resources.memoryBytes, 16 * 1024 ** 3);
    if (resources.memoryBytes < REQUIRED_MEMORY_BYTES) {
      memory = { id: "memory", label: "Memory", requirement: "≥ 8 GB recommended", actual: "{amount}", actualValues: { amount }, short: "{amount}", status: "Below 8 GB", tone: "warn", ratio, threshold: 0.5 };
    } else if (guestMemoryBytes !== null && guestMemoryBytes < REQUIRED_GUEST_MEMORY_BYTES) {
      memory = {
        id: "memory", label: "Memory", requirement: "≥ 8 GB recommended",
        actual: "{amount} (engine {guest})", actualValues: { amount, guest: formatGb(guestMemoryBytes) }, short: "{guest}",
        status: "Engine memory low", tone: "warn", ratio: clampRatio(guestMemoryBytes, 8 * 1024 ** 3), threshold: 0.5,
      };
    } else {
      memory = { id: "memory", label: "Memory", requirement: "≥ 8 GB recommended", actual: "{amount}", actualValues: { amount }, short: "{amount}", status: "Meets requirement", tone: "pass", ratio, threshold: 0.5 };
    }
  } else {
    memory = { id: "memory", label: "Memory", requirement: "≥ 8 GB recommended", actual: "Checked on deploy", status: "Unchecked", tone: "unknown", threshold: 0.5 };
  }

  // 2. Disk space
  let disk: ResourceCheckItem;
  if (checking) {
    disk = { id: "disk", label: "Free disk", requirement: "≥ 8 GB free", actual: "Checking…", status: "Checking…", tone: "checking", threshold: 0.25 };
  } else if (resources?.diskAvailableBytes != null) {
    const amount = formatGb(resources.diskAvailableBytes);
    const ratio = clampRatio(resources.diskAvailableBytes, 32 * 1024 ** 3);
    disk = resources.diskAvailableBytes >= REQUIRED_DISK_BYTES
      ? { id: "disk", label: "Free disk", requirement: "≥ 8 GB free", actual: "{amount} free", actualValues: { amount }, short: "{amount}", status: "Sufficient", tone: "pass", ratio, threshold: 0.25 }
      : { id: "disk", label: "Free disk", requirement: "≥ 8 GB free", actual: "{amount} free", actualValues: { amount }, short: "{amount}", status: "Not enough space", tone: "fail", ratio, threshold: 0.25 };
  } else {
    disk = { id: "disk", label: "Free disk", requirement: "≥ 8 GB free", actual: "Checked on deploy", status: "Unchecked", tone: "unknown", threshold: 0.25 };
  }

  // 3. CPU
  let cpu: ResourceCheckItem;
  if (checking) {
    cpu = { id: "cpu", label: "Processor", requirement: "≥ 2 cores (64-bit)", actual: "Checking…", status: "Checking…", tone: "checking", threshold: 0.25 };
  } else if (resources?.cpuCores != null) {
    const ratio = clampRatio(resources.cpuCores, 8);
    const archLabel = resources.arch || "64-bit";
    cpu = resources.cpuCores >= RECOMMENDED_CPU_CORES
      ? { id: "cpu", label: "Processor", requirement: "≥ 2 cores (64-bit)", actual: "{cores} cores · {arch}", actualValues: { cores: resources.cpuCores, arch: archLabel }, short: "{cores} cores", status: "Meets requirement", tone: "pass", ratio, threshold: 0.25 }
      : { id: "cpu", label: "Processor", requirement: "≥ 2 cores (64-bit)", actual: "{cores} cores · {arch}", actualValues: { cores: resources.cpuCores, arch: archLabel }, short: "{cores} cores", status: "Limited CPU", tone: "warn", ratio, threshold: 0.25 };
  } else {
    cpu = { id: "cpu", label: "Processor", requirement: "≥ 2 cores (64-bit)", actual: "Checked on deploy", status: "Unchecked", tone: "unknown", threshold: 0.25 };
  }

  // 4. Default API port
  let port: ResourceCheckItem;
  if (checking) {
    port = { id: "port", label: "Service port", requirement: "Needs port {port} free", requirementValues: { port: apiPort }, actual: "Checking…", status: "Checking…", tone: "checking" };
  } else if (resources?.apiPortAvailable === true) {
    port = { id: "port", label: "Service port", requirement: "Needs port {port} free", requirementValues: { port: apiPort }, actual: "Port {port} free", actualValues: { port: apiPort }, short: "{port}", status: "Available", tone: "pass" };
  } else if (resources?.apiPortAvailable === false) {
    port = { id: "port", label: "Service port", requirement: "Needs port {port} free", requirementValues: { port: apiPort }, actual: "Port {port} in use", actualValues: { port: apiPort }, short: "{port}", status: "In use", tone: "warn" };
  } else {
    port = { id: "port", label: "Service port", requirement: "Needs port {port} free", requirementValues: { port: apiPort }, actual: "Checked on deploy", status: "Unchecked", tone: "unknown" };
  }

  const items = [memory, disk, cpu, port];
  if (checking) {
    return { tone: "checking", summary: "Checking resources…", items };
  }
  if (disk.tone === "fail") {
    return {
      tone: "fail",
      summary: "Not enough disk space",
      items,
      note: { tone: "fail", text: "At least 8 GB of free disk space is required. Free up space, then click Check again." },
    };
  }
  if (items.some(item => item.tone === "warn")) {
    const note = memory.tone === "warn"
      ? (guestMemoryBytes !== null && guestMemoryBytes < REQUIRED_GUEST_MEMORY_BYTES
        ? { tone: "warn" as const, text: "The container engine has less than 4 GB of memory assigned. Increase its memory limit or confirm during deploy." }
        : { tone: "warn" as const, text: "This computer has less than the recommended 8 GB of memory. You can still deploy, though bots may run slower." })
      : port.tone === "warn"
        ? { tone: "warn" as const, text: "Port {port} is currently in use. Free it or choose another API port when deploying.", values: { port: apiPort } }
        : { tone: "warn" as const, text: "Fewer than 2 CPU cores were detected. Local bots may run slower than usual." };
    return { tone: "warn", summary: "Needs attention", items, note };
  }
  if (items.every(item => item.tone === "pass")) {
    return { tone: "pass", summary: "Ready to deploy", items };
  }
  return { tone: "unknown", summary: "Checked on deploy", items };
};
