import { describe, expect, test } from "bun:test";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { enqueueOutcomeTurn } from "@outcomego/messaging";
import { Effect } from "effect";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { RunService } from "../../server/src/services/run-service";
import { WakeWorker } from "../src/worker";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
function signal() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
function worker(h: Awaited<ReturnType<typeof outcomeThreadFixture>>, prisma = h.db) {
  return Object.assign(Object.create(WakeWorker.prototype), {
    prisma, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root,
  }) as unknown as { claim(botId: string): Promise<{ runId: string } | null> };
}

describe.skipIf(!url)("Outcome claim lock order", () => {
  test("real multi-Outcome Stop and reverse-priority claim both commit", async () => {
    const h = await outcomeThreadFixture();
    const aLocked = signal(), bLocked = signal();
    let stopping: Promise<unknown> | undefined, claiming: Promise<unknown> | undefined;
    let stopPid: number | undefined;
    let secondOutcomeId: string | undefined, secondItemId: string | undefined;
    let stopPaused = false, claimPaused = false;
    try {
      const second = await h.db.outcome.create({ data: { botId: h.bot.id, title: "Independent second Outcome" } });
      secondOutcomeId = second.id;
      const revision = await h.db.outcomeContractRevision.create({ data: {
        outcomeId: second.id, revision: 1, status: "approved", approvedAt: new Date(), approvedBy: "owner:local",
        goal: [], boundaries: {}, executionBotId: h.bot.id, contentHash: "second", createdBy: "owner:local",
      } });
      await h.db.outcome.update({ where: { id: second.id }, data: { currentRevisionId: revision.id, status: "approved" } });
      const firstItem = await h.item();
      const secondItem = await h.db.outcomeWorkItem.create({ data: {
        outcomeId: second.id, contractRevisionId: revision.id, botId: h.bot.id, executorType: "agent",
        status: "queued", ordinal: 1, title: "Second independent work",
      } });
      secondItemId = secondItem.id;
      const [a, b] = [firstItem, secondItem].sort((left, right) => left.outcomeId.localeCompare(right.outcomeId));
      for (const item of [a!, b!]) await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
        workItemId: item.id, content: "Compare", reason: "start", clientId: `claim-lock:${item.id}`,
      }));
      const bRun = await h.db.run.findFirstOrThrow({ where: { outcomeWorkItemId: b!.id } });
      await h.db.inboxEvent.updateMany({ where: { runId: bRun.id }, data: { priority: 999 } });
      const stopDb = new Proxy(h.db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (write: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(async tx => {
          const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          stopPid = connection!.pid;
          const wrapped = new Proxy(tx, { get(client, method) {
            if (method !== "$executeRaw") return Reflect.get(client, method);
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(client.$executeRaw, client, args);
              if (!stopPaused && args.includes(`outcome:${a!.outcomeId}`)) {
                stopPaused = true;
                aLocked.resolve();
                await bLocked.promise;
              }
              return result;
            };
          } });
          return write(wrapped);
        }, { timeout: 10_000 });
      } });
      const claimDb = new Proxy(h.db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (write: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(async tx => {
          const wrapped = new Proxy(tx, { get(client, method) {
            if (method !== "$queryRaw" && method !== "$executeRaw") return Reflect.get(client, method);
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(client[method], client, args);
              if (!claimPaused && args.includes(`outcome:${b!.outcomeId}`)) {
                claimPaused = true;
                bLocked.resolve();
                let waiting = false;
                for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
                  const activity = await h.db.$queryRaw<Array<{ wait_event: string | null }>>`SELECT wait_event FROM pg_stat_activity WHERE pid = ${stopPid!}`;
                  waiting = activity[0]?.wait_event === "advisory";
                  if (!waiting) await Bun.sleep(5);
                }
                expect(waiting).toBe(true);
              }
              return result;
            };
          } });
          return write(wrapped);
        }, { timeout: 10_000 });
      } });
      const stops = new RunService(stopDb, async () => Response.json({ ok: true }));
      stopping = Effect.runPromise(stops.cancelOutcomeWorkItems([a!.id, b!.id]));
      await aLocked.promise;
      claiming = worker(h, claimDb).claim(h.bot.id);
      const [claimed] = await Promise.all([claiming, stopping]);
      expect(claimed).toMatchObject({ runId: bRun.id });
      expect(await h.db.outcomeWorkItem.count({ where: { id: { in: [a!.id, b!.id] }, status: "cancelled" } })).toBe(2);
      expect(await h.db.botRunLease.count({ where: { botId: h.bot.id } })).toBe(0);
    } finally {
      aLocked.resolve(); bLocked.resolve();
      await Promise.allSettled([stopping, claiming].filter(Boolean));
      if (secondItemId) await h.db.idempotencyRecord.deleteMany({ where: { scope: { in: [`outcome-turn:${secondItemId}`, `outcome-work-item:${secondItemId}`] } } });
      if (secondOutcomeId) await h.db.event.deleteMany({ where: { entityId: secondOutcomeId } });
      await h.cleanup();
    }
  });

  test("a contended higher-priority Outcome cannot hold up foreground input", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      const queued = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
        workItemId: item.id, content: "Compare", reason: "start", clientId: `foreground-lock:${item.id}`,
      }));
      if (queued.status !== "enqueued") throw new Error("Fixture did not enqueue");
      await h.db.inboxEvent.updateMany({ where: { runId: queued.runId }, data: { priority: 999 } });
      const foreground = await h.db.$transaction(tx => h.messaging.acceptDirectUserMessage(tx, {
        botId: h.bot.id, channelId: h.channel.id, content: "Keep chatting", clientId: `main-lock:${item.id}`,
      }));
      const bounded = new Proxy(h.db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (write: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(write, { timeout: 1000 });
      } }) as PrismaClient;
      await h.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${h.outcome.id}`}))`;
        expect(await worker(h, bounded).claim(h.bot.id)).toMatchObject({ runId: foreground.run.id });
        expect((await tx.run.findUniqueOrThrow({ where: { id: queued.runId } })).status).toBe("queued");
      });
    } finally { await h.cleanup(); }
  });
});
