import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  MISSED_SCHEDULE_CONFIRMED_REASON,
  MISSED_SCHEDULE_OPTION_IDS,
  MISSED_SCHEDULE_REASON_CODE,
} from "@outcomego/contracts/outcome-inbox";
import { parseOutcomeInboxQuery } from "@outcomego/contracts/outcome-inbox";
import { dispatchDueScheduledWorkItems, enqueueOutcomeTurn, reconcileOutcomeInboxNotifications, updateFeatureSettings } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { DecisionService } from "../src/services/decision-service";
import { OutcomeInboxService } from "../src/services/outcome-inbox-service";

// Specs/004.10 task 2.4: how the owner's choice on a missed-schedule decision is applied. Needs a disposable
// PostgreSQL database; skipped without OUTCOMEGO_TEST_DATABASE_URL.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});
const owner = "owner:local" as const;
const minutesAgo = (value: number) => new Date(Date.now() - value * 60_000);

/** A late action: its plan says action, its time was 30 minutes ago and the grace time is 5 minutes. */
async function lateAction() {
  const h = await outcomeThreadFixture();
  cleanups.push(async () => {
    await h.db.featureSettings.deleteMany({ where: { id: "global" } });
    await h.cleanup();
  });
  await updateFeatureSettings(h.db, { taskPolicy: { "schedule.graceMinutes": 5 } });
  await h.db.outcomeContractRevision.update({
    where: { id: h.revision.id },
    data: { plan: { tasks: [{ key: "act", title: "act", instructions: "Do it", botId: h.bot.id, covers: [], nature: "action" }] } },
  });
  const item = await h.db.outcomeWorkItem.create({
    data: {
      outcomeId: h.outcome.id, contractRevisionId: h.revision.id, botId: h.bot.id, executorType: "agent",
      title: "act", instructions: "Do it", status: "queued", ordinal: 1, planKey: "act", scheduledAt: minutesAgo(30),
    },
  });
  await h.db.$transaction((tx) => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
  const decision = await h.db.outcomeDecision.findFirstOrThrow({ where: { workItemId: item.id, reasonCode: MISSED_SCHEDULE_REASON_CODE } });
  const service = new DecisionService(h.db, { messaging: h.messaging });
  const resolve = (optionId: string, clientRequestId = crypto.randomUUID()) =>
    Effect.runPromise(service.resolve(decision.id, { optionId, expectedContractRevision: 1, clientRequestId }, owner));
  const runs = () => h.db.run.count({ where: { botId: h.bot.id } });
  const row = () => h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } });
  return { h, item, decision, resolve, runs, row };
}

