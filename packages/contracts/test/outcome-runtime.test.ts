import { expect, test } from "bun:test";
import { Schema } from "effect";
import { OutcomeAttentionInput, ReconcileOutcomeInput } from "../src/outcome-runtime";

test("attention accepts finite foreground deltas without inferred identity or revision", () => {
  expect(Schema.decodeUnknownSync(OutcomeAttentionInput)({ clientRequestId: "delta:1", surface: "decision", seconds: 0.25 }))
    .toEqual({ clientRequestId: "delta:1", surface: "decision", seconds: 0.25 });
  for (const seconds of [0, -1, NaN, Infinity, 300.001]) expect(() =>
    Schema.decodeUnknownSync(OutcomeAttentionInput)({ clientRequestId: "delta:1", surface: "review", seconds })).toThrow();
  expect(() => Schema.decodeUnknownSync(OutcomeAttentionInput)({ clientRequestId: "delta:1", surface: "chat", seconds: 1 })).toThrow();
});

test("reconcile carries only an idempotent request identity", () => {
  expect(Schema.decodeUnknownSync(ReconcileOutcomeInput)({ clientRequestId: "reconcile:1", forceSuccess: true })).toEqual({ clientRequestId: "reconcile:1" });
  expect(() => Schema.decodeUnknownSync(ReconcileOutcomeInput)({ clientRequestId: "" })).toThrow();
});
