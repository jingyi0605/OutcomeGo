import { randomUUID } from "node:crypto";
import { ApiError, type AgentSendToUserInput, type AssetRef } from "@outcomego/contracts";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { nextMessageAddress, type AgentMessaging, type AssetStore, type ToolContext } from "@outcomego/messaging";
import {
  EXTERNAL_DELIVER_TIMEOUT_MS,
  EXTERNAL_ERROR_MESSAGE_MAX_CHARS,
  ExternalProtocolError,
  parseExternalDeliverResult,
  sanitizeExternalLabel,
  type ExternalDeliverInput,
  type ExternalDeliverResult,
  type ExternalOutboundMedia,
} from "@outcomego/plugin-sdk/messaging";
import { appendEvent } from "../service-utils";
import type { CallHostTool } from "./poller";
import type { ExternalMediaExchange } from "./media-exchange";
import { DB_NOW, messagingOf, shortCode, toolResultValue, ToolResultError } from "./shared";

export type DeliveryStatus = "pending" | "sending" | "sent" | "failed" | "uncertain";

/** The tool-result view of one delivery. Never carries a path, token or provider body. */
export interface DeliveryOutcome {
  id: string;
  platform: string;
  status: DeliveryStatus;
  reason?: string;
  messageId: string;
  /** Set when a replayed call finds the first attempt still running. */
  inProgress?: boolean;
}

export const LEASE_SECONDS = 120;
export const RENEW_INTERVAL_MS = 10_000;
export const RECOVERY_INTERVAL_MS = 30_000;

export interface DeliveryDependencies {
  prisma: PrismaClient;
  messaging: Pick<AgentMessaging, "sendVisible">;
  assets: Pick<AssetStore, "contentPath">;
  exchange: Pick<ExternalMediaExchange, "stageOutbound" | "cleanupOutbound">;
  callHostTool: CallHostTool;
  instanceId?: string;
  /** Shortened in tests. */
  timing?: { renewMs?: number; deliverTimeoutMs?: number };
}

type Row = Prisma.ExternalOutboundDeliveryGetPayload<{
  include: { mapping: true; connection: { include: { installation: true } }; channelMessage: true };
}>;

const KIND_OF_ASSET: Record<string, "image" | "video" | "audio" | "file"> = {
  image: "image",
  video: "video",
  audio: "audio",
  pdf: "file",
  text: "file",
  file: "file",
};

const errorMessageFor = (code: string): string => `Not delivered: ${code}`;

/**
 * The only writer of delivery state (specs/009 §2.3.6). The rule that shapes everything: an
 * outgoing message is never sent twice. A delivery that cannot be proven unsent is `uncertain`,
 * and nothing in this class retries one.
 */
