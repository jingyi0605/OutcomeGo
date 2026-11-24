import { existsSync, statfsSync } from "node:fs";
import { totalmem } from "node:os";
import { dirname } from "node:path";
import { MINIMUM_RECOMMENDED_DISK_BYTES, MINIMUM_RECOMMENDED_MEMORY_BYTES, VIEWER_PORT_START, VIEWER_PORT_END } from "./constants";
import type { DeployAction } from "./deploy-events";
import { cliTranslate } from "./localization";
import type { PortOccupant } from "./stack";

const gib = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

const availableDiskBytes = (path: string): number => {
  let directory = path;
  while (!existsSync(directory)) {
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const filesystem = statfsSync(directory);
  return Number(filesystem.bavail) * Number(filesystem.bsize);
};

interface ResourceIssue {
  code: "DISK_SPACE_LOW" | "MEMORY_LOW" | "PORT_IN_USE";
  message: string;
  action: DeployAction;
}

export const checkDeployResources = async (options: {
  directory: string;
  assetDirectory?: string;
  apiPort: number;
  guestMemoryBytes: number | null;
  acceptLowMemory?: boolean;
  findConflict: () => Promise<PortOccupant | null>;
  hostMemoryBytes?: () => number;
  diskBytes?: (directory: string) => number;
}): Promise<ResourceIssue | null> => {
  for (const directory of [options.directory, options.assetDirectory]) {
    if (!directory) continue;
    const available = (options.diskBytes ?? availableDiskBytes)(directory);
    if (available < MINIMUM_RECOMMENDED_DISK_BYTES) {
      const message = cliTranslate("Only {available} is available near {directory}; deployment needs {required}.", {
        available: gib(available), directory, required: gib(MINIMUM_RECOMMENDED_DISK_BYTES),
      });
      return { code: "DISK_SPACE_LOW", message, action: { kind: "free-disk", detail: message } };
    }
  }
  const host = (options.hostMemoryBytes ?? totalmem)();
  const guest = options.guestMemoryBytes;
  const minimumGuest = 4 * 1024 ** 3;
  if (!options.acceptLowMemory && (host < MINIMUM_RECOMMENDED_MEMORY_BYTES || (guest !== null && guest < minimumGuest))) {
    const message = host < MINIMUM_RECOMMENDED_MEMORY_BYTES
      ? cliTranslate("Your computer has {available} of memory; {required} is recommended.", { available: gib(host), required: gib(MINIMUM_RECOMMENDED_MEMORY_BYTES) })
      : cliTranslate("The engine has {available} of memory; deployment recommends at least {required}.", { available: gib(guest!), required: gib(minimumGuest) });
    return { code: "MEMORY_LOW", message, action: { kind: "confirm-low-memory", detail: message } };
  }
  const conflict = await options.findConflict();
  if (!conflict) return null;
  const { port, container, host: address } = conflict;
  const message = container
    ? cliTranslate("Port {port} on {address} is already in use by {container}.", { port, address, container })
    : cliTranslate("Port {port} on {address} is already in use by another local process.", { port, address });
  const detail = port === options.apiPort && (port < VIEWER_PORT_START || port > VIEWER_PORT_END)
    ? cliTranslate("Free port {port} or choose another API port.", { port })
    : cliTranslate("Free port {port}; the screen-viewer port range cannot be changed here.", { port });
  return { code: "PORT_IN_USE", message, action: { kind: "free-port", detail } };
};

export const validMemorySize = (value: string | undefined): value is string => {
  const match = value && /^(\d+)([kmgt]?)b?$/i.exec(value);
  if (!match) return false;
  const units = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
  const bytes = Number(match[1]) * units[match[2]!.toLowerCase() as keyof typeof units];
  return Number.isSafeInteger(bytes) && bytes >= 16 * 1024 ** 2;
};