describe.skipIf(!url)("choosing on a missed-schedule decision (specs/004.10 task 2.4)", () => {
  test("run now: the task starts once, at the current time, with its original instructions", async () => {
    const f = await lateAction();
    expect(await f.runs()).toBe(0);
    const before = Date.now();
    const result = await f.resolve(MISSED_SCHEDULE_OPTION_IDS.runNow);
    expect(result).toMatchObject({ status: "resolved", resume: { status: "enqueued", workItemIds: [f.item.id] } });
    expect(await f.runs()).toBe(1);
    const row = await f.row();
    expect(row.rootRunId).not.toBeNull();
    expect(row.scheduledAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The run carries the original start instructions, not a "decision resolved" message.
    const run = await f.h.db.run.findFirstOrThrow({ where: { botId: f.h.bot.id }, include: { inboxEvents: true } });
    expect(JSON.stringify(run.inboxEvents[0]!.payload)).toContain("Execute");
    expect(JSON.stringify(run.inboxEvents[0]!.payload)).not.toContain("decisionId");
  });

  test("run now is idempotent: the same request again starts nothing more", async () => {
    const f = await lateAction();
    const requestId = crypto.randomUUID();
    const first = await f.resolve(MISSED_SCHEDULE_OPTION_IDS.runNow, requestId);
    expect(await f.resolve(MISSED_SCHEDULE_OPTION_IDS.runNow, requestId)).toEqual(first);
    expect(await f.runs()).toBe(1);
  });

  test("run now with no grace time at all still starts and is not asked a second time", async () => {
    const f = await lateAction();
    await updateFeatureSettings(f.h.db, { taskPolicy: { "schedule.graceMinutes": 0 } });
    await f.resolve(MISSED_SCHEDULE_OPTION_IDS.runNow);
    expect(await f.runs()).toBe(1);
    expect(await f.h.db.outcomeDecision.count({ where: { workItemId: f.item.id, reasonCode: MISSED_SCHEDULE_REASON_CODE } })).toBe(1);
  });

  test("run now while the bot is busy keeps the task ready and marked, so it starts as soon as there is room", async () => {
    const f = await lateAction();
    // Two other tasks hold the bot's two slots.
    for (const ordinal of [2, 3]) {
      const other = await f.h.item(ordinal);
      await f.h.db.$transaction((tx) => enqueueOutcomeTurn(tx, f.h.messaging, { workItemId: other.id, content: "Busy", reason: "start", clientId: `busy:${other.id}` }));
    }
    const result = await f.resolve(MISSED_SCHEDULE_OPTION_IDS.runNow);
    expect(result.resume.status).toBe("queued_for_capacity");
    const row = await f.row();
    expect(row.statusReason).toBe(MISSED_SCHEDULE_CONFIRMED_REASON);
    expect(row.rootRunId).toBeNull();
  });

  test("I will set a new time: nothing starts, the task stays held, and repeated scans never ask again", async () => {
    const f = await lateAction();
    const result = await f.resolve(MISSED_SCHEDULE_OPTION_IDS.waitForReschedule);
    expect(result).toMatchObject({ status: "resolved", resume: { status: "recorded" } });
    expect(await f.runs()).toBe(0);
    for (let pass = 0; pass < 3; pass += 1) await dispatchDueScheduledWorkItems(f.h.db, f.h.messaging);
    expect(await f.runs()).toBe(0);
    const row = await f.row();
    expect(row.status).toBe("queued");
    expect(row.statusReason).toBe(MISSED_SCHEDULE_REASON_CODE);
    expect(await f.h.db.outcomeDecision.count({ where: { workItemId: f.item.id, reasonCode: MISSED_SCHEDULE_REASON_CODE } })).toBe(1);
  });

  test("the choice records who chose and which option, like any decision", async () => {
    const f = await lateAction();
    await f.resolve(MISSED_SCHEDULE_OPTION_IDS.runNow);
    const decision = await f.h.db.outcomeDecision.findUniqueOrThrow({ where: { id: f.decision.id } });
    expect(decision).toMatchObject({ status: "resolved", resolvedBy: owner, openWorkItemId: null });
    expect((decision.resolvedOption as { id: string }).id).toBe(MISSED_SCHEDULE_OPTION_IDS.runNow);
  });

  test("the owner can see it: it is an open decision in the inbox for this goal and task, until it is chosen", async () => {
    const f = await lateAction();
    const inbox = new OutcomeInboxService(f.h.db);
    const list = async () =>
      (await Effect.runPromise(inbox.list(parseOutcomeInboxQuery(new URLSearchParams({ status: "all" }))))).items.filter((item) => item.outcomeId === f.h.outcome.id);
    const [shown] = await list();
    expect(shown).toMatchObject({ category: "decision_pending", workItemId: f.item.id, decisionId: f.decision.id, requiresAction: true });
    await f.resolve(MISSED_SCHEDULE_OPTION_IDS.waitForReschedule);
    expect((await list()).filter((item) => item.category === "decision_pending")).toHaveLength(0);
  });

  test("it reaches the owner as a notification through the same recovery path as other decisions", async () => {
    const f = await lateAction();
    const before = await f.h.db.channelNotification.count({ where: { key: `decision.required:${f.decision.id}` } });
    await reconcileOutcomeInboxNotifications(f.h.db);
    const after = await f.h.db.channelNotification.findMany({ where: { key: `decision.required:${f.decision.id}` } });
    expect(after.length).toBeGreaterThanOrEqual(before);
    expect(after.length).toBe(1);
    expect(after[0]!.revoked).toBe(false);
    await f.resolve(MISSED_SCHEDULE_OPTION_IDS.runNow);
    expect((await f.h.db.channelNotification.findMany({ where: { key: `decision.required:${f.decision.id}` } }))[0]!.revoked).toBe(true);
  });

  test("a task cancelled in the meantime is not started by an old choice", async () => {
    const f = await lateAction();
    await f.h.db.outcomeWorkItem.update({ where: { id: f.item.id }, data: { status: "cancelled", completedAt: new Date() } });
    const result = await f.resolve(MISSED_SCHEDULE_OPTION_IDS.runNow);
    expect(result.resume.status).toBe("recorded");
    expect(await f.runs()).toBe(0);
  });
});
