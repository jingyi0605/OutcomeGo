import { createPrismaClient } from "@outcomego/db";
import { Effect } from "effect";
import { OutcomeService } from "../../src/services/outcome-service";

export const requestId = () => `test:${crypto.randomUUID()}`;
export const testDatabaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;
export const fixtureSnapshot = {
  goal: { options: [{ id: "goal-1", text: "Compare backup plans" }], selectedOptionIds: [], customEntries: [] },
  acceptance: { options: [{ id: "acceptance-1", text: "Compare costs", required: true }, { id: "acceptance-2", text: "Add appendix", required: false }], selectedOptionIds: [], customEntries: [] },
  boundaries: { options: [{ id: "boundaries-1", text: "Public sources", kind: "included" }], selectedOptionIds: [], customEntries: [] },
};
export const fixtureSelections = { goal: { selectedOptionIds: ["goal-1"], customEntries: [] }, acceptance: { selectedOptionIds: ["acceptance-1", "acceptance-2"], customEntries: [] }, boundaries: { selectedOptionIds: ["boundaries-1"], customEntries: [] } };
export function outcomeFixture() {
  const prisma = createPrismaClient(testDatabaseUrl!);
  const outcomes = new OutcomeService(prisma);
  const bots: string[] = [];
  return { prisma, outcomes,
    async bot() {
      const bot = await prisma.bot.create({ data: { name: `Product test ${requestId()}`, defaultDirectory: "/tmp", conversation: { create: {} } } });
      bots.push(bot.id); return bot;
    },
    async create(approved = true) {
      const bot = await this.bot();
      const plan = await prisma.outcomePlanningDraft.create({ data: { botId: bot.id, sourceText: "Compare backups", snapshot: fixtureSnapshot, expiresAt: new Date(Date.now() + 60_000) } });
      let outcome = await Effect.runPromise(outcomes.createFromDraft({ planId: plan.id, ...fixtureSelections, title: "Backup comparison", clientRequestId: requestId() }, "owner:local"));
      if (approved) outcome = await Effect.runPromise(outcomes.approve(outcome.id, 1, { expectedRevision: 1, confirmationText: "I confirm", clientRequestId: requestId() }, "owner:local"));
      return { bot, plan, outcome };
    },
    async completed() {
      const result = await this.create();
      const revision = result.outcome.currentRevisionView!;
      const item = await prisma.outcomeWorkItem.create({ data: { outcomeId: result.outcome.id, contractRevisionId: revision.id, botId: result.bot.id, executorType: "agent", status: "completed", ordinal: 1, title: "Comparison", completedAt: new Date() } });
      const output = await prisma.outcomeOutput.create({ data: { outcomeId: result.outcome.id, workItemId: item.id, kind: "final_result", title: "Comparison report", content: "Plan A costs less; Plan B restores faster.", dedupeKey: `final:${item.id}` } });
      await prisma.$transaction(tx => outcomes.recomputeStatus(tx, result.outcome.id, "system:test"));
      return { ...result, revision, item, output, required: revision.criteria.find(c => c.required)!, optional: revision.criteria.find(c => !c.required)! };
    },
    async close() { await prisma.bot.deleteMany({ where: { id: { in: bots } } }); await prisma.$disconnect(); },
  };
}
export async function failureCode(effect: Effect.Effect<unknown, Error>) {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Right") throw new Error("Expected operation failure");
  return (result.left as Error & { code?: string }).code;
}
