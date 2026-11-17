import { describe, expect, test } from "bun:test";
import { enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { WakeWorker } from "../src/worker";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
type Fixture = Awaited<ReturnType<typeof outcomeThreadFixture>>;
function worker(h: Fixture) {
  return Object.assign(Object.create(WakeWorker.prototype), {
    prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root,
  }) as WakeWorker & { claim(id: string): Promise<{ runId: string; ownerId: string } | null> };
}
async function enqueue(h: Fixture, ordinal: number) {
  const item = await h.item(ordinal);
  const result = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
    workItemId: item.id, content: "Compare without main-chat messages", reason: "start", clientId: `start:${item.id}`,
  }));
  if (result.status !== "enqueued") throw new Error("Fixture did not enqueue");
  return { item, runId: result.runId };
}

describe.skipIf(!url)("Outcome recovery ownership and mailbox fairness", () => {
  test("a cancelled queued head is retired and the same claim reaches valid later work", async () => {
    const h = await outcomeThreadFixture();
    try {
      const first = await enqueue(h, 1);
      const second = await enqueue(h, 2);
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: first.item.id, to: "cancelled", reason: "contract_revision_superseded", actor: "system:fixture" }));
      await h.db.inboxEvent.updateMany({ where: { runId: first.runId }, data: { priority: 999 } });
      const instance = worker(h);
      const claimed = await (instance as unknown as { claim(id: string): Promise<{ runId: string } | null> }).claim(h.bot.id);
      expect(claimed?.runId).toBe(second.runId);
      expect((await h.db.run.findUniqueOrThrow({ where: { id: first.runId } })).status).toBe("cancelled");
      expect((await h.db.inboxEvent.findFirstOrThrow({ where: { runId: first.runId } })).status).toBe("completed");
      expect(await h.db.botRunLease.count({ where: { runId: first.runId } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  test("two worker claims produce one valid owner for one Outcome thread", async () => {
    const h = await outcomeThreadFixture();
    try {
      const queued = await enqueue(h, 1);
      const first = worker(h) as unknown as { claim(id: string): Promise<{ runId: string } | null> };
      const second = worker(h) as unknown as { claim(id: string): Promise<{ runId: string } | null> };
      const claims = await Promise.all([first.claim(h.bot.id), second.claim(h.bot.id)]);
      expect(claims.filter(Boolean).map(claim => claim!.runId)).toEqual([queued.runId]);
      expect(await h.db.botRunLease.count({ where: { runId: queued.runId } })).toBe(1);
    } finally { await h.cleanup(); }
  });

  test("expired Outcome ownership cannot renew itself or be redispatched as the same Run", async () => {
    const h = await outcomeThreadFixture();
    try {
      const queued = await enqueue(h, 1);
      const instance = worker(h) as unknown as {
        claim(id: string): Promise<{ runId: string; ownerId: string; botId: string; origin: string } | null>;
        heartbeat(input: unknown): Promise<void>; computerFetch(path: string, init: RequestInit): Promise<Response>;
      };
      const claimed = await instance.claim(h.bot.id);
      expect(claimed?.runId).toBe(queued.runId);
      const expiredAt = new Date(Date.now() - 1000);
      await h.db.botRunLease.updateMany({ where: { runId: queued.runId }, data: { expiresAt: expiredAt } });
      const stops: string[] = [];
      instance.computerFetch = async path => { stops.push(path); return new Response("{}"); };
      await instance.heartbeat(claimed!);
      expect((await h.db.botRunLease.findUniqueOrThrow({ where: { runId: queued.runId } })).expiresAt).toEqual(expiredAt);
      expect(stops).toHaveLength(1);
      expect(await instance.claim(h.bot.id)).toBeNull();
      expect((await h.db.run.findUniqueOrThrow({ where: { id: queued.runId } })).status).toBe("running");
    } finally { await h.cleanup(); }
  });

  test("closing Outcome dispatch preserves pending intents, foreground claims and business history", async () => {
    const h = await outcomeThreadFixture();
    const original = process.env.OUTCOMEGO_OUTCOMES_ENABLED;
    try {
      process.env.OUTCOMEGO_OUTCOMES_ENABLED = "false";
      const item = await h.item();
      const result = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Wait durably", reason: "start", clientId: "closed:start" }));
      expect(result).toEqual({ status: "queued_for_capacity" });
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(0);
      expect(await h.db.idempotencyRecord.count({ where: { scope: `outcome-turn:${item.id}`, status: "processing" } })).toBe(1);
      const main = await h.db.$transaction(tx => h.messaging.acceptDirectUserMessage(tx, { botId: h.bot.id, channelId: h.channel.id, content: "Continue chatting", clientId: "closed:main" }));
      const claimed = await (worker(h) as unknown as { claim(id: string): Promise<{ runId: string } | null> }).claim(h.bot.id);
      expect(claimed?.runId).toBe(main.run.id);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("queued");
    } finally {
      if (original === undefined) delete process.env.OUTCOMEGO_OUTCOMES_ENABLED; else process.env.OUTCOMEGO_OUTCOMES_ENABLED = original;
      await h.cleanup();
    }
  });
});
