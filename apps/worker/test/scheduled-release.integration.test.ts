import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueOutcomeTurn } from "@outcomego/messaging";
import { WakeWorker } from "../src/worker";

// Specs/004.10 task 2.3: the worker releases bot tasks whose scheduled time has arrived, and a failure in that step
// is logged without stopping the rest of the routine pass. Needs a disposable PostgreSQL database.
const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;

type Internals = {
  boss: { send: (...args: unknown[]) => Promise<unknown> };
  releaseDueScheduledWork(): Promise<void>;
};

async function seed(worker: WakeWorker, root: string) {
  const db = worker.prisma;
  const botId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  const bot = await db.bot.create({
    data: { id: botId, name: "Scheduled release", defaultDirectory: root, status: "active", onboardingStatus: "completed", conversation: { create: {} } },
    include: { conversation: true },
  });
  await db.channel.create({ data: { id: channelId, kind: "bot_dm", name: "Scheduled release", directKey: `bot:${botId}`, members: { create: { botId, ordinal: 0 } } } });
  const outcome = await db.outcome.create({ data: { botId, title: "Scheduled work" } });
  const revision = await db.outcomeContractRevision.create({
    data: {
      outcomeId: outcome.id, revision: 1, status: "approved", approvedAt: new Date(), approvedBy: "owner:local",
      goal: ["Do the work"], boundaries: { excluded: [] }, executionBotId: botId, contentHash: "fixture", createdBy: "owner:local",
      criteria: { create: { ordinal: 1, statement: "Done", required: true, verificationMethod: "human_review" } },
    },
  });
  await db.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: revision.id, status: "approved" } });
  const item = await db.outcomeWorkItem.create({
    data: {
      outcomeId: outcome.id, contractRevisionId: revision.id, botId, executorType: "agent", title: "Due task",
      instructions: "Do it", status: "queued", ordinal: 1, scheduledAt: new Date(Date.now() + 3_600_000),
    },
  });
  // The start intent a plan approval leaves behind: written by the real enqueue path while the task is not yet
  // due (so it is held), exactly as in production. Then the due time arrives.
  const held = await db.$transaction((tx) =>
    enqueueOutcomeTurn(tx, worker.messaging, { workItemId: item.id, content: "Do it", reason: "start", clientId: `start:${item.id}` })
  );
  expect(held).toEqual({ status: "queued_for_capacity" });
  await db.outcomeWorkItem.update({ where: { id: item.id }, data: { scheduledAt: new Date(Date.now() - 60_000) } });
  const cleanup = async () => {
    await db.idempotencyRecord.deleteMany({ where: { scope: `outcome-turn:${item.id}` } });
    await db.event.deleteMany({ where: { entityId: { in: [outcome.id, ...(await db.run.findMany({ where: { botId }, select: { id: true } })).map((run) => run.id)] } } });
    await db.bot.delete({ where: { id: bot.id } });
    await db.channel.delete({ where: { id: channelId } });
  };
  return { botId, item, cleanup };
}

async function withWorker(run: (worker: WakeWorker, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "scheduled-release-"));
  const keys = ["DATABASE_URL", "OUTCOMEGO_WORKSPACE_ROOT", "OUTCOMEGO_AGENT_DATA_ROOT"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { DATABASE_URL: databaseUrl, OUTCOMEGO_WORKSPACE_ROOT: root, OUTCOMEGO_AGENT_DATA_ROOT: join(root, "data") });
  const worker = new WakeWorker();
  (worker as unknown as Internals).boss.send = async () => "job";
  (worker.messaging as unknown as { boss: unknown }).boss = { send: async () => "job", sendDebounced: async () => "job" };
  try {
    await run(worker, root);
  } finally {
    await worker.prisma.$disconnect();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(root, { recursive: true, force: true });
  }
}

test.skipIf(!databaseUrl)("the worker starts a task whose scheduled time has arrived", async () => {
  await withWorker(async (worker, root) => {
    const seeded = await seed(worker, root);
    try {
      await (worker as unknown as Internals).releaseDueScheduledWork();
      expect(await worker.prisma.run.count({ where: { botId: seeded.botId, origin: "outcome" } })).toBe(1);
      expect((await worker.prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: seeded.item.id } })).rootRunId).not.toBeNull();
    } finally {
      await seeded.cleanup();
    }
  });
});

test.skipIf(!databaseUrl)("a failing release is logged and does not throw, so the rest of the pass still runs", async () => {
  await withWorker(async (worker, root) => {
    const seeded = await seed(worker, root);
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      (worker.messaging as unknown as { enqueueWake: () => Promise<never> }).enqueueWake = async () => {
        throw new Error("simulated outage");
      };
      await expect((worker as unknown as Internals).releaseDueScheduledWork()).resolves.toBeUndefined();
      expect(error.mock.calls.some((call) => String(call[0]).includes("scheduled-work-release"))).toBe(true);
      // Nothing was started, and the intent is still pending for the next pass.
      expect(await worker.prisma.run.count({ where: { botId: seeded.botId } })).toBe(0);
      expect(await worker.prisma.idempotencyRecord.count({ where: { scope: `outcome-turn:${seeded.item.id}`, status: "processing" } })).toBe(1);
    } finally {
      error.mockRestore();
      await seeded.cleanup();
    }
  });
});
