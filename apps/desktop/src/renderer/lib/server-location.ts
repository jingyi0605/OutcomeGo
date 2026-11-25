import type { LocalServerStatus } from "./local-deploy-contract";

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
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && Number(url.port || 80) === apiPort;
  } catch { return false; }
};
export const canDeleteLocalData = (checked: boolean, word: string) => checked && word === "DELETE";
export const memorySizeBytes = (value: string): number | null => {
  const match = /^(\d+)([kmgt]?)b?$/i.exec(value);
  if (!match) return null;
  const power = ["", "k", "m", "g", "t"].indexOf(match[2]!.toLowerCase());
  const bytes = Number(match[1]) * 1024 ** power;
  return Number.isSafeInteger(bytes) && bytes >= 1024 ** 3 ? bytes : null;
};

export const localMemoryChange = (computerMemory: string, desktopMemory: string, guestMemory?: number) => {
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
