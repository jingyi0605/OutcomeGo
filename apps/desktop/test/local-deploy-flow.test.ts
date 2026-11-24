import { expect, test } from "bun:test";
import { codes, type DeployProgress, type EngineProbe, stages } from "../src/renderer/lib/local-deploy-contract";
import {
  activeStage, deployFraction, deployIssue, deployProgress, emptyProgress, engineOptions, sourceOfLog, stageCopy,
  stageWeights, stepState, suggestedEngine,
} from "../src/renderer/lib/local-deploy-flow";

const envelope = { schemaVersion: 1, deployId: "test", ts: "2026-11-24T00:00:00Z" } as const;

test("all deployment error codes have distinct actionable copy", () => {
  expect(new Set(codes.map(deployIssue)).size).toBe(codes.length);
});

test.each(["username", "password", "apiPort", "stdin"] as const)("preserves the invalid %s field", field => {
  const event: DeployProgress = { ...envelope, type: "error", code: "INVALID_INPUT", retryable: true, stage: "detect", field };
  expect(deployProgress(emptyProgress(), event)).toMatchObject({ issue: { code: "INVALID_INPUT", field }, busy: false });
});

test("tracks pull progress and resets on retry", () => {
  const progress = deployProgress(emptyProgress(), { ...envelope, type: "stage", stage: "pull", status: "progress", current: 2, total: 7 });
  expect(progress).toMatchObject({ stage: "pull", current: 2, total: 7, busy: true });
  expect(emptyProgress()).toMatchObject({ stage: "detect", busy: true, issue: null });
});

test("ends on cancellation", () => {
  expect(deployProgress(emptyProgress(), { ...envelope, type: "error", stage: "pull", code: "CANCELLED", retryable: true })).toMatchObject({ busy: false, issue: { code: "CANCELLED" } });
});

test("preserves the low-memory prompt until the user chooses whether to retry", () => {
  const prompt = deployProgress(emptyProgress(), { ...envelope, type: "action-required", action: { kind: "confirm-low-memory" } });
  expect(deployProgress(prompt, { ...envelope, type: "error", stage: "detect", code: "MEMORY_LOW", retryable: true })).toMatchObject({ busy: false, action: { kind: "confirm-low-memory" } });
});

const stage = (name: (typeof stages)[number], status: "started" | "completed" | "skipped" | "progress", extra: { current?: number; total?: number } = {}): DeployProgress =>
  ({ ...envelope, type: "stage", stage: name, status, ...extra });
const log = (message: string, name: (typeof stages)[number] = "pull"): DeployProgress => ({ ...envelope, type: "log", stage: name, message });

test("remembers which stages finished or were already satisfied, and moves on after a completion", () => {
  let progress = deployProgress(emptyProgress(), stage("detect", "completed"));
  progress = deployProgress(progress, stage("release", "skipped"));
  expect(progress.done).toEqual({ detect: "completed", release: "skipped" });
  expect(stepState(progress, "detect")).toBe("done");
  expect(stepState(progress, "release")).toBe("skipped");
  expect(activeStage(progress)).toBe("engine");
  expect(stepState(progress, "engine")).toBe("active");
  expect(stepState(progress, "pull")).toBe("pending");
});

test("a failure marks the working stage and nothing else", () => {
  const progress = deployProgress(deployProgress(emptyProgress(), stage("pull", "started")), { ...envelope, type: "error", stage: "pull", code: "IMAGE_PULL_FAILED", retryable: true });
  expect(stepState(progress, "pull")).toBe("failed");
  expect(stages.filter(name => stepState(progress, name) === "failed")).toEqual(["pull"]);
});

test.each([
  ["Pulling server from ghcr.io.", "official"],
  ["Pulling postgres from registry-1.docker.io.", "official"],
  ["Pulling server from ghcr.nju.edu.cn.", "nju"],
  ["Pulling postgres from docker.nju.edu.cn.", "nju"],
  ["正在从 m.daocloud.io 拉取 worker。", "daocloud"],
  ["Image pull failed from m.daocloud.io.", "daocloud"],
])("reads the image source from %j in any language", (message, source) => {
  expect(sourceOfLog(message)).toBe(source);
});

test.each(["Pulling server.", "Starting services", "ghcr.io.evil.example", undefined])("ignores log lines that do not name a known registry: %j", message => {
  expect(sourceOfLog(message)).toBeNull();
});

test("tracks image sources in the order they were used, once each in a row", () => {
  let progress = emptyProgress();
  for (const message of ["Pulling a from ghcr.io.", "Image pull failed from ghcr.io.", "Pulling a from ghcr.nju.edu.cn.", "Pulling b from ghcr.nju.edu.cn.", "Pulling c from m.daocloud.io."]) {
    progress = deployProgress(progress, log(message));
  }
  expect(progress.sources).toEqual(["official", "nju", "daocloud"]);
  expect(deployProgress(progress, log("something unrelated")).sources).toBe(progress.sources);
});

