import { afterAll, describe, expect, test } from "bun:test";
import { ApiError } from "@outcomego/contracts";
import { MISSED_SCHEDULE_CONFIRMED_REASON, MISSED_SCHEDULE_REASON_CODE } from "@outcomego/contracts/outcome-inbox";
import { enqueueOutcomeTurn, updateFeatureSettings } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeScheduleService } from "../src/services/outcome-schedule-service";
import { OutcomeService } from "../src/services/outcome-service";

// Specs/004.10 task 2.6: the owner changes a not-yet-started task's schedule and the goal's deadline.
// Needs a disposable PostgreSQL database; skipped without OUTCOMEGO_TEST_DATABASE_URL.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});
const owner = "owner:local" as const;
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
let sequence = 0;
const requestId = () => `schedule-request-${++sequence}-${crypto.randomUUID().slice(0, 8)}`;

async function setup() {
  const h = await outcomeThreadFixture();
  cleanups.push(async () => {
    await h.db.featureSettings.deleteMany({ where: { id: "global" } });
    await h.cleanup();
  });
  const outcomes = new OutcomeService(h.db, h.messaging);
  const service = new OutcomeScheduleService(h.db, outcomes, h.messaging);
  const events = () => h.db.event.findMany({ where: { topic: "outcome.schedule.changed", entityId: h.outcome.id }, orderBy: { sequence: "asc" } });
  const row = (id: string) => h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id } });
  const failure = async (promise: Promise<unknown>) => {
    const error = await promise.then(() => null, (e) => e);
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  };
  const start = (workItemId: string, content = "Execute") =>
    h.db.$transaction((tx) => enqueueOutcomeTurn(tx, h.messaging, { workItemId, content, reason: "start", clientId: `start:${workItemId}` }));
  const reschedule = (workItemId: string, body: Record<string, unknown>, id = requestId()) =>
    service.setWorkItemSchedule(h.outcome.id, workItemId, { clientRequestId: id, ...body } as never, owner);
  /** A queued task whose start is held because its time has not come. */
  const heldTask = async (ordinal = 1, minutesAhead = 120) => {
    const item = await h.item(ordinal);
    await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { scheduledAt: new Date(Date.now() + minutesAhead * 60_000) } });
    expect(await start(item.id, "Original instructions")).toEqual({ status: "queued_for_capacity" });
    return item;
  };
  return { h, service, events, row, failure, start, reschedule, heldTask };
}

