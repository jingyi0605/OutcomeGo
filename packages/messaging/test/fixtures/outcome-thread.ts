import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrismaClient } from "@outcomego/db";
import { AgentDataStore, AgentMessaging } from "../../src";

export async function outcomeThreadFixture() {
  const db = createPrismaClient(process.env.OUTCOMEGO_TEST_DATABASE_URL!);
  const root = await mkdtemp(join(tmpdir(), "outcome-thread-"));
  const store = new AgentDataStore(db, { root: join(root, "agent-data"), workspaceRoot: root });
  const messaging = new AgentMessaging(db, {
    send: async () => "job",
    sendDebounced: async () => "projection-job",
  } as never, store);
  const bot = await db.bot.create({ data: { name: "Outcome runtime fixture", defaultDirectory: root, status: "active", conversation: { create: {} } }, include: { conversation: true } });
  const channel = await db.channel.create({ data: { kind: "bot_dm", name: "Fixture", directKey: `bot:${bot.id}`, members: { create: { botId: bot.id, ordinal: 0 } } } });
  const outcome = await db.outcome.create({ data: { botId: bot.id, title: "Compare backup approaches" } });
  const revision = await db.outcomeContractRevision.create({ data: {
    outcomeId: outcome.id, revision: 1, status: "approved", approvedAt: new Date(), approvedBy: "owner:local",
    goal: ["Compare two approaches"], boundaries: { excluded: ["Production changes"] }, executionBotId: bot.id,
    contentHash: "fixture", createdBy: "owner:local", criteria: { create: { ordinal: 1, statement: "Cite sources", required: true, verificationMethod: "human_review" } },
  } });
  await db.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: revision.id, status: "approved" } });
  const item = async (ordinal = 1) => db.outcomeWorkItem.create({ data: {
    outcomeId: outcome.id, contractRevisionId: revision.id, botId: bot.id, executorType: "agent", title: `Work ${ordinal}`,
    instructions: "Compare and cite sources", status: "queued", ordinal,
  } });
  return { db, root, store, messaging, bot, channel, outcome, revision, item,
    runtime: { messaging, workspaceRoot: root },
    async cleanup() {
      const items = await db.outcomeWorkItem.findMany({ where: { outcomeId: outcome.id }, select: { id: true } });
      const runs = await db.run.findMany({ where: { botId: bot.id }, select: { id: true } });
      await db.idempotencyRecord.deleteMany({ where: { OR: [
        { scope: { in: items.flatMap(item => [`outcome-turn:${item.id}`, `outcome-work-item:${item.id}`]) } },
        { scope: { endsWith: outcome.id } },
      ] } });
      await db.event.deleteMany({ where: { entityId: { in: [outcome.id, ...runs.map(run => run.id)] } } });
      await db.bot.delete({ where: { id: bot.id } });
      await db.channel.delete({ where: { id: channel.id } });
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
    },
  };
}
