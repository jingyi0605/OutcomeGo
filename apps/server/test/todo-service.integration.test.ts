import { afterEach, describe, expect, test } from "bun:test";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OwnerTodoService } from "../src/services/owner-todo-service";
import { createTodoRoutes } from "../src/routes/todos";
import type { RouteContext } from "../src/routes/context";

const enabled = Boolean(process.env.OUTCOMEGO_TEST_DATABASE_URL);
const cleanups: Array<() => Promise<void>> = [];
const now = new Date("2026-11-25T10:00:00Z");
const later = "2026-11-25T12:00:00Z";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const fixture = await outcomeThreadFixture();
  const { db } = fixture;
  const owner = crypto.randomUUID();
  await db.featureSettings.upsert({ where: { id: "global" }, create: { outcomesEnabled: true }, update: { outcomesEnabled: true } });
  cleanups.push(async () => {
    const rows = await db.ownerTodoItem.findMany({ where: { ownerId: { in: [owner, "local"] } }, select: { id: true } });
    await db.event.deleteMany({ where: { topic: "todo.changed", entityId: { in: rows.map((row) => row.id) } } });
    await db.ownerTodoItem.deleteMany({ where: { ownerId: { in: [owner, "local"] } } });
    await db.idempotencyRecord.deleteMany({ where: { scope: { in: [`todo-create:${owner}`, "todo-create:local"] } } });
    await db.featureSettings.deleteMany({ where: { id: "global" } });
    await fixture.cleanup();
  });
  return { ...fixture, owner, todos: new OwnerTodoService(db) };
}

describe.skipIf(!enabled)("owner todo basics", () => {
  for (const [title, tag] of [["Alpha", "one"], ["Beta", "two"]]) {
    test(`${title}: creation is idempotent, owner scoped, and independent of outcomes`, async () => {
      const { db, owner, todos } = await setup();
      const outcomeCount = await db.outcome.count();
      const input = { title: title!, tags: [tag!], clientRequestId: "repeat", dueAt: later };
      const [first, second] = await Promise.all([todos.create(owner, input, now), todos.create(owner, input, now)]);
      expect(second).toEqual(first);
      expect(first).toMatchObject({ status: "open", executor: "owner", createdVia: "owner_ui", urgency: "normal", revision: 1 });
      expect((await todos.list(owner, { tag }, now)).items).toEqual([first]);
      expect((await todos.list("non-owner", {}, now)).items).toEqual([]);
      await expect(todos.detail("non-owner", first.id, now)).rejects.toMatchObject({ status: 404 });
      await expect(todos.create(owner, { ...input, title: "Different" }, now)).rejects.toMatchObject({ status: 409 });
      expect(await db.event.count({ where: { topic: "todo.changed", entityId: first.id } })).toBe(1);
      expect(await db.outcome.count()).toBe(outcomeCount);
    });
  }

  test("the revision guard, transitions and configurable restore retention apply to writes", async () => {
    const { db, owner, todos } = await setup();
    const item = await todos.create(owner, { title: "Initial", clientRequestId: "transitions" }, now);
    await expect(todos.act(owner, item.id, "accept", { revision: 1 }, now)).rejects.toMatchObject({ status: 409 });
    const writes = await Promise.allSettled([
      todos.update(owner, item.id, { revision: 1, title: "First" }, now),
      todos.update(owner, item.id, { revision: 1, title: "Second" }, now),
    ]);
    expect(writes.map((write) => write.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(writes.find((write) => write.status === "rejected")).toMatchObject({ reason: { code: "todo_conflict" } });
    const waiting = await todos.update(owner, item.id, { revision: 2, status: "waiting", followUpAt: later }, now);
    expect(waiting).toMatchObject({ status: "waiting", revision: 3 });
    const done = await todos.act(owner, item.id, "complete", { revision: 3, note: "Finished" }, now);
    expect(done).toMatchObject({ status: "done", completedAt: now.toISOString(), completionNote: "Finished", revision: 4 });
    expect((await todos.list(owner, { view: "history" }, now)).items).toEqual([done]);
    const restored = await todos.act(owner, item.id, "restore", { revision: 4 }, now);
    expect(restored).toMatchObject({ status: "open", completedAt: null, completionNote: null });
    const dismissed = await todos.act(owner, item.id, "dismiss", { revision: 5 }, now);
    expect(dismissed).toMatchObject({ status: "dismissed", dismissReason: "owner" });
    await db.featureSettings.update({ where: { id: "global" }, data: { taskPolicy: { "todo.restoreRetentionDays": 1 } } });
    const afterRetention = new Date("2026-11-27T10:00:00Z");
    expect((await todos.list(owner, { view: "history" }, afterRetention)).items).toEqual([]);
    await expect(todos.act(owner, item.id, "restore", { revision: 6 }, afterRetention)).rejects.toMatchObject({ status: 409 });
  });

  test("owner routes validate payload, apply the feature gate and support disabled-auth installations", async () => {
    const { db, todos } = await setup();
    const route = createTodoRoutes(todos);
    const request = new Request("http://localhost/api/todos", { method: "POST", body: JSON.stringify({ title: "Alpha", clientRequestId: "route" }) });
    const ctx = { request, path: "/api/todos", url: new URL(request.url), authenticatedSessionId: null } as RouteContext;
    await expect(route({ ...ctx, authMode: "required" })).rejects.toMatchObject({ status: 401 });
    const response = await route({ ...ctx, authMode: "disabled" });
    expect(response?.status).toBe(201);
    const malformed = new Request(request.url, { method: "POST", body: JSON.stringify({ title: "Alpha", clientRequestId: "invalid", dueAt: "2026-11-25T12:00:00" }) });
    await expect(route({ ...ctx, request: malformed, authMode: "disabled" })).rejects.toMatchObject({ status: 400 });
    await db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: false } });
    await expect(route({ ...ctx, authMode: "disabled", request: new Request(request.url) })).rejects.toMatchObject({ code: "outcomes_disabled" });
  });
});