describe.skipIf(!url)("owner changes a task's schedule (specs/004.10 task 2.6)", () => {
  test("sets the time, deadline and estimate, writes an audit event with old and new values, and leaves the contract alone", async () => {
    const t = await setup();
    const item = await t.heldTask();
    const before = await t.h.db.outcomeContractRevision.findUniqueOrThrow({ where: { id: t.h.revision.id } });
    const previous = (await t.row(item.id)).scheduledAt!.toISOString();
    const [scheduledAt, dueAt] = [at(300), at(600)];
    const detail = await t.reschedule(item.id, { scheduledAt, dueAt, estimateMinutes: 45 });
    const saved = await t.row(item.id);
    expect(saved.scheduledAt!.toISOString()).toBe(new Date(scheduledAt).toISOString());
    expect(saved.dueAt!.toISOString()).toBe(new Date(dueAt).toISOString());
    expect(saved.estimateMinutes).toBe(45);
    expect(detail.workItems.find((entry) => entry.id === item.id)).toMatchObject({ estimateMinutes: 45 });
    const [event] = await t.events();
    expect(event!.payload).toMatchObject({ payload: { target: "work_item", workItemId: item.id, source: "owner", previous: { scheduledAt: previous, dueAt: null, estimateMinutes: null }, estimateMinutes: 45 } });
    const after = await t.h.db.outcomeContractRevision.findUniqueOrThrow({ where: { id: t.h.revision.id } });
    expect([after.contentHash, after.status, after.approvedAt?.getTime()]).toEqual([before.contentHash, before.status, before.approvedAt?.getTime()]);
  });

  test("a field left out is unchanged and null clears it", async () => {
    const t = await setup();
    const item = await t.heldTask();
    await t.reschedule(item.id, { dueAt: at(500), estimateMinutes: 20 });
    await t.reschedule(item.id, { estimateMinutes: null });
    const saved = await t.row(item.id);
    expect(saved.estimateMinutes).toBeNull();
    expect(saved.dueAt).not.toBeNull();
    expect(saved.scheduledAt).not.toBeNull();
    await t.reschedule(item.id, { scheduledAt: null });
    expect((await t.row(item.id)).scheduledAt).toBeNull();
  });

  test("a bad time, a deadline before the start or an estimate out of range is refused and nothing changes", async () => {
    const t = await setup();
    const item = await t.heldTask();
    const snapshot = JSON.stringify(await t.row(item.id));
    const bad: Array<Record<string, unknown>> = [
      { scheduledAt: "soon" }, { scheduledAt: "2026-12-01" }, { dueAt: "2026-02-30T00:00:00Z" },
      { dueAt: at(10) }, // earlier than the task's current start (120 minutes ahead)
      { scheduledAt: at(600), dueAt: at(300) },
      { estimateMinutes: 0 }, { estimateMinutes: 10_081 }, { estimateMinutes: 1.5 },
    ];
    for (const body of bad) {
      const error = await t.failure(t.reschedule(item.id, body));
      expect([JSON.stringify(body), error.status, error.code]).toEqual([JSON.stringify(body), 400, "invalid_schedule"]);
    }
    expect(JSON.stringify(await t.row(item.id))).toBe(snapshot);
    expect(await t.events()).toHaveLength(0);
  });

  test("a task that has started, finished, failed or been cancelled cannot be rescheduled", async () => {
    const t = await setup();
    for (const status of ["running", "completed", "failed", "cancelled", "waiting_decision", "needs_review"] as const) {
      const item = await t.h.db.outcomeWorkItem.create({
        data: { outcomeId: t.h.outcome.id, contractRevisionId: t.h.revision.id, botId: t.h.bot.id, executorType: "agent", title: status, status, ordinal: 100 + sequence++ },
      });
      const error = await t.failure(t.reschedule(item.id, { scheduledAt: at(60) }));
      expect([status, error.status, error.code]).toEqual([status, 409, "schedule_not_editable"]);
      expect((await t.row(item.id)).scheduledAt).toBeNull();
    }
    expect(await t.events()).toHaveLength(0);
  });

  test("a queued task whose turn is already running is not editable either", async () => {
    const t = await setup();
    const item = await t.h.item(1);
    const first = await t.start(item.id);
    expect(first.status).toBe("enqueued");
    const error = await t.failure(t.reschedule(item.id, { scheduledAt: at(60) }));
    expect([error.status, error.code]).toEqual([409, "schedule_not_editable"]);
  });

  test("a goal that is accepted or cancelled refuses the change", async () => {
    for (const closed of [{ acceptedAt: new Date(), status: "accepted" as const }, { cancelledAt: new Date(), status: "cancelled" as const }]) {
      const t = await setup();
      const item = await t.heldTask();
      await t.h.db.outcome.update({ where: { id: t.h.outcome.id }, data: closed });
      const error = await t.failure(t.reschedule(item.id, { scheduledAt: at(300) }));
      expect([error.status, error.code]).toEqual([409, "outcome_not_open"]);
    }
  });

  test("a task that is not in this goal is not found", async () => {
    const t = await setup();
    expect((await t.failure(t.reschedule(crypto.randomUUID(), { scheduledAt: at(60) }))).code).toBe("work_item_not_found");
    const other = await setup();
    const foreign = await other.h.item(1);
    expect((await t.failure(t.reschedule(foreign.id, { scheduledAt: at(60) }))).code).toBe("work_item_not_found");
  });

  // Specs/004.10 task 3.2: clients never receive `outcome.*` events, so an open goal learns of a change from this one.
  test("a change announces itself to the open goal once; a replay, a no-op and a refusal announce nothing", async () => {
    const t = await setup();
    const signals = () => t.h.db.event.findMany({ where: { topic: "goal.schedule.changed", entityId: t.h.outcome.id } });
    const item = await t.heldTask();
    const when = at(300);
    const id = requestId();
    await t.reschedule(item.id, { scheduledAt: when }, id);
    expect(await signals()).toHaveLength(1);
    await t.reschedule(item.id, { scheduledAt: when }, id);
    await t.reschedule(item.id, { scheduledAt: when });
    expect(await signals()).toHaveLength(1);
    await t.failure(t.reschedule(item.id, { scheduledAt: "not a time" }));
    expect(await signals()).toHaveLength(1);
    expect((await signals())[0]!.payload).toEqual({ outcomeId: t.h.outcome.id });
  });

  test("the same request again replays and writes nothing more; the same id for another change is refused", async () => {
    const t = await setup();
    const item = await t.heldTask();
    const id = requestId();
    // One fixed value: `at()` reads the clock, so two calls would send two different requests under the same ID.
    const when = at(300);
    const first = await t.reschedule(item.id, { scheduledAt: when }, id);
    const again = await t.reschedule(item.id, { scheduledAt: when }, id);
    expect(again).toEqual(first);
    expect(await t.events()).toHaveLength(1);
    expect((await t.failure(t.reschedule(item.id, { scheduledAt: at(400) }, id))).code).toBe("idempotency_conflict");
  });

  test("setting what is already set changes nothing and writes no event", async () => {
    const t = await setup();
    const item = await t.heldTask();
    const current = (await t.row(item.id)).scheduledAt!.toISOString();
    await t.reschedule(item.id, { scheduledAt: current });
    expect(await t.events()).toHaveLength(0);
  });

  test("moving a held task to a later time keeps it held, with its original instructions under a fresh request ID", async () => {
    const t = await setup();
    const item = await t.heldTask();
    const [old] = await t.h.db.idempotencyRecord.findMany({ where: { scope: `outcome-turn:${item.id}`, status: "processing" } });
    await t.reschedule(item.id, { scheduledAt: at(600) });
    const held = await t.h.db.idempotencyRecord.findMany({ where: { scope: `outcome-turn:${item.id}`, status: "processing" } });
    expect(held).toHaveLength(1);
    expect(held[0]!.key).not.toBe(old!.key);
    expect(JSON.stringify(held[0]!.response)).toContain("Original instructions");
    expect(await t.h.db.run.count({ where: { botId: t.h.bot.id } })).toBe(0);
  });

  test("moving it to a time that has passed makes it start now, exactly once", async () => {
    const t = await setup();
    const item = await t.heldTask();
    await t.reschedule(item.id, { scheduledAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    expect(await t.h.db.run.count({ where: { botId: t.h.bot.id } })).toBe(1);
    expect((await t.row(item.id)).rootRunId).not.toBeNull();
    // Asking again with a new request ID, now that it has started, is refused rather than starting a second run.
    expect((await t.failure(t.reschedule(item.id, { scheduledAt: at(60) }))).code).toBe("schedule_not_editable");
    expect(await t.h.db.run.count({ where: { botId: t.h.bot.id } })).toBe(1);
  });

  test("clearing the time lets a held task start right away", async () => {
    const t = await setup();
    const item = await t.heldTask();
    await t.reschedule(item.id, { scheduledAt: null });
    expect(await t.h.db.run.count({ where: { botId: t.h.bot.id } })).toBe(1);
  });

  test("a task deferred by its agent keeps that state and its note when the owner moves it", async () => {
    const t = await setup();
    const item = await t.h.item(1);
    await t.h.db.outcomeWorkItem.update({
      where: { id: item.id },
      data: { status: "queued", statusReason: "deferred_by_agent", scheduledAt: new Date(Date.now() + 3_600_000), deferCount: 1, startedAt: new Date() },
    });
    await t.h.db.$transaction((tx) => enqueueOutcomeTurn(tx, t.h.messaging, { workItemId: item.id, content: "Continue from step three.", reason: "resume_scheduled", clientId: `defer:${item.id}:1` }));
    await t.reschedule(item.id, { scheduledAt: at(900) });
    const saved = await t.row(item.id);
    expect(saved.statusReason).toBe("deferred_by_agent");
    const [held] = await t.h.db.idempotencyRecord.findMany({ where: { scope: `outcome-turn:${item.id}`, status: "processing" } });
    expect(JSON.stringify(held!.response)).toContain("Continue from step three.");
    expect(JSON.stringify(held!.response)).toContain("resume_scheduled");
  });

  describe("a task that missed its time and is waiting on the owner", () => {
    const lateAction = async () => {
      const t = await setup();
      await updateFeatureSettings(t.h.db, { taskPolicy: { "schedule.graceMinutes": 5 } });
      await t.h.db.outcomeContractRevision.update({
        where: { id: t.h.revision.id },
        data: { plan: { tasks: [{ key: "act", title: "act", instructions: "Do it", botId: t.h.bot.id, covers: [], nature: "action" }] } },
      });
      const item = await t.h.db.outcomeWorkItem.create({
        data: { outcomeId: t.h.outcome.id, contractRevisionId: t.h.revision.id, botId: t.h.bot.id, executorType: "agent", title: "act", instructions: "Do it", status: "queued", ordinal: 1, planKey: "act", scheduledAt: new Date(Date.now() - 30 * 60_000) },
      });
      await t.start(item.id);
      const decision = await t.h.db.outcomeDecision.findFirstOrThrow({ where: { workItemId: item.id, reasonCode: MISSED_SCHEDULE_REASON_CODE } });
      expect((await t.row(item.id)).statusReason).toBe(MISSED_SCHEDULE_REASON_CODE);
      return { t, item, decision };
    };

    test("moving it to the future closes the open decision and returns it to the normal schedule", async () => {
      const { t, item, decision } = await lateAction();
      await t.reschedule(item.id, { scheduledAt: at(240) });
      expect((await t.h.db.outcomeDecision.findUniqueOrThrow({ where: { id: decision.id } })).status).toBe("withdrawn");
      expect((await t.row(item.id)).statusReason).toBeNull();
      expect(await t.h.db.run.count({ where: { botId: t.h.bot.id } })).toBe(0);
    });

    test("and when the new time comes it starts, and is judged against the new time", async () => {
      const { t, item } = await lateAction();
      await t.reschedule(item.id, { scheduledAt: at(240) });
      await t.h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { scheduledAt: new Date(Date.now() - 60_000) } });
      expect((await t.start(item.id)).status).toBe("enqueued");
      expect(await t.h.db.outcomeDecision.count({ where: { workItemId: item.id, reasonCode: MISSED_SCHEDULE_REASON_CODE } })).toBe(1);
    });

    test("moving it to a time that has passed is the owner's own choice: it starts and is not asked again", async () => {
      const { t, item } = await lateAction();
      await t.reschedule(item.id, { scheduledAt: new Date(Date.now() - 20 * 60_000).toISOString() });
      expect(await t.h.db.run.count({ where: { botId: t.h.bot.id } })).toBe(1);
      expect(await t.h.db.outcomeDecision.count({ where: { workItemId: item.id, reasonCode: MISSED_SCHEDULE_REASON_CODE } })).toBe(1);
      expect([MISSED_SCHEDULE_CONFIRMED_REASON, null]).toContain((await t.row(item.id)).statusReason);
    });

    test("a decision the owner had already answered with 'I will set a new time' is cleared by setting it", async () => {
      const { t, item, decision } = await lateAction();
      await t.h.db.outcomeDecision.update({ where: { id: decision.id }, data: { status: "resolved", openWorkItemId: null, resolvedAt: new Date() } });
      await t.reschedule(item.id, { scheduledAt: at(240) });
      expect((await t.row(item.id)).statusReason).toBeNull();
    });
  });

  test("a human task's date can be set while it is not submitted, and it changes nothing else about the task", async () => {
    const t = await setup();
    const human = await t.h.db.outcomeWorkItem.create({
      data: { outcomeId: t.h.outcome.id, contractRevisionId: t.h.revision.id, botId: t.h.bot.id, executorType: "human", kind: "human_action", title: "By hand", status: "ready", ordinal: 50 },
    });
    await t.reschedule(human.id, { scheduledAt: at(60), dueAt: at(600) });
    const saved = await t.row(human.id);
    expect(saved.status).toBe("ready");
    expect(saved.scheduledAt).not.toBeNull();
    expect(saved.dueAt).not.toBeNull();
    expect(await t.events()).toHaveLength(1);
    await t.h.db.outcomeWorkItem.update({ where: { id: human.id }, data: { status: "submitted" } });
    expect((await t.failure(t.reschedule(human.id, { dueAt: at(900) }))).code).toBe("schedule_not_editable");
  });
});

