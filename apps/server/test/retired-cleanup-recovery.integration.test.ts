import { expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import { WakeWorker } from "../../worker/src/worker";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;

test.skipIf(!url)("failed retirement cleanup rotates past an outage backlog without touching a healthy agent", async () => {
  const db = createPrismaClient(url!);
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID()).sort();
  const calls: string[] = [];
  const healthy = await db.bot.create({ data: {
    name: "Healthy cleanup neighbor", defaultDirectory: "/unused", status: "active",
    conversation: { create: {} },
  }, include: { conversation: true } });
  const worker = Object.assign(Object.create(WakeWorker.prototype), {
    prisma: db,
    agentData: {
      deleteAgentFiles: async () => {},
      repairActiveAgentAfterDeletion: async () => null,
    },
    computerFetch: async (path: string) => {
      calls.push(path);
      return path.includes(ids[4]!)
        ? Response.json({ ok: true })
        : new Response("Injected owner cleanup outage", { status: 503 });
    },
  }) as { reconcileRetiredAgents(): Promise<void> };
  try {
    const run = await db.run.create({ data: {
      botId: healthy.id, conversationId: healthy.conversation!.id,
      userMessageId: crypto.randomUUID(), status: "running",
    } });
    await db.retiredAgent.createMany({ data: ids.map(id => ({ id, nextCleanupAt: new Date(0) })) });
    await worker.reconcileRetiredAgents();
    expect(calls).toHaveLength(12);
    expect(calls.some(path => path.includes(ids[4]!))).toBe(false);
    expect(await db.retiredAgent.count({ where: {
      id: { in: ids.slice(0, 4) }, cleanupPending: true, nextCleanupAt: { gt: new Date() },
    } })).toBe(4);
    await worker.reconcileRetiredAgents();
    expect(calls.filter(path => path.includes(ids[4]!))).toHaveLength(3);
    expect(await db.retiredAgent.findUniqueOrThrow({ where: { id: ids[4] } }))
      .toMatchObject({ cleanupPending: false });
    expect(calls.some(path => path.includes(healthy.id))).toBe(false);
    expect(await db.bot.findUniqueOrThrow({ where: { id: healthy.id } }))
      .toMatchObject({ status: "active" });
    expect(await db.run.findUniqueOrThrow({ where: { id: run.id } }))
      .toMatchObject({ status: "running" });
  } finally {
    await db.retiredAgent.deleteMany({ where: { id: { in: ids } } });
    await db.bot.delete({ where: { id: healthy.id } });
    await db.$disconnect();
  }
}, 15_000);
