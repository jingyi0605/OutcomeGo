import { expect, test } from "bun:test";
import { outcomeDispatchEnabled } from "../src/outcome-availability";
import { routeOutcomeNextStep, OUTCOME_RECOVERY_PROMPT } from "../src/outcome-recovery";

test("five durable workflow facts route to their actual product owner", () => {
  expect(routeOutcomeNextStep({ type: "decision", decisionId: "decision" })).toEqual({ kind: "NEEDS_USER_DECISION", decisionId: "decision" });
  expect(routeOutcomeNextStep({ type: "human", workItemId: "human" })).toEqual({ kind: "MANUAL_ACTION", workItemId: "human" });
  expect(routeOutcomeNextStep({ type: "completed", workItemId: "agent" })).toEqual({ kind: "ALLOW", workItemId: "agent" });
  expect(routeOutcomeNextStep({ type: "interrupted", workItemId: "agent", decisionId: "unknown" })).toEqual({ kind: "NEEDS_USER_DECISION", decisionId: "unknown" });
  expect(routeOutcomeNextStep({ type: "unsupported", actionType: "unknown-executor" }).kind).toBe("UNSUPPORTED");
  expect(OUTCOME_RECOVERY_PROMPT).toContain("verify work already completed");
  expect(OUTCOME_RECOVERY_PROMPT).toContain("Do not repeat sends");
});

test("operational rollback is explicit and leaves the default dispatch behavior intact", () => {
  expect(outcomeDispatchEnabled({})).toBe(true);
  for (const value of ["false", "FALSE", "0"]) expect(outcomeDispatchEnabled({ OUTCOMEGO_OUTCOMES_ENABLED: value })).toBe(false);
  expect(outcomeDispatchEnabled({ OUTCOMEGO_OUTCOMES_ENABLED: "true" })).toBe(true);
});