test("overall progress follows stage weights and the image count, and never goes backwards", () => {
  expect(deployFraction(emptyProgress())).toBeGreaterThan(0);
  let progress = emptyProgress();
  let previous = 0;
  for (const name of stages) {
    if (name === "pull") {
      for (let current = 0; current <= 4; current++) {
        progress = deployProgress(progress, stage("pull", "progress", { current, total: 4 }));
        expect(deployFraction(progress)).toBeGreaterThanOrEqual(previous);
        previous = deployFraction(progress);
      }
    }
    progress = deployProgress(progress, stage(name, "completed"));
    expect(deployFraction(progress)).toBeGreaterThanOrEqual(previous);
    previous = deployFraction(progress);
  }
  expect(previous).toBe(1);
  expect(Object.values(stageWeights).reduce((sum, weight) => sum + weight, 0)).toBe(100);
});

test("every stage has its own plain-language introduction, and macOS names the virtual machine", () => {
  const notes = stages.map(name => stageCopy(name, "win32", "managed").note);
  expect(new Set(notes).size).toBe(stages.length);
  expect(stageCopy("engine", "darwin", "managed").title).toBe("Preparing the virtual machine");
  expect(stageCopy("engine", "darwin", "external").title).toBe("Preparing the container engine");
  expect(stageCopy("engine", "darwin", "external").note).not.toBe(stageCopy("engine", "darwin", "managed").note);
});

const probe = (state: EngineProbe["state"], extra: Partial<EngineProbe> = {}): EngineProbe => ({ state, reasons: [], ...extra });
const choose = (external: EngineProbe, managed: EngineProbe | null, platform = "darwin", resuming = false) => {
  const options = engineOptions({ external, managed }, platform, resuming);
  return { options, suggested: suggestedEngine(options), external: options[0]!, managed: options[1]! };
};

test("suggests nothing while the engines are still being looked at", () => {
  const options = engineOptions(null, "darwin");
  expect(options.map(option => option.tone)).toEqual(["checking", "checking"]);
  expect(suggestedEngine(options)).toBeNull();
  expect(options.every(option => option.selectable)).toBe(true);
});

test("a running engine of your own is the suggestion and shows its version", () => {
  const found = choose(probe("ready", { name: "Docker Engine", version: "27.3.1" }), probe("needs-setup"));
  expect(found.suggested).toBe("external");
  expect(found.external).toMatchObject({ tone: "ready", status: "Ready to use", meta: "Docker Engine 27.3.1", recommended: true });
  expect(found.managed).toMatchObject({ tone: "setup", status: "Installs automatically", recommended: false, selectable: true });
});

test.each([["stopped"], ["needs-setup"], ["unsupported"], ["unknown"]] as const)("without a running engine of your own (%s) the OutcomeGo engine is suggested", state => {
  const found = choose(probe(state, state === "unsupported" ? { reasons: ["Compose is too old."] } : {}), probe("needs-setup"));
  expect(found.suggested).toBe("managed");
});

test("an engine that cannot run OutcomeGo is shown with its reason and cannot be picked", () => {
  const found = choose(probe("unsupported", { reasons: ["Compose is too old."] }), probe("needs-setup"));
  expect(found.external).toMatchObject({ tone: "blocked", status: "Not compatible", detail: "Compose is too old.", selectable: false, recommended: false });
});

test("when this computer cannot host the OutcomeGo engine, only a running engine of your own is suggested", () => {
  const unsupported = probe("unsupported", { code: "MACOS_UNSUPPORTED" });
  expect(choose(probe("ready"), unsupported).suggested).toBe("external");
  expect(choose(probe("stopped"), unsupported).suggested).toBe("external");
  const nothing = choose(probe("needs-setup"), unsupported);
  expect(nothing.suggested).toBeNull();
  expect(nothing.managed).toMatchObject({ tone: "blocked", selectable: false, detail: expect.stringContaining("macOS 13.5") });
});

test("Windows explains the one-time WSL setup and a pending restart", () => {
  expect(choose(probe("needs-setup"), probe("needs-setup", { code: "WSL_NOT_ENABLED" }), "win32").managed)
    .toMatchObject({ tone: "attention", status: "Needs one-time setup", detail: expect.stringContaining("administrator approval"), selectable: true });
  expect(choose(probe("needs-setup"), probe("needs-setup", { code: "REBOOT_REQUIRED" }), "win32").managed)
    .toMatchObject({ tone: "attention", status: "Restart needed", detail: expect.stringContaining("Restart your computer") });
  expect(choose(probe("needs-setup"), probe("needs-setup"), "win32").managed.about).toContain("WSL 2");
  expect(choose(probe("needs-setup"), probe("needs-setup"), "darwin").managed.about).toContain("virtual machine");
});

test("a deployment waiting on a restart can only continue with the OutcomeGo engine", () => {
  const found = choose(probe("ready"), probe("needs-setup", { code: "REBOOT_REQUIRED" }), "win32", true);
  expect(found.suggested).toBe("managed");
  expect(found.external).toMatchObject({ selectable: false, recommended: false });
});

test("when neither engine could be looked at, nothing is suggested and both stay available", () => {
  const found = choose(probe("unknown"), probe("unknown"));
  expect(found.suggested).toBeNull();
  expect([found.external.selectable, found.managed.selectable]).toEqual([true, true]);
});
