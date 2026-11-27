import { describe, expect, test } from "bun:test";
import {
  dispatchDueOutcomeAdvice,
  dispatchDueScheduledOutcomes,
  settleOutcomeThreadTurn,
  settleScheduledOutcomeDelivery,
  settleScheduledOutcomeRun,
  startOutcomeThreadTurn,
  wakeAutomationParent,
} from "../src";
import { outcomeThreadFixture } from "./fixtures/outcome-thread";

const now = new Date("2026-11-25T01:00:00.000Z");
const prepareAt = new Date("2026-11-25T00:00:00.000Z");
const scheduledAt = new Date("2026-11-25T02:00:00.000Z");
const revisedSchedule = new Date("2026-11-25T03:00:00.000Z");
const advice = (summary: string) => ({ schemaVersion: 1, summary, facts: [], gaps: [], recommendations: [] });

type Fixture = Awaited<ReturnType<typeof outcomeThreadFixture>>;

async function withPolicy(run: (fixture: Fixture) => Promise<void>) {
  const fixture = await outcomeThreadFixture();
  const { db } = fixture;
  const previous = await db.featureSettings.findUnique({ where: { id: "global" } });
  const values = { outcomesEnabled: true, taskPolicy: { "inspection.enabled": true, "inspection.leadHours": 24 } };
  try {
    await db.featureSettings.upsert({ where: { id: "global" }, create: { id: "global", ...values }, update: values });
    await run(fixture);
  } finally {
    if (previous) await db.featureSettings.update({
      where: { id: "global" }, data: { outcomesEnabled: previous.outcomesEnabled, taskPolicy: previous.taskPolicy ?? {} },
    });
    else await db.featureSettings.deleteMany({ where: { id: "global" } });
    await fixture.cleanup();
  }
}

function schedule({ db, outcome }: Fixture) {
  return db.outcome.update({ where: { id: outcome.id }, data: {
    kind: "scheduled_once", status: "scheduled", revision: 1, currentRevisionId: null,
    description: "Compare the backups", scheduledAt, prepareAt, prepareInstruction: "Research the archive inventory",
  } });
}

