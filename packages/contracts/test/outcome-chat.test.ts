import { expect, test } from "bun:test";
import { decodeOutcomeChatInput, OUTCOME_CHAT_TOOLS, OUTCOME_CHAT_TOOL_NAMES } from "../src/outcome-chat";
import { parseListOutcomesQuery } from "../src/outcomes";

test("native chat has planning/records/Explore tools and no owner approval or acceptance tool", () => {
  expect(OUTCOME_CHAT_TOOL_NAMES).toHaveLength(14);
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
