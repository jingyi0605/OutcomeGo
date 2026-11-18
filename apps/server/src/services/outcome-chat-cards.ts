import type { PrismaClient } from "@outcomego/db";
import type { AgentMessaging, ToolContext } from "@outcomego/messaging";
import type { OutcomeChatCard } from "@outcomego/contracts/outcome-chat";
import { appendEvent, metadataRecord, toJson } from "./service-utils";

/** Use ordinary delivery checks and one durable message per tool call. No question or approval widget. */
export class OutcomeChatCards {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly messaging: AgentMessaging
  ) {}

  async begin(context: ToolContext, card: OutcomeChatCard): Promise<string | null> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: context.channelId },
      select: { kind: true },
    });
    // Other clients retain the tool's ordinary text response; never post private details to a room.
    if (channel?.kind !== "bot_dm") return null;
    const result = await this.messaging.sendVisible(
      { ...context, callId: `outcome-card:${context.callId}` },
      { type: "text", content: `Goal · ${card.title}`, end_turn: false },
      async (tx, id) => {
        const message = await tx.channelMessage.findUniqueOrThrow({ where: { id } });
        await tx.channelMessage.update({
          where: { id },
          data: {
            metadata: toJson({
              ...metadataRecord(message.metadata),
              type: "outcome-card",
              outcomeCard: card,
            }),
          },
        });
        await appendEvent(tx, "channel.message.created", id, {
          channelId: context.channelId,
          messageId: id,
        });
      }
    );
    const ack = result.acknowledgement;
    return typeof ack === "object" && typeof ack.message_id === "string" ? ack.message_id : null;
  }

  async update(context: ToolContext, id: string, card: OutcomeChatCard): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Serialize retry transitions so a late in-progress update cannot replace a finished card.
      await tx.$queryRaw`
        SELECT "id" FROM "outcomego_channel_message"
        WHERE "id" = ${id}::uuid
        FOR UPDATE
      `;
      const message = await tx.channelMessage.findFirst({
        where: { id, channelId: context.channelId, senderBotId: context.botId },
      });
      if (!message) return;
      const previous = metadataRecord(metadataRecord(message.metadata).outcomeCard);
      if (
        ["analyzing", "generating"].includes(card.stage) &&
        !["analyzing", "generating", "failed"].includes(String(previous.stage))
      )
        return;
      await tx.channelMessage.update({
        where: { id },
        data: {
          content: `Goal · ${card.title} · ${card.stage}`,
          metadata: toJson({ ...metadataRecord(message.metadata), outcomeCard: card }),
        },
      });
      await appendEvent(tx, "channel.message.updated", id, {
        channelId: context.channelId,
        messageId: id,
      });
      await this.messaging.scheduleTranscriptProjection(tx, [context.botId]);
    });
  }
}