export class ExternalDeliveryService {
  private readonly instance: string;
  private readonly renewMs: number;
  private readonly deliverTimeoutMs: number;
  private recoveryTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: DeliveryDependencies) {
    this.instance = deps.instanceId ?? "server";
    this.renewMs = deps.timing?.renewMs ?? RENEW_INTERVAL_MS;
    this.deliverTimeoutMs = deps.timing?.deliverTimeoutMs ?? EXTERNAL_DELIVER_TIMEOUT_MS;
  }

  private load(where: { id: string } | { callId: string }): Promise<Row | null> {
    return this.deps.prisma.externalOutboundDelivery.findUnique({
      where,
      include: { mapping: true, connection: { include: { installation: true } }, channelMessage: true },
    });
  }

  private outcome(row: { id: string; status: string; errorCode: string | null; channelMessageId: string }, platform: string, replay = false): DeliveryOutcome {
    const status = row.status as DeliveryStatus;
    return {
      id: row.id,
      platform,
      status,
      ...(row.errorCode ? { reason: row.errorCode } : {}),
      messageId: row.channelMessageId,
      ...(replay && (status === "pending" || status === "sending") ? { inProgress: true } : {}),
    };
  }

  /**
   * Writes the Bot's message into its own chat and sends it to the contact. The message and the pending
   * delivery are one transaction. A replay of the same tool call returns what was recorded.
   */
  async send(input: { context: ToolContext; input: AgentSendToUserInput; mappingId: string }): Promise<DeliveryOutcome> {
    if (input.input.type !== "text" && input.input.type !== "attachment")
      throw new ApiError(400, "external_channel_type_unsupported", "Only text and attachments can be sent to an external chat.");
    const callId = `external-delivery:${input.context.callId}`;
    const mapping = await this.deps.prisma.externalChannelMapping.findUnique({ where: { id: input.mappingId } });
    const prior = await this.load({ callId });
    if (prior) return this.outcome(prior, prior.mapping?.platform ?? mapping?.platform ?? "", true);
    if (!mapping || mapping.status !== "active")
      throw new ApiError(409, "external_channel_unavailable", "This external conversation is no longer available");
    // The Bot's message is recorded in its own chat, where the owner reads everything.
    const home = await this.deps.prisma.channel.findFirst({
      where: { kind: "bot_dm", directKey: `bot:${mapping.botId}`, archivedAt: null },
      select: { id: true },
    });
    if (!home) throw new ApiError(409, "external_channel_unavailable", "This Bot has no chat to record the message in");

    const leaseOwner = `${this.instance}:${randomUUID()}`;
    let created = false;
    // Sent from another conversation (an explicit address): that conversation's reply context means
    // nothing in this one.
    const foreign = input.context.channelId !== home.id;
    const context = foreign ? { ...input.context, channelId: home.id, replyToMessageId: null, isFork: false } : input.context;
    const visible = foreign ? { ...input.input, reply_to: undefined } : input.input;
    try {
      await this.deps.messaging.sendVisible(context, visible, async (tx, messageId) => {
        await this.createPending(tx, { callId, mapping, context: input.context, messageId, leaseOwner });
        created = true;
      });
    } catch (error) {
      // A concurrent replay of the same call may have won the unique constraint.
      const winner = await this.load({ callId });
      if (winner) return this.outcome(winner, mapping.platform, true);
      throw error;
    }
    const row = await this.load({ callId });
    if (!row) throw new Error("The delivery record was not created");
    if (!created) return this.outcome(row, mapping.platform, true);
    return this.dispatch(row.id, leaseOwner);
  }

  /**
   * Sends a short notice the service itself writes (the daily reminder), not something a Bot said.
   * It is recorded in the Bot's own chat like any delivery, so its outcome is visible, and `key`
   * makes it idempotent: the same key is never sent twice.
   */
  async sendNotice(input: { mappingId: string; text: string; key: string }): Promise<DeliveryOutcome> {
    const callId = `external-delivery:${input.key}`;
    const prior = await this.load({ callId });
    if (prior) return this.outcome(prior, prior.mapping?.platform ?? "", true);
    const mapping = await this.deps.prisma.externalChannelMapping.findUnique({ where: { id: input.mappingId } });
    if (!mapping || mapping.status !== "active")
      throw new ApiError(409, "external_channel_unavailable", "This external conversation is no longer available");
    const home = await this.deps.prisma.channel.findFirst({
      where: { kind: "bot_dm", directKey: `bot:${mapping.botId}`, archivedAt: null },
      select: { id: true },
    });
    if (!home) throw new ApiError(409, "external_channel_unavailable", "This Bot has no chat to record the message in");

    const leaseOwner = `${this.instance}:${randomUUID()}`;
    try {
      await this.deps.prisma.$transaction(async (tx) => {
        const address = await nextMessageAddress(tx, home.id, "agent");
        const message = await tx.channelMessage.create({
          data: {
            channelId: home.id,
            sender: "agent",
            senderBotId: mapping.botId,
            clientId: `notice:${input.key}`,
            content: input.text,
            metadata: { type: "text", address, externalNotice: "reminder" } as Prisma.InputJsonValue,
          },
        });
        await this.createPending(tx, { callId, mapping, context: { botId: mapping.botId, runId: null }, messageId: message.id, leaseOwner });
        await appendEvent(tx, "channel.message.accepted", message.id, { channelId: home.id, messageId: message.id });
      });
    } catch (error) {
      const winner = await this.load({ callId });
      if (winner) return this.outcome(winner, mapping.platform, true);
      throw error;
    }
    const row = await this.load({ callId });
    if (!row) throw new Error("The delivery record was not created");
    return this.dispatch(row.id, leaseOwner);
  }

  /**
   * Resolves where a Bot may send on its own initiative: `<platform>:<peerId>`, or just `<platform>`
   * for the contact the Bot is already talking to. `null` means no messaging connector uses that
   * platform (the older connector path may still apply). Only a connection that is ready, bound to
   * this Bot and switched on can be used, and only a person who has written first.
   */
  async resolveAddress(botId: string, address: string): Promise<{ mappingId: string } | null> {
    const split = address.indexOf(":");
    if (split === 0 || (split > 0 && split === address.length - 1)) return null;
    const platform = (split < 0 ? address : address.slice(0, split)).trim().toLowerCase();
    const peerId = split < 0 ? null : address.slice(split + 1);
    if (!platform) return null;
    const connections = await this.deps.prisma.pluginConnection.findMany({
      where: { status: "ready", installation: { status: "installed" } },
      include: { installation: true },
    });
    const matching = connections.filter((connection) => messagingOf(connection)?.platform === platform);
    if (matching.length === 0) return null;
    const bound = await this.deps.prisma.externalMessagingBinding.findMany({
      where: { botId, enabled: true, connectionId: { in: matching.map((connection) => connection.id) } },
      select: { connectionId: true },
    });
    if (bound.length === 0)
      throw new ApiError(409, "external_binding_missing", `No ${platform} account is switched on for this Bot, so nothing was sent.`);
    const mappings = await this.deps.prisma.externalChannelMapping.findMany({
      where: { botId, status: "active", connectionId: { in: bound.map((binding) => binding.connectionId) }, ...(peerId === null ? {} : { peerId }) },
      select: { id: true },
    });
    if (mappings.length === 0)
      throw new ApiError(409, "external_peer_unknown", `No ${platform} conversation with ${peerId === null ? "anyone" : "that contact"} exists yet, so nothing was sent. They need to message you first.`);
    if (mappings.length > 1)
      throw new ApiError(409, "external_peer_ambiguous", `More than one ${platform} contact or account matches, so nothing was sent. Address one as ${platform}:<contact> (list_peers shows them).`);
    return { mappingId: mappings[0]!.id };
  }

  private async createPending(
    tx: Prisma.TransactionClient,
    input: { callId: string; mapping: { id: string; connectionId: string }; context: Pick<ToolContext, "botId"> & { runId: string | null }; messageId: string; leaseOwner: string }
  ): Promise<void> {
    const row = await tx.externalOutboundDelivery.create({
      data: {
        callId: input.callId,
        connectionId: input.mapping.connectionId,
        mappingId: input.mapping.id,
        botId: input.context.botId,
        runId: input.context.runId,
        channelMessageId: input.messageId,
        deliveryLeaseOwner: input.leaseOwner,
        // Replaced with a database-clock deadline right below.
        deliveryLeaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000),
      },
    });
    await tx.$executeRaw`
      UPDATE "outcomego_external_outbound_delivery"
      SET "deliveryLeaseExpiresAt" = ${DB_NOW} + make_interval(secs => ${LEASE_SECONDS})
      WHERE "id" = ${row.id}::uuid`;
    await this.writeMessageState(tx, input.messageId, { id: row.id, status: "pending", code: null });
  }

  /** Mirrors the delivery state onto the Bot message so every client can show it. */
  private async writeMessageState(
    tx: Prisma.TransactionClient,
    messageId: string,
    state: { id: string; status: DeliveryStatus; code: string | null }
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
      SELECT "metadata" FROM "outcomego_channel_message" WHERE "id" = ${messageId}::uuid FOR UPDATE`;
    const current = rows[0]?.metadata && typeof rows[0].metadata === "object" && !Array.isArray(rows[0].metadata) ? (rows[0].metadata as Record<string, unknown>) : {};
    await tx.channelMessage.update({
      where: { id: messageId },
      data: { metadata: { ...current, externalDelivery: state } as Prisma.InputJsonValue },
    });
    await appendEvent(tx, "external.delivery.updated", state.id, { deliveryId: state.id, messageId, status: state.status, code: state.code });
  }

  /** Renews the lease while work is in flight. Reports lost ownership through `lost()`. */
  private keepAlive(id: string, owner: string) {
    let lost = false;
    const timer = setInterval(() => {
      void this.deps.prisma
        .$executeRaw`
          UPDATE "outcomego_external_outbound_delivery"
          SET "deliveryLeaseExpiresAt" = ${DB_NOW} + make_interval(secs => ${LEASE_SECONDS}), "updatedAt" = ${DB_NOW}
          WHERE "id" = ${id}::uuid AND "status" IN ('pending', 'sending')
            AND "deliveryLeaseOwner" = ${owner} AND "deliveryLeaseExpiresAt" > ${DB_NOW}`
        .then((count) => {
          if (count === 0) lost = true;
        })
        .catch(() => {});
    }, this.renewMs);
    return { lost: () => lost, stop: () => clearInterval(timer) };
  }

  /**
   * Sends one delivery. Only the operation that created it, holding its lease, gets past the
   * `pending` to `sending` step, so concurrent callers cannot send twice.
   */
  async dispatch(deliveryId: string, leaseOwner: string): Promise<DeliveryOutcome> {
    const row = await this.load({ id: deliveryId });
    if (!row) throw new ApiError(404, "external_delivery_not_found", "Delivery not found");
    const platform = row.mapping?.platform ?? "";
    const alive = this.keepAlive(deliveryId, leaseOwner);
    let staged = false;
    try {
      const fail = (code: string) => this.finish(row, leaseOwner, "failed", code, undefined);

      const binding = await this.deps.prisma.externalMessagingBinding.findUnique({ where: { connectionId: row.connectionId } });
      if (!binding?.enabled) return await fail("external_messaging_disabled");
      if (row.connection.status !== "ready") return await fail("external_connection_unavailable");
      const messaging = messagingOf(row.connection);
      if (!messaging || !row.mapping) return await fail("external_connection_unavailable");

      const metadata = row.channelMessage.metadata && typeof row.channelMessage.metadata === "object" && !Array.isArray(row.channelMessage.metadata) ? (row.channelMessage.metadata as Record<string, unknown>) : {};
      const attachments = Array.isArray(metadata.attachments) ? (metadata.attachments as AssetRef[]) : [];
      const text = metadata.type === "attachment" ? (typeof metadata.alt === "string" ? metadata.alt.trim() : "") : row.channelMessage.content;

      // Capability checks come before any file leaves the Server.
      if (text.length > messaging.outbound.maxTextChars) return await fail("external_delivery_unsupported");
      if (!text && attachments.length === 0) return await fail("external_delivery_unsupported");
      const mediaRule = messaging.outbound.media;
      for (const ref of attachments) {
        const kind = KIND_OF_ASSET[ref.kind] ?? "file";
        if (!mediaRule || !mediaRule.kinds.includes(kind) || ref.byteSize > mediaRule.maxBytes) return await fail("external_delivery_unsupported");
      }

      const media: ExternalOutboundMedia[] = [];
      for (const [index, ref] of attachments.entries()) {
        const extension = /\.[A-Za-z0-9]{1,8}$/.exec(ref.fileName)?.[0] ?? "";
        const exchangeName = `${index}-${ref.assetId.slice(0, 12)}${extension}`;
        try {
          await this.deps.exchange.stageOutbound({
            connectionId: row.connectionId,
            deliveryId,
            exchangeName,
            body: Bun.file(this.deps.assets.contentPath(ref.assetId)).stream(),
            byteSize: ref.byteSize,
            sha256: ref.assetId,
          });
        } catch {
          staged = true;
          return await fail("external_media_staging_failed");
        }
        staged = true;
        media.push({ exchangeName, fileName: sanitizeExternalLabel(ref.fileName, 200) || exchangeName, mimeType: ref.mimeType, byteSize: ref.byteSize, sha256: ref.assetId });
      }

      // From here the connector may act. Only the lease holder may take this step, exactly once.
      if (alive.lost()) return await this.current(row, platform);
      const started = await this.deps.prisma.$executeRaw`
        UPDATE "outcomego_external_outbound_delivery"
        SET "status" = 'sending', "startedAt" = ${DB_NOW}, "updatedAt" = ${DB_NOW}
        WHERE "id" = ${deliveryId}::uuid AND "status" = 'pending'
          AND "deliveryLeaseOwner" = ${leaseOwner} AND "deliveryLeaseExpiresAt" > ${DB_NOW}`;
      if (started === 0) return await this.current(row, platform);

      const payload: ExternalDeliverInput = {
        deliveryId,
        peerId: row.mapping.peerId,
        ...(text ? { text } : {}),
        ...(media.length ? { media } : {}),
      };
      return await this.finishFromCall(row, leaseOwner, payload, messaging.outbound.deliverTool);
    } finally {
      alive.stop();
      // Waited for, so "the delivery ended" also means "its staged files are gone". A failure to clean up
      // never changes the delivery's result: the connector ages leftovers out on its own.
      if (staged) await this.deps.exchange.cleanupOutbound(row.connectionId, deliveryId).catch(() => false);
    }
  }

  private async finishFromCall(row: Row, owner: string, payload: ExternalDeliverInput, tool: string): Promise<DeliveryOutcome> {
    let result: ExternalDeliverResult;
    try {
      const timeout = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new DeliverTimeout()), this.deliverTimeoutMs);
        (timer as { unref?: () => void }).unref?.();
      });
      const raw = await Promise.race([this.deps.callHostTool(row.connection, tool, { ...payload }), timeout]);
      result = parseExternalDeliverResult(toolResultValue(raw));
    } catch (error) {
      // After the call started, anything short of a clear answer might still have been sent.
      const code =
        error instanceof DeliverTimeout ? "external_delivery_timeout" :
        error instanceof ExternalProtocolError || error instanceof ToolResultError ? "external_delivery_unreadable" :
        "external_delivery_transport";
      return this.finish(row, owner, "uncertain", code, undefined);
    }
    if (result.status === "sent")
      return this.finish(row, owner, "sent", null, {
        ...(result.providerMessageIds ? { providerMessageIds: result.providerMessageIds } : {}),
        ...(result.note ? { note: result.note } : {}),
      });
    return this.finish(row, owner, result.status, shortCode(result.code, 100), undefined, result.message);
  }

  /**
   * The only terminal write. It names the lease holder and requires the lease unexpired, so a late
   * result cannot overwrite what recovery already decided.
   */
  private async finish(
    row: Row,
    owner: string,
    status: "sent" | "failed" | "uncertain",
    code: string | null,
    providerResult: Record<string, unknown> | undefined,
    detail?: string
  ): Promise<DeliveryOutcome> {
    const platform = row.mapping?.platform ?? "";
    const message = status === "sent" ? null : (detail ? sanitizeExternalLabel(detail, EXTERNAL_ERROR_MESSAGE_MAX_CHARS) : errorMessageFor(code ?? "unknown")).slice(0, 500);
    const changed = await this.deps.prisma.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
        UPDATE "outcomego_external_outbound_delivery"
        SET "status" = ${status}, "errorCode" = ${code}, "errorMessage" = ${message},
            "providerResult" = ${providerResult ? JSON.stringify(providerResult) : null}::jsonb,
            "completedAt" = ${DB_NOW}, "updatedAt" = ${DB_NOW},
            "deliveryLeaseOwner" = NULL, "deliveryLeaseExpiresAt" = NULL
        WHERE "id" = ${row.id}::uuid AND "status" IN ('pending', 'sending')
          AND "deliveryLeaseOwner" = ${owner} AND "deliveryLeaseExpiresAt" > ${DB_NOW}`;
      if (count === 0) return false;
      await this.writeMessageState(tx, row.channelMessageId, { id: row.id, status, code });
      return true;
    });
    if (!changed) return this.current(row, platform);
    return { id: row.id, platform, status, ...(code ? { reason: code } : {}), messageId: row.channelMessageId };
  }

  /** The stored state, for a caller whose own write lost to recovery or a newer owner. */
  private async current(row: Row, platform: string): Promise<DeliveryOutcome> {
    const latest = await this.deps.prisma.externalOutboundDelivery.findUniqueOrThrow({ where: { id: row.id } });
    return this.outcome(latest, platform, true);
  }

  // --- Recovery and lifecycle -------------------------------------------------------------

  /**
   * Settles deliveries whose lease expired: unsent ones are failed, in-flight ones are uncertain.
   * Never sends, and never touches a lease another Server still holds.
   */
  async recoverExpired(): Promise<number> {
    return this.deps.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; channelMessageId: string; status: DeliveryStatus; errorCode: string }>>`
        UPDATE "outcomego_external_outbound_delivery"
        SET "status" = CASE WHEN "status" = 'pending' THEN 'failed' ELSE 'uncertain' END,
            "errorCode" = CASE WHEN "status" = 'pending' THEN 'external_delivery_abandoned' ELSE 'external_delivery_interrupted' END,
            "errorMessage" = CASE WHEN "status" = 'pending' THEN 'Not delivered: external_delivery_abandoned' ELSE 'Delivery was interrupted; it may or may not have been sent' END,
            "completedAt" = ${DB_NOW}, "updatedAt" = ${DB_NOW},
            "deliveryLeaseOwner" = NULL, "deliveryLeaseExpiresAt" = NULL
        WHERE "status" IN ('pending', 'sending') AND "deliveryLeaseExpiresAt" < ${DB_NOW}
        RETURNING "id", "channelMessageId", "status", "errorCode"`;
      for (const row of rows) await this.writeMessageState(tx, row.channelMessageId, { id: row.id, status: row.status, code: row.errorCode });
      return rows.length;
    });
  }

  startRecovery(): void {
    if (this.recoveryTimer) return;
    void this.recoverExpired().catch((cause) => console.error("external delivery recovery", cause instanceof Error ? cause.message : "failed"));
    this.recoveryTimer = setInterval(
      () => void this.recoverExpired().catch((cause) => console.error("external delivery recovery", cause instanceof Error ? cause.message : "failed")),
      RECOVERY_INTERVAL_MS
    );
    (this.recoveryTimer as { unref?: () => void }).unref?.();
  }

  stopRecovery(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  /**
   * Run in the transaction that deletes a Connection, before the delete: its conversations are
   * archived (history stays) and anything not yet finished is failed.
   */
  async prepareConnectionRemoval(tx: Prisma.TransactionClient, connectionId: string): Promise<void> {
    await tx.channel.updateMany({
      where: { kind: "external_dm", archivedAt: null, externalMapping: { connectionId } },
      data: { archivedAt: new Date() },
    });
    const rows = await tx.$queryRaw<Array<{ id: string; channelMessageId: string }>>`
      UPDATE "outcomego_external_outbound_delivery"
      SET "status" = 'failed', "errorCode" = 'external_connection_removed',
          "errorMessage" = 'Not delivered: external_connection_removed',
          "completedAt" = ${DB_NOW}, "updatedAt" = ${DB_NOW},
          "deliveryLeaseOwner" = NULL, "deliveryLeaseExpiresAt" = NULL
      WHERE "connectionId" = ${connectionId}::uuid AND "status" IN ('pending', 'sending')
      RETURNING "id", "channelMessageId"`;
    for (const row of rows) await this.writeMessageState(tx, row.channelMessageId, { id: row.id, status: "failed", code: "external_connection_removed" });
    // Deleting these is explicit so a connection that is only reset (not deleted) leaves nothing behind either.
    await tx.externalMessagingBinding.deleteMany({ where: { connectionId } });
    await tx.externalMessageReceipt.deleteMany({ where: { connectionId } });
    await tx.externalChannelMapping.deleteMany({ where: { connectionId } });
  }

  /** Archiving or restoring a conversation moves its mapping with it. */
  async setChannelArchived(channelId: string, archived: boolean): Promise<void> {
    await this.deps.prisma.$transaction(async (tx) => {
      const channel = await tx.channel.findUnique({ where: { id: channelId }, select: { kind: true } });
      if (channel?.kind !== "external_dm") throw new ApiError(404, "external_channel_not_found", "External conversation not found");
      await tx.channel.update({ where: { id: channelId }, data: { archivedAt: archived ? new Date() : null } });
      await tx.externalChannelMapping.updateMany({ where: { channelId }, data: { status: archived ? "archived" : "active" } });
    });
  }
}

class DeliverTimeout extends Error {
  constructor() {
    super("external_delivery_timeout");
  }
}
