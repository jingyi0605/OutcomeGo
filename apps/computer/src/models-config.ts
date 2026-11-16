import { Database } from "bun:sqlite";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ModelProviderConfig = {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};
export type ModelsDocument = {
  providers?: Record<string, ModelProviderConfig>;
  [key: string]: unknown;
};

export interface PrivateModelEndpoint {
  address: string;
  port: number;
}

const privateAddress = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    const first = parts[0] ?? -1;
    const second = parts[1] ?? -1;
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }
  return isIP(normalized) === 6 && normalized !== "::1" &&
    (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized));
};

export function privateModelEndpoints(document: ModelsDocument): PrivateModelEndpoint[] {
  const result = new Map<string, PrivateModelEndpoint>();
  for (const provider of Object.values(document.providers ?? {})) {
    if (typeof provider?.baseUrl !== "string") continue;
    try {
      const url = new URL(provider.baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        continue;
      if (!privateAddress(url.hostname)) continue;
      const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) continue;
      const address = url.hostname.toLowerCase();
      result.set(`${address}/${port}`, { address, port });
    } catch {
      /* Ignore one malformed provider and keep other model endpoints usable. */
    }
  }
  return [...result.values()].sort((left, right) =>
    `${left.address}/${left.port}`.localeCompare(`${right.address}/${right.port}`)
  );
}

export async function readModelsConfig(path: string): Promise<ModelsDocument> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      ("providers" in value &&
        (!value.providers || typeof value.providers !== "object" || Array.isArray(value.providers)))
    ) {
      throw new Error("Invalid provider registry");
    }
    return value as ModelsDocument;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      "The custom provider registry is invalid. Repair models.json before loading providers."
    );
  }
}

/** Lock the entire read/modify/write transaction, including across CLI processes. */
export async function updateModelsConfig(
  path: string,
  change: (document: ModelsDocument) => boolean | Promise<boolean>
): Promise<boolean> {
  path = resolve(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock.sqlite`;
  const lock = new Database(lockPath, { create: true });
  let held = false;
  try {
    await chmod(lockPath, 0o600);
    lock.exec("PRAGMA busy_timeout = 0");
    const deadline = Date.now() + 8_000;
    for (;;) {
      try {
        lock.exec("BEGIN IMMEDIATE");
        held = true;
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "SQLITE_BUSY" || Date.now() >= deadline)
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    const document = await readModelsConfig(path);
    if (!(await change(document))) return false;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return true;
  } finally {
    try {
      if (held) lock.exec("ROLLBACK");
    } finally {
      lock.close();
    }
  }
}
