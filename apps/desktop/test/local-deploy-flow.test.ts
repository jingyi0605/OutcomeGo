import { expect, test } from "bun:test";
import { codes, type DeployProgress, type EngineProbe } from "../src/renderer/lib/local-deploy-contract";
import { deployIssue, deployProgress, emptyProgress, engineOptions, suggestedEngine } from "../src/renderer/lib/local-deploy-flow";

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
