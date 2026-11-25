import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/renderer/styles.css";
import LocalDeployFlow from "../../src/renderer/components/outcomego/local-deploy-flow";
import { I18nProvider } from "../../src/renderer/lib/i18n";
import type {
  DeployProgress,
  EngineProbe,
  EngineProbes,
  HostResources,
  Stage,
} from "../../src/renderer/lib/local-deploy-contract";

// The one-click local deployment screens without Electron: a fake desktop bridge answers the
// engine look and plays a deployment. Params: ?platform=darwin|win32, ?engines=ready|stopped|
// none|blocked|wsl|reboot|slow|failed|unsupported, ?freeze=<stage> (stop there; pull stops at
// 3 of 7 images), ?source=nju|daocloud|official|external, ?speed=<ms per beat>, ?theme=dark,
// Reload to start over. The language follows the browser's.
const params = new URL(window.location.href).searchParams;
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";

const platform = params.get("platform") === "win32" ? "win32" : "darwin";
const beat = Number(params.get("speed") ?? 700);
const probe = (state: EngineProbe["state"], extra: Partial<EngineProbe> = {}): EngineProbe => ({ state, reasons: [], ...extra });
const answers: Record<string, EngineProbes> = {
  ready: { external: probe("ready", { name: "Docker Engine", version: "27.3.1" }), managed: probe("needs-setup") },
  stopped: { external: probe("stopped", { name: "Docker Desktop" }), managed: probe("needs-setup") },
  none: { external: probe("needs-setup"), managed: probe("needs-setup") },
  blocked: { external: probe("unsupported", { reasons: ["Install or update Compose to 2.24.0 or newer."] }), managed: probe("needs-setup") },
  wsl: { external: probe("needs-setup"), managed: probe("needs-setup", { code: "WSL_NOT_ENABLED" }) },
  reboot: { external: probe("needs-setup"), managed: probe("needs-setup", { code: "REBOOT_REQUIRED" }) },
  unsupported: {
    external: probe("unsupported", { reasons: ["The container engine must report cgroup v2 support."] }),
    managed: probe("unsupported", { code: platform === "win32" ? "WINDOWS_UNSUPPORTED" : "MACOS_UNSUPPORTED" }),
  },
  failed: { external: probe("unknown"), managed: probe("unknown") },
};
const GiB = 1024 ** 3;
const resourcePresets: Record<string, HostResources> = {
  ok: { memoryBytes: 16 * GiB, diskAvailableBytes: 128.4 * GiB, cpuCores: 10, arch: platform === "win32" ? "x64" : "arm64", apiPort: 8787, apiPortAvailable: true },
  "low-mem": { memoryBytes: 6 * GiB, diskAvailableBytes: 64 * GiB, cpuCores: 4, arch: platform === "win32" ? "x64" : "arm64", apiPort: 8787, apiPortAvailable: true },
  "low-disk": { memoryBytes: 16 * GiB, diskAvailableBytes: 3.8 * GiB, cpuCores: 8, arch: platform === "win32" ? "x64" : "arm64", apiPort: 8787, apiPortAvailable: true },
  "port-busy": { memoryBytes: 16 * GiB, diskAvailableBytes: 86 * GiB, cpuCores: 8, arch: platform === "win32" ? "x64" : "arm64", apiPort: 8787, apiPortAvailable: false },
};
const mode = params.get("engines") ?? "ready";
const resourceMode = params.get("resources") ?? "ok";

let listener: ((event: DeployProgress) => void) | undefined;
const deployId = "00000000-0000-4000-8000-000000000000";
const emit = (payload: Record<string, unknown>) =>
  listener?.({ schemaVersion: 1, deployId, ts: new Date().toISOString(), ...payload } as DeployProgress);
const stage = (name: Stage, status: string, extra: Record<string, unknown> = {}) => emit({ type: "stage", stage: name, status, ...extra });
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const source = params.get("source") ?? "nju";
const host = { official: "ghcr.io", nju: "ghcr.nju.edu.cn", daocloud: "m.daocloud.io" }[source] ?? "ghcr.nju.edu.cn";
const freeze = params.get("freeze");

async function play() {
  const done = (name: Stage) => freeze === name;
  await wait(beat / 2);
  stage("detect", "started");
  await wait(beat);
  stage("detect", "completed");
  stage("engine", "started");
  if (done("engine")) return;
  await wait(beat * 2);
  stage("engine", "completed");
  stage("release", "started");
  if (done("release")) return;
  await wait(beat);
  stage("release", "completed");
  stage("configure", "started");
  await wait(beat / 2);
  stage("configure", "completed");
  stage("pull", "started");
  if (done("pull") && !params.get("source")) return;
  await wait(beat * 2);
  if (source !== "external") emit({ type: "log", stage: "pull", message: `Pulling server from ${host}.` });
  for (let current = 0; current <= 7; current++) {
    stage("pull", "progress", { current, total: 7 });
    if (done("pull") && current === 3) return;
    await wait(beat * 1.4);
    if (current === 4 && source === "nju") emit({ type: "log", stage: "pull", message: "Pulling worker from m.daocloud.io." });
  }
  stage("pull", "completed");
  stage("start", "started");
  if (done("start")) return;
  await wait(beat * 2);
  stage("start", "completed");
  stage("health", "started");
  if (done("health")) return;
  await wait(beat * 2);
  stage("health", "completed");
  stage("owner", "started");
  await wait(beat);
  stage("owner", "completed");
}

Object.defineProperty(window, "outcomego", {
  configurable: true,
  value: {
    platform,
    localServer: { status: async () => ({ stack: { state: "not-installed", services: [] }, apiPort: null, engine: null, version: null, ownerUsername: null, awaiting: null }), diagnostics: async () => "QA diagnostics" },
    localDeploy: {
      engines: async () => {
        await wait(mode === "slow" ? 60_000 : 900);
        const base = answers[mode] ?? answers.ready!;
        return { ...base, resources: resourcePresets[resourceMode] ?? resourcePresets.ok! };
      },
      start: async () => {
        void play();
        return { deployId };
      },
      cancel: async () => {
        emit({ type: "error", stage: "detect", code: "CANCELLED", retryable: true });
      },
      enableWsl: async () => ({ code: null }),
      onProgress: (callback: typeof listener) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <LocalDeployFlow onBack={() => undefined} onConnect={async () => undefined} />
    </I18nProvider>
  </React.StrictMode>
);
