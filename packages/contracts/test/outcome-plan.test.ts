import { expect, test } from "bun:test";
import { Schema } from "effect";
import { OutcomePlanAdvice, OutcomePlanMode, OutcomeTriageResult, PLAN_ADVICE_LIMITS, TurnAccessMode } from "../src/outcome-plan";
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

test("Plan advice enforces progressive-disclosure write bounds while keeping legacy stored records readable", () => {
  const decodeAdvice = Schema.decodeUnknownSync(OutcomePlanAdvice);
  expect(decodeAdvice({ schemaVersion: 1, ...advice }, strict)).toEqual({ schemaVersion: 1, ...advice });
  // Stored records created before concise bounds remain readable.
  const legacyStored = {
    schemaVersion: 1 as const,
    summary: "x".repeat(500),
    facts: Array.from({ length: 8 }, (_, index) => ({ statement: `Fact ${index}`, source: "legacy-log.txt" })),
    gaps: ["y".repeat(250)],
    recommendations: [{ action: "z".repeat(180), needsOwnerConfirm: true, reason: "r".repeat(300) }],
  };
  expect(decodeAdvice(legacyStored, strict)).toEqual(legacyStored);
  expect(() => decodeAdvice({ schemaVersion: 2, ...advice }, strict)).toThrow();
  expect(decodeOutcomeThreadInput("SavePlanAdvice", { ...advice, clientRequestId })).toEqual({ ...advice, clientRequestId });
  for (const extra of [
    { summary: "x".repeat(PLAN_ADVICE_LIMITS.summaryChars + 1) },
    { summary: "   " },
    { suggestedKind: "tracked" },
    { schemaVersion: 1 },
    { facts: [{ statement: "No source" }] },
    { facts: Array.from({ length: PLAN_ADVICE_LIMITS.maxFacts + 1 }, (_, i) => ({ statement: `F${i}`, source: "s" })) },
    { facts: [{ statement: "x".repeat(PLAN_ADVICE_LIMITS.factStatementChars + 1), source: "s" }] },
    { facts: [{ statement: "ok", source: "x".repeat(PLAN_ADVICE_LIMITS.factSourceChars + 1) }] },
    { gaps: Array.from({ length: PLAN_ADVICE_LIMITS.maxGaps + 1 }, (_, i) => `G${i}`) },
    { gaps: ["x".repeat(PLAN_ADVICE_LIMITS.gapChars + 1)] },
    { recommendations: [{ action: "Check" }] },
    { recommendations: Array.from({ length: PLAN_ADVICE_LIMITS.maxRecommendations + 1 }, (_, i) => ({ action: `R${i}`, needsOwnerConfirm: false })) },
    { recommendations: [{ action: "x".repeat(PLAN_ADVICE_LIMITS.recommendationActionChars + 1), needsOwnerConfirm: false }] },
    { recommendations: [{ action: "Check", needsOwnerConfirm: false, reason: "x".repeat(PLAN_ADVICE_LIMITS.recommendationReasonChars + 1) }] },
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
