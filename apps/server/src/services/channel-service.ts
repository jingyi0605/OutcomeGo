import {
  nextMessageAddress,
  lockGroupExecution,
  supersedeGroupUserTurns,
  toggleMessageReaction,
  lockQuestions,
  dismissQuestions,
  questionScopeForReply,
  outcomeDispatchEnabled,
  readOutcomesEnabled,
  type ActorRef,
} from "@outcomego/messaging";
import {
  ApiError,
  type ChannelMessageView,
  type ReactToChannelMessageInput,
  type ReactToChannelMessageView,
  type RenameChannelInput,
  type SendMessageInput,
} from "@outcomego/contracts";
import { OUTCOME_THREAD_TEXT_CHARS, type CreateOutcomeThreadInput, type OutcomeThreadTurnView } from "@outcomego/contracts/outcome-thread";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import { COMPUTER_API_PATHS } from "@outcomego/contracts/service-protocol";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  type AgentDataStore,
  type AgentMessaging,
  type AssetStore,
  PRIORITY,
  lockAgentLifecycle,
} from "@outcomego/messaging";
import { cancelSkippedBootstrap } from "./channel/delivery";
import { renameDirectChannel } from "./channel/direct-profile";
import {
  formatDirectMentionContext,
  formatUserPrompt,
  formatUserReactionPrompt,
  messageAddress,
  replyGoalHint,
} from "./channel/formatting";
import { GroupAdministration } from "./channel/group-administration";
import { outcomeApiError } from "./outcome-service";
import {
  appendEvent,
  type ComputerFetch,
  forwardServiceMethod,
  hashRequest,
  metadataRecord,
  serviceEffect,
  toJson,
} from "./service-utils";
import { toChannelMessageView as channelMessageView, serialize } from "./view-mappers";
import type { UserLocationService } from "./user-location";

/**
 * The reference may cut off a run before its input reached the model only when that input
 * is a plain typed message, which the next turn replays: no attachments, reply or thread.
 */
const recoveryShaped = (run: { origin: string; inboxEvents: Array<{ payload: unknown }> }): boolean => {
  const payload = (run.inboxEvents[0]?.payload ?? {}) as { attachments?: unknown[]; replyToMessageId?: unknown; isFork?: unknown };
  return run.origin === "user" && !payload.attachments?.length && !payload.replyToMessageId && payload.isFork !== true;
};

export type CreateGoalThreadInTransaction = (
  tx: Prisma.TransactionClient,
  input: CreateOutcomeThreadInput & { titleText?: string },
  actor: ActorRef
) => Promise<{ outcome: OutcomeDetail; turn: OutcomeThreadTurnView }>;

