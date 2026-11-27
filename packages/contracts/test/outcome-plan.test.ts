import { expect, test } from "bun:test";
import { Schema } from "effect";
import { OutcomePlanAdvice, OutcomePlanMode, OutcomeTriageResult, TurnAccessMode } from "../src/outcome-plan";
import {
  decodeOutcomeThreadInput,
  OUTCOME_GOAL_THREAD_TOOLS,
  OUTCOME_THREAD_TURN_STATUSES,
  RequestOutcomePlanInput,
  SendOutcomeThreadMessageInput,
  type OutcomeThreadTurnView,
} from "../src/outcome-thread";

const strict = { onExcessProperty: "error" } as const;
const clientRequestId = "plan:unique";
const advice = {
  summary: "One item needs confirmation.",
  facts: [{ statement: "A current backup exists.", source: "backup-report.md", verifiedAt: "2026-11-26T01:00:00Z" }],
  gaps: ["The retention policy is missing."],
  recommendations: [{ action: "Confirm the retention period.", needsOwnerConfirm: true }],
  suggestedKind: "explore_idea",
} as const;

test("Plan modes and access modes decode explicitly, and Plan requests support optional mode and revision", () => {
  const decodeMode = Schema.decodeUnknownSync(OutcomePlanMode);
  for (const mode of ["triage", "advice", "contract_plan"] as const) expect(decodeMode(mode)).toBe(mode);
  expect(() => decodeMode("inspection")).toThrow();
  const decodeAccess = Schema.decodeUnknownSync(TurnAccessMode);
  for (const mode of ["full", "research_readonly", "readonly_strict"] as const) expect(decodeAccess(mode)).toBe(mode);
  expect(() => decodeAccess(true)).toThrow();

  const decodePlan = Schema.decodeUnknownSync(RequestOutcomePlanInput);
  const request = { mode: "advice", prompt: "Look for recent evidence", expectedRevision: 2, workItemId: crypto.randomUUID(), clientRequestId } as const;
  expect(decodePlan(request, strict)).toEqual(request);
  expect(decodePlan({ clientRequestId }, strict)).toEqual({ clientRequestId });
  expect(() => decodePlan({ ...request, expectedRevision: 0 }, strict)).toThrow();
  expect(() => decodePlan({ ...request, workItemId: "not-a-uuid" }, strict)).toThrow();
  const message = { text: "  Please revise the assumptions.\n", mode: "contract_plan", clientRequestId } as const;
  expect(Schema.decodeUnknownSync(SendOutcomeThreadMessageInput)(message, strict)).toEqual(message);
});

test("a superseded Plan revision can be returned as cancelled with its skip reason", () => {
  const turn = {
    id: crypto.randomUUID(), purpose: "plan", trigger: "Automatic preparation", status: "cancelled",
    planMode: "advice", outcomeRevision: 1, reply: null, error: null, runId: null, skipReason: "schedule_superseded",
    createdAt: "2026-11-26T01:00:00Z", updatedAt: "2026-11-26T02:00:00Z",
  } satisfies OutcomeThreadTurnView;
  expect(OUTCOME_THREAD_TURN_STATUSES).toContain(turn.status);
});

test("Plan advice requires a sourced result and keeps the storage version separate from agent input", () => {
  const decodeAdvice = Schema.decodeUnknownSync(OutcomePlanAdvice);
  expect(decodeAdvice({ schemaVersion: 1, ...advice }, strict)).toEqual({ schemaVersion: 1, ...advice });
  expect(() => decodeAdvice({ schemaVersion: 2, ...advice }, strict)).toThrow();
  expect(decodeOutcomeThreadInput("SavePlanAdvice", { ...advice, clientRequestId })).toEqual({ ...advice, clientRequestId });
  for (const extra of [
    { summary: "x".repeat(2001) }, { summary: "   " }, { suggestedKind: "tracked" },
    { schemaVersion: 1 }, { facts: [{ statement: "No source" }] }, { recommendations: [{ action: "Check" }] },
  ]) {
    expect(() => decodeOutcomeThreadInput("SavePlanAdvice", { ...advice, clientRequestId, ...extra })).toThrow();
  }
  expect(OUTCOME_GOAL_THREAD_TOOLS.find((tool) => tool.name === "SavePlanAdvice")?.inputSchema).toHaveProperty("properties.facts");
});

test("ClassifyOutcome supports single conversion or a nonempty split without trusting injected IDs or status", () => {
  const single = { strategy: "single_convert", outcome: { kind: "note", title: "Keep these notes" }, summary: "Saved a note", clientRequestId } as const;
  expect(decodeOutcomeThreadInput("ClassifyOutcome", single)).toEqual(single);
  const split = {
    strategy: "split_from_note", sourceNote: { title: "Backup meeting" },
    children: [{ kind: "todo", title: "Check the backup" }, { kind: "standard", title: "Document recovery" }],
    summary: "Created one to-do and one goal", memoryFacts: ["Backup restoration requires approval."], clientRequestId,
  } as const;
  expect(decodeOutcomeThreadInput("ClassifyOutcome", split)).toEqual(split);
  for (const children of [[], [{ kind: "note", title: "Unexpected" }], [...split.children, { kind: "scheduled_once", title: "No date" }], [{ ...split.children[0], status: "open" }], [{ ...split.children[0], parentOutcomeId: crypto.randomUUID() }]]) {
    expect(() => decodeOutcomeThreadInput("ClassifyOutcome", { ...split, children })).toThrow();
  }
  expect(() => decodeOutcomeThreadInput("ClassifyOutcome", { ...single, children: split.children })).toThrow();
  expect(() => decodeOutcomeThreadInput("ClassifyOutcome", { ...single, memoryFacts: ["x".repeat(501)] })).toThrow();
});

test("Triage results bind every split to a source note and keep memory facts within 500 characters", () => {
  const decodeTriage = Schema.decodeUnknownSync(OutcomeTriageResult);
  const common = { schemaVersion: 1, sourceOutcomeId: crypto.randomUUID(), summary: "Classified intake" } as const;
  const single = { ...common, strategy: "single_convert", sourceKind: "todo", createdChildren: [] } as const;
  expect(decodeTriage(single, strict)).toEqual(single);
  const child = { kind: "todo", outcomeId: crypto.randomUUID(), title: "Check the backup" } as const;
  const split = { ...common, strategy: "split_from_note", sourceKind: "note", createdChildren: [child], memoryFacts: ["x".repeat(500)] } as const;
  expect(decodeTriage(split, strict)).toEqual(split);
  for (const bad of [
    { ...split, sourceKind: "todo" }, { ...split, createdChildren: [] }, { ...split, memoryFacts: ["x".repeat(501)] },
    { ...single, createdChildren: [child] }, { ...single, sourceOutcomeId: "not-a-uuid" },
  ]) {
    expect(() => decodeTriage(bad, strict)).toThrow();
  }
});
