import type { LocalResourceSnapshot, LocalServerStatus } from "./local-deploy-contract";

const labels: Record<LocalServerStatus["stack"]["state"], string> = {
  "not-installed": "Not installed",
  stopped: "Stopped",
  starting: "Starting local services",
  running: "Running",
  unhealthy: "Local services need attention",
  updating: "Updating local services",
  removing: "Removing local services",
};

export const serverStateLabel = (state: keyof typeof labels) => labels[state];

export const isLocalServer = (address: string, apiPort: number | null) => {
  try {
    const url = new URL(address);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      Number(url.port || 80) === apiPort
    );
  } catch {
    return false;
  }
};

export const canDeleteLocalData = (checked: boolean, word: string) =>
  checked && word === "DELETE";

export const memorySizeBytes = (value: string): number | null => {
  const match = /^(\d+)([kmgt]?)i?b?$/i.exec(value.trim());
  if (!match) return null;
  const power = ["", "k", "m", "g", "t"].indexOf(match[2]!.toLowerCase());
  const bytes = Number(match[1]) * 1024 ** power;
  return Number.isSafeInteger(bytes) && bytes >= 1024 ** 3 ? bytes : null;
};

export const localMemoryChange = (
  computerMemory: string,
  desktopMemory: string,
  guestMemory?: number
) => {
  const computer = memorySizeBytes(computerMemory);
  const desktop = memorySizeBytes(desktopMemory);
  const limit = guestMemory ? Math.floor(guestMemory * 0.75) : Infinity;
  if (!computer || !desktop || limit < 1024 ** 3) return null;
  return {
    computerMemory: computer > limit ? String(limit) : computerMemory,
    desktopMemory: desktop > limit ? String(limit) : desktopMemory,
    capped: computer > limit || desktop > limit,
  };
};

export type ResourcePresetId = "light" | "balanced" | "performance" | "custom";

export interface ResourcePresetValues {
  computerMemory: string;
  desktopMemory: string;
  computerCpu: number | null;
  workerConcurrency: number;
}

export const computeResourcePresets = (
  hostMemoryBytes: number,
  hostCpuCores: number,
  engineMemoryBytes: number | null
): Record<Exclude<ResourcePresetId, "custom">, ResourcePresetValues> => {
  const gib = 1024 ** 3;
  const budgetBytes = Math.max(
    4 * gib,
    engineMemoryBytes ?? Math.floor(hostMemoryBytes * 0.5)
  );
  const maxRecommendedGib = Math.max(2, Math.floor((budgetBytes * 0.75) / gib));
  const cores = Math.max(1, hostCpuCores);

  const clampPair = (targetComputerGib: number): { computerMemory: string; desktopMemory: string } => {
    const comp = Math.max(2, Math.min(targetComputerGib, maxRecommendedGib));
    const desk = Math.max(1, comp - Math.max(1, Math.floor(comp * 0.2)));
    return {
      computerMemory: `${comp}g`,
      desktopMemory: `${Math.min(desk, comp - 1)}g`,
    };
  };

  return {
    light: {
      ...clampPair(4),
      computerCpu: Math.max(1, Math.min(2, cores)),
      workerConcurrency: Math.max(1, Math.min(4, cores)),
    },
    balanced: {
      ...clampPair(8),
      computerCpu: Math.max(1, Math.min(4, Math.max(2, Math.floor(cores / 2)))),
      workerConcurrency: Math.max(2, Math.min(8, cores)),
    },
    performance: {
      ...clampPair(12),
      computerCpu: null,
      workerConcurrency: Math.max(4, Math.min(12, cores)),
    },
  };
};

export interface ResourceFormValidation {
  valid: boolean;
  error: string | null;
  warning: string | null;
  parsedComputerCpu: number | null;
  parsedWorkerConcurrency: number | null;
  parsedEngineCpu: number | null;
}

