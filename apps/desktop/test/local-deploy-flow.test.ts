import { expect, test } from "bun:test";
import { codes, type DeployProgress } from "../src/renderer/lib/local-deploy-contract";
import { deployIssue, deployProgress, emptyProgress } from "../src/renderer/lib/local-deploy-flow";

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