describe.skipIf(!url)("owner sets the goal's deadline (specs/004.10 task 2.6)", () => {
  const due = (t: Awaited<ReturnType<typeof setup>>, dueAt: string | null, id = requestId()) =>
    t.service.setOutcomeDue(t.h.outcome.id, { clientRequestId: id, dueAt } as never, owner);

  test("each real change of the deadline announces itself to the open goal; setting the same value again does not", async () => {
    const t = await setup();
    const signals = () => t.h.db.event.count({ where: { topic: "goal.schedule.changed", entityId: t.h.outcome.id } });
    const when = at(2000);
    await due(t, when);
    expect(await signals()).toBe(1);
    await due(t, when);
    expect(await signals()).toBe(1);
    await due(t, null);
    expect(await signals()).toBe(2);
  });

  test("sets and clears the deadline, with an audit event holding the old value, without touching the contract", async () => {
    const t = await setup();
    const before = await t.h.db.outcomeContractRevision.findUniqueOrThrow({ where: { id: t.h.revision.id } });
    const first = at(2000);
    const detail = await due(t, first);
    expect(detail.dueAt).toBe(new Date(first).toISOString());
    const second = at(3000);
    await due(t, second);
    await due(t, null);
    expect((await t.h.db.outcome.findUniqueOrThrow({ where: { id: t.h.outcome.id } })).dueAt).toBeNull();
    const events = await t.events();
    expect(events.map((event) => (event.payload as { payload: { previous: { dueAt: string | null }; dueAt: string | null } }).payload.previous.dueAt))
      .toEqual([null, new Date(first).toISOString(), new Date(second).toISOString()]);
    expect(events[0]!.payload).toMatchObject({ payload: { target: "outcome", source: "owner" } });
    const after = await t.h.db.outcomeContractRevision.findUniqueOrThrow({ where: { id: t.h.revision.id } });
    expect([after.contentHash, after.status]).toEqual([before.contentHash, before.status]);
  });

  test("a deadline in the past is allowed (the goal is simply overdue), but a malformed one is not", async () => {
    const t = await setup();
    await due(t, "2001-01-01T00:00:00Z");
    for (const bad of ["tomorrow", "2026-12-01", "2026-02-30T00:00:00Z", ""]) {
      const error = await t.failure(due(t, bad));
      expect([bad, error.status, error.code]).toEqual([bad, 400, "invalid_schedule"]);
    }
  });

  test("an accepted or cancelled goal refuses it", async () => {
    for (const closed of [{ acceptedAt: new Date(), status: "accepted" as const }, { cancelledAt: new Date(), status: "cancelled" as const }]) {
      const t = await setup();
      await t.h.db.outcome.update({ where: { id: t.h.outcome.id }, data: closed });
      const error = await t.failure(due(t, at(2000)));
      expect([error.status, error.code]).toEqual([409, "outcome_not_open"]);
      expect(await t.events()).toHaveLength(0);
    }
  });

  test("a goal a bot registered for itself can have a deadline too", async () => {
    const t = await setup();
    await t.h.db.outcome.update({ where: { id: t.h.outcome.id }, data: { trackingMode: "tracked" } });
    await due(t, at(2000));
    expect((await t.h.db.outcome.findUniqueOrThrow({ where: { id: t.h.outcome.id } })).dueAt).not.toBeNull();
  });

  test("a goal that does not exist is not found; the same request replays", async () => {
    const t = await setup();
    const missing = await t.failure(t.service.setOutcomeDue(crypto.randomUUID(), { clientRequestId: requestId(), dueAt: at(60) } as never, owner));
    expect(missing.code).toBe("outcome_not_found");
    const id = requestId();
    const when = at(2000);
    const first = await due(t, when, id);
    expect(await due(t, when, id)).toEqual(first);
    expect(await t.events()).toHaveLength(1);
  });
});
