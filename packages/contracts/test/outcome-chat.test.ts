import { expect, test } from "bun:test";
import { decodeOutcomeChatInput, OUTCOME_CHAT_TOOLS, OUTCOME_CHAT_TOOL_NAMES } from "../src/outcome-chat";
import { parseListOutcomesQuery } from "../src/outcomes";

test("native chat has planning/records/Explore tools and no owner approval or acceptance tool", () => {
  expect(OUTCOME_CHAT_TOOL_NAMES).toHaveLength(16);
  expect(OUTCOME_CHAT_TOOLS.map(tool => tool.name)).toEqual(OUTCOME_CHAT_TOOL_NAMES);
  expect(OUTCOME_CHAT_TOOL_NAMES.some(name => /approve|review|receipt/i.test(name))).toBe(false);
  const plan = OUTCOME_CHAT_TOOLS.find(tool => tool.name === "PlanOutcome")!;
  expect(plan.inputSchema).toMatchObject({ type: "object", required: ["sourceText", "clientRequestId"] });
  expect(decodeOutcomeChatInput("PlanOutcome", { sourceText: "Clean Unraid space", clientRequestId: "plan:unique" }))
    .toEqual({ sourceText: "Clean Unraid space", clientRequestId: "plan:unique" });
});

test("schemas reject forged actors, planning Bot, invalid status and unbounded inputs", () => {
  for (const extra of [{ actor: "owner:local" }, { context: { botId: crypto.randomUUID() } }]) {
    expect(() => decodeOutcomeChatInput("PlanOutcome", {
      sourceText: "Plan", clientRequestId: "plan:unique", ...extra,
    })).toThrow();
  }
  expect(() => decodeOutcomeChatInput("ListOutcomes", { query: "x".repeat(201) })).toThrow();
  expect(() => decodeOutcomeChatInput("ListOutcomes", { statuses: ["made_up"] })).toThrow();
  expect(() => decodeOutcomeChatInput("ListOutcomes", { limit: 101 })).toThrow();
  expect(() => decodeOutcomeChatInput("GetOutcome", { outcomeId: "not-a-uuid" })).toThrow();
  expect(() => decodeOutcomeChatInput("CreateExploreIdea", {
    title: "Idea", botId: crypto.randomUUID(), clientRequestId: "idea:unique",
  })).toThrow();
});

test("Outcome text search is optional and preserves the existing list query shape", () => {
  expect(parseListOutcomesQuery(new URLSearchParams())).toEqual({ statuses: [], cursor: null, limit: 20 });
  expect(parseListOutcomesQuery(new URLSearchParams("query=Unraid&status=running&limit=2")))
    .toMatchObject({ query: "Unraid", statuses: ["running"], limit: 2 });
  expect(() => parseListOutcomesQuery(new URLSearchParams({ query: "a".repeat(201) }))).toThrow();
});

test("TrackOutcome registers without planning and ties decision details to ownerNeed", () => {
  const base = { title: "Renew domain", goal: "Renew the domain before it expires", clientRequestId: "track:unique" };
  expect(decodeOutcomeChatInput("TrackOutcome", base)).toEqual(base);
  expect(decodeOutcomeChatInput("TrackOutcome", { ...base, ownerNeed: "approval" })).toMatchObject({ ownerNeed: "approval" });
  const decision = { problemSummary: "Renew for 1 or 3 years?", options: [{ label: "1 year", consequence: "Lower cost" }] };
  expect(decodeOutcomeChatInput("TrackOutcome", { ...base, ownerNeed: "decision", decision })).toMatchObject({ ownerNeed: "decision" });
  // A decision goal needs its question, and no other goal may carry one.
  expect(() => decodeOutcomeChatInput("TrackOutcome", { ...base, ownerNeed: "decision" })).toThrow();
  expect(() => decodeOutcomeChatInput("TrackOutcome", { ...base, decision })).toThrow();
  expect(() => decodeOutcomeChatInput("TrackOutcome", { ...base, ownerNeed: "approval", decision })).toThrow();
  expect(() => decodeOutcomeChatInput("TrackOutcome", { ...base, ownerNeed: "everything" })).toThrow();
  expect(() => decodeOutcomeChatInput("TrackOutcome", { ...base, actor: "owner:local" })).toThrow();
  expect(() => decodeOutcomeChatInput("TrackOutcome", { ...base, decision: { ...decision, options: [] }, ownerNeed: "decision" })).toThrow();
});

test("CloseOutcome needs a real target and a non-empty result summary", () => {
  const outcomeId = crypto.randomUUID();
  expect(decodeOutcomeChatInput("CloseOutcome", { outcomeId, resultSummary: "Renewed", clientRequestId: "close:unique" }))
    .toMatchObject({ resultSummary: "Renewed" });
  expect(() => decodeOutcomeChatInput("CloseOutcome", { outcomeId, resultSummary: "", clientRequestId: "close:unique" })).toThrow();
  expect(() => decodeOutcomeChatInput("CloseOutcome", { outcomeId: "nope", resultSummary: "x", clientRequestId: "close:unique" })).toThrow();
});
