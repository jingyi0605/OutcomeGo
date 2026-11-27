import { expect, test } from "bun:test";
import { decodeOutcomeChatInput, OUTCOME_CHAT_TOOLS, OUTCOME_CHAT_TOOL_NAMES } from "../src/outcome-chat";

const outcomeId = crypto.randomUUID();
const clientRequestId = "chat:unique";

test("ordinary chat exposes only the six unified tools", () => {
  expect(OUTCOME_CHAT_TOOL_NAMES).toEqual([
    "CreateOutcome", "UpdateOutcome", "QueryOutcomes", "GetOutcome", "ActOnOutcome", "PlanOutcome",
  ]);
  expect(OUTCOME_CHAT_TOOLS.map((tool) => tool.name)).toEqual(OUTCOME_CHAT_TOOL_NAMES);
  expect(OUTCOME_CHAT_TOOLS.find((tool) => tool.name === "CreateOutcome")?.inputSchema).toMatchObject({
    type: "object", required: expect.arrayContaining(["kind", "title", "clientRequestId"]),
  });
});

test("CreateOutcome handles all kinds, preserves notes, and keeps todo authorization explicit", () => {
  for (const kind of ["standard", "tracked", "todo", "explore_idea", "note"] as const) {
    const input = { kind, title: "Backup checklist", clientRequestId };
    expect(decodeOutcomeChatInput("CreateOutcome", input)).toEqual(input);
  }
  const note = { kind: "note", title: "Backup notes", description: "# Verified\n- Latest backup exists.", tags: ["backup"], clientRequestId } as const;
  expect(decodeOutcomeChatInput("CreateOutcome", note)).toEqual(note);
  const todo = { kind: "todo", title: "Check the latest backup", ownerMessageRef: crypto.randomUUID(), clientRequestId } as const;
  expect(decodeOutcomeChatInput("CreateOutcome", todo)).toEqual(todo);
  expect(() => decodeOutcomeChatInput("CreateOutcome", { ...todo, ownerMessageRef: "forged" })).toThrow();
  for (const extra of [{ actor: "owner:local" }, { approved: true }, { status: "open" }, { autoPlan: false }]) {
    expect(() => decodeOutcomeChatInput("CreateOutcome", { ...note, ...extra })).toThrow();
  }
  const schedule = { kind: "scheduled_once", title: "Check tomorrow", description: "Check the latest backup report.", clientRequestId };
  expect(() => decodeOutcomeChatInput("CreateOutcome", schedule)).toThrow();
  expect(decodeOutcomeChatInput("CreateOutcome", { ...schedule, scheduledAt: "2099-12-01T09:00:00Z" })).toMatchObject(schedule);
});

test("QueryOutcomes finds notes by kind, tags, text and date; GetOutcome keeps revision and transcript options", () => {
  const query = {
    kinds: ["note", "todo"], statuses: ["active", "open"], tags: ["backup"], query: "weekly",
    from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z", limit: 10,
  } as const;
  expect(decodeOutcomeChatInput("QueryOutcomes", query)).toEqual(query);
  for (const extra of [{ kinds: ["other"] }, { statuses: ["other"] }, { query: "x".repeat(201) }, { limit: 101 }, { to: "2026-09-01T00:00:00Z" }]) {
    expect(() => decodeOutcomeChatInput("QueryOutcomes", { ...query, ...extra })).toThrow();
  }
  const get = { outcomeId, revision: 2, workItemId: crypto.randomUUID(), before: 10, limit: 5 };
  expect(decodeOutcomeChatInput("GetOutcome", get)).toEqual(get);
  expect(() => decodeOutcomeChatInput("GetOutcome", { outcomeId: "not-a-uuid" })).toThrow();
});

test("UpdateOutcome supports in-place conversion, and ActOnOutcome rejects owner-only and mismatched actions", () => {
  const update = { outcomeId, expectedRevision: 2, description: "# Revised", tags: ["weekly"], targetKind: "todo", clientRequestId } as const;
  expect(decodeOutcomeChatInput("UpdateOutcome", update)).toEqual(update);
  expect(decodeOutcomeChatInput("UpdateOutcome", { outcomeId, expectedRevision: 2, targetKind: "todo", clientRequestId })).toMatchObject({ targetKind: "todo" });
  expect(() => decodeOutcomeChatInput("UpdateOutcome", { ...update, targetKind: "other" })).toThrow();
  expect(() => decodeOutcomeChatInput("UpdateOutcome", { ...update, expectedRevision: 0 })).toThrow();
  expect(() => decodeOutcomeChatInput("UpdateOutcome", { outcomeId, expectedRevision: 2, clientRequestId })).toThrow();
  expect(() => decodeOutcomeChatInput("UpdateOutcome", {
    ...update, prepareAt: "2099-12-01T10:00:00Z", scheduledAt: "2099-12-01T09:00:00Z",
  })).toThrow();
  const snooze = { outcomeId, action: "snooze", payload: { snoozeUntil: "2099-12-01T09:00:00Z" }, clientRequestId } as const;
  expect(decodeOutcomeChatInput("ActOnOutcome", snooze)).toEqual(snooze);
  const close = { outcomeId, action: "close_tracked", payload: { resultSummary: "Weekly backup verified" }, clientRequestId } as const;
  expect(decodeOutcomeChatInput("ActOnOutcome", close)).toEqual(close);
  for (const invalid of [{ action: "approve" }, { action: "accept_outcome" }, { action: "snooze" }, { action: "close_tracked", payload: { resultSummary: "" } }]) {
    expect(() => decodeOutcomeChatInput("ActOnOutcome", { outcomeId, clientRequestId, ...invalid })).toThrow();
  }
});

test("PlanOutcome uses the shared Plan request and accepts an omitted mode", () => {
  const plan = { outcomeId, clientRequestId };
  expect(decodeOutcomeChatInput("PlanOutcome", plan)).toEqual(plan);
  expect(decodeOutcomeChatInput("PlanOutcome", { ...plan, mode: "advice", prompt: "Check the backup notes", expectedRevision: 1 })).toMatchObject({ mode: "advice" });
  expect(() => decodeOutcomeChatInput("PlanOutcome", { ...plan, mode: "inspection" })).toThrow();
  expect(() => decodeOutcomeChatInput("PlanOutcome", { ...plan, mode: "triage" })).toThrow();
});
