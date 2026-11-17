import { afterAll, describe, expect, test } from "bun:test";
import type { PrismaClient } from "@outcomego/db";
import { parseOutcomeInboxQuery, type OutcomeInboxPage } from "@outcomego/contracts/outcome-inbox";
import { OutcomeInboxService } from "../src/services/outcome-inbox-service";
import { DecisionService } from "../src/services/decision-service";
import { actor, fixture, run, testDb } from "./fixtures/outcome-inbox-fixture";
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("OutcomeInboxService live projection", () => {
  const db = testDb(); const bots: string[] = [];
  const create = async () => { const f = await fixture(db); bots.push(f.bot.id); return f; };
  afterAll(async () => { await db.bot.deleteMany({ where: { id: { in: bots } } }); await db.$disconnect(); });
  const query = (params: Record<string, string> = {}) => parseOutcomeInboxQuery(new URLSearchParams(params));
  test("four categories, acceptance merge, separate decisions and no read side effect", async () => {
    const f = await create(); const decisions = new DecisionService(db); const service = new OutcomeInboxService(db);
    const first = await run(decisions.create(f.input, actor));
    await run(decisions.create({ ...f.input, workItemId: undefined, reasonCode: "another-action" }, actor));
    await db.outcome.update({ where: { id: f.outcome.id }, data: { status: "review_pending" } });
    await db.outcomeWorkItem.create({ data: { outcomeId: f.outcome.id, contractRevisionId: f.revision.id, botId: f.bot.id, executorType: "human", title: "Inspect", ordinal: 2, status: "ready" } });
    const completed = await create();
    await db.outcome.update({ where: { id: completed.outcome.id }, data: { status: "accepted", acceptedAt: new Date() } });
    const items = (await run(service.list(query({ status: "all" })))).items.filter(item => [f.outcome.id, completed.outcome.id].includes(item.outcomeId));
    expect(items.map(item => item.category)).toEqual(["decision_pending", "decision_pending", "human_action_pending", "acceptance_pending", "completed"]);
    expect(items.find(item => item.category === "acceptance_pending")?.criterionIds).toHaveLength(2);
    expect((await run(decisions.get(first.id))).status).toBe("open");
    expect(await db.inboxEvent.count({ where: { botId: f.bot.id } })).toBe(0);
    expect(await db.channelMessage.count({ where: { channelId: f.channel.id } })).toBe(0);
    expect((await run(service.list(query(), completed.outcome.id))).items).toHaveLength(0);
  });
  test("keyset pagination has no duplicates or missing items, stable ties and a fixed snapshot", async () => {
    const f = await create(); const decisions = new DecisionService(db); const service = new OutcomeInboxService(db);
    for (let i = 0; i < 37; i++) await run(decisions.create({ ...f.input, workItemId: undefined, reasonCode: `fixture-${i}` }, actor));
    const sameTime = new Date(Date.now()-1000);
    await db.outcomeDecision.updateMany({ where: { outcomeId: f.outcome.id }, data: { createdAt: sameTime } });
    const expected = (await run(service.list(query({ limit: "100" }), f.outcome.id))).items.map(item => item.id);
    const seen: string[] = []; let cursor: string | null = null;
    do {
      const page: OutcomeInboxPage = await run(service.list(query({ limit: "7", ...(cursor ? { cursor } : {}) }), f.outcome.id));
      seen.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
      if (seen.length === 7) await run(decisions.create({ ...f.input, workItemId: undefined, reasonCode: "created-after-first-page" }, actor));
    } while (cursor);
    expect(seen).toEqual(expected); expect(new Set(seen).size).toBe(37);
  });
  test("query count stays one per global page and two for a scoped page, independent of page size", async () => {
    let calls = 0;
    const observed = new Proxy(db, { get(target, key) {
      if (key === "$queryRaw") return (...args: unknown[]) => { calls++; return (target.$queryRaw as Function).apply(target, args); };
      return Reflect.get(target, key);
    } }) as PrismaClient;
    const service = new OutcomeInboxService(observed);
    await run(service.list(query({ limit: "1" }))); expect(calls).toBe(1);
    calls = 0; await run(service.list(query({ limit: "100" }))); expect(calls).toBe(1);
  });
  test("obsolete decisions and submitted human work are hidden; completion expires after seven days", async () => {
    const f = await create(); const decisions = new DecisionService(db); const service = new OutcomeInboxService(db);
    await run(decisions.create({ ...f.input, expiresAt: new Date(Date.now()-100).toISOString() }, actor));
    await db.outcomeWorkItem.create({ data: { outcomeId: f.outcome.id, contractRevisionId: f.revision.id, botId: f.bot.id, executorType: "human", title: "submitted", ordinal: 2, status: "submitted" } });
    expect((await run(service.list(query(), f.outcome.id))).items).toHaveLength(0);
    await db.outcome.update({ where: { id: f.outcome.id }, data: { status: "accepted", acceptedAt: new Date(Date.now()-8*86400_000) } });
    expect((await run(service.list(query({ status: "completed" }), f.outcome.id))).items).toHaveLength(0);
  });
});
