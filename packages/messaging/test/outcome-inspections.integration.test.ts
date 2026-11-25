import { describe, expect, test } from "bun:test";
import { dispatchDueOutcomeInspections } from "../src";
import { outcomeThreadFixture } from "./fixtures/outcome-thread";

const database = process.env.OUTCOMEGO_TEST_DATABASE_URL;

describe.skipIf(!database)("active outcome inspection", () => {
  async function withPolicy<T>(h: Awaited<ReturnType<typeof outcomeThreadFixture>>, run: () => Promise<T>) {
    const previous = await h.db.featureSettings.findUnique({ where: { id: "global" } });
    await h.db.featureSettings.upsert({
      where: { id: "global" },
      create: { id: "global", outcomesEnabled: true, taskPolicy: { "inspection.enabled": true, "inspection.leadHours": 24 } },
      update: { outcomesEnabled: true, taskPolicy: { "inspection.enabled": true, "inspection.leadHours": 24 } },
    });
    try {
      return await run();
    } finally {
      if (previous) {
        await h.db.featureSettings.update({
          where: { id: "global" },
          data: { outcomesEnabled: previous.outcomesEnabled, taskPolicy: previous.taskPolicy ?? {} },
        });
      }
      else await h.db.featureSettings.deleteMany({ where: { id: "global" } });
    }
  }

  test("queues one goal inspection inside the lead window and suppresses repeats for the revision", async () => {
    const h = await outcomeThreadFixture();
    try {
      await withPolicy(h, async () => {
        const now = new Date("2026-11-25T00:00:00.000Z");
        await h.db.outcome.update({ where: { id: h.outcome.id }, data: { dueAt: new Date("2026-11-25T12:00:00.000Z") } });
        expect(await dispatchDueOutcomeInspections(h.db, h.messaging, now)).toBe(1);
        expect(await dispatchDueOutcomeInspections(h.db, h.messaging, now)).toBe(0);
        const turns = await h.db.outcomeThreadTurn.findMany({ where: { purpose: "inspection", thread: { outcomeId: h.outcome.id } } });
        expect(turns).toHaveLength(1);
        expect(turns[0]).toMatchObject({ triggerBy: "system:auto-inspection", workItemId: null, result: { revisionId: h.revision.id } });
      });
    } finally {
      await h.cleanup();
    }
  });

  test("a newer current revision becomes eligible again, while a manual inspection suppresses it", async () => {
    const h = await outcomeThreadFixture();
    try {
      await withPolicy(h, async () => {
        const now = new Date("2026-11-25T00:00:00.000Z");
        await h.db.outcome.update({ where: { id: h.outcome.id }, data: { dueAt: new Date("2026-11-25T12:00:00.000Z") } });
        expect(await dispatchDueOutcomeInspections(h.db, h.messaging, now)).toBe(1);
        const next = await h.db.outcomeContractRevision.create({
          data: {
            outcomeId: h.outcome.id, revision: 2, status: "approved", approvedAt: now, approvedBy: "owner:local",
            goal: ["Compare two approaches again"], boundaries: {}, executionBotId: h.bot.id, contentHash: "fixture-2", createdBy: "owner:local",
          },
        });
        await h.db.outcome.update({ where: { id: h.outcome.id }, data: { currentRevisionId: next.id } });
        expect(await dispatchDueOutcomeInspections(h.db, h.messaging, now)).toBe(1);
        const turns = await h.db.outcomeThreadTurn.findMany({
          where: { purpose: "inspection", thread: { outcomeId: h.outcome.id } },
          orderBy: { createdAt: "asc" },
        });
        expect(turns).toHaveLength(2);
        await h.db.outcome.update({ where: { id: h.outcome.id }, data: { inspectionRevisionId: next.id } });
        expect(await dispatchDueOutcomeInspections(h.db, h.messaging, now)).toBe(0);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("queues task inspections and skips completed, disabled, and out-of-window targets", async () => {
    const h = await outcomeThreadFixture();
    try {
      await withPolicy(h, async () => {
        const now = new Date("2026-11-25T00:00:00.000Z");
        const soon = await h.item(1);
        const completed = await h.item(2);
        const disabled = await h.item(3);
        const later = await h.item(4);
        await h.db.outcome.update({ where: { id: h.outcome.id }, data: { dueAt: null } });
        await h.db.outcomeWorkItem.updateMany({
          where: { id: { in: [soon.id, completed.id, disabled.id, later.id] } },
          data: { dueAt: new Date("2026-11-25T12:00:00.000Z") },
        });
        await h.db.outcomeWorkItem.update({ where: { id: completed.id }, data: { status: "completed" } });
        await h.db.outcomeWorkItem.update({ where: { id: disabled.id }, data: { inspectionEnabled: false } });
        await h.db.outcomeWorkItem.update({ where: { id: later.id }, data: { dueAt: new Date("2026-11-27T00:00:00.000Z") } });
        expect(await dispatchDueOutcomeInspections(h.db, h.messaging, now)).toBe(1);
        const turns = await h.db.outcomeThreadTurn.findMany({ where: { purpose: "inspection", workItemId: { not: null } } });
        expect(turns).toHaveLength(1);
        expect(turns[0]!.workItemId).toBe(soon.id);
      });
    } finally {
      await h.cleanup();
    }
  });
});
