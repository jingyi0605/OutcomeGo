import { expect, test } from "bun:test";
import { dispatchDueOutcomeAdvice, settleOutcomeThreadTurn } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeScheduleService } from "../../server/src/services/outcome-schedule-service";
import { OutcomeService } from "../../server/src/services/outcome-service";
import { OutcomeThreadService } from "../../server/src/services/outcome-thread-service";
import { WakeWorker } from "../src/worker";

test.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("manual advice suppresses automatic advice for the same Outcome revision", async () => {
  const fixture = await outcomeThreadFixture();
  const { db, outcome, messaging, bot, revision } = fixture;
  const previous = await db.featureSettings.findUnique({ where: { id: "global" } });
  const outcomes = new OutcomeService(db, messaging);
  const outcomeThreads = new OutcomeThreadService(db, messaging);
  const schedules = new OutcomeScheduleService(db, outcomes, messaging);
  const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: db, messaging, agentData: fixture.store });
  const now = new Date("2080-05-03T11:00:00.000Z");
  const dueAt = new Date("2080-05-03T12:00:00.000Z");
  const clientRequestId = crypto.randomUUID();
  try {
    await db.featureSettings.upsert({
      where: { id: "global" },
      create: { id: "global", outcomesEnabled: true },
      update: { outcomesEnabled: true, taskPolicy: {} },
    });
    const item = await fixture.item();
    await db.outcome.update({ where: { id: outcome.id }, data: { dueAt } });
    await db.outcomeWorkItem.update({ where: { id: item.id }, data: { dueAt } });
    const input = { mode: "advice" as const, workItemId: item.id, clientRequestId };
    const turn = await outcomeThreads.plan(outcome.id, input, "owner:local");
    expect(await outcomeThreads.plan(outcome.id, input, "owner:local")).toEqual(turn);
    expect(turn).toMatchObject({ planMode: "advice", workItemId: item.id });
    expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(0);
    expect(await worker.claim(bot.id)).toMatchObject({ runId: turn.runId, accessMode: "research_readonly" });
    const runId = turn.runId!;
    const reply = "Review the saved delivery date.";
    await db.event.create({ data: { topic: "run_item.completed", entityId: runId, payload: { item: { type: "agentMessage", text: reply } } } });
    await db.run.update({ where: { id: runId }, data: { status: "completed", completedAt: new Date() } });
    await db.inboxEvent.updateMany({ where: { runId }, data: { status: "completed" } });
    await db.$transaction((tx) => settleOutcomeThreadTurn(tx, runId, messaging));
    expect((await outcomeThreads.list(outcome.id)).turns).toContainEqual(expect.objectContaining({ id: turn.id, status: "completed", result: expect.objectContaining({ summary: reply }) }));
    expect(await db.outcome.findUnique({ where: { id: outcome.id } })).toMatchObject({ currentRevisionId: revision.id, status: "approved" });
    expect(await db.outcomeWorkItem.findUnique({ where: { id: item.id } })).toMatchObject({ status: "queued" });
    expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(0);

    await schedules.setOutcomeDue(outcome.id, { dueAt: "2080-05-03T13:00:00.000Z", clientRequestId: crypto.randomUUID() }, "owner:local");
    expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(1);
  } finally {
    await db.idempotencyRecord.deleteMany({ where: { key: clientRequestId } });
    if (previous) await db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: previous.outcomesEnabled, taskPolicy: previous.taskPolicy ?? {} } });
    else await db.featureSettings.deleteMany({ where: { id: "global" } });
    await fixture.cleanup();
  }
}, 15_000);
