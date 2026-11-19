import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { OutcomePlanningService, parsePlanningGeneration } from "../src/services/outcome-planning-service";
import { outcomeFixture, requestId, testDatabaseUrl, failureCode } from "./fixtures/outcome-fixture";

const generated = { goal: [{ text: "Compare backups", id: "forged", recommended: true, reason: "Matches the request" }], acceptance: [{ text: "Compare costs" }], boundaries: [{ text: "Production writes", kind: "excluded" }], questions: ["Which plans?"] };
test("planning caps four options, clips text, assigns IDs, and surfaces questions", () => {
  const data = parsePlanningGeneration(JSON.stringify({ ...generated, goal: Array.from({ length: 7 }, () => ({ text: "x".repeat(600), id: "forged", recommended: true })) }));
  expect(data.goal.options).toHaveLength(4);
  expect(data.goal.options.map(o => o.id)).toEqual(["goal-1", "goal-2", "goal-3", "goal-4"]);
  expect(data.goal.options[0]?.text).toHaveLength(500);
  expect(data.goal.options[0]?.recommended).toBeUndefined();
  expect(data.conflicts[0]).toMatchObject({ code: "ambiguous_scope", severity: "informational" });
  expect(data.boundaries.options[0]?.kind).toBe("excluded");
});

describe.skipIf(!testDatabaseUrl)("OutcomePlanningService", () => {
  const f = outcomeFixture();
  afterAll(() => f.close());
  test("persists 24h snapshots, replays retries and rejects forged selected IDs", async () => {
    const bot = await f.bot(); let calls = 0;
    const service = new OutcomePlanningService(f.prisma, async () => { calls++; return { text: JSON.stringify(generated) }; });
    const input = { sourceText: "Compare backups", context: { botId: bot.id }, clientRequestId: requestId() };
    const plan = await Effect.runPromise(service.create(input));
    expect((Date.parse(plan.expiresAt) - Date.parse(plan.generatedAt)) / 3600_000).toBeCloseTo(24, 2);
    expect(await Effect.runPromise(service.get(plan.planId))).toEqual(plan);
    expect(await Effect.runPromise(service.create(input))).toEqual(plan);
    expect(calls).toBe(1);
    expect(await failureCode(service.create({ ...input, sourceText: "Different" }))).toBe("idempotency_conflict");
    expect(await failureCode(f.outcomes.createFromDraft({ planId: plan.planId, title: "t", clientRequestId: requestId(), goal: { selectedOptionIds: ["forged"], customEntries: [] }, acceptance: { selectedOptionIds: ["acceptance-1"], customEntries: [] }, boundaries: { selectedOptionIds: [], customEntries: [] } }, "owner:local"))).toBe("planning_option_not_found");
  });
  test("non-JSON retries once; a valid second response succeeds", async () => {
    const bot = await f.bot(); let calls = 0;
    const service = new OutcomePlanningService(f.prisma, async () => ({ text: ++calls === 1 ? "not json" : JSON.stringify(generated) }));
    const result = await Effect.runPromise(service.create({ sourceText: "Compare", context: { botId: bot.id }, clientRequestId: requestId() }));
    expect(result.status).toBe("ready"); expect(calls).toBe(2);
  });
  for (const mode of ["non-json", "empty", "timeout"] as const) test(`${mode} returns retryable error and readable failed draft`, async () => {
    const bot = await f.bot(); let calls = 0;
    const service = new OutcomePlanningService(f.prisma, async () => { calls++; if (mode === "timeout") throw new Error("timeout"); return { text: mode === "empty" ? "{}" : "invalid" }; });
    const input = { sourceText: "Compare", context: { botId: bot.id }, clientRequestId: requestId() };
    const result = await Effect.runPromise(Effect.either(service.create(input)));
    expect(result._tag).toBe("Left");
    if (result._tag !== "Left") return;
    const error = result.left as Error & { details: { retryable: boolean; planId: string }; code: string };
    expect(error.code).toBe("planning_generation_failed"); expect(error.details.retryable).toBe(true);
    const failed = await Effect.runPromise(service.get(error.details.planId));
    expect(failed.status).toBe("failed"); expect(failed.error?.retryable).toBe(true);
    expect(calls).toBe(mode === "timeout" ? 1 : 2);
    await failureCode(service.create(input)); expect(calls).toBe(mode === "timeout" ? 1 : 2);
  });
  test("empty input never calls computer; expiry reads expired and cleanup deletes", async () => {
    const bot = await f.bot(); let calls = 0;
    const service = new OutcomePlanningService(f.prisma, async () => { calls++; return { text: JSON.stringify(generated) }; });
    expect(await failureCode(service.create({ sourceText: "  ", context: { botId: bot.id }, clientRequestId: requestId() }))).toBe("invalid_request"); expect(calls).toBe(0);
    const plan = await Effect.runPromise(service.create({ sourceText: "Compare", context: { botId: bot.id }, clientRequestId: requestId() }));
    await f.prisma.outcomePlanningDraft.update({ where: { id: plan.planId }, data: { expiresAt: new Date(0) } });
    expect((await Effect.runPromise(service.get(plan.planId))).status).toBe("expired");
    await service.pruneExpired(); expect(await failureCode(service.get(plan.planId))).toBe("planning_draft_not_found");
  });
});
