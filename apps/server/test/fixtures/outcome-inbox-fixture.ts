import { createPrismaClient } from "@outcomego/db";
import type { DecisionCreateInput, DecisionOption } from "@outcomego/contracts/outcome-inbox";
import { Effect } from "effect";
export const actor = "owner:local" as const;
export const run = <T>(effect: Effect.Effect<T, Error>) => Effect.runPromise(effect);
export const errorCode = async (effect: Effect.Effect<unknown, Error>) => {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Right") throw new Error("Expected failure");
  return (result.left as { code?: string }).code;
};
export const testDb = () => createPrismaClient(process.env.OUTCOMEGO_TEST_DATABASE_URL!);
export const option = (overrides: Partial<DecisionOption> = {}): DecisionOption => ({ id: "cancel", label: "Cancel branch", consequence: "Close this branch", source: "runtime", resolutionEffect: "cancel_branch", ...overrides });
export async function fixture(db: ReturnType<typeof testDb>) {
  const bot = await db.bot.create({ data: { name: "Inbox fixture", defaultDirectory: "/tmp", conversation: { create: {} } } });
  const channel = await db.channel.create({ data: { kind: "bot_dm", name: "Inbox fixture", members: { create: { botId: bot.id, ordinal: 1 } } } });
  const outcome = await db.outcome.create({ data: { botId: bot.id, title: "Private title never sent", status: "decision_pending" } });
  const revision = await db.outcomeContractRevision.create({ data: {
    outcomeId: outcome.id, revision: 1, status: "approved", goal: ["Compare options"], boundaries: { included: ["public research"], excluded: ["production changes"] },
    executionBotId: bot.id, contentHash: "fixture", createdBy: actor,
    criteria: { create: [{ ordinal: 1, statement: "Cite sources", required: true }, { ordinal: 2, statement: "Compare costs", required: true }] },
  } });
  await db.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: revision.id } });
  const item = await db.outcomeWorkItem.create({ data: { outcomeId: outcome.id, contractRevisionId: revision.id, botId: bot.id, executorType: "agent", title: "Research", ordinal: 1, status: "waiting_decision" } });
  const input: DecisionCreateInput = { outcomeId: outcome.id, contractRevisionId: revision.id, workItemId: item.id, reasonCode: "missing_input", completedSummary: "SECRET research", problemSummary: "SECRET customer details", nextStepSummary: "Choose how to continue", options: [option()] };
  return { bot, channel, outcome, revision, item, input };
}
