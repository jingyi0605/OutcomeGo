import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrismaClient } from "../src";
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("OutcomeDecision additive schema", () => {
  let db: ReturnType<typeof createPrismaClient>; let botId: string | undefined;
  beforeAll(() => { db = createPrismaClient(url!); });
  afterAll(async () => { if (botId) await db.bot.delete({ where: { id: botId } }); await db.$disconnect(); });
  test("retains snapshots, constrains active work and allows historical decisions after closure", async () => {
    const bot = await db.bot.create({ data: { name: "Decision schema", defaultDirectory: "/tmp" } }); botId = bot.id;
    const outcome = await db.outcome.create({ data: { botId, title: "Schema fixture" } });
    const revision = await db.outcomeContractRevision.create({ data: { outcomeId: outcome.id, revision: 1, goal: [], boundaries: {}, executionBotId: botId, contentHash: "fixture", createdBy: "owner:local" } });
    const work = await db.outcomeWorkItem.create({ data: { outcomeId: outcome.id, contractRevisionId: revision.id, botId, executorType: "agent", title: "Fixture", status: "running", ordinal: 1 } });
    const input = { outcomeId: outcome.id, contractRevisionId: revision.id, workItemId: work.id, openWorkItemId: work.id, reasonCode: "missing_input", completedSummary: "Done", problemSummary: "Choose", nextStepSummary: "Continue", options: [{ id: "continue", label: "Continue", consequence: "Keep revision", source: "runtime", resolutionEffect: "plan_only" }] };
    const first = await db.outcomeDecision.create({ data: { ...input, idempotencyKey: crypto.randomUUID() } });
    expect(first.status).toBe("open"); expect(first.expiresAt).toBeNull(); expect(first.customEntryAllowed).toBe(true); expect(first.options).toEqual(input.options);
    await expect(db.outcomeDecision.create({ data: { ...input, idempotencyKey: crypto.randomUUID() } }).then(value => value)).rejects.toMatchObject({ code: "P2002" });
    await db.outcomeDecision.update({ where: { id: first.id }, data: { status: "withdrawn", openWorkItemId: null } });
    await db.outcomeDecision.create({ data: { ...input, idempotencyKey: crypto.randomUUID() } });
    expect(await db.outcomeDecision.count({ where: { outcomeId: outcome.id } })).toBe(2);
    await expect(db.outcomeDecision.create({ data: { ...input, openWorkItemId: null, idempotencyKey: first.idempotencyKey } }).then(value => value)).rejects.toMatchObject({ code: "P2002" });
    await expect(db.outcomeDecision.create({ data: { ...input, openWorkItemId: null, contractRevisionId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() } }).then(value => value)).rejects.toMatchObject({ code: "P2003" });
  });
});
