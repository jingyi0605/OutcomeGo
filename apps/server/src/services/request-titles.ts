import { messagePreviewText } from "@outcomego/contracts/message-preview";
import { ACTIVITY_TITLE_LIMIT } from "@outcomego/contracts/task-overview";
import type { PrismaClient } from "@outcomego/db";
import { turnPreviewSource } from "@outcomego/messaging";
import { metadataRecord } from "./service-utils";

export interface TitledRequest {
  userMessageId: string;
  channelId: string | null;
}

type ChatMessage = { content: string; metadata: unknown };

/** What the owner sent: their words, or the names of the files when they sent only files. */
function chatText({ content, metadata }: ChatMessage): string {
  if (content.trim()) return content;
  const attachments = metadataRecord(metadata).attachments;
  return Array.isArray(attachments)
    ? attachments.map((attachment) => metadataRecord(attachment).fileName).filter((name) => typeof name === "string").join(", ")
    : "";
}

/**
 * Request titles keyed by user message ID: the start of the owner's own message, one query per source. The stored
 * turn wraps those words for the model, so the chat message is preferred and the turn is only unwrapped without one.
 */
export async function readRequestTitles(db: PrismaClient, requests: readonly TitledRequest[]): Promise<Map<string, string>> {
  if (!requests.length) return new Map();
  const messages = await db.message.findMany({
    where: { id: { in: requests.map((request) => request.userMessageId) } },
    select: { id: true, clientId: true, content: true },
  });
  const byId = new Map(messages.map((message) => [message.id, message]));
  const chatKey = (channelId: string | null, clientId: string | null | undefined) =>
    channelId && clientId ? `${channelId}:${clientId}` : null;
  const sent = requests.flatMap(({ channelId, userMessageId }) => {
    const clientId = byId.get(userMessageId)?.clientId;
    return channelId && clientId ? [{ channelId, clientId }] : [];
  });
  const chats = sent.length ? await db.channelMessage.findMany({
    where: { sender: "user", channelId: { in: sent.map((row) => row.channelId) }, clientId: { in: sent.map((row) => row.clientId) } },
    select: { channelId: true, clientId: true, content: true, metadata: true },
  }) : [];
  const chatByKey = new Map(chats.map((chat) => [chatKey(chat.channelId, chat.clientId), chat]));
  return new Map(requests.flatMap(({ channelId, userMessageId }) => {
    const message = byId.get(userMessageId);
    if (!message) return [];
    const chat = chatByKey.get(chatKey(channelId, message.clientId));
    return [[userMessageId, messagePreviewText(chat ? chatText(chat) : turnPreviewSource(message.content), ACTIVITY_TITLE_LIMIT)] as const];
  }));
}
