import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { AUTOMATION_ATTEMPT_LIMIT } from "@outcomego/messaging";
import { BotService } from "../../server/src/services/bot-service";
import { createRoutineHarness } from "./fixtures/routine-context";

const url = (process.env.OUTCOMEGO_TEST_DATABASE_URL ?? process.env.OPENTEAM_TEST_DATABASE_URL);
const integration = test.skipIf(!url);
let harness: Awaited<ReturnType<typeof createRoutineHarness>>;
beforeAll(async () => {
  if (url) harness = await createRoutineHarness();
});
afterAll(async () => {
  await harness?.close();
});

async function until(probe: () => Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await Bun.sleep(2);
  }
  throw new Error("The expected database barrier was not reached");
}

function instrument(
  db: PrismaClient,
  hook: (tx: Prisma.TransactionClient, pid: number) => Prisma.TransactionClient
): PrismaClient {
  return new Proxy(db, {
    get(owner, key) {
      if (key !== "$transaction") return Reflect.get(owner, key);
      return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        owner.$transaction(async tx => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          return work(hook(tx, backend!.pid));
        }, { timeout: 10_000 });
    },
  });
}

const outcome = (promise: Promise<unknown>) =>
  promise.then(() => ({ ok: true }), (error: unknown) => ({ error: String(error) }));

for (const first of ["failure", "archive", "recovery"] as const) {
  integration(`Routine ${first} and real archive finish without inverse lifecycle locks`, async () => {
    const f = await harness.fixture({ trigger: { type: "webhook" }, enabled: true });
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let settling: Promise<unknown> | undefined, archiving: Promise<unknown> | undefined;
    let workerPid = 0, archivePid = 0, paused = false;
    try {
      const [execution] = await f.service.dispatchEvent(
        { kind: "bot", id: f.botId },
        { id: randomUUID(), source: "webhook", kind: "received", text: "First event" }
      );
      const claimed = await f.worker.claim(f.botId);
      expect(claimed?.runId).toBe(execution!.runId);
      // The failed/completed occurrence must also handle a real coalesced follow-up.
      await f.service.dispatchEvent(
        { kind: "bot", id: f.botId },
        { id: randomUUID(), source: "webhook", kind: "received", text: "Next event" }
      );
      if (first === "failure") {
        await harness.db.inboxEvent.update({
          where: { id: claimed.inboxId },
          data: { attempts: AUTOMATION_ATTEMPT_LIMIT },
        });
        claimed.attempt = AUTOMATION_ATTEMPT_LIMIT;
      }
      if (first === "recovery") {
        await harness.db.run.update({
          where: { id: claimed.runId }, data: { status: "completed", completedAt: new Date() },
        });
        await harness.db.inboxEvent.update({
          where: { id: claimed.inboxId }, data: { status: "completed", completedAt: new Date() },
        });
        await harness.db.botRunLease.deleteMany({ where: { runId: claimed.runId } });
      }
      f.worker.prisma = instrument(harness.db, (tx, pid) => {
        workerPid = pid;
        return new Proxy(tx, {
          get(inner, key) {
            const model = first === "recovery" ? "routineExecution" : "run";
            const method = first === "recovery" ? "updateMany" : "update";
            if (key !== model) return Reflect.get(inner, key);
            const delegate = inner[model];
            return { ...delegate, [method]: async (input: never) => {
              const value = await (delegate[method] as (input: never) => Promise<unknown>)(input);
              if (first !== "archive" && !paused) {
                paused = true;
                held.resolve();
                await release.promise;
              }
              return value;
            } };
          },
        });
      });
      const archiveDb = instrument(harness.db, (tx, pid) => {
        archivePid = pid;
        if (first !== "archive") return tx;
        return new Proxy(tx, {
          get(inner, key) {
            if (key !== "bot") return Reflect.get(inner, key);
            return { ...inner.bot, findUnique: async (input: Prisma.BotFindUniqueArgs) => {
              const value = await inner.bot.findUnique(input);
              if (!paused) {
                paused = true;
                held.resolve();
                await release.promise;
              }
              return value;
            } };
          },
        });
      });
      const retire = () => Effect.runPromise(new BotService(
        archiveDb, {} as never, harness.root, async () => Response.json({ ok: true }), f.store
      ).archive(f.botId));
      const settle = () => first === "recovery"
        ? f.worker.recoverRoutineExecutions()
        : f.worker.fail(claimed, new Error("Fixture transport disconnected"), true);
      if (first === "archive") archiving = outcome(retire());
      else settling = outcome(settle());
      await held.promise;
      if (first === "archive") settling = outcome(settle());
      else archiving = outcome(retire());
      // Prove real contention on the exact two backend sessions, rather than
      // assuming a timed delay reached the intended ordering.
      await until(async () => {
        if (!workerPid || !archivePid) return false;
        const waiting = first === "archive" ? workerPid : archivePid;
        const blocker = first === "archive" ? archivePid : workerPid;
        const [row] = await harness.db.$queryRaw<Array<{ blockers: number[] }>>`
          SELECT pg_blocking_pids(${waiting}::int) AS blockers`;
        return row!.blockers.includes(blocker);
      });
      release.resolve();
      expect(await Promise.all([settling, archiving])).toEqual([{ ok: true }, { ok: true }]);
      expect((await harness.db.bot.findUniqueOrThrow({ where: { id: f.botId } })).status).toBe("archived");
      expect(await harness.db.run.count({
        where: { botId: f.botId, status: { in: ["queued", "running"] } },
      })).toBe(0);
      expect(await harness.db.inboxEvent.count({
        where: { botId: f.botId, status: { in: ["pending", "processing"] } },
      })).toBe(0);
      expect((await f.read()).enabled).toBe(false);
      if (first === "archive")
        expect(await harness.db.run.findUniqueOrThrow({ where: { id: claimed.runId } }))
          .toMatchObject({ status: "cancelled", error: { code: "bot_archived" } });
    } finally {
      release.resolve();
      await Promise.allSettled([settling, archiving]);
      await harness.db.retiredAgent.deleteMany({ where: { id: f.botId } });
      await f.cleanup();
    }
  }, 15_000);
}
