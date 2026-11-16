import type { ExternalMessage, ExternalMediaFailure } from "@outcomego/plugin-sdk/messaging";
import { ITEM_TYPE, type WechatInboundMessage, type WechatItem } from "./protocol";

export type DropReason = "group" | "self" | "empty";

/** A media item that still has to be fetched, in message order. */
export interface PendingMedia {
  item: WechatItem;
  /** Position among the message's media, used for the exchange file name. */
  index: number;
}

export type Normalized =
  | { kind: "drop"; reason: DropReason }
  | {
      kind: "message";
      /** Everything except the files, which the caller adds once they are in the exchange directory. */
      message: ExternalMessage;
      media: PendingMedia[];
    };

const MEDIA_TYPES: readonly number[] = [ITEM_TYPE.image, ITEM_TYPE.file, ITEM_TYPE.video];

const itemName = (type: number): string => {
  for (const [name, value] of Object.entries(ITEM_TYPE)) if (value === type) return name;
  return "unknown";
};

/**
 * Turns an iLink message into the Server's `ExternalMessage` (design §3.2.5). Group messages and the
 * bot's own are dropped; only the account owner is marked as such. `receivedAt` stands in for a missing
 * send time, and must be the stable time from the recovery journal so a replay hashes the same.
 */
export function normalizeInbound(
  message: WechatInboundMessage,
  account: { ilinkBotId: string; ilinkUserId: string },
  receivedAt: Date
): Normalized {
  if (message.groupId) return { kind: "drop", reason: "group" };
  if (message.fromUserId === account.ilinkBotId) return { kind: "drop", reason: "self" };

  const texts: string[] = [];
  const failures: ExternalMediaFailure[] = [];
  const media: PendingMedia[] = [];
  for (const item of message.items) {
    if (item.type === ITEM_TYPE.text && item.text) texts.push(item.text);
    else if (item.type === ITEM_TYPE.voice) {
      // A voice note is useful only as its transcript.
      if (item.voiceText) texts.push(item.voiceText);
      else failures.push({ code: "wechat_voice_untranscribed" });
    } else if (MEDIA_TYPES.includes(item.type)) media.push({ item, index: media.length });
  }
  const text = texts.join("\n");
  if (!text.trim() && media.length === 0 && failures.length === 0) return { kind: "drop", reason: "empty" };

  const itemTypes = [...new Set(message.items.map((item) => itemName(item.type)))].join(",");
  const sent = message.createTimeMs !== null ? new Date(message.createTimeMs) : receivedAt;
  return {
    kind: "message",
    media,
    message: {
      providerMessageId: message.messageId,
      peer: { id: message.fromUserId, type: "direct" },
      sender: { id: message.fromUserId, isAccountOwner: message.fromUserId === account.ilinkUserId },
      text,
      occurredAt: (Number.isNaN(sent.getTime()) ? receivedAt : sent).toISOString(),
      ...(failures.length ? { mediaFailures: failures } : {}),
      ...(itemTypes ? { providerMetadata: { itemTypes } } : {}),
    },
  };
}
