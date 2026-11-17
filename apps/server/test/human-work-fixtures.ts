import type { PrismaClient } from "@outcomego/db";
import type { HumanWorkService } from "../src/services/human-work-service";
import { AgentDataStore, AgentMessaging, AssetStore } from "@outcomego/messaging";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

/** All data is synthetic and isolated by a newly created Bot. */
export async function humanWorkScenario(prisma: PrismaClient, service: HumanWorkService) {
  const bot = await prisma.bot.create({
    data: { name: "Synthetic human-work test", defaultDirectory: "/tmp", conversation: { create: {} } },
  });
  const outcome = await prisma.outcome.create({ data: { botId: bot.id, title: "Synthetic site check", status: "approved" } });
  const revision = await prisma.outcomeContractRevision.create({
    data: {
      outcomeId: outcome.id, revision: 1, status: "approved", goal: ["Check fixture network"],
      boundaries: { included: ["Synthetic lab"], excluded: ["Production"] }, executionBotId: bot.id,
      contentHash: "fixture", createdBy: "owner:local", approvedBy: "owner:local", approvedAt: new Date(),
      criteria: { create: { ordinal: 1, statement: "Provide observed network log", required: true } },
    },
  });
  await prisma.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: revision.id } });
  const agent = await prisma.outcomeWorkItem.create({ data: {
    outcomeId: outcome.id, contractRevisionId: revision.id, botId: bot.id,
    executorType: "agent", title: "Prepare site instructions", status: "running", ordinal: 1,
  } });
  const cardInput = {
    outcomeId: outcome.id, expectedContractRevision: 1,
    card: { title: "Perform site check", purpose: "Collect real observations", steps: ["Human checks the fixture network"],
      evidenceRequirements: [{ criterionOrdinal: 1, label: "Network log", kind: "text" as const }] },
    references: [], requestedByWorkItemId: agent.id,
  };
  const card = await prisma.$transaction((tx) => service.createCard(tx, cardInput, "owner:local"));
  return { bot, outcome, revision, agent, card, cardInput };
}

/** Real mailbox enqueue with synthetic filesystem/database state; never starts a worker or server. */
export async function humanActionScenario(prisma: PrismaClient, service: HumanWorkService) {
  const fixture = await humanWorkScenario(prisma, service);
  const bot = await prisma.bot.update({ where: { id: fixture.bot.id }, data: { status: "active" } });
  await prisma.outcomeWorkItem.delete({ where: { id: fixture.card.workItemId } });
  const root = await mkdtemp(join(import.meta.dir, ".human-action-test-"));
  const store = new AgentDataStore(prisma, { root: join(root, "agent-data"), workspaceRoot: root });
  const assets = new AssetStore({ root: join(root, "assets") });
  const messaging = new AgentMessaging(prisma, { send: async () => "synthetic-job" } as never, store, assets);
  const channel = await prisma.channel.create({ data: {
    name: "Synthetic action DM", kind: "bot_dm", members: { create: { botId: fixture.bot.id, ordinal: 0 } },
  } });
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { botId: fixture.bot.id } });
  const message = await prisma.message.create({ data: {
    botId: fixture.bot.id, conversationId: conversation.id, role: "user", content: "Synthetic root action", status: "completed",
  } });
  const run = await prisma.run.create({ data: {
    botId: fixture.bot.id, conversationId: conversation.id, userMessageId: message.id, origin: "outcome",
    outcomeWorkItemId: fixture.agent.id, status: "running", channelId: channel.id, startedAt: new Date(),
  } });
  await prisma.outcomeWorkItem.update({ where: { id: fixture.agent.id }, data: { rootRunId: run.id, startedAt: run.startedAt } });
  return { ...fixture, bot, root, store, assets, messaging, channel, run,
    async cleanup() {
      await prisma.bot.delete({ where: { id: fixture.bot.id } });
      await prisma.channel.delete({ where: { id: channel.id } });
      await rm(root, { recursive: true, force: true });
    },
  };
}
