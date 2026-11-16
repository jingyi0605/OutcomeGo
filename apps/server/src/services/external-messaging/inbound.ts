import { randomUUID } from "node:crypto";
import { attachmentLimitForName } from "@outcomego/contracts/media-input";
import type { AssetRef } from "@outcomego/contracts";
import { Prisma, type ExternalMessagingBinding, type PrismaClient } from "@outcomego/db";
import {
  type AgentMessaging,
  MAX_MESSAGE_ASSETS,
  nextMessageAddress,
  type AssetStore,
} from "@outcomego/messaging";
import {
  EXTERNAL_DISPLAY_NAME_MAX_CHARS,
  externalMessagePayloadHash,
  normalizeExternalMessage,
  sanitizeExternalLabel,
  type ExternalInboundMedia,
  type ExternalMessage,
  type ExternalMessageRejectionCode,
  type ExternalPollEntry,
} from "@outcomego/plugin-sdk/messaging";
import { cancelSkippedBootstrap } from "../channel/delivery";
import { formatUserPrompt } from "../channel/formatting";
import { dismissMoveOnWidgets } from "../rich-message-service";
import { appendEvent, type ComputerFetch } from "../service-utils";
import { ExternalExchangeError, type ExternalMediaExchange } from "./media-exchange";
import { isUniqueViolation, Rollback } from "./shared";

export type AcceptCode =
  | ExternalMessageRejectionCode
  | "external_sender_not_allowed"
  | "external_peer_type_unsupported"
  | "external_message_conflict"
  | "external_channel_unavailable"
  | "external_retry_exhausted";

/** What happened to one inbound message. Only `retry` leaves the cursor where it is. */
export type AcceptResult =
  | { status: "accepted"; runId: string | null }
  | { status: "duplicate" }
  | { status: "rejected"; code: AcceptCode }
  | { status: "retry"; code: "external_target_unavailable" | "external_accept_failed"; targetUnavailable: boolean };

export interface AcceptContext {
  binding: Pick<ExternalMessagingBinding, "id" | "botId" | "connectionId">;
  /** `messaging.platform` of the connector, e.g. `wechat`. */
  platform: string;
  /** Human-readable platform name for Bot-visible text, e.g. `WeChat`. */
  platformLabel: string;
}

export interface InboundDependencies {
  prisma: PrismaClient;
  messaging: AgentMessaging;
  assets: Pick<AssetStore, "ingestStream">;
  exchange: Pick<ExternalMediaExchange, "openInbound">;
  computerFetch: ComputerFetch;
  /** Cancels the run a new user message supersedes. */
  interruptRun: (runId: string) => Promise<void>;
  now?: () => Date;
}

const TARGET_RUNNABLE = ["active", "provisioning"];
/** A message whose clock is ahead of ours is stamped with ours, so ordering stays sane. */
const clampToNow = (value: Date, now: Date) => (value.getTime() > now.getTime() ? now : value);

/**
 * Turns one external message into a user message in an `external_dm` Channel and a durable Bot
 * wake (specs/009 §2.3.2). Knows nothing about any platform.
 *
 * Exactly-once comes from the Receipt: it is written only in the same transaction that writes the
 * message and the wake, so a crash leaves nothing, a redelivery finds it, and a concurrent
 * redelivery loses on the unique constraint.
 */
export class ExternalInboundMessageService {
  private readonly now: () => Date;

