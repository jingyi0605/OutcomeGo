import {
  OUTCOME_UPDATE_CARD_SOURCE,
  outcomeCardStage,
  type OutcomeChatCard,
} from "@outcomego/contracts/outcome-chat";
import type { Prisma } from "@outcomego/db";

/**
 * Post one goal card into the Bot's direct conversation for a user-facing fact.
 *
 * The card is a `system` message: no Run, delivery, wake or reply is created, so the Bot does not
 * see it unless the user quotes it in the main thread (the quote carries `content`). The card is
 * live in the desktop client, which reads the Outcome itself, so the stored stage is only a fallback.
 * `clientId` derives from the fact key, so replaying a fact never posts a second card.
 */
export async function postOutcomeUpdateCard(
  tx: Prisma.TransactionClient,
  input: { channelId: string; outcomeId: string; factKey: string; contractRevision: number; type: string }
): Promise<boolean> {
  const outcome = await tx.outcome.findUnique({
    where: { id: input.outcomeId },
    select: { title: true, status: true },
  });
  if (!outcome) return false;
  const clientId = `outcome-update:${input.factKey}`;
  const existing = await tx.channelMessage.findUnique({
    where: { channelId_clientId: { channelId: input.channelId, clientId } },
    select: { id: true },
  });
  if (existing) return false;
  const card: OutcomeChatCard = {
    // A blocked task leaves the Outcome running, but the user still needs to look at it.
    stage: input.type === "outcome.blocked" ? "attention" : outcomeCardStage(outcome.status),
    title: outcome.title,
    outcomeId: input.outcomeId,
    revision: input.contractRevision,
    updatedAt: new Date().toISOString(),
  };
  const message = await tx.channelMessage.create({
    data: {
      channelId: input.channelId,
      clientId,
      sender: "system",
      content: `Goal · ${card.title} · ${card.stage}`,
      metadata: {
        type: "outcome-card",
        source: OUTCOME_UPDATE_CARD_SOURCE,
        outcomeCard: card,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.event.create({
    data: {
      topic: "channel.message.created",
      entityId: message.id,
      payload: { channelId: input.channelId, messageId: message.id },
    },
  });
  await tx.channel.update({ where: { id: input.channelId }, data: { updatedAt: new Date() } });
  return true;
}
