import { expect, test } from "bun:test";
import { Schema } from "effect";
import { REQUEST_OUTCOME_DECISION_TOOL, RequestOutcomeDecisionInput } from "../src/outcome-inbox";
const input = { completedSummary: "Compared options", problemSummary: "No unresolved issue", nextStepSummary: "Choose the next step", reasonCode: "missing_input", options: [{ label: "Continue", consequence: "Keep the contract", recommended: true, reason: "Enough information" }] } satisfies RequestOutcomeDecisionInput;
test("Decision tool keeps the specified summaries and optional effect snapshots", () => {
  expect(Schema.decodeUnknownSync(RequestOutcomeDecisionInput)(input)).toEqual(input);
  expect(REQUEST_OUTCOME_DECISION_TOOL.name).toBe("RequestOutcomeDecision");
  expect(REQUEST_OUTCOME_DECISION_TOOL.inputSchema).toHaveProperty("properties.options");
  expect(Schema.decodeUnknownSync(RequestOutcomeDecisionInput)({ ...input, options: [{ ...input.options[0], resolutionEffect: "plan_only", supplement: { title: "Compare one detail", instructions: "Research under the approved boundaries" } }] }).options[0]?.supplement?.title).toBe("Compare one detail");
});
test("Decision tool rejects arbitrary effects, empty options and missing summaries", () => {
  for (const bad of [{ ...input, options: [] }, { ...input, options: [{ ...input.options[0], resolutionEffect: "grant_permission" }] }, { ...input, problemSummary: undefined }]) expect(() => Schema.decodeUnknownSync(RequestOutcomeDecisionInput)(bad)).toThrow();
});

// Specs/004.10 task 2.7: only RequestHumanAction carries a booked time and a deadline for a human task. A manual-action
// option proposed through a decision does not, and this pins that the dates are dropped rather than carried or refused,
// so the gap is a known one and not a surprise.
test("a manual-action option in a decision does not carry the human task's dates: they are dropped, not honoured", () => {
  const manualAction = { title: "Check", purpose: "Observe", steps: ["Inspect"], evidenceRequirements: [{ criterionOrdinal: 1, label: "Log", kind: "text" as const }] };
  const decoded = Schema.decodeUnknownSync(RequestOutcomeDecisionInput)({
    ...input,
    options: [{ ...input.options[0], resolutionEffect: "manual_action", manualAction: { ...manualAction, scheduledAt: "2026-12-01T09:00:00Z", dueAt: "2026-12-05T09:00:00Z" } }],
  });
  expect(decoded.options[0]!.manualAction).toEqual(manualAction);
});
