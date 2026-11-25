import { afterEach, describe, expect, test } from "bun:test";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { createScheduleRoutes } from "../src/routes/schedule";
import type { RouteContext } from "../src/routes/context";
import { OwnerTodoService } from "../src/services/owner-todo-service";
import { ScheduleService } from "../src/services/schedule-service";

const cleanups: Array<() => Promise<void>> = [];
const now = new Date("2026-03-08T15:00:00Z");
const range = { from: "2026-03-08T00:00:00Z", to: "2026-03-09T00:00:00Z" };

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const fixture = await outcomeThreadFixture();
  const { db } = fixture;
  const ownerId = crypto.randomUUID();
  const todos = new OwnerTodoService(db);
  const service = new ScheduleService(db);
  cleanups.push(fixture.cleanup, async () => {
    await db.ownerTodoItem.deleteMany({ where: { ownerId: { in: [ownerId, `${ownerId}-other`] } } });
  });
  return { ...fixture, ownerId, todos, service };
}

describe.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("owner schedule", () => {
  for (const [label, sourceKind] of [["Fixture A", "opaque-one"], ["Fixture B", "opaque-two"]] as const) {
    test(`${label} projects the same sources and scopes each filter`, async () => {
      const { db, bot, outcome, revision, item, ownerId, service } = await setup();
      const deadline = new Date("2026-03-08T05:00:00Z");
      const scheduledAt = new Date("2026-03-08T14:00:00Z");
      await db.outcome.update({ where: { id: outcome.id }, data: { dueAt: deadline } });
      const work = await item();
      await db.outcomeWorkItem.update({ where: { id: work.id }, data: { scheduledAt, dueAt: deadline, estimateMinutes: 40, title: label } });
      await db.outcomeWorkItem.create({ data: {
        outcomeId: outcome.id, contractRevisionId: revision.id, botId: bot.id, executorType: "human",
        title: label, status: "pending", ordinal: 2, dueAt: deadline,
      } });
      const done = await item(3);
      await db.outcomeWorkItem.update({ where: { id: done.id }, data: { status: "completed", completedAt: scheduledAt } });
      const todo = await db.ownerTodoItem.create({ data: {
        ownerId, title: label, sourceRef: { kind: sourceKind, id: "opaque-id", label },
        dueAt: deadline, scheduledAt, createdBy: ownerId, createdVia: "owner_ui", botId: bot.id, linkedOutcomeId: outcome.id,
      } });
      await db.ownerTodoItem.create({ data: { ownerId: `${ownerId}-other`, title: label, dueAt: deadline, createdBy: "other", createdVia: "owner_ui", botId: bot.id } });

      const query = { ...range, botId: bot.id, outcomeId: outcome.id };
      const result = await service.list(ownerId, query, now, "America/New_York");
      expect(result.truncated).toBe(false);
      expect(result.items).toHaveLength(7);
      expect(result.items).toContainEqual(expect.objectContaining({ kind: "goal_due", end: "2026-03-08", allDay: true, overdue: true }));
      expect(result.items).toContainEqual(expect.objectContaining({ kind: "work_item", id: `work_item:${work.id}`, timeBasis: "estimated", start: scheduledAt.toISOString(), end: "2026-03-08T14:40:00.000Z", editable: true }));
      expect(result.items).toContainEqual(expect.objectContaining({ kind: "work_item", id: `work_item:${done.id}:actual`, timeBasis: "actual", end: scheduledAt.toISOString(), editable: false }));
      expect(result.items).toContainEqual(expect.objectContaining({ kind: "human_task", state: "pending", owner: "me", editable: true }));
      expect((await service.list(ownerId, { ...query, kinds: ["todo"], mine: true }, now)).items.map(({ id }) => id).sort()).toEqual([`todo:${todo.id}`, `todo:${todo.id}:due`]);
      expect((await service.list(`${ownerId}-other`, { ...query, kinds: ["todo"] }, now)).items).toEqual([]);
      expect((await service.list(ownerId, { ...query, mine: true }, now)).items.every(({ owner }) => owner === "me")).toBe(true);
    });
  }

  test("requires owner authentication and validates date ranges and filters", async () => {
    const { todos, service, bot } = await setup();
    const route = createScheduleRoutes(service, todos);
    const call = (query: Record<string, string>, authMode: "required" | "disabled" = "disabled") => {
      const url = new URL(`http://localhost/api/v0/schedule?${new URLSearchParams(query)}`);
      return route({ request: new Request(url), url, path: "/api/schedule", authMode, authenticatedSessionId: null } as RouteContext);
    };
    await expect(call(range, "required")).rejects.toMatchObject({ status: 401 });
    for (const query of [{ ...range, to: range.from }, { ...range, from: "2026-03-08" }, { ...range, to: "2026-06-09T00:00:00.001Z" }]) {
      await expect(call(query)).rejects.toMatchObject({ status: 400, code: "invalid_range" });
    }
    await expect(call({ ...range, kinds: "unknown" })).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    const response = await call({ ...range, to: "2026-06-09T00:00:00Z", botId: bot.id, kinds: "goal_due,todo", mine: "true" });
    expect(await response?.json()).toEqual({ items: [], truncated: false });
  });

  test("projects cron, interval and historical event executions without projecting paused or deleted routines", async () => {
    const { db, bot, ownerId, service } = await setup();
    const reference = new Date("2026-03-07T15:00:00Z");
    const query = { from: range.from, to: "2026-03-11T00:00:00Z", botId: bot.id, kinds: ["routine_run"] as const };
    const create = (slug: string, fields: Parameters<typeof db.routine.create>[0]["data"]) => db.routine.create({ data: { ...fields, slug, name: slug } });
    const base = { botId: bot.id, prompt: "Fixture", name: "Fixture", slug: "fixture", scheduleText: "0 9 * * *", scheduleKind: "cron" as const,
      timezone: "America/New_York", cronExpression: "0 9 * * *", nextRunAt: new Date("2026-03-08T13:00:00Z") };
    const cron = await create("alpha", base);
    const interval = await create("beta", { ...base, scheduleKind: "interval", scheduleText: "@every 5m", intervalSeconds: 300, cronExpression: null,
      nextRunAt: new Date("2026-03-07T15:02:00Z"), scheduleAnchorAt: new Date("2026-03-07T15:02:00Z") });
    const event = await create("gamma", { ...base, scheduleKind: "event", scheduleText: "", cronExpression: null });
    const paused = await create("delta", { ...base, pausedAt: reference, enabled: false });
    const deleted = await create("epsilon", { ...base, deletedAt: reference });
    const revision = await db.routineRevision.create({ data: { routineId: event.id, revision: 1, name: event.name, prompt: event.prompt,
      scheduleText: event.scheduleText, scheduleKind: event.scheduleKind, timezoneMode: event.timezoneMode, timezone: event.timezone, enabled: true, source: "fixture" } });
    const past = await db.routineExecution.create({ data: { routineId: event.id, routineRevisionId: revision.id, kind: "scheduled", status: "completed",
      scheduledFor: new Date("2026-03-08T00:10:00Z"), events: [], dedupeKey: `fixture:${event.id}` } });

    const { items } = await service.list(ownerId, query, reference, "America/New_York");
    const forRoutine = (id: string) => items.filter((item) => item.link.id === id);
    expect(forRoutine(cron.id).map((item) => item.start)).toEqual(["2026-03-08T13:00:00.000Z", "2026-03-09T13:00:00.000Z", "2026-03-10T13:00:00.000Z"]);
    expect(forRoutine(interval.id)).toHaveLength(100);
    expect(forRoutine(interval.id)[0]?.start).toBe("2026-03-08T00:02:00.000Z");
    for (const routine of [event, paused, deleted]) expect(forRoutine(routine.id)).toEqual([]);
    const history = await service.list(ownerId, query, now);
    expect(history.items.filter((item) => item.link.id === event.id)).toMatchObject([
      { id: `routine_run:${event.id}:${past.id}`, start: past.scheduledFor.toISOString(), timeBasis: "actual", editable: false },
    ]);
  });

  test("surfaces active follow-ups and links the relevant conversation or the standalone todo", async () => {
    const { db, bot, ownerId, service } = await setup();
    const nextCheck = new Date("2026-03-08T14:55:00Z");
    const message = await db.message.create({ data: { botId: bot.id, conversationId: bot.conversation!.id, role: "user", content: "Fixture request" } });
    const run = await db.run.create({ data: { botId: bot.id, conversationId: bot.conversation!.id, userMessageId: message.id,
      requestProgress: { state: "waiting", summary: "Fixture" }, requestNextCheckAt: nextCheck } });
    const todo = { ownerId, title: "Fixture", status: "waiting" as const, followUpAt: nextCheck, createdBy: ownerId, createdVia: "owner_ui" as const, botId: bot.id };
    const linked = await db.ownerTodoItem.create({ data: { ...todo, handoffMessageId: message.id } });
    const standalone = await db.ownerTodoItem.create({ data: todo });
    await db.ownerTodoItem.create({ data: { ...todo, status: "done" } });
    const query = { ...range, botId: bot.id, kinds: ["follow_up"] as const };
    const { items } = await service.list(ownerId, query, now);
    expect(items).toHaveLength(3);
    expect(items).toContainEqual(expect.objectContaining({ id: `follow_up:request:${run.id}`, title: "Fixture request", link: { type: "conversation", id: bot.conversation!.id }, editable: false }));
    expect(items).toContainEqual(expect.objectContaining({ id: `follow_up:todo:${linked.id}`, link: { type: "conversation", id: bot.conversation!.id }, state: "follow_up" }));
    expect(items).toContainEqual(expect.objectContaining({ id: `follow_up:todo:${standalone.id}`, link: { type: "todo", id: standalone.id } }));
    await db.run.update({ where: { id: run.id }, data: { requestStoppedAt: now } });
    expect((await service.list(ownerId, query, now)).items).toHaveLength(2);
    expect((await service.list("another-owner", query, now)).items).toEqual([]);
  });

  test("returns a stable first 1000 with a truncation flag over a 93-day range", async () => {
    const { db, ownerId, service } = await setup();
    await db.ownerTodoItem.createMany({ data: Array.from({ length: 1001 }, (_, index) => ({
      ownerId, title: `Fixture ${index}`, createdBy: ownerId, createdVia: "owner_ui" as const,
      scheduledAt: new Date(Date.parse(range.from) + index * 1_000),
    })) });
    const query = { from: range.from, to: "2026-06-09T00:00:00Z", kinds: ["todo"] as const };
    const elapsed: number[] = [];
    for (let sample = 0; sample < 20; sample++) {
      const start = performance.now();
      const response = await service.list(ownerId, query, now);
      elapsed.push(performance.now() - start);
      expect(response.truncated).toBe(true);
      expect(response.items).toHaveLength(1000);
      expect(response.items.at(-1)?.title).toBe("Fixture 999");
    }
    const p95 = elapsed.sort((left, right) => left - right)[18]!;
    console.info(`schedule 93-day / 1000 items local p95: ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(500);
  }, 30_000);
});
