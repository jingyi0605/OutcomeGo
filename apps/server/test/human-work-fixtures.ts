import type { PrismaClient } from "@outcomego/db";
import type { HumanWorkService } from "../src/services/human-work-service";

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