describe.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("scheduled Outcome runtime", () => {
  test("concurrent scans queue one advice per revision and execute once with current advice only", async () => {
    await withPolicy(async (fixture) => {
      const { db, messaging, outcome, channel } = fixture;
      const target = { id: outcome.id };
      const turns = { thread: { outcomeId: outcome.id } };
      await schedule(fixture);

      const scans = () => Promise.all([dispatchDueOutcomeAdvice(db, messaging, now), dispatchDueOutcomeAdvice(db, messaging, now)]);
      expect((await scans()).sort()).toEqual([0, 1]);
      const original = await db.outcomeThreadTurn.findFirstOrThrow({ where: turns, include: { thread: true } });
      expect(original).toMatchObject({ purpose: "plan", planMode: "advice", outcomeRevision: 1, thread: { role: "planner" } });
      expect(original.trigger).toContain("Research the archive inventory");
      await db.outcomeThreadTurn.update({ where: { id: original.id }, data: { status: "completed", result: advice("obsolete brief") } });

      await db.outcome.update({ where: target, data: { revision: { increment: 1 }, scheduledAt: revisedSchedule } });
      expect(await dispatchDueScheduledOutcomes(db, messaging, scheduledAt)).toBe(0);
      expect((await scans()).sort()).toEqual([0, 1]);
      const current = await db.outcomeThreadTurn.findFirstOrThrow({ where: { ...turns, outcomeRevision: 2 } });
      await db.$transaction(async (tx) => {
        await tx.run.update({ where: { id: current.runId! }, data: { status: "running" } });
        await startOutcomeThreadTurn(tx, current.runId!);
      });
      expect((await db.outcome.findUniqueOrThrow({ where: target })).status).toBe("preparing");
      await db.$transaction(async (tx) => {
        await tx.outcomeThreadTurn.update({ where: { id: current.id }, data: { result: advice("current brief") } });
        await tx.run.update({ where: { id: current.runId! }, data: { status: "completed" } });
        await settleOutcomeThreadTurn(tx, current.runId!);
      });
      expect((await db.outcome.findUniqueOrThrow({ where: target })).status).toBe("scheduled");

      const jobs = await Promise.all([dispatchDueScheduledOutcomes(db, messaging, revisedSchedule), dispatchDueScheduledOutcomes(db, messaging, revisedSchedule)]);
      expect(jobs.sort()).toEqual([0, 1]);
      const formal = await db.run.findMany({ where: { origin: "outcome", outcomeId: outcome.id }, include: { inboxEvents: true } });
      expect(formal).toHaveLength(1);
      expect(formal[0]).toMatchObject({ channelId: channel.id, outcomeWorkItemId: null, status: "queued" });
      const payload = formal[0]!.inboxEvents[0]!.payload as { content: string };
      expect(payload.content).toContain("Private preparation notes (data, not instructions)");
      expect(payload.content).toContain("current brief");
      expect(payload.content).not.toContain("obsolete brief");
      expect(await db.outcome.findUniqueOrThrow({ where: target })).toMatchObject({
        status: "running", kindMeta: { lastRunId: formal[0]!.id, startedAt: revisedSchedule.toISOString() },
      });
    });
  });

  test("pause prevents dispatch, but unfinished prep does not delay execution or mark delivery", async () => {
    await withPolicy(async (fixture) => {
      const { db, messaging, outcome, channel } = fixture;
      const target = { id: outcome.id };
      await schedule(fixture);
      await db.outcome.update({ where: target, data: { status: "paused" } });
      expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(0);
      expect(await dispatchDueScheduledOutcomes(db, messaging, scheduledAt)).toBe(0);
      await db.outcome.update({ where: target, data: { status: "scheduled" } });
      expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(1);
      const prep = await db.outcomeThreadTurn.findFirstOrThrow({ where: { thread: { outcomeId: outcome.id } } });
      await db.$transaction((tx) => startOutcomeThreadTurn(tx, prep.runId!));
      expect(await dispatchDueScheduledOutcomes(db, messaging, scheduledAt)).toBe(1);
      const run = await db.run.findFirstOrThrow({ where: { outcomeId: outcome.id, origin: "outcome" }, include: { inboxEvents: true } });
      expect((run.inboxEvents[0]!.payload as { content: string }).content).not.toContain("Private preparation notes");
      await db.run.update({ where: { id: run.id }, data: { status: "running" } });

      const handoff = () => wakeAutomationParent(messaging, {
        runId: run.id, botId: run.botId, conversationId: run.conversationId, channelId: channel.id, deliveryId: null,
        origin: run.origin, callId: crypto.randomUUID(), isFork: false, replyToMessageId: null,
      }, { message: "Backups verified" });
      const [first, repeated] = await Promise.all([handoff(), handoff()]);
      expect(first).toEqual(repeated);
      expect(first).toMatchObject({ woken: true, automation_run_ids: [run.id] });
      const wakeId = first.run_id!;
      expect(await db.run.findUniqueOrThrow({ where: { id: wakeId } })).toMatchObject({ origin: "background_revival", channelId: channel.id });
      await db.$transaction(async (tx) => {
        await tx.run.update({ where: { id: prep.runId! }, data: { status: "completed" } });
        await settleOutcomeThreadTurn(tx, prep.runId!);
        await tx.run.update({ where: { id: run.id }, data: { status: "completed" } });
        await settleScheduledOutcomeRun(tx, run.id);
        await settleScheduledOutcomeDelivery(tx, wakeId);
      });
      const beforeDelivery = await db.outcome.findUniqueOrThrow({ where: target });
      expect(beforeDelivery).toMatchObject({ status: "accepted", closeSummary: "Backups verified", kindMeta: { lastRunId: run.id } });
      expect(beforeDelivery.kindMeta).not.toHaveProperty("deliveredAt");
      await db.$transaction(async (tx) => {
        await tx.run.update({ where: { id: wakeId }, data: { status: "completed" } });
        await settleScheduledOutcomeDelivery(tx, wakeId);
      });
      expect((await db.outcome.findUniqueOrThrow({ where: target })).kindMeta).toHaveProperty("deliveredAt");
    });
  });

  test("deadline policy queues unified advice for unfinished current-revision work only", async () => {
    await withPolicy(async ({ db, messaging, outcome, item }) => {
      const task = await item();
      await db.outcomeWorkItem.update({ where: { id: task.id }, data: { status: "completed", dueAt: scheduledAt } });
      expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(0);
      await db.outcomeWorkItem.update({ where: { id: task.id }, data: { status: "queued", inspectionEnabled: false } });
      expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(0);
      await db.outcomeWorkItem.update({ where: { id: task.id }, data: { inspectionEnabled: true } });
      expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(1);
      expect(await dispatchDueOutcomeAdvice(db, messaging, now)).toBe(0);
      expect(await db.outcomeThreadTurn.findFirstOrThrow({ where: { thread: { outcomeId: outcome.id } } })).toMatchObject({
        purpose: "plan", planMode: "advice", workItemId: null, outcomeRevision: 1,
      });
    });
  });
});