export class ChannelService {
  private readonly groups: GroupAdministration;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly messaging: AgentMessaging,
    private readonly workspaceRoot: string,
    private readonly computerFetch: ComputerFetch,
    private readonly agentData?: AgentDataStore,
    private readonly assets?: AssetStore,
    private readonly userLocations?: UserLocationService,
    private readonly createGoalThreadInTransaction?: CreateGoalThreadInTransaction
  ) {
    this.groups = new GroupAdministration(
      prisma,
      messaging,
      workspaceRoot,
      computerFetch,
      agentData
    );
  }

  messageDeliveryStatus = (channelId: string, clientId: string) =>
    serviceEffect(async () => {
      if (clientId.length < 8 || clientId.length > 120) {
        throw new ApiError(400, "invalid_client_id", "Message delivery ID is invalid");
      }
      const message = await this.prisma.channelMessage.findUnique({
        where: { channelId_clientId: { channelId, clientId } },
      });
      if (message) {
        return {
          clientId,
          status: "accepted" as const,
          acceptedAtMs: message.createdAt.getTime(),
          message: channelMessageView(message),
        };
      }
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        include: {
          members: {
            orderBy: { ordinal: "asc" },
            include: { bot: { include: { conversation: true } } },
          },
        },
      });
      if (!channel) {
        throw new ApiError(404, "channel_not_found", "Channel was not found");
      }
      const conversationId =
        channel.kind === "bot_dm" ? channel.members[0]?.bot.conversation?.id : null;
      const scope = conversationId
        ? `conversation:${conversationId}:message`
        : `channel:${channelId}:message`;
      const idempotency = await this.prisma.idempotencyRecord.findUnique({
        where: { scope_key: { scope, key: clientId } },
      });
      if (!idempotency) {
        return { clientId, status: "not_found" as const, acceptedAtMs: null, message: null };
      }
      if (idempotency.status === "processing") {
        return { clientId, status: "pending" as const, acceptedAtMs: null, message: null };
      }
      if (idempotency.status === "failed") {
        return {
          clientId,
          status: "rejected" as const,
          acceptedAtMs: null,
          message: null,
          code: "server_rejected",
          messageText: "The server rejected this message.",
        };
      }
      return {
        clientId,
        status: "unknown_durability" as const,
        acceptedAtMs: null,
        message: null,
      };
    });

  sendDirectMessage = (conversationId: string, input: SendMessageInput, locationSessionId: string | null = null,
    onAccepted?: (tx: Prisma.TransactionClient, userMessageId: string) => Promise<void>) =>
    serviceEffect(async () => {
      input = await this.normalizeMessageAttachments(input);
      const scope = `conversation:${conversationId}:message`;
      // Enrollment can finish between delivery retries. Origin is routing metadata,
      // not a content change; the first accepted message keeps its original origin.
      const requestHash = hashRequest({ ...input, sourceMachineId: undefined, location: undefined });
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { scope_key: { scope, key: input.clientId } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ApiError(
            409,
            "idempotency_conflict",
            "The idempotency key was already used for different content"
          );
        }
        if (existing.response) return serialize(existing.response);
        throw new ApiError(409, "request_in_progress", "This message is already being accepted");
      }

      // Copy/hash files and acquire their advisory locks before message acceptance
      // locks Bot. File reconciliation may hold those locks while updating Bot.
      // Revalidate the target inside acceptance below; prepared files grant no access.
      let preparedAttachmentPaths: string[] | undefined;
      if (input.attachments?.length) {
        const target = await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { bot: { include: { subagentIdentity: { select: { id: true } } } } },
        });
        if (!target || target.bot.subagentIdentity || !["active", "provisioning"].includes(target.bot.status)) {
          throw new ApiError(404, "conversation_not_found", "Runnable conversation not found");
        }
        preparedAttachmentPaths = await this.messaging.agentData.materializeAttachments(
          target.botId, input.clientId, input.attachments
        );
      }

      const accepted = await this.prisma.$transaction(async (tx) => {
        // Accept before retirement scans the queue, or reread its archived state.
        // The lifecycle gate must precede any Bot/onboarding row lock.
        const owner = await tx.conversation.findUnique({
          where: { id: conversationId }, select: { botId: true },
        });
        if (owner) await lockAgentLifecycle(tx, owner.botId);
        const conversation = await tx.conversation.findUnique({
          where: { id: conversationId },
          include: { bot: { include: { subagentIdentity: { select: { id: true } } } } },
        });
        if (
          !conversation ||
          conversation.bot.subagentIdentity ||
          !["active", "provisioning"].includes(conversation.bot.status)
        ) {
          throw new ApiError(404, "conversation_not_found", "Runnable conversation not found");
        }
        const channel = await tx.channel.findUnique({
          where: { directKey: `bot:${conversation.botId}` },
        });
        if (!channel || channel.archivedAt) {
          throw new ApiError(409, "channel_unavailable", "Bot DM channel is unavailable");
        }
        await lockQuestions(tx, channel.id);
        const duplicate = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key: input.clientId } },
        });
        if (duplicate) {
          if (duplicate.requestHash !== requestHash)
            throw new ApiError(409, "idempotency_conflict", "The idempotency key was already used for different content");
          if (duplicate.response)
            return { response: serialize(duplicate.response), bootstrapRunId: null, interruptRunId: null };
          throw new ApiError(409, "request_in_progress", "This message is already being accepted");
        }
        const reply = input.replyToMessageId
          ? await tx.channelMessage.findFirst({
              where: { id: input.replyToMessageId, channelId: channel.id },
            })
          : null;
        if (input.replyToMessageId && !reply) {
          throw new ApiError(404, "reply_target_not_found", "Reply target was not found");
        }
        const questionScopeId = questionScopeForReply(input.isFork, reply);
        await tx.idempotencyRecord.create({
          data: {
            scope,
            key: input.clientId,
            requestHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
          },
        });
        const bootstrapRunId = await this.messaging.skipBootstrapForUser(tx, conversation.botId);
        await dismissQuestions(tx, channel.id, questionScopeId, "moved-on");
        const mentionPeers = await tx.bot.findMany({
          where: {
            id: { not: conversation.botId },
            status: "active",
            subagentIdentity: { is: null },
          },
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" },
        });
        const sourceMachineId = input.sourceMachineId && await tx.hostMachine.findUnique({ where: { machineId: input.sourceMachineId }, select: { machineId: true } }) ? input.sourceMachineId : undefined;
        if (input.location) {
          if (!this.userLocations) throw new ApiError(404, "location_disabled", "Location sharing is not enabled");
          await this.userLocations.record(tx, locationSessionId, input.location);
        }
        if (input.timeZone) await this.messaging.updateUserTimeZone(tx, { detected: input.timeZone });
        if (input.goalMode && !outcomeDispatchEnabled()) {
          throw new ApiError(
            503,
            "outcome_dispatch_disabled",
            "New Outcome execution is temporarily disabled",
            { retryable: true }
          );
        }
        const address = await nextMessageAddress(tx, channel.id, "user");
        const visibleMessage = await tx.channelMessage.create({
          data: {
            channelId: channel.id,
            clientId: input.clientId,
            sender: "user",
            content: input.content,
            metadata: {
              type: "text",
              address,
              ...(sourceMachineId ? { sourceMachineId } : {}),
              ...(input.attachments?.length ? { attachments: input.attachments } : {}),
              ...(reply ? { replyTo: reply.id } : {}),
              ...(input.richText ? { richText: input.richText } : {}),
              ...(input.isFork ? { branched: true, questionScopeId } : {}),
              ...(input.timeZone ? { timeZone: input.timeZone } : {}),
              ...(input.voice ? { voice: input.voice } : {}),
              ...(input.goalMode ? { goalMode: true } : {}),
            },
          },
        });
        if (input.goalMode) {
          if (!(await readOutcomesEnabled(tx))) {
            throw new ApiError(
              403,
              "outcomes_disabled",
              "Goal management is turned off. The user can enable it in Settings → General"
            );
          }
          if (conversation.bot.status !== "active") {
            throw outcomeApiError("bot_not_runnable", "Choose an existing, active Bot");
          }
          if (!this.createGoalThreadInTransaction) {
            throw new ApiError(
              503,
              "outcome_thread_unavailable",
              "Goal thread creation is not available"
            );
          }
          let actor: ActorRef = "owner:local";
          if (locationSessionId) {
            const session = await tx.session.findUnique({
              where: { id: locationSessionId },
              select: { userId: true, expiresAt: true },
            });
            if (session && session.expiresAt > new Date()) actor = `user:${session.userId}`;
          }
          const titleText =
            input.content.trim() ||
            input.attachments?.map((attachment) => attachment.fileName).join(", ") ||
            "New goal";
          const plannerParts = [
            ...(reply
              ? [
                  `[In reply to ${messageAddress(reply)}: ${JSON.stringify(reply.content)}${replyGoalHint(reply)}]`,
                ]
              : []),
            titleText,
            ...(input.attachments?.length
              ? [
                  `[Attachments: ${input.attachments.map((attachment) => `${attachment.fileName} (${attachment.mimeType})`).join(", ")}]`,
                ]
              : []),
          ];
          const plannerText = plannerParts.join("\n").slice(0, OUTCOME_THREAD_TEXT_CHARS);
          const created = await this.createGoalThreadInTransaction(
            tx,
            {
              text: plannerText,
              titleText: titleText.slice(0, OUTCOME_THREAD_TEXT_CHARS),
              botId: conversation.botId,
              postToChat: true,
              clientRequestId: input.clientId,
            },
            actor
          );
          const goalRun = created.turn.runId
            ? await tx.run.findUnique({ where: { id: created.turn.runId } })
            : null;
          await this.messaging.scheduleTranscriptProjection(tx, [conversation.botId]);
          await tx.channel.update({
            where: { id: channel.id },
            data: { updatedAt: new Date() },
          });
          const response = { message: visibleMessage, run: goalRun };
          await tx.idempotencyRecord.update({
            where: { scope_key: { scope, key: input.clientId } },
            data: { status: "completed", response: toJson(response) },
          });
          return {
            response: serialize(response),
            bootstrapRunId,
            interruptRunId: null,
          };
        }
        const delivery = await this.messaging.acceptDirectUserMessage(tx, {
          botId: conversation.botId,
          channelId: channel.id,
          content: formatUserPrompt(
            address,
            formatDirectMentionContext(input.content, mentionPeers),
            reply
          ) + (sourceMachineId ? `\n\n[Sent from machine ${sourceMachineId}]` : ""),
          attachments: input.attachments,
          clientId: input.clientId,
          occurredAt: visibleMessage.createdAt,
          ...(input.isFork ? { replyToMessageId: visibleMessage.id, isFork: true } : {}),
        }, preparedAttachmentPaths);
        await onAccepted?.(tx, delivery.run.userMessageId);
        await this.messaging.scheduleTranscriptProjection(tx, [conversation.botId]);
        await tx.channel.update({
          where: { id: channel.id },
          data: { updatedAt: new Date() },
        });
        const response = { message: visibleMessage, run: delivery.run };
        await tx.idempotencyRecord.update({
          where: { scope_key: { scope, key: input.clientId } },
          data: { status: "completed", response: toJson(response) },
        });
        return {
          response: serialize(response),
          bootstrapRunId,
          interruptRunId: delivery.interruptRunId,
        };
      });
      this.afterDurableAcceptance("direct message follow-up", async () => {
        if (accepted.bootstrapRunId)
          await cancelSkippedBootstrap(this.computerFetch, this.prisma, accepted.bootstrapRunId);
        // A thread message carries no recovery of the run it supersedes, as in the reference.
        if (accepted.interruptRunId) await this.interruptRun(accepted.interruptRunId, true, input.isFork !== true);
      });
      return accepted.response;
    });

  createGroup = forwardServiceMethod(() => this.groups.createGroup);

  listGroups = (includeHidden = false) => this.groups.listGroups(includeHidden);

  setGroupHidden = forwardServiceMethod(() => this.groups.setGroupHidden);

  deleteGroup = forwardServiceMethod(() => this.groups.deleteGroup);

  updateGroupProfile = forwardServiceMethod(() => this.groups.updateGroupProfile);

  setGroupAvatar = forwardServiceMethod(() => this.groups.setGroupAvatar);

  groupAvatar = forwardServiceMethod(() => this.groups.groupAvatar);

  renameDirectChannel = (channelId: string, input: RenameChannelInput) =>
    renameDirectChannel(
      this.prisma,
      this.agentData,
      this.computerFetch,
      this.messaging,
      channelId,
      input
    );

  setGroupMembers = forwardServiceMethod(() => this.groups.setGroupMembers);

  sendGroupMessage = (
    channelId: string,
    input: SendMessageInput,
    options?: { responderIds?: readonly string[]; locationSessionId?: string | null }
  ) =>
    serviceEffect(async () => {
      input = await this.normalizeMessageAttachments(input);
      const scope = `channel:${channelId}:message`;
      const requestHash = hashRequest({
        ...input,
        sourceMachineId: undefined,
        location: undefined,
        ...(options?.responderIds ? { responderIds: [...options.responderIds] } : {}),
      });
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { scope_key: { scope, key: input.clientId } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ApiError(409, "idempotency_conflict", "Idempotency key content changed");
        }
        if (existing.response) return serialize(existing.response);
        throw new ApiError(409, "request_in_progress", "This message is already being accepted");
      }
      let supersededRunIds: string[] = [];
      const response = await this.prisma.$transaction(async (tx) => {
        await lockGroupExecution(tx, channelId);
        // Recheck after the room lock: concurrent delivery retries must not
        // create another root or cancel the first accepted request's turn.
        const duplicate = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key: input.clientId } },
        });
        if (duplicate) {
          if (duplicate.requestHash !== requestHash)
            throw new ApiError(409, "idempotency_conflict", "Idempotency key content changed");
          if (duplicate.response) return duplicate.response as any;
          throw new ApiError(409, "request_in_progress", "This message is already being accepted");
        }
        const channel = await tx.channel.findUnique({
          where: { id: channelId },
          include: { members: true },
        });
        // External conversations mirror an outside chat; the app never writes into them (specs/009 D12).
        if (channel?.kind === "external_dm")
          throw new ApiError(409, "external_channel_read_only", "This conversation is read-only in the app");
        if (!channel || channel.kind !== "group" || channel.archivedAt) {
          throw new ApiError(404, "group_not_found", "Active group not found");
        }
        const reply = input.replyToMessageId
          ? await tx.channelMessage.findFirst({
              where: { id: input.replyToMessageId, channelId },
            })
          : null;
        if (input.replyToMessageId && !reply) {
          throw new ApiError(404, "reply_target_not_found", "Reply target was not found");
        }
        const questionScopeId = questionScopeForReply(input.isFork, reply);
        await tx.idempotencyRecord.create({
          data: {
            scope,
            key: input.clientId,
            requestHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
          },
        });
        await lockQuestions(tx, channelId);
        await dismissQuestions(tx, channelId, questionScopeId, "moved-on");
        if (input.location) {
          if (!this.userLocations) throw new ApiError(404, "location_disabled", "Location sharing is not enabled");
          await this.userLocations.record(tx, options?.locationSessionId ?? null, input.location);
        }
        const sourceMachineId = input.sourceMachineId && await tx.hostMachine.findUnique({ where: { machineId: input.sourceMachineId }, select: { machineId: true } }) ? input.sourceMachineId : undefined;
        if (input.timeZone) await this.messaging.updateUserTimeZone(tx, { detected: input.timeZone });
        const address = await nextMessageAddress(tx, channelId, "user");
        const message = await tx.channelMessage.create({
          data: {
            channelId,
            sender: "user",
            clientId: input.clientId,
            content: input.content,
            metadata: {
              type: "text",
              address,
              ...(sourceMachineId ? { sourceMachineId } : {}),
              ...(input.attachments?.length ? { attachments: input.attachments } : {}),
              ...(reply ? { replyTo: reply.id } : {}),
              ...(input.richText ? { richText: input.richText } : {}),
              ...(input.isFork ? { branched: true, questionScopeId } : {}),
              ...(input.timeZone ? { timeZone: input.timeZone } : {}),
              ...(input.voice ? { voice: input.voice } : {}),
            },
          },
        });
        await this.messaging.scheduleTranscriptProjection(
          tx,
          channel.members.map((member) => member.botId)
        );
        supersededRunIds = await supersedeGroupUserTurns(tx, channelId, message.id);
        const round = await this.messaging.createGroupRound(tx, {
          channelId,
          triggerMessageId: message.id,
          initiatorBotId: null,
          ...(options?.responderIds ? { responderIds: options.responderIds } : {}),
        });
        await tx.channel.update({
          where: { id: channelId },
          data: { updatedAt: new Date() },
        });
        await appendEvent(tx, "channel.message.accepted", message.id, {
          channelId,
          messageId: message.id,
          roundId: round.id,
        });
        const accepted = { message, round };
        await tx.idempotencyRecord.update({
          where: { scope_key: { scope, key: input.clientId } },
          data: { status: "completed", response: toJson(accepted) },
        });
        return accepted;
      });
      this.afterDurableAcceptance("group message round advancement", async () => {
        // The durable cancellation fence already prevents stale publication.
        // Stop the runtime too, without holding the acceptance transaction open.
        await Promise.allSettled(supersededRunIds.map((runId) =>
          this.computerFetch(COMPUTER_API_PATHS.turnCancel(runId), { method: "POST" })
        ));
        await this.messaging.advanceRound(response.round.id);
      });
      return serialize(response);
    });

  reactToMessage = (messageId: string, input: ReactToChannelMessageInput) =>
    serviceEffect(async () => {
      const scope = `channel-message:${messageId}:user-reaction`;
      const requestHash = hashRequest(input);
      const response = await this.prisma.$transaction(async (tx) => {
        // Both user and Bot reactions serialize their metadata changes on the same message.
        await tx.$queryRaw`SELECT id FROM "outcomego_channel_message" WHERE id = ${messageId}::uuid FOR NO KEY UPDATE`;
        const existing = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key: input.clientId } },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ApiError(409, "idempotency_conflict", "Reaction idempotency key changed");
          }
          if (existing.response) {
            const message = await tx.channelMessage.findUnique({
              where: { id: messageId },
            });
            if (!message) throw new ApiError(404, "message_not_found", "Message was not found");
            return {
              ...(serialize(existing.response) as Omit<ReactToChannelMessageView, "message">),
              message: channelMessageView(message),
            } as ReactToChannelMessageView;
          }
          throw new ApiError(409, "request_in_progress", "This reaction is already being applied");
        }
        const message = await tx.channelMessage.findUnique({
          where: { id: messageId },
          include: {
            channel: { include: { members: { select: { botId: true } } } },
            senderBot: true,
          },
        });
        if (!message || message.channel.archivedAt) {
          throw new ApiError(404, "message_not_found", "Message was not found");
        }
        await tx.idempotencyRecord.create({
          data: {
            scope,
            key: input.clientId,
            requestHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
          },
        });

        const metadata = metadataRecord(message.metadata);
        const reactions = Array.isArray(metadata.reactions)
          ? metadata.reactions.filter(
              (reaction): reaction is { by: string; emoji: string } =>
                Boolean(reaction) &&
                typeof reaction === "object" &&
                !Array.isArray(reaction) &&
                typeof (reaction as Record<string, unknown>).by === "string" &&
                typeof (reaction as Record<string, unknown>).emoji === "string"
            )
          : [];
        const { reactions: next, removed } = toggleMessageReaction(reactions, input.emoji, "me");
        if (next.length > 0) metadata.reactions = next;
        else delete metadata.reactions;
        const updatedMessage = await tx.channelMessage.update({
          where: { id: message.id },
          data: { metadata: toJson(metadata) },
        });

        if (input.timeZone) await this.messaging.updateUserTimeZone(tx, { detected: input.timeZone });
        let runId: string | null = null;
        if (
          !removed &&
          message.sender === "agent" &&
          message.senderBot &&
          message.channel.members.some(member => member.botId === message.senderBot!.id) &&
          ["active", "provisioning"].includes(message.senderBot.status)
        ) {
          const wake = await this.messaging.enqueueWake(tx, {
            botId: message.senderBot.id,
            channelId: message.channelId,
            origin: "user",
            type: "user.reaction",
            content: formatUserReactionPrompt(input.emoji, message.content),
            clientId: `reaction:${message.id}:${input.clientId}`,
            priority: PRIORITY.user,
            occurredAt: new Date(),
          });
          runId = wake.run.id;
        }
        await this.messaging.scheduleTranscriptProjection(
          tx,
          message.channel.members.map((member) => member.botId)
        );

        const result = {
          messageId: message.id,
          emoji: input.emoji,
          reacted: !removed,
          removed,
          runId,
        };
        await appendEvent(tx, "channel.message.user_reaction", message.id, result);
        await tx.idempotencyRecord.update({
          where: { scope_key: { scope, key: input.clientId } },
          data: { status: "completed", response: toJson(result) },
        });
        return { ...result, message: channelMessageView(updatedMessage) } as ReactToChannelMessageView;
      });
      return serialize(response);
    });

  private afterDurableAcceptance(label: string, operation: () => Promise<void>): void {
    void operation().catch((cause) => {
      // The accepted message and its inbox/round state are already committed.
      // Startup recovery and queue retry remain authoritative for follow-up work.
      console.error(label, cause);
    });
  }

  /**
   * A priority message supersedes a run that no user started; a typed message (byUser)
   * supersedes any run, as in the reference, and its cut-off calls say the user interrupted them.
   */
  async interruptRun(runId: string, byUser = false, carriesRecovery = false): Promise<void> {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: { inboxEvents: { select: { payload: true }, take: 1 } },
    });
    if (
      !run ||
      (run.origin === "user" && !byUser) ||
      !["queued", "running"].includes(run.status)
    ) {
      return;
    }
    try {
      const response = await this.computerFetch(COMPUTER_API_PATHS.turnCancel(runId), {
        method: "POST",
        ...(byUser ? { body: JSON.stringify({ reason: "user_message", recovery: carriesRecovery && recoveryShaped(run) }) } : {}),
      });
      if (!response.ok) return;
      await this.prisma.$transaction(async (tx) => {
        const interrupted = await tx.run.updateMany({
          where: {
            id: runId,
            ...(byUser ? {} : { origin: { not: "user" } }),
            status: { in: ["queued", "running"] },
          },
          data: {
            status: "cancelled",
            error: {
              code: "priority_peer_interrupt",
              message: byUser ? "superseded by a new user message" : "superseded by a priority agent message",
            },
          },
        });
        if (interrupted.count > 0) {
          await appendEvent(tx, "run.priority_interrupted", runId, { runId });
        }
      });
    } catch {
      // The priority wake remains durable if the previous turn ended during cancellation.
    }
  }

  private async normalizeMessageAttachments(input: SendMessageInput): Promise<SendMessageInput> {
    if (!input.attachments?.length) return input;

    const assets = this.assets ?? this.messaging.assets;
    if (!assets) {
      throw new ApiError(503, "asset_store_unavailable", "Attachments are temporarily unavailable");
    }
    return { ...input, attachments: await assets.normalizeRefs(input.attachments) };
  }
}

export {
  formatChannelRenamePrompt,
  formatDirectMentionContext,
  formatUserPrompt,
  formatUserReactionPrompt,
} from "./channel/formatting";
