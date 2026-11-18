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
