import { realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { scopedProcessEnvironment } from "@outcomego/plugin-sdk";

type CachedBitwardenPackage = { pluginId?: unknown; installPath?: unknown };

export const BITWARDEN_REQUIRED_FIELDS = [
  "BW_SERVER_URL",
  "BW_EMAIL",
  "BW_CLIENT_ID",
  "BW_CLIENT_SECRET",
  "BW_MASTER_PASSWORD",
] as const;

export function parseBitwardenEnvironment(environment: unknown): Record<string, string> {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new Error("The Bitwarden runtime environment was invalid");
  }
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => {
      if (typeof value !== "string") {
        throw new Error("The Bitwarden runtime environment was invalid");
      }
      return [key, value];
    })
  );
}

/** Resolve the cached bw.sh wrapper inside the managed plugin package cache. */
export async function resolveBitwardenWrapper(
  root: string,
  installed: CachedBitwardenPackage & { installPath: string }
): Promise<string> {
  const allowedRoot = await realpath(join(root, "plugins", "cache"));
  const candidates = [installed.installPath];
  const normalized = installed.installPath.replaceAll("\\", "/");
  const marker = "/plugins/cache/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    candidates.push(
      join(root, "plugins", "cache", ...normalized.slice(markerIndex + marker.length).split("/"))
    );
  }
  for (const candidate of candidates) {
    const resolved = await realpath(join(candidate, "skills/bitwarden/scripts/bw.sh")).catch(
      () => null
    );
    if (resolved?.startsWith(`${allowedRoot}${sep}`)) return resolved;
  }
  throw new Error("The Bitwarden wrapper is outside the managed package cache");
}

/** Execute the managed bw.sh wrapper with an isolated per-invocation environment. */
export async function runBitwardenWrapper(
  args: readonly string[],
  environment: unknown,
  signal?: AbortSignal,
  timeoutMs = 150_000
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const configured = parseBitwardenEnvironment(environment);
  const root = process.env.OUTCOMEGO_AGENT_DATA_ROOT ?? "/agent-data";
  const cache = JSON.parse(await Bun.file(join(root, "plugin-skills", "cache.json")).text()) as {
    packages?: CachedBitwardenPackage[];
  };
  const installed = cache.packages?.find(
    (entry) => entry.pluginId === "bitwarden" && typeof entry.installPath === "string"
  );
  if (!installed || typeof installed.installPath !== "string") {
    throw new Error("The Bitwarden package is unavailable");
  }
  const resolvedWrapper = await resolveBitwardenWrapper(root, {
    installPath: installed.installPath,
  });
  const child = Bun.spawn(["bash", resolvedWrapper, ...args], {
    env: scopedProcessEnvironment(process.env, configured),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const onAbort = () => child.kill();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const [stdout] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    signal?.throwIfAborted();
    const parsed = JSON.parse(stdout) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The Bitwarden wrapper returned an invalid response");
    }
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