export const validateLocalResourceForm = (input: {
  computerMemory: string;
  desktopMemory: string;
  computerCpu: string;
  workerConcurrency: string;
  engineMemory: string;
  engineCpu: string;
  modifyEngine: boolean;
  snapshot: LocalResourceSnapshot;
}): ResourceFormValidation => {
  const gib = 1024 ** 3;
  const hostCores = Math.max(1, input.snapshot.host.cpuCores);
  const hostMemory = input.snapshot.host.memoryBytes;
  const engineMemory = input.snapshot.engine.memoryBytes;

  const computerBytes = memorySizeBytes(input.computerMemory);
  const desktopBytes = memorySizeBytes(input.desktopMemory);
  if (!computerBytes || !desktopBytes) {
    return {
      valid: false,
      error: "Enter at least 1 GiB for each limit, for example 4g.",
      warning: null,
      parsedComputerCpu: null,
      parsedWorkerConcurrency: null,
      parsedEngineCpu: null,
    };
  }
  if (desktopBytes >= computerBytes) {
    return {
      valid: false,
      error: "Desktop memory limit must be strictly less than computer memory limit.",
      warning: null,
      parsedComputerCpu: null,
      parsedWorkerConcurrency: null,
      parsedEngineCpu: null,
    };
  }

  let parsedComputerCpu: number | null = null;
  const rawCpu = input.computerCpu.trim();
  if (rawCpu !== "") {
    if (!/^\d+(?:\.\d+)?$/.test(rawCpu)) {
      return {
        valid: false,
        error: "Computer CPU limit must be a valid number or blank for unlimited.",
        warning: null,
        parsedComputerCpu: null,
        parsedWorkerConcurrency: null,
        parsedEngineCpu: null,
      };
    }
    const cpuVal = Number(rawCpu);
    if (
      !Number.isFinite(cpuVal) ||
      cpuVal < 1 ||
      cpuVal > hostCores ||
      Math.round(cpuVal * 2) !== cpuVal * 2
    ) {
      return {
        valid: false,
        error: "Computer CPU limit must be between 1 and host cores in 0.5 increments.",
        warning: null,
        parsedComputerCpu: null,
        parsedWorkerConcurrency: null,
        parsedEngineCpu: null,
      };
    }
    parsedComputerCpu = cpuVal;
  }

  const rawWorker = input.workerConcurrency.trim();
  if (!/^\d+$/.test(rawWorker)) {
    return {
      valid: false,
      error: "Worker concurrency must be an integer between 1 and 16.",
      warning: null,
      parsedComputerCpu: null,
      parsedWorkerConcurrency: null,
      parsedEngineCpu: null,
    };
  }
  const workerConcurrency = Number(rawWorker);
  if (!Number.isInteger(workerConcurrency) || workerConcurrency < 1 || workerConcurrency > 64) {
    return {
      valid: false,
      error: "Worker concurrency must be an integer between 1 and 16.",
      warning: null,
      parsedComputerCpu: null,
      parsedWorkerConcurrency: null,
      parsedEngineCpu: null,
    };
  }

  let parsedEngineCpu: number | null = null;
  if (input.modifyEngine && input.snapshot.engine.configurable !== "readonly") {
    if (input.engineMemory.trim()) {
      const engMemBytes = memorySizeBytes(input.engineMemory);
      if (!engMemBytes || engMemBytes < 2 * gib || engMemBytes > hostMemory) {
        return {
          valid: false,
          error: "Engine memory must be between 2 GiB and total host memory.",
          warning: null,
          parsedComputerCpu: null,
          parsedWorkerConcurrency: null,
          parsedEngineCpu: null,
        };
      }
    }
    if (input.engineCpu.trim()) {
      if (!/^\d+$/.test(input.engineCpu.trim())) {
        return {
          valid: false,
          error: "Engine CPU cores must be an integer between 1 and host cores.",
          warning: null,
          parsedComputerCpu: null,
          parsedWorkerConcurrency: null,
          parsedEngineCpu: null,
        };
      }
      const engCpu = Number(input.engineCpu.trim());
      if (!Number.isInteger(engCpu) || engCpu < 1 || engCpu > hostCores) {
        return {
          valid: false,
          error: "Engine CPU cores must be an integer between 1 and host cores.",
          warning: null,
          parsedComputerCpu: null,
          parsedWorkerConcurrency: null,
          parsedEngineCpu: null,
        };
      }
      parsedEngineCpu = engCpu;
    }
  }

  let warning: string | null = null;
  if (engineMemory && computerBytes > Math.floor(engineMemory * 0.75)) {
    warning =
      "Computer memory exceeds 75% of the container engine's available memory and may cause instability.";
  }

  return {
    valid: true,
    error: null,
    warning,
    parsedComputerCpu,
    parsedWorkerConcurrency: workerConcurrency,
    parsedEngineCpu,
  };
};

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const KIB = 1024;

export const formatMegabytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / MIB;
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
};

export const formatGigabytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0.00 GB";
  return `${(bytes / 1000 ** 3).toFixed(2)} GB`;
};

export const formatFriendlyBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= GIB) {
    const val = bytes / GIB;
    const rounded = val >= 10 ? val.toFixed(1) : val.toFixed(1);
    return `${rounded.replace(/\.0$/, "")} GB`;
  }
  if (bytes >= MIB) {
    return `${Math.max(1, Math.round(bytes / MIB))} MB`;
  }
  if (bytes >= KIB) {
    return `${Math.max(1, Math.round(bytes / KIB))} KB`;
  }
  return `${Math.round(bytes)} B`;
};

export const formatMemoryGib = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "—";
  const bytes = typeof value === "number" ? value : memorySizeBytes(value);
  if (bytes === null) return String(value);
  const gib = bytes / GIB;
  const formatted = gib.toFixed(1).replace(/\.0$/, "");
  return `${formatted} GB`;
};

export const memoryStringToHalfGib = (value: string, fallbackGib: number): number => {
  const bytes = memorySizeBytes(value);
  if (!bytes) return fallbackGib;
  const rawGib = bytes / GIB;
  // Floor to 0.5 GB increments when derived from raw byte caps so default values stay under warning limits
  const floored = Math.floor(rawGib * 2 + 1e-6) / 2;
  return Math.max(1, floored);
};

export const halfGibToCliMemory = (gib: number): string => {
  const safe = Math.max(1, Math.round(gib * 2) / 2);
  if (Number.isInteger(safe)) return `${safe}g`;
  return `${Math.round(safe * 1024)}m`;
};

