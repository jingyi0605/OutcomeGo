import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrismaClient } from "../src";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("004.4 additive human card/receipt schema", () => {
  const prisma = createPrismaClient(url!);
  const bots: string[] = [];
  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.$disconnect();
  });
  test("card is one-to-one, receipt sequences unique, FK relations persist and cascade", async () => {
    const bot = await prisma.bot.create({ data: { name: "Schema-only fixture", defaultDirectory: "/tmp", conversation: { create: {} } } });
    bots.push(bot.id);
    const outcome = await prisma.outcome.create({ data: { botId: bot.id, title: "Synthetic schema test" } });
    const revision = await prisma.outcomeContractRevision.create({ data: {
      outcomeId: outcome.id, revision: 1, goal: [], boundaries: {}, executionBotId: bot.id, contentHash: "fixture", createdBy: "owner:local",
    } });
    const item = await prisma.outcomeWorkItem.create({ data: {
      outcomeId: outcome.id, contractRevisionId: revision.id, botId: bot.id, executorType: "human",
      kind: "human_action", title: "Human fixture", status: "pending", ordinal: 1,
    } });
    const data = { workItemId: item.id, purpose: "Verify schema", steps: [], evidenceRequirements: [] };
    await prisma.outcomeHumanActionCard.create({ data });
    await expect(Promise.resolve(prisma.outcomeHumanActionCard.create({ data }))).rejects.toMatchObject({ code: "P2002" });
    const receipt = { workItemId: item.id, outcomeId: outcome.id, sequence: 1, submittedBy: "owner:local", payload: { comment: "Synthetic" } };
    await prisma.outcomeHumanReceipt.create({ data: receipt });
    await expect(Promise.resolve(prisma.outcomeHumanReceipt.create({ data: receipt }))).rejects.toMatchObject({ code: "P2002" });
    await prisma.outcomeHumanReceipt.create({ data: { ...receipt, sequence: 2 } });
    expect((await prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id }, include: { humanReceipts: true, humanActionCard: true } })).humanReceipts).toHaveLength(2);
    await expect(Promise.resolve(prisma.outcomeHumanActionCard.create({ data: { ...data, workItemId: crypto.randomUUID() } }))).rejects.toMatchObject({ code: "P2003" });
    await prisma.outcome.delete({ where: { id: outcome.id } });
    expect(await prisma.outcomeHumanActionCard.count({ where: { workItemId: item.id } })).toBe(0);
    expect(await prisma.outcomeHumanReceipt.count({ where: { workItemId: item.id } })).toBe(0);
  });
});
