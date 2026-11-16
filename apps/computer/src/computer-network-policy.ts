import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import type {
  ComputerNetworkPolicySnapshot,
  ComputerNetworkPolicyStatus,
} from "@outcomego/contracts";

const MODEL_CONFIG = "/home/box/.pi/agent/models.json";
const HELPER = "/usr/lib/outcomego/bin/outcomego-computer-network.py";

type Options = {
  serverUrl: string;
  token: string;
  helper?: string;
  modelsPath?: string;
  intervalMs?: number;
  fetchTimeoutMs?: number;
  applyTimeoutMs?: number;
  apply?: (snapshot: ComputerNetworkPolicySnapshot) => Promise<{ modelEndpointCount: number }>;
  applied?: () => void;
};

const unknownStatus = (): ComputerNetworkPolicyStatus => ({
  state: "pending",
  appliedRevision: null,
  modelEndpointCount: 0,
  error: null,
});

export function startComputerNetworkPolicy(options: Options) {
  const modelsPath = options.modelsPath ?? MODEL_CONFIG;
  const controller = new AbortController();
  let stopped = false;
  let pending = false;
  let previousKey: string | undefined;
  let consecutiveFailures = 0;
  let retryAfter = 0;
  let failureStage: "fetch" | "apply" = "fetch";
  let status: ComputerNetworkPolicyStatus = unknownStatus();

  const apply =
    options.apply ??
    ((snapshot: ComputerNetworkPolicySnapshot) =>
      new Promise<{ modelEndpointCount: number }>((resolve, reject) => {
        execFile(
          "/usr/bin/python3",
          [
            "-I",
            "-S",
            options.helper ?? HELPER,
            "--network-policy",
            options.serverUrl,
            JSON.stringify(snapshot),
          ],
          {
            timeout: options.applyTimeoutMs ?? 15_000,
            signal: controller.signal,
            env: { PATH: process.env.PATH },
          },
          (error, stdout) => {
            if (error) {
              reject(new Error("Computer network policy could not be applied"));
              return;
            }
            try {
              const result = JSON.parse(stdout) as { modelEndpointCount?: unknown };
              const modelEndpointCount = Number(result.modelEndpointCount);
              if (!Number.isSafeInteger(modelEndpointCount) || modelEndpointCount < 0)
                throw new Error("invalid policy result");
              resolve({ modelEndpointCount });
            } catch {
              reject(new Error("Computer network policy returned an invalid result"));
            }
          }
        );
      }));

  const refresh = async () => {
    if (stopped || pending || Date.now() < retryAfter) return;
    pending = true;
    try {
      failureStage = "fetch";
      const response = await fetch(
        `${options.serverUrl.replace(/\/$/, "")}/api/v0/internal/computer-network-policy`,
        {
          headers: {
            authorization: `Bearer ${options.token}`,
            // Policy polling runs in the marked network worker. Do not reuse an
            // HTTP socket whose route may have been invalidated by nftables.
            connection: "close",
          },
          signal: AbortSignal.timeout(options.fetchTimeoutMs ?? 10_000),
        }
      );
      if (response.status === 404) {
        status = {
          state: "error",
          appliedRevision: null,
          modelEndpointCount: 0,
          error: "Computer network policy is not supported by the connected server.",
        };
        return;
      }
      if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
      const snapshot = (await response.json()) as ComputerNetworkPolicySnapshot;
      const metadata = await lstat(modelsPath).catch(() => undefined);
      const signature = [
        snapshot.revision,
        snapshot.mode,
        JSON.stringify(snapshot.rules),
        metadata
          ? `${metadata.dev}:${metadata.ino}:${metadata.mode}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`
          : "missing",
      ].join("|");
      if (signature === previousKey) {
        if (status.state === "error" && status.appliedRevision === snapshot.revision) {
          status = {
            state: "applied",
            appliedRevision: status.appliedRevision,
            modelEndpointCount: status.modelEndpointCount,
            error: null,
          };
          consecutiveFailures = 0;
          retryAfter = 0;
        }
        return;
      }
      status = {
        state: "applying",
        appliedRevision: status.appliedRevision,
        modelEndpointCount: status.modelEndpointCount,
        error: null,
      };
      failureStage = "apply";
      const result = await apply(snapshot);
      if (stopped) return;
      status = {
        state: "applied",
        appliedRevision: snapshot.revision,
        modelEndpointCount: result.modelEndpointCount,
        error: null,
      };
      previousKey = signature;
      consecutiveFailures = 0;
      retryAfter = 0;
      options.applied?.();
    } catch (error) {
      if (stopped) return;
      consecutiveFailures++;
      const maxDelay = failureStage === "fetch" ? 5_000 : 30_000;
      retryAfter = Date.now() + Math.min(maxDelay, 1_000 * 2 ** Math.min(consecutiveFailures - 1, 5));
      status = {
        state: "error",
        appliedRevision: status.appliedRevision,
        modelEndpointCount: status.modelEndpointCount,
        error: error instanceof Error ? error.message : "Computer network policy failed",
      };
    } finally {
      pending = false;
    }
  };
  const timer = setInterval(() => void refresh(), options.intervalMs ?? 2_000);
  timer.unref();
  void refresh();
  return {
    status: () => status,
    stop() {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    },
  };
}