  constructor(private readonly deps: InboundDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async accept(context: AcceptContext, entry: ExternalPollEntry): Promise<AcceptResult> {
    const { prisma } = this.deps;
    const { connectionId } = context.binding;

    // A message that failed validation but can still be acknowledged.
    if ("invalid" in entry) {
      const { invalid } = entry;
      if (invalid.providerMessageId)
        await this.recordRejection(connectionId, invalid.providerMessageId, "", invalid.payloadHash, invalid.code, context.binding.id);
      else await this.countRejection(context.binding.id, invalid.code);
      return { status: "rejected", code: invalid.code };
    }

    const message = normalizeExternalMessage(entry.message);
    const payloadHash = externalMessagePayloadHash(message);
    const reject = async (code: AcceptCode): Promise<AcceptResult> => {
      await this.recordRejection(connectionId, message.providerMessageId, message.peer.id, payloadHash, code, context.binding.id);
      return { status: "rejected", code };
    };

    // Admission: only the account owner, only direct chats. Nothing else is stored.
    if (message.peer.type !== "direct") return reject("external_peer_type_unsupported");
    if (message.sender.isAccountOwner !== true) return reject("external_sender_not_allowed");
    // A message with no words, no files and no failure note has nothing to deliver.
    if (!message.text.trim() && !message.media?.length && !message.mediaFailures?.length) return reject("external_message_invalid");

    const existing = await prisma.externalMessageReceipt.findUnique({
      where: { connectionId_providerMessageId: { connectionId, providerMessageId: message.providerMessageId } },
      select: { payloadHash: true },
    });
    if (existing) return this.duplicateOrConflict(context, existing.payloadHash, payloadHash);

    // The Bot must be able to run before any file is fetched or any record is written.
    const bot = await prisma.bot.findUnique({
      where: { id: context.binding.botId },
      include: { subagentIdentity: { select: { id: true } }, conversation: { select: { id: true } } },
    });
    if (!bot || bot.subagentIdentity || !bot.conversation || !TARGET_RUNNABLE.includes(bot.status))
      return this.targetUnavailable(context.binding.id);

    let media: Awaited<ReturnType<ExternalInboundMessageService["registerMedia"]>>;
    try {
      media = await this.registerMedia(connectionId, message);
    } catch (error) {
      if (error instanceof ExternalExchangeError && error.retryable) return { status: "retry", code: "external_accept_failed", targetUnavailable: false };
      throw error;
    }

    const receiptId = randomUUID();
    const clientId = `external:${receiptId}`;
    let preparedAttachmentPaths: string[] | undefined;
    if (media.refs.length) {
      try {
        // Takes file locks, so it runs before the transaction that locks the Bot.
        preparedAttachmentPaths = await this.deps.messaging.agentData.materializeAttachments(context.binding.botId, clientId, media.refs);
      } catch {
        return { status: "retry", code: "external_accept_failed", targetUnavailable: false };
      }
    }

    let accepted: { runId: string | null; bootstrapRunId: string | null; interruptRunId: string | null };
    try {
      accepted = await this.persist({ context, message, payloadHash, receiptId, clientId, media, preparedAttachmentPaths });
    } catch (error) {
      if (error instanceof Rollback) {
        if (error.reason === "target_unavailable") return this.targetUnavailable(context.binding.id);
        if (error.reason === "channel_unavailable") return reject("external_channel_unavailable");
        if (error.reason === "duplicate" || error.reason === "conflict") {
          // Lost a race with another process handling the same message.
          const winner = await prisma.externalMessageReceipt.findUnique({
            where: { connectionId_providerMessageId: { connectionId, providerMessageId: message.providerMessageId } },
            select: { payloadHash: true },
          });
          return winner ? this.duplicateOrConflict(context, winner.payloadHash, payloadHash) : { status: "retry", code: "external_accept_failed", targetUnavailable: false };
        }
        return { status: "retry", code: "external_accept_failed", targetUnavailable: false };
      }
      if (isUniqueViolation(error)) {
        const winner = await prisma.externalMessageReceipt.findUnique({
          where: { connectionId_providerMessageId: { connectionId, providerMessageId: message.providerMessageId } },
          select: { payloadHash: true },
        });
        if (winner) return this.duplicateOrConflict(context, winner.payloadHash, payloadHash);
      }
      return { status: "retry", code: "external_accept_failed", targetUnavailable: false };
    }

    // Follow-ups after commit: failures here never undo the accepted message.
    void (async () => {
      if (accepted.bootstrapRunId) await cancelSkippedBootstrap(this.deps.computerFetch, prisma, accepted.bootstrapRunId);
      if (accepted.interruptRunId) await this.deps.interruptRun(accepted.interruptRunId);
    })().catch((cause) => console.error("external message follow-up", cause instanceof Error ? cause.message : "failed"));
    return { status: "accepted", runId: accepted.runId };
  }

  private async duplicateOrConflict(context: AcceptContext, storedHash: string, hash: string): Promise<AcceptResult> {
    if (storedHash === hash) return { status: "duplicate" };
    // The first receipt stays as it is. The second message is refused and counted.
    await this.countRejection(context.binding.id, "external_message_conflict");
    return { status: "rejected", code: "external_message_conflict" };
  }

  private async targetUnavailable(bindingId: string): Promise<AcceptResult> {
    await this.deps.prisma.externalMessagingBinding.updateMany({
      where: { id: bindingId },
      data: { status: "needs_attention", lastErrorCode: "external_target_unavailable", lastErrorAt: this.now() },
    });
    return { status: "retry", code: "external_target_unavailable", targetUnavailable: true };
  }

  /**
   * Fetches each file through the exchange and registers it. A bad file costs only itself.
   * A computer that cannot be reached throws a retryable error: the whole message waits.
   */
  private async registerMedia(connectionId: string, message: ExternalMessage) {
    const refs: AssetRef[] = [];
    const failures: Array<{ fileName?: string; code: string }> = [];
    for (const failure of message.mediaFailures ?? []) failures.push({ ...(failure.fileName ? { fileName: failure.fileName } : {}), code: failure.code });
    const wanted = message.media ?? [];
    for (const [index, item] of wanted.entries()) {
      if (index >= MAX_MESSAGE_ASSETS) {
        failures.push({ fileName: item.fileName, code: "external_media_too_many" });
        continue;
      }
      const failure = await this.registerOne(connectionId, item, refs);
      if (failure) failures.push({ fileName: item.fileName, code: failure });
    }
    return { refs, failures };
  }

  private async registerOne(connectionId: string, item: ExternalInboundMedia, refs: AssetRef[]): Promise<string | null> {
    if (item.byteSize > attachmentLimitForName(item.fileName || item.exchangeName)) return "external_media_too_large";
    let opened: Awaited<ReturnType<ExternalMediaExchange["openInbound"]>>;
    try {
      opened = await this.deps.exchange.openInbound(connectionId, item.exchangeName);
    } catch (error) {
      if (error instanceof ExternalExchangeError) {
        if (error.retryable) throw error;
        return error.code === "external_media_too_large" ? "external_media_too_large" : "external_media_missing";
      }
      throw error;
    }
    try {
      const ref = await this.deps.assets.ingestStream({
        fileName: item.fileName || item.exchangeName,
        ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        stream: opened.body,
      });
      // The asset id is the SHA-256 of what was stored: it must be what the connector declared.
      if (ref.assetId !== item.sha256 || ref.byteSize !== item.byteSize) return "external_media_mismatch";
      refs.push(ref);
      return null;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      // The asset store refuses by type or size with a stable code; anything else is unexpected
      // enough to retry the whole message rather than silently dropping the file.
      if (typeof code === "string" && /^asset_|^attachment_/.test(code)) return code === "asset_too_large" ? "external_media_too_large" : code;
      throw new ExternalExchangeError("external_exchange_unavailable", true);
    }
  }

  private async persist(input: {
    context: AcceptContext;
    message: ExternalMessage;
    payloadHash: string;
    receiptId: string;
    clientId: string;
    media: { refs: AssetRef[]; failures: Array<{ fileName?: string; code: string }> };
    preparedAttachmentPaths: string[] | undefined;
  }) {
    const { context, message, payloadHash, receiptId, clientId, media } = input;
    const { prisma, messaging } = this.deps;
    const { connectionId } = context.binding;
    const occurredAt = clampToNow(new Date(message.occurredAt), this.now());
    const displayName = message.peer.displayName ? sanitizeExternalLabel(message.peer.displayName, EXTERNAL_DISPLAY_NAME_MAX_CHARS) : null;

    const notes = media.failures.map((failure) =>
      failure.fileName
        ? `[Attachment ${JSON.stringify(failure.fileName)} could not be received: ${failure.code}]`
        : `[An attachment could not be received: ${failure.code}]`
    );
    const visibleText = message.text.trim() ? message.text : notes.join("\n");
    const botText = [message.text.trim() ? message.text : "", `[Sent from ${context.platformLabel}]`, ...notes].filter(Boolean).join("\n");

    return prisma.$transaction(async (tx) => {
      // One peer at a time: the first messages of a new conversation must not create two Channels.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`external-peer:${connectionId}:${message.peer.id}`}))`;
      try {
        await tx.externalMessageReceipt.create({
          data: { id: receiptId, connectionId, providerMessageId: message.providerMessageId, peerId: message.peer.id, payloadHash, status: "accepted" },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new Rollback("duplicate");
        throw error;
      }

      // The Binding and the Bot may have changed since the checks above.
      const binding = await tx.externalMessagingBinding.findUnique({ where: { id: context.binding.id } });
      if (!binding || !binding.enabled || binding.botId !== context.binding.botId) throw new Rollback("retry");
      const bot = await tx.bot.findUnique({ where: { id: binding.botId }, include: { subagentIdentity: { select: { id: true } } } });
      if (!bot || bot.subagentIdentity || !TARGET_RUNNABLE.includes(bot.status)) throw new Rollback("target_unavailable");

      // The contact's identity only. The conversation is the Bot's own chat: a WeChat message is
      // the owner talking to their Bot, so it joins the same thread and the same context.
      let mapping = await tx.externalChannelMapping.findUnique({
        where: { connectionId_peerId_botId: { connectionId, peerId: message.peer.id, botId: binding.botId } },
      });
      if (!mapping) {
        mapping = await tx.externalChannelMapping.create({
          data: { connectionId, botId: binding.botId, peerId: message.peer.id, platform: context.platform, ...(displayName ? { displayName } : {}) },
        });
      } else if (mapping.channelId) {
        // From the earlier design, where each contact had a Channel of its own: keep it as history.
        await tx.channel.update({ where: { id: mapping.channelId }, data: { archivedAt: new Date() } });
        mapping = await tx.externalChannelMapping.update({ where: { id: mapping.id }, data: { channelId: null } });
      }
      if (mapping.status !== "active") throw new Rollback("channel_unavailable");
      const home = await tx.channel.findFirst({
        where: { kind: "bot_dm", directKey: `bot:${binding.botId}`, archivedAt: null },
        select: { id: true },
      });
      if (!home) throw new Rollback("target_unavailable");
      const homeChannelId = home.id;

      const bootstrapRunId = await messaging.skipBootstrapForUser(tx, binding.botId);
      await dismissMoveOnWidgets(tx, homeChannelId);
      const address = await nextMessageAddress(tx, homeChannelId, "user");
      const visibleMessage = await tx.channelMessage.create({
        data: {
          channelId: homeChannelId,
          clientId,
          sender: "user",
          content: visibleText,
          metadata: {
            type: "text",
            address,
            ...(media.refs.length ? { attachments: media.refs } : {}),
            external: {
              platform: context.platform,
              ...(message.sender.displayName ? { senderName: message.sender.displayName } : {}),
              occurredAt: message.occurredAt,
              ...(media.failures.length ? { mediaFailures: media.failures } : {}),
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });
      // The owner typed this: same priority and interruption as typing in the app.
      const delivery = await messaging.acceptDirectUserMessage(
        tx,
        {
          botId: binding.botId,
          channelId: homeChannelId,
          content: formatUserPrompt(address, botText),
          ...(media.refs.length ? { attachments: media.refs } : {}),
          clientId,
          occurredAt,
        },
        input.preparedAttachmentPaths
      );
      await messaging.scheduleTranscriptProjection(tx, [binding.botId]);
      await tx.channel.update({ where: { id: homeChannelId }, data: { updatedAt: new Date() } });
      const now = this.now();
      await tx.externalChannelMapping.update({
        where: { id: mapping.id },
        data: { lastInboundAt: now, ...(displayName ? { displayName } : {}) },
      });
      await tx.externalMessageReceipt.update({
        where: { id: receiptId },
        data: { mappingId: mapping.id, channelMessageId: visibleMessage.id, runId: delivery.run.id },
      });
      await tx.externalMessagingBinding.update({ where: { id: binding.id }, data: { lastAcceptedAt: now } });
      await appendEvent(tx, "channel.message.accepted", visibleMessage.id, { channelId: homeChannelId, messageId: visibleMessage.id });
      return { runId: delivery.run.id as string | null, bootstrapRunId, interruptRunId: delivery.interruptRunId };
    });
  }

  /**
   * Stores a refusal so the same message is not judged again. The first receipt for a message wins;
   * a second one for the same id is ignored. Never stores the text.
   */
  async recordRejection(
    connectionId: string,
    providerMessageId: string,
    peerId: string,
    payloadHash: string,
    code: AcceptCode,
    bindingId: string
  ): Promise<void> {
    try {
      await this.deps.prisma.externalMessageReceipt.create({
        data: { connectionId, providerMessageId, peerId: peerId.slice(0, 256), payloadHash, status: "rejected", rejectionCode: code },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    await this.countRejection(bindingId, code);
  }

  /** Cumulative per-code counters for diagnostics. */
  async countRejection(bindingId: string, code: string): Promise<void> {
    await this.deps.prisma.$executeRaw`
      UPDATE "outcomego_external_messaging_binding"
      SET "rejectedCounts" = jsonb_set(
        coalesce("rejectedCounts", '{}'::jsonb),
        ARRAY[${code}]::text[],
        to_jsonb(coalesce(("rejectedCounts" ->> ${code})::int, 0) + 1)
      )
      WHERE "id" = ${bindingId}::uuid`;
  }

  /** Gives up on a message that kept failing: records why and lets the cursor move on. */
  async deadLetter(context: AcceptContext, entry: ExternalPollEntry): Promise<void> {
    const connectionId = context.binding.connectionId;
    if ("invalid" in entry) {
      if (entry.invalid.providerMessageId)
        await this.recordRejection(connectionId, entry.invalid.providerMessageId, "", entry.invalid.payloadHash, "external_retry_exhausted", context.binding.id);
      return;
    }
    const message = normalizeExternalMessage(entry.message);
    await this.recordRejection(connectionId, message.providerMessageId, message.peer.id, externalMessagePayloadHash(message), "external_retry_exhausted", context.binding.id);
  }
}
