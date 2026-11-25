import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { reconcileRoutineExecution, saveSilentAutomationResult, wakeAutomationParent } from "@outcomego/messaging";
import { Prisma } from "@outcomego/db";
import { ActivityService } from "../../server/src/services/activity-service";
import { ScheduleService } from "../../server/src/services/schedule-service";
import { createRoutineHarness } from "./fixtures/routine-context";

const database = process.env.OUTCOMEGO_TEST_DATABASE_URL ?? process.env.OPENTEAM_TEST_DATABASE_URL;
const integration = test.skipIf(!database);
let harness: Awaited<ReturnType<typeof createRoutineHarness>>;
beforeAll(async () => { if (database) harness = await createRoutineHarness(); });
afterAll(async () => { await harness?.close(); });

integration("an explicitly converted date-specific Cron keeps its ID and appears in both one-time views", async () => {
  const now = new Date();
  const runAt = new Date(Math.ceil((now.getTime() + 120_000) / 60_000) * 60_000);
  const cron = [runAt.getUTCMinutes(), runAt.getUTCHours(), runAt.getUTCDate(), runAt.getUTCMonth() + 1, "*"].join(" ");
  const fixture = await harness.fixture({ schedule: cron, enabled: true });
  const { service, botId, routineId } = fixture;
  const activity = new ActivityService(harness.db);
  const calendar = new ScheduleService(harness.db);
  const calendarItems = async () => (await calendar.list("local", {
    from: now.toISOString(), to: new Date(runAt.getTime() + 60_000).toISOString(), botId, kinds: ["scheduled_once"],
  })).items;
  try {
    const original = await fixture.read();
    expect(original).toMatchObject({ scheduleKind: "cron", nextRunAt: runAt, onceAt: null });
    const link = { type: "routine", id: routineId };
    expect((await activity.list({ botId })).upcoming).toEqual([expect.objectContaining({ link, runAt: runAt.toISOString() })]);
    expect(await calendarItems()).toEqual([expect.objectContaining({ link, start: runAt.toISOString() })]);
    expect(await fixture.read()).toEqual(original);

    await service.mutate(botId, randomUUID(), null, {
      action: "update", id: routineId, expectedRevision: original.revision, trigger: { type: "once", runAt: runAt.toISOString() },
    });
    await fixture.sync();
    expect(await fixture.read()).toMatchObject({ id: routineId, name: original.name, prompt: original.prompt,
      scheduleKind: "once", nextRunAt: runAt, onceAt: runAt, cronExpression: null, revision: original.revision + 1 });
    expect((await activity.list({ botId })).upcoming).toEqual([expect.objectContaining({ link, runAt: runAt.toISOString() })]);
    expect(await calendarItems()).toEqual([expect.objectContaining({ link, start: runAt.toISOString() })]);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

integration("scheduled goal lifecycle stays on one ID and preparation is assigned to the configured planner", async () => {
  const runAt = new Date(Date.now() + 600_000);
  const fixture = await harness.fixture({ trigger: { type: "once", runAt: runAt.toISOString() }, enabled: true });
  const planner = await harness.fixture();
  const { db } = harness;
  const { service, botId, routineId, worker } = fixture;
  const previous = await db.featureSettings.findUnique({ where: { id: "global" } });
  const model = { providerId: "openai", modelId: "gpt-5", reasoning: "low" };
  const settings = { outcomesEnabled: true, plannerBotId: planner.botId, plannerModel: model };
  const owner = { kind: "bot", id: botId } as const;
  try {
    await db.featureSettings.upsert({ where: { id: "global" }, update: settings, create: { id: "global", ...settings } });
    const advice = await service.prepareOwner(owner, routineId, randomUUID(), 1);
    expect(await db.run.findUnique({ where: { id: advice.runId! } })).toMatchObject({
      botId: planner.botId, channelId: planner.channelId, origin: "routine",
    });
    expect(await worker.claim(botId)).toBeNull();
    const claimed = await worker.claim(planner.botId);
    expect(claimed).toMatchObject({ runId: advice.runId, botId: planner.botId, readOnly: true, preparationModel: model });
    expect(await db.contextSession.findUnique({ where: { id: claimed.contextSessionId } })).toMatchObject({
      botId: planner.botId, scope: "automation", scopeId: advice.runId,
    });
    expect(await service.scheduledGoal(routineId)).toMatchObject({ state: "preparing", botId, runAt: runAt.toISOString() });
    const text = "Confirm the current delivery date with the owner.";
    await db.$transaction(async (tx) => {
      await tx.event.create({ data: { topic: "run_item.completed", entityId: claimed.runId, payload: { item: { type: "agentMessage", text } } } });
      await tx.run.update({ where: { id: claimed.runId }, data: { status: "completed", completedAt: new Date() } });
      await saveSilentAutomationResult(tx, claimed.runId);
      await reconcileRoutineExecution(tx, claimed.runId);
    });
    expect(await service.scheduledGoal(routineId)).toMatchObject({ executions: [{ result: { summary: text, delivered: false } }] });
    await service.mutate(botId, randomUUID(), null, { action: "pause", id: routineId, expectedRevision: 1 });
    expect(await service.listScheduledGoals()).toContainEqual(expect.objectContaining({ id: routineId, state: "paused", runAt: runAt.toISOString() }));
    expect(await service.listScheduledGoals()).not.toContainEqual(expect.objectContaining({ id: planner.routineId }));
    await service.mutate(botId, randomUUID(), null, { action: "resume", id: routineId, expectedRevision: 2 });
    const movedTo = new Date(runAt.getTime() + 60_000);
    await service.mutate(botId, randomUUID(), null, { action: "update", id: routineId, expectedRevision: 3, trigger: { type: "once", runAt: movedTo.toISOString() } });
    expect(await service.scheduledGoal(routineId)).toMatchObject({ id: routineId, state: "scheduled", runAt: movedTo.toISOString() });
    await service.mutate(botId, randomUUID(), null, { action: "delete", id: routineId, expectedRevision: 4 });
    expect(await service.scheduledGoal(routineId)).toMatchObject({ state: "cancelled", executions: [{ result: { summary: text } }] });
    expect(await service.dispatchDue(movedTo)).toBe(0);
  } finally {
    if (previous) await db.featureSettings.update({ where: { id: "global" }, data: {
      outcomesEnabled: previous.outcomesEnabled, plannerBotId: previous.plannerBotId, plannerModel: previous.plannerModel ?? Prisma.DbNull,
    } });
    else await db.featureSettings.deleteMany({ where: { id: "global" } });
    await fixture.cleanup();
    await planner.cleanup();
  }
}, 15_000);

for (const kind of ["once", "dated Cron"] as const) {
  integration(`manual run advice for ${kind} is private and keeps the original schedule`, async () => {
    const now = Date.now();
    const prepAt = new Date(now + 20_000);
    const runAt = new Date(Math.ceil((now + 120_000) / 60_000) * 60_000);
    const schedule = `CRON_TZ=UTC ${runAt.getUTCMinutes()} ${runAt.getUTCHours()} ${runAt.getUTCDate()} ${runAt.getUTCMonth() + 1} *`;
    const fixture = await harness.fixture(kind === "once"
      ? { trigger: { type: "once", runAt: runAt.toISOString(), preparation: { at: prepAt.toISOString(), instruction: "Read the project notes." } }, enabled: true }
      : { schedule, enabled: true });
    const { service, worker, botId, channelId, routineId } = fixture;
    const owner = { kind: "bot", id: botId } as const;
    const { db } = harness;
    try {
      const original = await fixture.read();
      await expect(service.prepareOwner(owner, routineId, randomUUID(), original.revision + 1))
        .rejects.toMatchObject({ code: "routine_revision_conflict" });
      const requestId = randomUUID();
      const requests = await Promise.all([requestId, requestId, randomUUID()].map((id) =>
        service.prepareOwner(owner, routineId, id, original.revision)
      ));
      const [queued] = requests;
      expect(queued).toMatchObject({ kind: "preparation", status: "queued", revision: original.revision });
      expect(new Set(requests.map(({ id }) => id)).size).toBe(1);
      expect(await fixture.read()).toEqual(original);
      const preparation = await worker.claim(botId);
      expect(preparation).toMatchObject({ runId: queued!.runId, readOnly: true, inboxType: "routine.preparation" });
      expect(preparation.content).toContain(original.prompt);
      expect(preparation.content).toContain(runAt.toISOString());
      await expect(wakeAutomationParent(fixture.messaging, {
        botId, channelId, runId: preparation.runId, conversationId: fixture.conversationId,
        origin: "routine", callId: randomUUID(), deliveryId: null, replyToMessageId: null, isFork: false,
      }, { message: "Private brief" })).rejects.toThrow("Preparation is private");
      await db.$transaction(async (tx) => {
        await tx.event.create({ data: {
          topic: "run_item.completed", entityId: preparation.runId,
          payload: { item: { type: "agentMessage", text: "Verified sources and questions" } },
        } });
        await tx.run.update({ where: { id: preparation.runId }, data: { status: "completed", completedAt: new Date() } });
        await saveSilentAutomationResult(tx, preparation.runId);
        const settled = await reconcileRoutineExecution(tx, preparation.runId);
        await service.afterExecution(tx, settled!);
      });
      expect(await service.executions(botId, routineId)).toEqual([expect.objectContaining({
        id: queued!.id, status: "completed", result: { summary: "Verified sources and questions", delivered: false },
      })]);
      expect(await service.dispatchDue(prepAt)).toBe(0);
      expect(await fixture.read()).toMatchObject({ nextRunAt: runAt, onceStartedAt: null, lastRunAt: null });
      expect(await service.dispatchDue(runAt)).toBe(1);
      const formal = await worker.claim(botId);
      expect(formal).toMatchObject({ readOnly: false, inboxType: "routine.scheduled" });
      expect(formal.content).toContain("Verified sources and questions");
      await expect(service.prepareOwner(owner, routineId, randomUUID(), original.revision))
        .rejects.toMatchObject({ code: "routine_preparation_unavailable" });
      expect((await service.executions(botId, routineId)).map(({ kind }) => kind)).toEqual(["scheduled", "preparation"]);
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);
}

integration("rescheduling dated Cron cancels queued advice from the previous revision", async () => {
  const runAt = new Date(Math.ceil((Date.now() + 120_000) / 60_000) * 60_000);
  const scheduleAt = (date: Date) => `CRON_TZ=UTC ${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
  const fixture = await harness.fixture({ schedule: scheduleAt(runAt), enabled: true });
  const { service, worker, botId, routineId } = fixture;
  const owner = { kind: "bot", id: botId } as const;
  try {
    const advice = await service.prepareOwner(owner, routineId, randomUUID(), 1);
    const newTime = new Date(runAt.getTime() + 60_000);
    await service.mutate(botId, randomUUID(), null, { action: "update", id: routineId, expectedRevision: 1, schedule: scheduleAt(newTime) });
    expect(await worker.claim(botId)).toBeNull();
    expect((await service.executions(botId, routineId))[0]).toMatchObject({ id: advice.id, status: "cancelled" });
    expect(await service.prepareOwner(owner, routineId, randomUUID(), 2)).toMatchObject({ kind: "preparation", status: "queued", revision: 2 });
    expect(await fixture.read()).toMatchObject({ nextRunAt: newTime });
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

for (const outcome of ["ready", "unfinished", "failed", "late", "rescheduled"] as const) {
  integration(`single arrangement with ${outcome} preparation claims and delivers one formal run`, async () => {
    const now = Date.now();
    const prepAt = new Date(now + 60_000);
    const dueAt = new Date(now + 180_000);
    const instruction = outcome === "ready" ? "Read the authorized project notes." : "Summarize the latest inventory snapshot.";
    const trigger = { type: "once", runAt: dueAt.toISOString(), preparation: { at: prepAt.toISOString(), instruction } };
    const fixture = await harness.fixture({ trigger, enabled: true });
    const { db } = harness;
    const { service, worker, botId, channelId, routineId } = fixture;
    const calendar = new ScheduleService(db);
    const activity = new ActivityService(db);
    const query = { from: new Date(now).toISOString(), to: new Date(now + 600_000).toISOString(), botId, kinds: ["routine_run", "scheduled_once"] as const };
    const calendarRows = async () => (await calendar.list("local", { ...query, kinds: [...query.kinds] })).items;
    const rows = async () => (await activity.list({ botId })).upcoming;
    const history = () => service.executions(botId, routineId);
    try {
      await fixture.sync();
      expect(await fixture.read()).toMatchObject({ trigger, onceAt: dueAt, revision: 1 });
      expect(await rows()).toEqual([expect.objectContaining({ id: `routine:${routineId}`, state: "scheduled", runAt: trigger.runAt })]);
      expect(await calendarRows()).toEqual([expect.objectContaining({ id: `scheduled_once:${routineId}`, link: { type: "routine", id: routineId }, start: trigger.runAt })]);
      expect(await service.dispatchDue(new Date(now))).toBe(0);
      if (outcome !== "late") {
        const counts = await Promise.all([service.dispatchDue(prepAt), service.dispatchDue(prepAt)]);
        expect(counts.reduce((total, count) => total + count, 0)).toBe(1);
        const preparation = await worker.claim(botId);
        expect(preparation).toMatchObject({ readOnly: true, inboxType: "routine.preparation" });
        expect(preparation.content).toContain(instruction);
        expect(await rows()).toEqual([expect.objectContaining({ state: "preparing" })]);
        expect(await calendarRows()).toEqual([expect.objectContaining({ state: "preparing" })]);
        await expect(wakeAutomationParent(fixture.messaging, {
          botId, channelId, runId: preparation.runId, conversationId: fixture.conversationId,
          origin: "routine", callId: randomUUID(), deliveryId: null, replyToMessageId: null, isFork: false,
        }, { message: "Private brief" })).rejects.toThrow("Preparation is private");
        if (outcome !== "unfinished") {
          await db.$transaction(async (tx) => {
            await tx.automationResult.create({ data: { runId: preparation.runId, message: "Private brief" } });
            await tx.run.update({ where: { id: preparation.runId }, data: { status: outcome === "failed" ? "failed" : "completed", completedAt: new Date() } });
            await reconcileRoutineExecution(tx, preparation.runId);
          });
        }
      }
      const scanAt = outcome === "late" ? new Date(dueAt.getTime() + 30_000) : dueAt;
      expect(await service.dispatchDue(scanAt)).toBe(1);
      expect(await rows()).toEqual([expect.objectContaining({ state: "waiting" })]);
      if (outcome === "rescheduled") {
        const old = (await history()).find(({ kind }) => kind === "scheduled")!;
        const movedAt = new Date(dueAt.getTime() + 60_000);
        await service.mutate(botId, randomUUID(), null, { action: "update", id: routineId, expectedRevision: 1, trigger: { type: "once", runAt: movedAt.toISOString() } });
        expect(await worker.claim(botId)).toBeNull();
        expect((await history()).find(({ id }) => id === old.id)?.status).toBe("cancelled");
        expect(await calendarRows()).toEqual([expect.objectContaining({ start: movedAt.toISOString(), state: "scheduled" })]);
        expect(await service.dispatchDue(movedAt)).toBe(1);
      }
      const formal = await worker.claim(botId);
      expect(formal).toMatchObject({ readOnly: false, inboxType: "routine.scheduled" });
      expect(formal.content.includes("Private brief")).toBe(outcome === "ready");
      if (outcome === "late") expect(formal.content).toContain("delivery is late");
      expect(await rows()).toEqual([]);
      expect(await calendarRows()).toEqual([expect.objectContaining({ state: "running" })]);
      const scheduled = (await history()).find(({ runId }) => runId === formal.runId)!;
      if (outcome === "late") {
        const staleAt = new Date(Date.now() - 180_000);
        await db.botRunLease.update({ where: { runId: formal.runId }, data: { expiresAt: staleAt } });
        await db.inboxEvent.update({ where: { id: formal.inboxId }, data: { claimedAt: staleAt } });
        expect(await worker.claim(botId)).toMatchObject({ runId: formal.runId, attempt: 2 });
      }
      await db.$transaction(async (tx) => {
        await tx.run.update({ where: { id: formal.runId }, data: { status: "failed", completedAt: new Date() } });
        const settled = await reconcileRoutineExecution(tx, formal.runId);
        expect(settled).toBeDefined();
        await service.afterExecution(tx, settled!);
        await service.afterExecution(tx, settled!);
      });
      const result = await db.automationResult.findUniqueOrThrow({ where: { runId: formal.runId } });
      expect(result.wakeRunId).toBeString();
      expect((await history()).find(({ id }) => id === scheduled.id)?.result?.delivered).toBe(false);
      const parent = await worker.claim(botId);
      expect(parent).toMatchObject({ runId: result.wakeRunId, origin: "background_revival" });
      const delivery = await fixture.messaging.sendVisible({
        botId, channelId, runId: parent.runId, conversationId: fixture.conversationId,
        origin: "background_revival", callId: randomUUID(), deliveryId: null, replyToMessageId: null, isFork: false,
      }, { type: "text", content: "Reminder from the main conversation" });
      expect(delivery.acknowledgement).toMatchObject({ sent: true });
      expect((await history()).find(({ id }) => id === scheduled.id)?.result?.delivered).toBe(true);
      expect(await fixture.sync()).toBeDefined();
      expect(await fixture.read()).toMatchObject({ nextRunAt: null, onceStartedAt: expect.any(Date) });
      expect(await service.dispatchDue(new Date(now + 600_000))).toBe(0);
      expect((await history()).filter(({ kind, startedAt }) => kind === "scheduled" && startedAt)).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);
}

for (const action of ["pause", "delete"] as const) {
  integration(`${action} fences an already queued arrangement`, async () => {
    const dueAt = new Date(Date.now() + 60_000);
    const fixture = await harness.fixture({ trigger: { type: "once", runAt: dueAt.toISOString() }, enabled: true });
    try {
      const { service, worker, botId, routineId } = fixture;
      expect(await service.dispatchDue(dueAt)).toBe(1);
      await service.mutate(botId, randomUUID(), null, { action, id: routineId, expectedRevision: 1 });
      expect(await worker.claim(botId)).toBeNull();
      expect(await fixture.read()).toMatchObject({ enabled: false, onceStartedAt: null, nextRunAt: null });
      expect(await harness.db.routineExecution.findFirst({ where: { routineId } })).toMatchObject({ status: "cancelled", startedAt: null });
      expect((await new ActivityService(harness.db).list({ botId })).upcoming).toEqual([]);
      const calendar = await new ScheduleService(harness.db).list("local", {
        botId, kinds: ["scheduled_once"], from: new Date(dueAt.getTime() - 60_000).toISOString(),
        to: new Date(dueAt.getTime() + 60_000).toISOString(),
      });
      expect(calendar.items).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });
}
