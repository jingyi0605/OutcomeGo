import { describe, expect, spyOn, test } from "bun:test";
import {
  dispatchDueScheduledWorkItems,
  dispatchQueuedOutcomeWorkItems,
  enqueueOutcomeTurn,
} from "../src";
import { outcomeThreadFixture } from "./fixtures/outcome-thread";

// Specs/004.10 task 2.3: a bot task with a future schedule does not start, holds no capacity, and starts exactly
// once when it is due. Needs a disposable PostgreSQL database; skipped without OUTCOMEGO_TEST_DATABASE_URL.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const minutes = (value: number) => new Date(Date.now() + value * 60_000);

describe.skipIf(!url)("scheduled dispatch (specs/004.10 task 2.3)", () => {
  const start = (h: Awaited<ReturnType<typeof outcomeThreadFixture>>, workItemId: string) =>
    h.db.$transaction((tx) =>
      enqueueOutcomeTurn(tx, h.messaging, { workItemId, content: "Execute", reason: "start", clientId: `start:${workItemId}` })
    );
  const schedule = (h: Awaited<ReturnType<typeof outcomeThreadFixture>>, workItemId: string, at: Date | null) =>
    h.db.outcomeWorkItem.update({ where: { id: workItemId }, data: { scheduledAt: at } });
  const runs = (h: Awaited<ReturnType<typeof outcomeThreadFixture>>) => h.db.run.count({ where: { botId: h.bot.id } });
  const pendingRecords = (h: Awaited<ReturnType<typeof outcomeThreadFixture>>, workItemId: string) =>
    h.db.idempotencyRecord.count({ where: { scope: `outcome-turn:${workItemId}`, status: "processing" } });

  test("a task scheduled for later is not started: no run, no root run, still queued, intent kept", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      await schedule(h, item.id, minutes(60));
      expect(await start(h, item.id)).toEqual({ status: "queued_for_capacity" });
      expect(await runs(h)).toBe(0);
      const row = await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(row.status).toBe("queued");
      expect(row.rootRunId).toBeNull();
      expect(await pendingRecords(h, item.id)).toBe(1);
    } finally {
      await h.cleanup();
    }
  });

  test("waiting for its time holds no capacity: the bot's two slots stay free for other tasks", async () => {
    const h = await outcomeThreadFixture();
    try {
      const waiting = await Promise.all([h.item(1), h.item(2), h.item(3)]);
      for (const item of waiting) await schedule(h, item.id, minutes(60));
      for (const item of waiting) expect((await start(h, item.id)).status).toBe("queued_for_capacity");
      const normal = await Promise.all([h.item(4), h.item(5)]);
      expect((await start(h, normal[0]!.id)).status).toBe("enqueued");
      expect((await start(h, normal[1]!.id)).status).toBe("enqueued");
      expect(await runs(h)).toBe(2);
    } finally {
      await h.cleanup();
    }
  });

  test("a task still waiting for its time never takes or waits on the bot's capacity lock", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      await schedule(h, item.id, minutes(60));
      // Hold the per-bot capacity lock in another transaction, as a busy release for the same bot would.
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquired!: () => void;
      const ready = new Promise<void>((resolve) => (acquired = resolve));
      const holder = h.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-capacity:${h.bot.id}`}))`;
        acquired();
        await held;
      }, { timeout: 30_000 });
      await ready;
      try {
        // With the gate ahead of the capacity step this returns at once. If it ran after, it would block on the
        // lock until the lock timeout, and fail here.
        const result = await h.db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
          return enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` });
        });
        expect(result).toEqual({ status: "queued_for_capacity" });
      } finally {
        release();
        await holder;
      }
    } finally {
      await h.cleanup();
    }
  });

  test("once due it starts exactly once, and repeated dispatching creates no second run", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      await schedule(h, item.id, minutes(60));
      await start(h, item.id);
      await schedule(h, item.id, minutes(-1));
      for (let pass = 0; pass < 3; pass += 1)
        await h.db.$transaction((tx) => dispatchQueuedOutcomeWorkItems(tx, h.messaging, h.bot.id));
      await Promise.all([
        h.db.$transaction((tx) => dispatchQueuedOutcomeWorkItems(tx, h.messaging, h.bot.id)),
        h.db.$transaction((tx) => dispatchQueuedOutcomeWorkItems(tx, h.messaging, h.bot.id)),
      ]);
      expect(await runs(h)).toBe(1);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).rootRunId).not.toBeNull();
      expect(await pendingRecords(h, item.id)).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("a schedule that is exactly now counts as due", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      await schedule(h, item.id, new Date(Date.now() - 5));
      expect((await start(h, item.id)).status).toBe("enqueued");
    } finally {
      await h.cleanup();
    }
  });

  test("a task with no schedule behaves exactly as before", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      expect((await start(h, item.id)).status).toBe("enqueued");
    } finally {
      await h.cleanup();
    }
  });

  test("one hundred not-yet-due tasks ahead in line cannot starve a due task", async () => {
    const h = await outcomeThreadFixture();
    try {
      const future = minutes(600);
      // Older than the due task, so a naive "first 100 by creation time" would be all of them.
      await h.db.outcomeWorkItem.createMany({
        data: Array.from({ length: 100 }, (_, index) => ({
          outcomeId: h.outcome.id, contractRevisionId: h.revision.id, botId: h.bot.id, executorType: "agent" as const,
          title: "Waiting fixture", status: "queued" as const, ordinal: index + 1000, scheduledAt: future, createdAt: new Date("2026-01-01"),
        })),
      });
      const waiting = await h.db.outcomeWorkItem.findMany({ where: { outcomeId: h.outcome.id, ordinal: { gte: 1000 } }, select: { id: true } });
      // Real start intents, written by the enqueue path itself (each is held because it is not due).
      for (const item of waiting) expect((await start(h, item.id)).status).toBe("queued_for_capacity");
      expect(await h.db.idempotencyRecord.count({ where: { scope: { in: waiting.map((item) => `outcome-turn:${item.id}`) }, status: "processing" } })).toBe(100);
      // Created after the 100, so a plain "first 100 by creation time" would never reach it. It is held first (not
      // due), then its time arrives, so only the dispatch query can release it.
      const due = await h.item(1);
      await schedule(h, due.id, minutes(30));
      expect((await start(h, due.id)).status).toBe("queued_for_capacity");
      await schedule(h, due.id, minutes(-1));
      expect(await runs(h)).toBe(0);
      await h.db.$transaction((tx) => dispatchQueuedOutcomeWorkItems(tx, h.messaging, h.bot.id));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: due.id } })).rootRunId).not.toBeNull();
      expect(await runs(h)).toBe(1);
      await h.db.idempotencyRecord.deleteMany({ where: { scope: { in: waiting.map((item) => `outcome-turn:${item.id}`) } } });
    } finally {
      await h.cleanup();
    }
  });

  test("the due-time sweep releases only tasks that are due, once per bot pass", async () => {
    const h = await outcomeThreadFixture();
    try {
      const [soon, later] = await Promise.all([h.item(1), h.item(2)]);
      await schedule(h, soon!.id, minutes(30));
      await schedule(h, later!.id, minutes(600));
      await start(h, soon!.id);
      await start(h, later!.id);
      expect(await dispatchDueScheduledWorkItems(h.db, h.messaging)).toEqual({ bots: 0, released: 0 });
      expect(await runs(h)).toBe(0);
      await schedule(h, soon!.id, minutes(-1));
      expect(await dispatchDueScheduledWorkItems(h.db, h.messaging)).toEqual({ bots: 1, released: 1 });
      expect(await runs(h)).toBe(1);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: later!.id } })).rootRunId).toBeNull();
      // Nothing is due any more, so a second sweep does nothing.
      expect(await dispatchDueScheduledWorkItems(h.db, h.messaging)).toEqual({ bots: 0, released: 0 });
    } finally {
      await h.cleanup();
    }
  });

  test("a cancelled goal never releases its scheduled task", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      await schedule(h, item.id, minutes(30));
      await start(h, item.id);
      await schedule(h, item.id, minutes(-1));
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { cancelledAt: new Date(), status: "cancelled" } });
      await dispatchDueScheduledWorkItems(h.db, h.messaging);
      await h.db.$transaction((tx) => dispatchQueuedOutcomeWorkItems(tx, h.messaging, h.bot.id));
      expect(await runs(h)).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("an accepted goal never releases its scheduled task", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      await schedule(h, item.id, minutes(30));
      await start(h, item.id);
      await schedule(h, item.id, minutes(-1));
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { acceptedAt: new Date(), status: "accepted" } });
      await dispatchDueScheduledWorkItems(h.db, h.messaging);
      expect(await runs(h)).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("a task whose contract revision was replaced is not released", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      await schedule(h, item.id, minutes(30));
      await start(h, item.id);
      await schedule(h, item.id, minutes(-1));
      await h.db.outcomeContractRevision.update({ where: { id: h.revision.id }, data: { status: "closed" } });
      await dispatchDueScheduledWorkItems(h.db, h.messaging);
      expect(await runs(h)).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("a restart that spans the due time still releases it: the intent is durable, not an in-process timer", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      await schedule(h, item.id, minutes(30));
      await start(h, item.id);
      // "Downtime": nothing runs while the due time passes, and the process holds no timers or state.
      await schedule(h, item.id, minutes(-600));
      expect(await dispatchDueScheduledWorkItems(h.db, h.messaging)).toEqual({ bots: 1, released: 1 });
      expect(await runs(h)).toBe(1);
    } finally {
      await h.cleanup();
    }
  });

  test("releasing a task logs its plan time, the actual time and the delay in seconds", async () => {
    const h = await outcomeThreadFixture();
    const info = spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const item = await h.item(1);
      await schedule(h, item.id, minutes(30));
      await start(h, item.id);
      const planned = new Date(Date.now() - 90_000);
      await schedule(h, item.id, planned);
      await dispatchDueScheduledWorkItems(h.db, h.messaging);
      const lines = info.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("outcome.scheduled_release"));
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]!.slice(lines[0]!.indexOf("{")));
      expect(entry).toMatchObject({ workItemId: item.id, scheduledAt: planned.toISOString() });
      expect(typeof entry.releasedAt).toBe("string");
      expect(entry.delaySeconds).toBeGreaterThanOrEqual(89);
      expect(entry.delaySeconds).toBeLessThan(150);
    } finally {
      info.mockRestore();
      await h.cleanup();
    }
  });
});
