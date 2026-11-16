import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";

/** Runs independently of management DNS inside the marked relay worker.
 * The Python helper validates private configuration and owns route changes. */
export function startHostBridgeDiscovery(
  serverUrl: string,
  options: {
    intervalMs?: number;
    configurationPath?: string;
    configurationPaths?: string[];
    helper?: string;
    apply?: () => Promise<void>;
  } = {}
) {
  const configurationPaths = options.configurationPaths ?? [
    options.configurationPath ?? "/home/box/.config/openteam/imessage-bridge.json",
    "/home/box/.pi/agent/models.json",
  ];
  const controller = new AbortController();
  let stopped = false,
    pending = false,
    previous: string | undefined;
  const apply =
    options.apply ??
    (() =>
      new Promise<void>((resolve, reject) => {
        execFile(
          "/usr/bin/python3",
          [
            "-I",
            "-S",
            options.helper ?? "/usr/lib/outcomego/bin/outcomego-computer-network.py",
            "--host-bridge",
            serverUrl,
          ],
          { timeout: 10_000, signal: controller.signal, env: { PATH: process.env.PATH } },
          (error) => (error ? reject(new Error("Host bridge route unavailable")) : resolve())
        );
      }));
  const refresh = async () => {
    if (stopped || pending) return;
    pending = true;
    try {
      const metadata = await Promise.all(
        configurationPaths.map((path) =>
          lstat(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
            throw error;
          })
        )
      );
      if (stopped) return;
      const signature = metadata
        .map((item) =>
          item
            ? `${item.dev}:${item.ino}:${item.mode}:${item.size}:${item.mtimeMs}:${item.ctimeMs}`
            : "missing"
        )
        .join("|");
      if (signature !== previous) {
        await apply();
        if (stopped) return;
        // Cache the pre-apply snapshot so a change during application is
        // observed again on the next tick, including configuration removal.
        previous = signature;
      }
    } catch {
      // Preserve the last successful signature and retry transient failures.
    } finally {
      pending = false;
    }
  };
  const timer = setInterval(() => void refresh(), options.intervalMs ?? 2000);
  timer.unref();
  void refresh();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    },
  };
}
