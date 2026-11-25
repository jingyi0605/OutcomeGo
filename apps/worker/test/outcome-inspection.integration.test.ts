import { expect, test } from "bun:test";
import { dispatchDueOutcomeInspections, settleOutcomeThreadTurn } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { outcomeRoutes } from "../../server/src/routes/outcome";
import type { RouteContext } from "../../server/src/routes/context";
import { OutcomeScheduleService } from "../../server/src/services/outcome-schedule-service";
import { OutcomeService } from "../../server/src/services/outcome-service";
import { OutcomeThreadService } from "../../server/src/services/outcome-thread-service";
import { WakeWorker } from "../src/worker";

test.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("manual goal and task analysis suppress automation for the saved schedule", async () => {
  const fixture = await outcomeThreadFixture();
  const { db, outcome, messaging, bot, revision } = fixture;
  const previous = await db.featureSettings.findUnique({ where: { id: "global" } });
  const outcomes = new OutcomeService(db, messaging);
  const outcomeThreads = new OutcomeThreadService(db, messaging, outcomes);
  const schedules = new OutcomeScheduleService(db, outcomes, messaging);
  const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: db, messaging, agentData: fixture.store });
  const now = new Date("2080-05-03T11:00:00.000Z");
  const dueAt = new Date("2080-05-03T12:00:00.000Z");
  const clientRequestId = crypto.randomUUID();
  const inspect = async (workItemId?: string) => {
    const path = `/api/outcomes/${outcome.id}${workItemId ? `/work-items/${workItemId}` : ""}/inspection`;
    const url = new URL(path, "http://localhost");
    const request = new Request(url, { method: "POST", body: JSON.stringify({ clientRequestId }) });
    const response = await outcomeRoutes({ path, url, request, app: { outcomeThreads } } as unknown as RouteContext);
    expect(response?.status).toBe(202);
    return response!.json();
  };
  try {
    await db.featureSettings.upsert({
      where: { id: "global" },
      create: { id: "global", outcomesEnabled: true },
      update: { outcomesEnabled: true, taskPolicy: {} },
    });
    const item = await fixture.item();
    await db.outcome.update({ where: { id: outcome.id }, data: { dueAt } });
    await db.outcomeWorkItem.update({ where: { id: item.id }, data: { dueAt } });
    const taskTurn = await inspect(item.id);
    expect(await inspect(item.id)).toEqual(taskTurn);
    expect(taskTurn).toMatchObject({ purpose: "inspection", workItemId: item.id, inspectionSource: "manual" });
    expect(await dispatchDueOutcomeInspections(db, messaging, now)).toBe(1);
    const goalTurn = await inspect();
    expect(goalTurn).toMatchObject({ purpose: "inspection", inspectionSource: "manual" });
    const automaticTurn = (await outcomeThreads.list(outcome.id)).reviewTurns!.find((turn) => turn.inspectionSource === "automatic")!;

    for (const turn of [taskTurn, goalTurn]) {
      expect(await worker.claim(bot.id)).toMatchObject({ runId: turn.runId, readOnly: true });
      await db.event.create({ data: { topic: "run_item.completed", entityId: turn.runId, payload: { item: { type: "agentMessage", text: "Review the saved delivery date." } } } });
      await db.run.update({ where: { id: turn.runId }, data: { status: "completed", completedAt: new Date() } });
      await db.inboxEvent.updateMany({ where: { runId: turn.runId }, data: { status: "completed" } });
      await db.$transaction((tx) => settleOutcomeThreadTurn(tx, turn.runId, messaging));
    }
    expect(await db.run.findUnique({ where: { id: automaticTurn.runId! } })).toMatchObject({ status: "cancelled" });
    expect((await outcomeThreads.list(outcome.id)).reviewTurns).toContainEqual(expect.objectContaining({ id: goalTurn.id, status: "completed", reply: "Review the saved delivery date." }));
    expect(await db.outcome.findUnique({ where: { id: outcome.id } })).toMatchObject({ currentRevisionId: revision.id, inspectionRevisionId: revision.id, status: "approved" });
    expect(await db.outcomeWorkItem.findUnique({ where: { id: item.id } })).toMatchObject({ status: "queued", inspectionRevisionId: revision.id });
    expect(await dispatchDueOutcomeInspections(db, messaging, now)).toBe(0);

    await schedules.setOutcomeDue(outcome.id, { dueAt: "2080-05-03T13:00:00.000Z", clientRequestId: crypto.randomUUID() }, "owner:local");
    expect(await dispatchDueOutcomeInspections(db, messaging, now)).toBe(1);
  } finally {
    await db.idempotencyRecord.deleteMany({ where: { scope: { startsWith: `outcome-inspection:${outcome.id}:` } } });
    if (previous) await db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: previous.outcomesEnabled, taskPolicy: previous.taskPolicy ?? {} } });
    else await db.featureSettings.deleteMany({ where: { id: "global" } });
    await fixture.cleanup();
  }
}, 15_000);
