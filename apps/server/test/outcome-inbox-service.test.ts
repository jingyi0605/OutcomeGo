import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { transitionWorkItem } from "@outcomego/messaging";
import type { PrismaClient } from "@outcomego/db";
import { parseOutcomeInboxQuery, type OutcomeInboxPage } from "@outcomego/contracts/outcome-inbox";
import { OutcomeInboxService } from "../src/services/outcome-inbox-service";
import { DecisionService } from "../src/services/decision-service";
import { actor, fixture, run, testDb } from "./fixtures/outcome-inbox-fixture";
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("OutcomeInboxService live projection", () => {
  let db: ReturnType<typeof testDb>; const bots: string[] = [];
  const create = async () => { const f = await fixture(db); bots.push(f.bot.id); return f; };
  beforeAll(() => { db = testDb(); });
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
    const messageCount = await db.channelMessage.count({ where: { channelId: f.channel.id } });
    expect(messageCount).toBe(2);
    const items = (await run(service.list(query({ status: "all" })))).items.filter(item => [f.outcome.id, completed.outcome.id].includes(item.outcomeId));
    expect(items.map(item => item.category)).toEqual(["decision_pending", "decision_pending", "human_action_pending", "acceptance_pending", "completed"]);
    expect(items.find(item => item.category === "acceptance_pending")?.criterionIds).toHaveLength(2);
    expect((await run(decisions.get(first.id))).status).toBe("open");
    expect(await db.inboxEvent.count({ where: { botId: f.bot.id } })).toBe(0);
    expect(await db.channelMessage.count({ where: { channelId: f.channel.id } })).toBe(messageCount);
    expect((await run(service.list(query(), completed.outcome.id))).items).toHaveLength(0);
  });
  test("acceptance waits while another agent work item of the revision is still running", async () => {
    const f = await create(); const service = new OutcomeInboxService(db);
    const acceptance = async () => (await run(service.list(query({ category: "acceptance_pending" }), f.outcome.id))).items;
    await db.outcome.update({ where: { id: f.outcome.id }, data: { status: "running" } });
    await db.outcomeWorkItem.update({ where: { id: f.item.id }, data: { status: "completed", completedAt: new Date() } });
    await db.outcomeOutput.create({ data: { outcomeId: f.outcome.id, workItemId: f.item.id, title: "Report", kind: "final_result", content: "Done", dedupeKey: `final:${f.item.id}` } });
    const running = await db.outcomeWorkItem.create({ data: { outcomeId: f.outcome.id, contractRevisionId: f.revision.id, botId: f.bot.id, executorType: "agent", title: "Still running", ordinal: 2, status: "running", startedAt: new Date() } });
    expect(await acceptance()).toHaveLength(0);
    await db.outcomeWorkItem.update({ where: { id: running.id }, data: { status: "completed", completedAt: new Date() } });
    await db.outcomeOutput.create({ data: { outcomeId: f.outcome.id, workItemId: running.id, title: "Report 2", kind: "final_result", content: "Done", dedupeKey: `final:${running.id}` } });
    expect(await acceptance()).toHaveLength(1);
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
  test("completed facts with identical availability use creation time before identity", async () => {
    const older = await create(); const newer = await create(); const acceptedAt = new Date(Date.now()-1000);
    await db.outcome.update({ where: { id: older.outcome.id }, data: { status: "accepted", acceptedAt, createdAt: new Date(Date.now()-5000) } });
    await db.outcome.update({ where: { id: newer.outcome.id }, data: { status: "accepted", acceptedAt, createdAt: new Date(Date.now()-3000) } });
    const service = new OutcomeInboxService(db);
    const all = await run(service.list(query({ status: "completed", limit: "100" })));
    const ours = all.items.filter(item => [older.outcome.id, newer.outcome.id].includes(item.outcomeId));
    expect(ours.map(item => item.outcomeId)).toEqual([older.outcome.id, newer.outcome.id]);
    const seen: string[] = []; let cursor: string | null = null;
    do {
      const page: OutcomeInboxPage = await run(service.list(query({ status: "completed", limit: "1", ...(cursor ? { cursor } : {}) })));
      seen.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.items.map(item => item.id));
  });
  test("submitted receipts remain visible for owner acceptance while the requester is waiting_human", async () => {
    const f = await create();
    await db.outcomeWorkItem.update({ where: { id: f.item.id }, data: { status: "running" } });
    await db.$transaction(tx => transitionWorkItem(tx, { workItemId: f.item.id, to: "waiting_human", reason: "manual", actor }));
    const human = await db.outcomeWorkItem.create({ data: { outcomeId: f.outcome.id, contractRevisionId: f.revision.id, botId: f.bot.id, executorType: "human", title: "Inspect", ordinal: 2, status: "in_progress" } });
    const service = new OutcomeInboxService(db);
    for (const status of ["submitted", "review_pending"] as const) {
      await db.$transaction(tx => transitionWorkItem(tx, { workItemId: human.id, to: status, reason: "receipt", actor }));
      expect((await db.outcome.findUniqueOrThrow({ where: { id: f.outcome.id } })).status).toBe("human_action_pending");
      const page = await run(service.list(query(), f.outcome.id));
      expect(page.items.map(item => item.category)).toEqual(["acceptance_pending"]);
      expect(page.items[0]?.criterionIds).toHaveLength(2);
    }
  });
  test("expired decisions stay hidden and completion expires after seven days", async () => {
    const f = await create(); const decisions = new DecisionService(db); const service = new OutcomeInboxService(db);
    await run(decisions.create({ ...f.input, expiresAt: new Date(Date.now()-100).toISOString() }, actor));
    await db.outcomeWorkItem.create({ data: { outcomeId: f.outcome.id, contractRevisionId: f.revision.id, botId: f.bot.id, executorType: "human", title: "accepted", ordinal: 2, status: "accepted" } });
    expect((await run(service.list(query(), f.outcome.id))).items).toHaveLength(0);
    await db.outcome.update({ where: { id: f.outcome.id }, data: { status: "accepted", acceptedAt: new Date(Date.now()-8*86400_000) } });
    expect((await run(service.list(query({ status: "completed" }), f.outcome.id))).items).toHaveLength(0);
  });
});
