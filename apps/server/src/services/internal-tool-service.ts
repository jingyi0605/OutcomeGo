import { TaskProgressInput, RequestProgressInput } from "@outcomego/contracts/task-progress";
import { reportTaskProgress, reportRequestProgress, requestProgressSnapshot } from "@outcomego/messaging";
import { readAgentActivity, readFeatureSettings, readOutcomesEnabled, readTranscript } from "@outcomego/messaging";
import { MAX_REPLY_PREVIEW_CHARS, REPLY_PREVIEW_CONTROL } from "@outcomego/contracts";
import type { ReplyPreviews } from "./reply-previews";
import { normalizeMainToolArguments } from "@outcomego/contracts/reference-main-parsers";
import { subagentUsesParentConnectors } from "@outcomego/contracts/task-configuration";
import {
  AgentSendToUserInput,
  validateProcessSecretName,
  AUTOMATION_PARENT_ONLY_TOOLS,
  AUTOMATION_RUN_VISIBLE_TRANSCRIPT_BLOCKED,
  WakeParentInput,
  ApiError,
  CheckSubagentInput,
  CreateAgentInput,
  CreateChannelInput,
  type DynamicToolCallRequest,
  MessageSubagentInput,
  ReactToMessageInput,
  RequestBoxHelpInput,
  SendToAgentInput,
  StopSubagentInput,
  TaskInput,
  TodoWriteInput,
  UpdateAgentInput,
  UpdateChannelInput,
  isStateTool,
} from "@outcomego/contracts";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { type AgentMessaging, validateSendToUserInput, wakeAutomationParent, automationContextRunId, assertBackgroundRequestDeliveryAllowed, publishMessageNotification } from "@outcomego/messaging";
import { Schema } from "effect";
import type { DurableStateService } from "../update-state";
import { formatMemoryToolResult } from "../memory-tool-result";
import type { AdministrationService } from "./administration-service";
import type { PluginService } from "./plugin-service";
import { serviceEffect } from "./service-utils";
import { botSubagentId, type SubagentService } from "./subagent/service";
import type { TodoService } from "./todo-service";
import type { RichMessageService } from "./rich-message-service";
import type { ComputerNetworkPolicyService } from "./computer-network-policy-service";
import type { ExternalDeliveryService } from "./external-messaging/delivery";
import { processEnvironment } from "./process-secrets";
import { bitwardenInstanceEnvironment, jsonObject } from "./plugin/values";
import { toJson } from "./service-utils";
import { withConnectorDraftCardReminder } from "./connector-draft-reminder";
import { createHash, randomUUID } from "node:crypto";
import { OUTCOME_THREAD_TOOL_NAMES } from "@outcomego/contracts/outcomes";
import { OUTCOME_CHAT_TOOL_NAMES } from "@outcomego/contracts/outcome-chat";
import { isGroupTaskTool } from "@outcomego/contracts/group-tasks";
import type { GroupTaskTools } from "./group-task-tools";
import type { OutcomeChatTools } from "./outcome-chat-tools";
import { isOutcomeThreadTool, type OutcomeThreadTools } from "./outcome-thread-tools";
import { findOutcomeCredentialGrant } from "./outcome-credential-approval";

export interface OutcomeThreadToolContext {
  runId: string;
  workItemId: string;
  botId: string;
}

export type OutcomeThreadToolHandler = (
  request: DynamicToolCallRequest,
  context: OutcomeThreadToolContext
) => Promise<unknown>;

/** Line 3 and line 4 supply handlers from their independent service files. */
export interface OutcomeThreadToolHandlers {
  RequestOutcomeDecision?: OutcomeThreadToolHandler;
  RequestHumanAction?: OutcomeThreadToolHandler;
  ReportOutcomeProgress?: OutcomeThreadToolHandler;
  DeferWorkItem?: OutcomeThreadToolHandler;
  /** Step approval for Bitwarden reads; called with already validated candidates, never with agent input. */
  RequestBitwardenReadApproval?: OutcomeThreadToolHandler;
}
import { GET_USER_LOCATION_TOOL } from "@outcomego/contracts/user-location";
import type { UserLocationService } from "./user-location";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isBackgroundOrigin = (origin: string) => origin === "routine" || origin === "outcome" || origin === "outcome_thread";
const bitwardenCandidate = (
  value: unknown
): { connectionId: string; itemId: string; title: string; hostname: string } => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "bitwarden_candidate_invalid", "A Bitwarden candidate is invalid");
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.connectionId !== "string" ||
    !UUID.test(candidate.connectionId) ||
    typeof candidate.itemId !== "string" ||
    !UUID.test(candidate.itemId) ||
    typeof candidate.title !== "string" ||
    !candidate.title.trim() ||
    candidate.title.length > 200 ||
    typeof candidate.hostname !== "string" ||
    !candidate.hostname.trim() ||
    candidate.hostname.length > 200
  )
    throw new ApiError(400, "bitwarden_candidate_invalid", "A Bitwarden candidate is invalid");
  return {
    connectionId: candidate.connectionId,
    itemId: candidate.itemId,
    title: candidate.title.trim(),
    hostname: candidate.hostname.trim(),
  };
};
const approvalReference = (value: unknown): string | null => {
  const text = typeof value === "string" ? value : "";
  const match = /BITWARDEN_APPROVAL:([0-9a-f-]{36})/i.exec(text);
  return match?.[1] ?? null;
};

export class InternalToolService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly messaging: AgentMessaging,
    private readonly durableState: DurableStateService,
    private readonly interruptNonUserRun: (runId: string) => Promise<void>,
    private readonly todos: TodoService,
    private readonly subagents: SubagentService,
    private readonly administration: AdministrationService,
    private readonly plugins: PluginService,
    private readonly richMessages?: RichMessageService,
    private readonly onVisibleMessage?: (runId: string, messageId: string) => Promise<void>,
    private readonly onSpeechChunk?: (runId: string, callId: string, text: string) => Promise<boolean>,
    private readonly computerNetworkPolicy?: ComputerNetworkPolicyService,
    private readonly externalDelivery?: ExternalDeliveryService,
    private readonly outcomeThreadTools: OutcomeThreadToolHandlers = {},
    private readonly outcomeChatTools?: OutcomeChatTools,
    private readonly userLocations?: UserLocationService,
    private readonly goalThreadTools?: OutcomeThreadTools,
    private readonly groupTaskTools?: GroupTaskTools,
    private readonly replyPreviews?: ReplyPreviews
  ) {}

  /**
   * The contact a run is answering, when its triggering message came from an outside chat. The
   * receipt written with that message is the record, so nothing extra is stored on the run.
   */
  private async externalOriginOf(runId: string): Promise<string | null> {
    const receipt = await this.prisma.externalMessageReceipt.findFirst({
      where: { runId, status: "accepted", mappingId: { not: null } },
      select: { mappingId: true },
    });
    return receipt?.mappingId ?? null;
  }

  /** The tool result of a finished delivery. A failed or unknown one is never reported as sent. */
  private externalAck(outcome: import("./external-messaging/delivery").DeliveryOutcome) {
    return {
      acknowledgement: {
        sent: outcome.status === "sent",
        message_id: outcome.messageId,
        external: { id: outcome.id, platform: outcome.platform, status: outcome.status, ...(outcome.reason ? { reason: outcome.reason } : {}) },
        ...(outcome.status === "failed" || outcome.status === "uncertain" ? { delivery_failed: true } : {}),
        ...(outcome.inProgress ? { in_progress: true } : {}),
      },
      interruptRunId: null,
    };
  }

  execute = (request: DynamicToolCallRequest, transfer: {upload?:import("@outcomego/plugin-sdk/file-spool").StagedFile;stream?:boolean} = {}) =>
    serviceEffect(async (signal) => {
      const run = await this.prisma.run.findUnique({
        where: { id: request.runId },
        include: {
          inboxEvents: {
            orderBy: { createdAt: "desc" },
            select: { id: true, attempts: true, payload: true },
            take: 1,
          },
        },
      });
      if (
        !run ||
        run.botId !== request.botId ||
        run.conversationId !== request.conversationId ||
        run.channelId !== request.channelId ||
        run.deliveryId !== request.deliveryId ||
        !["running"].includes(run.status)
      ) {
        throw new ApiError(409, "tool_context_invalid", "Dynamic tool context is not active");
      }
      if ((OUTCOME_THREAD_TOOL_NAMES as readonly string[]).includes(request.tool)) {
        if (run.origin !== "outcome" || !run.outcomeWorkItemId)
          throw new ApiError(400, "outcome_thread_required", "This tool requires an Outcome sub-thread");
        const handler = this.outcomeThreadTools[request.tool as keyof OutcomeThreadToolHandlers];
        if (!handler)
          throw new ApiError(503, "outcome_thread_tool_unavailable", `Outcome tool ${request.tool} has not been registered`);
        return handler(request, { runId: run.id, workItemId: run.outcomeWorkItemId, botId: run.botId });
      }
      const inboxPayload = run.inboxEvents[0]?.payload as Record<string, unknown> | undefined;
      const context = {
        runId: request.runId,
        botId: request.botId,
        conversationId: request.conversationId,
        channelId: request.channelId,
        deliveryId: request.deliveryId,
        origin: run.origin,
        callId: request.callId,
        timeZone: typeof inboxPayload?.timeZone === "string" ? inboxPayload.timeZone : undefined,
        replyToMessageId:
          typeof inboxPayload?.replyToMessageId === "string" ? inboxPayload.replyToMessageId : null,
        isFork: inboxPayload?.isFork === true,
      };
      const childIdentity = await this.prisma.subagent.findUnique({
        where: { childBotId: request.botId },
        select: { id: true, parentBotId: true, parentRunId: true, subagentType: true },
      });
      const backgroundRun = isBackgroundOrigin(run.origin);
      if (request.tool === REPLY_PREVIEW_CONTROL) {
        const input = request.arguments as { attempt?: unknown; callId?: unknown; content?: unknown } | null;
        const inbox = run.inboxEvents[0];
        if (!this.replyPreviews || !input || !inbox || input.attempt !== inbox.attempts ||
            typeof input.callId !== "string" ||
            !input.callId || input.callId.length > 256)
          return { published: false };
        const clientId = `tool:${input.callId}`;
        if (input.content === null) {
          this.replyPreviews.discard(context.channelId, inbox.id, inbox.attempts, clientId);
          return { published: true };
        }
        if (typeof input.content !== "string" || !input.content.trim() ||
            input.content.length > MAX_REPLY_PREVIEW_CHARS || run.origin !== "user" ||
            context.deliveryId || context.isFork || childIdentity || !context.channelId)
          return { published: false };
        const [features, channel, externalOrigin, saved] = await Promise.all([
          readFeatureSettings(this.prisma),
          this.prisma.channel.findFirst({ where: {
            id: context.channelId, kind: "bot_dm", directKey: `bot:${context.botId}`, archivedAt: null,
            members: { some: { botId: context.botId, bot: { status: "active" } } },
          }, select: { id: true } }),
          this.externalOriginOf(context.runId),
          this.prisma.channelMessage.findUnique({
            where: { channelId_clientId: { channelId: context.channelId, clientId } },
            select: { id: true },
          }),
        ]);
        if (!features.streamBotReplies || !channel || externalOrigin || saved) return { published: false };
        this.replyPreviews.publish(channel.id, inbox.id, inbox.attempts, { runId: run.id, clientId, content: input.content });
        return { published: true };
      }
      // A goal's own thread has its own small tool set, bound to that goal (specs/004.8).
      if (run.origin === "outcome_thread" && isOutcomeThreadTool(request.tool)) {
        if (!this.goalThreadTools)
          throw new ApiError(503, "outcome_thread_tool_unavailable", `Goal thread tool ${request.tool} has not been registered`);
        return this.goalThreadTools.execute(request, context, signal);
      }
      if (request.tool === "SaveOutcomeContract")
        throw new ApiError(400, "outcome_thread_required", "This tool belongs to a goal's own thread");
      if ((OUTCOME_CHAT_TOOL_NAMES as readonly string[]).includes(request.tool)) {
        if (childIdentity || backgroundRun)
          throw new ApiError(403, "outcome_chat_required", "Manage native goals from the user-facing Bot conversation");
        if (!(await readOutcomesEnabled(this.prisma)))
          throw new ApiError(403, "outcomes_disabled", "Goal management is turned off. The user can enable it in Settings → General");
        if (!this.outcomeChatTools)
          throw new ApiError(503, "outcome_chat_unavailable", "Native Outcome conversation tools are not available");
        return this.outcomeChatTools.execute(request, context, signal);
      }
      if (isGroupTaskTool(request.tool)) {
        // A shared group board is for the group's own members, not their workers or background runs.
        if (childIdentity || backgroundRun)
          throw new ApiError(403, "group_task_unavailable", "Group tasks are managed from the member's own group conversation");
        if (!this.groupTaskTools)
          throw new ApiError(503, "group_task_unavailable", "Group task tools are not available");
        return this.groupTaskTools.execute(request, context);
      }
      if (request.tool === GET_USER_LOCATION_TOOL.name) {
        if (childIdentity)
          throw new ApiError(403, "user_location_unavailable", "Only the deployment owner's parent bot can read location");
        if (!this.userLocations)
          throw new ApiError(404, "location_disabled", "Location sharing is not enabled");
        if (request.arguments != null &&
            (typeof request.arguments !== "object" || Array.isArray(request.arguments) || Object.keys(request.arguments).length))
          throw new ApiError(400, "invalid_arguments", "GetUserLocation takes no arguments");
        return this.userLocations.readForTool();
      }
      // Private supervisor operation, never registered in any model catalog.
      if (request.tool === "RefreshToolCatalog") return {namespaces:await this.plugins.dynamicNamespaces(childIdentity?.parentBotId ?? request.botId)};
      if (request.tool === "ReadProcessSecrets") return { environment: await processEnvironment(this.prisma, request.botId) };
      const bitwardenCallerAllowed = !childIdentity || childIdentity.subagentType === "computerUse";
      // An Outcome turn has an owner to ask through a step approval; a routine run has nobody to answer.
      const outcomeRun = run.origin === "outcome" && !!run.outcomeWorkItemId;
      if (["SearchBitwardenItems", "RequestBitwardenReadApproval", "ReadBitwardenCredential", "ConsumeBitwardenReadLease", "ConsumeBitwardenSearchLease"].includes(request.tool) &&
          (!bitwardenCallerAllowed || (backgroundRun && !outcomeRun)))
        throw new ApiError(403, "bitwarden_tool_forbidden", "Bitwarden reads are available only to the user-facing agent");
      if (request.tool === "SearchBitwardenItems") {
        const input = jsonObject(request.arguments);
        const query = typeof input.query === "string" ? input.query.trim() : "";
        const title = input.title === true;
        const connectionId =
          typeof input.connectionId === "string" && input.connectionId.trim()
            ? input.connectionId.trim()
            : null;
        if (!query || query.length > 2048 || /[\x00-\x1f\x7f]/.test(query))
          throw new ApiError(400, "bitwarden_search_invalid", "A Bitwarden search query is required");
        if (connectionId && !UUID.test(connectionId))
          throw new ApiError(400, "bitwarden_instance_invalid", "A valid Bitwarden connectionId is required");
        const readyConnections = await this.prisma.pluginConnection.findMany({
          where: {
            connectorKey: "bitwarden",
            status: "ready",
            installation: { pluginKey: "bitwarden", status: "installed" },
            ...(connectionId ? { id: connectionId } : {}),
          },
          select: { id: true },
        });
        if (!readyConnections.length) {
          throw new ApiError(
            409,
            "bitwarden_not_connected",
            connectionId
              ? "The selected Bitwarden instance is not connected."
              : "No Bitwarden instance is connected. Configure and connect an instance in Marketplace first."
          );
        }
        const leaseToken = randomUUID();
        await this.prisma.bitwardenReadApproval.create({
          data: {
            botId: request.botId,
            channelId: request.channelId,
            sourceRunId: request.runId,
            connectionId,
            title: "__search__",
            hostname: title ? "title" : query,
            status: "approved",
            expiresAt: new Date(Date.now() + 30_000),
            leaseTokenHash: createHash("sha256").update(leaseToken).digest("hex"),
            leaseExpiresAt: new Date(Date.now() + 30_000),
          },
        });
        return { leaseToken, title };
      }
      if (request.tool === "RequestBitwardenReadApproval") {
        const input = jsonObject(request.arguments);
        const rawCandidates = Array.isArray(input.candidates) ? input.candidates : [input];
        const candidates = rawCandidates.map(bitwardenCandidate);
        if (!candidates.length || candidates.length > 12)
          throw new ApiError(400, "bitwarden_candidates_required", "Provide one to twelve Bitwarden candidates");
        const uniqueConnectionIds = [...new Set(candidates.map((candidate) => candidate.connectionId))];
        const readyConnections = await this.prisma.pluginConnection.findMany({
          where: {
            id: { in: uniqueConnectionIds },
            connectorKey: "bitwarden",
            status: "ready",
            installation: { pluginKey: "bitwarden", status: "installed" },
          },
          select: { id: true, alias: true },
        });
        const aliasMap = new Map(readyConnections.map((connection) => [connection.id.toLowerCase(), connection.alias]));
        if (uniqueConnectionIds.some((id) => !aliasMap.has(id.toLowerCase()))) {
          throw new ApiError(409, "bitwarden_not_connected", "One or more Bitwarden instances are not connected.");
        }
        const enriched = candidates.map((candidate) => ({
          ...candidate,
          instanceName: aliasMap.get(candidate.connectionId.toLowerCase())!,
        }));
        if (outcomeRun) {
          // No chat widget exists here: the owner answers a step approval that stays valid for the whole Outcome.
          const handler = this.outcomeThreadTools.RequestBitwardenReadApproval;
          if (!handler)
            throw new ApiError(503, "outcome_credential_approval_unavailable", "Bitwarden step approvals have not been registered");
          return handler(
            { ...request, arguments: { candidates: enriched } },
            { runId: run.id, workItemId: run.outcomeWorkItemId!, botId: run.botId },
          );
        }
        const single = enriched.length === 1 ? enriched[0]! : null;
        const approval = await this.prisma.bitwardenReadApproval.create({
          data: {
            botId: request.botId,
            channelId: request.channelId,
            sourceRunId: request.runId,
            connectionId: single ? single.connectionId : null,
            instanceName: single ? single.instanceName : "Multiple Bitwarden instances",
            candidates: single ? Prisma.DbNull : toJson(enriched),
            itemId: single ? single.itemId : null,
            title: single ? single.title : "Multiple Bitwarden items",
            hostname: single ? single.hostname : "Multiple hostnames",
            expiresAt: new Date(Date.now() + 15 * 60_000),
          },
        });
        let linked = false;
        try {
          const sent = await this.messaging.sendVisible(context, {
            type: "widget",
            end_turn: true,
            widget: {
              prompt: single
                ? `Allow reading the Bitwarden item "${single.title}" (${single.instanceName}) for ${single.hostname}?`
                : "Which Bitwarden item may be read for this task?",
              helpText: "This permission applies to this item in the selected instance for the current task and expires in 15 minutes.",
              options: enriched.map((candidate) => ({
                label: `${candidate.title} - ${candidate.hostname} (${candidate.instanceName})`,
                value: `${candidate.connectionId}:${candidate.itemId}`,
              })),
            },
          }, async (tx, messageId) => {
            await tx.bitwardenReadApproval.update({
              where: { id: approval.id },
              data: { widgetMessageId: messageId },
            });
            // A publication callback suppresses the default notice for external
            // delivery. This owner approval still needs its original notice.
            await publishMessageNotification(
              tx, await tx.channelMessage.findUniqueOrThrow({ where: { id: messageId } }),
            );
            linked = true;
          });
          const messageId = sent.acknowledgement && typeof sent.acknowledgement === "object" && typeof sent.acknowledgement.message_id === "string"
            ? sent.acknowledgement.message_id : null;
          if (!messageId || !linked) throw new Error("Bitwarden approval widget was not persisted");
          return { sent: true, waiting_for_user: true };
        } catch (error) {
          await this.prisma.bitwardenReadApproval.update({ where: { id: approval.id }, data: { status: "denied" } }).catch(() => undefined);
          throw error;
        }
      }
      if (request.tool === "ReadBitwardenCredential") {
        const input = jsonObject(request.arguments);
        const itemId = typeof input.itemId === "string" ? input.itemId : "";
        const connectionId =
          typeof input.connectionId === "string" && input.connectionId.trim()
            ? input.connectionId.trim()
            : null;
        const field = input.field;
        if (!UUID.test(itemId) || !["username", "password", "totp"].includes(String(field)))
          throw new ApiError(400, "bitwarden_read_invalid", "A Bitwarden itemId and field are required");
        if (connectionId && !UUID.test(connectionId))
          throw new ApiError(400, "bitwarden_read_invalid", "The Bitwarden connectionId is invalid");
        let approvedConnectionId: string;
        if (outcomeRun) {
          const grant = await findOutcomeCredentialGrant(this.prisma, run.outcomeWorkItemId!, itemId, connectionId);
          if (!grant)
            throw new ApiError(
              403,
              "bitwarden_read_not_approved",
              "The owner has not approved reading this Bitwarden item for this goal. Call RequestBitwardenReadApproval with its connectionId and itemId, then wait for the next turn.",
            );
          approvedConnectionId = grant.connectionId;
        } else {
          const payload = run.inboxEvents[0]?.payload as Record<string, unknown> | undefined;
          const reference = approvalReference(payload?.content);
          if (!reference) throw new ApiError(403, "bitwarden_read_not_approved", "User approval is required before reading this Bitwarden item");
          const approval = await this.prisma.bitwardenReadApproval.findUnique({ where: { id: reference } });
          if (approval?.status === "approved" && approval.expiresAt <= new Date()) {
            await this.prisma.bitwardenReadApproval.update({ where: { id: approval.id }, data: { status: "expired" } });
          }
          if (
            !approval ||
            approval.botId !== request.botId ||
            approval.channelId !== request.channelId ||
            approval.status !== "approved" ||
            !approval.connectionId ||
            approval.itemId?.toLowerCase() !== itemId.toLowerCase() ||
            (connectionId && approval.connectionId.toLowerCase() !== connectionId.toLowerCase()) ||
            approval.expiresAt <= new Date()
          )
            throw new ApiError(403, "bitwarden_read_not_approved", "User approval is missing, expired, or for a different Bitwarden item or instance");
          approvedConnectionId = approval.connectionId!;
        }
        const readyConnection = await this.prisma.pluginConnection.findFirst({
          where: {
            id: approvedConnectionId,
            connectorKey: "bitwarden",
            status: "ready",
            installation: { pluginKey: "bitwarden", status: "installed" },
          },
          select: { id: true },
        });
        if (!readyConnection) {
          throw new ApiError(409, "bitwarden_not_connected", "The approved Bitwarden instance is no longer connected.");
        }
        const leaseToken = randomUUID();
        await this.prisma.bitwardenReadApproval.create({
          data: {
            botId: request.botId,
            channelId: request.channelId,
            sourceRunId: request.runId,
            connectionId: approvedConnectionId,
            itemId,
            title: "__lease__",
            hostname: String(field),
            status: "approved",
            expiresAt: new Date(Date.now() + 30_000),
            leaseTokenHash: createHash("sha256").update(leaseToken).digest("hex"),
            leaseExpiresAt: new Date(Date.now() + 30_000),
          },
        });
        return { leaseToken, connectionId: approvedConnectionId };
      }
      if (request.tool === "ConsumeBitwardenReadLease") {
        const input = jsonObject(request.arguments);
        const leaseToken = typeof input.leaseToken === "string" ? input.leaseToken : "";
        if (!leaseToken || leaseToken.length > 100) throw new ApiError(400, "bitwarden_lease_invalid", "The Bitwarden read lease is invalid");
        const leaseHash = createHash("sha256").update(leaseToken).digest("hex");
        const environment = await this.prisma.$transaction(async (tx) => {
          const approval = await tx.bitwardenReadApproval.findFirst({
            where: {
              leaseTokenHash: leaseHash,
              botId: request.botId,
              channelId: request.channelId,
              status: "approved",
              title: "__lease__",
              leaseExpiresAt: { gt: new Date() },
            },
          });
          if (!approval || !approval.connectionId)
            throw new ApiError(403, "bitwarden_lease_invalid", "The Bitwarden read lease is invalid or expired");
          await tx.bitwardenReadApproval.delete({ where: { id: approval.id } });
          const connection = await tx.pluginConnection.findFirst({
            where: {
              id: approval.connectionId,
              connectorKey: "bitwarden",
              status: "ready",
              installation: { pluginKey: "bitwarden", status: "installed" },
            },
          });
          if (!connection)
            throw new ApiError(409, "bitwarden_not_connected", "The Bitwarden instance is no longer connected");
          return bitwardenInstanceEnvironment(connection);
        });
        return { environment };
      }
      if (request.tool === "ConsumeBitwardenSearchLease") {
        const input = jsonObject(request.arguments);
        const leaseToken = typeof input.leaseToken === "string" ? input.leaseToken : "";
        const leaseHash = createHash("sha256").update(leaseToken).digest("hex");
        const instances = await this.prisma.$transaction(async (tx) => {
          const approval = await tx.bitwardenReadApproval.findFirst({
            where: {
              leaseTokenHash: leaseHash,
              botId: request.botId,
              channelId: request.channelId,
              status: "approved",
              itemId: null,
              title: "__search__",
              leaseExpiresAt: { gt: new Date() },
            },
          });
          if (!approval) throw new ApiError(403, "bitwarden_lease_invalid", "The Bitwarden search lease is invalid or expired");
          await tx.bitwardenReadApproval.delete({ where: { id: approval.id } });
          const connections = await tx.pluginConnection.findMany({
            where: {
              connectorKey: "bitwarden",
              status: "ready",
              installation: { pluginKey: "bitwarden", status: "installed" },
              ...(approval.connectionId ? { id: approval.connectionId } : {}),
            },
            orderBy: { createdAt: "asc" },
          });
          if (!connections.length)
            throw new ApiError(409, "bitwarden_not_connected", "No Bitwarden instance is connected");
          return connections.map((connection) => ({
            connectionId: connection.id,
            instanceName: connection.alias,
            environment: bitwardenInstanceEnvironment(connection),
          }));
        });
        return { instances };
      }
      if (backgroundRun && AUTOMATION_PARENT_ONLY_TOOLS.has(request.tool)) {
        throw new ApiError(403, "automation_tool_forbidden", AUTOMATION_RUN_VISIBLE_TRANSCRIPT_BLOCKED);
      }
      request={...request,arguments:normalizeMainToolArguments(request.tool,request.arguments)};
      if (request.tool === "ReportRequestProgress") {
        if (childIdentity || backgroundRun) throw new ApiError(403, "request_progress_unavailable", "Only the user-facing parent may track a request");
        const result = await reportRequestProgress(this.prisma, context, Schema.decodeUnknownSync(RequestProgressInput)(request.arguments));
        return { ...(result as Record<string, unknown>), requests: await requestProgressSnapshot(this.prisma, request.botId, request.channelId) };
      }
      if (request.tool === "ReportTaskProgress") {
        if (!childIdentity) throw new ApiError(403, "task_progress_unavailable", "Only a delegated worker may report task progress");
        return reportTaskProgress(this.prisma, this.messaging, context, Schema.decodeUnknownSync(TaskProgressInput)(request.arguments));
      }
      if (request.tool === "WakeParent") {
        if (childIdentity) throw new ApiError(403, "wake_parent_unavailable", "Only the automation itself can wake its parent");
        const woken = await wakeAutomationParent(this.messaging, context, Schema.decodeUnknownSync(WakeParentInput)(request.arguments));
        // The handoff ends the automation, so the subagents it started stop with it.
        const children = await this.prisma.subagent.findMany({
          where: { parentBotId: request.botId, parentRunId: { in: woken.automation_run_ids }, status: { in: ["provisioning", "queued", "running", "waiting"] } },
          select: { id: true },
        });
        await Promise.allSettled(children.map((child) => this.subagents.stop(request.botId, request.callId, { subagent_id: botSubagentId(child.id) })));
        return woken;
      }
      if (backgroundRun && request.tool !== "AcknowledgeCardOutcomes" &&
        (await this.prisma.automationResult.findUnique({ where: { runId: run.origin === "outcome" ? run.id : automationContextRunId(run.id, inboxPayload) }, select: { wakeRunId: true } }))?.wakeRunId) {
        throw new ApiError(409, "automation_turn_ended", "This automation already handed control to its parent");
      }
      if (request.tool === "PrepareConnectorTransfer" || request.tool === "ExecuteConnectorTransfer") {
        const args = request.arguments as Record<string, unknown>;
        if (childIdentity && !subagentUsesParentConnectors(childIdentity.subagentType))
          throw new ApiError(403, "parent_transfer_required", "This file transfer must be performed by the parent bot");
        return request.tool === "PrepareConnectorTransfer" ? this.plugins.fileTransfers.prepare(context, args) : this.plugins.fileTransfers.execute(context, args, signal, transfer);
      }
      if (request.tool === "AcknowledgeCardOutcomes") {
        await this.messaging.acknowledgeCardOutcomes(request.botId, (request.arguments as { receipts: Array<{ messageId: string; outcomeId: string }> }).receipts);
        return { acknowledged: true };
      }
      if (request.tool === "UpdateComputerNetworkPolicy") {
        if (childIdentity || backgroundRun)
          throw new ApiError(403, "computer_network_policy_bot_forbidden", "Only an owner bot can request a firewall change.");
        if (!this.computerNetworkPolicy)
          throw new ApiError(503, "computer_network_policy_unavailable", "Firewall policy control is unavailable.");

        const dmChannel = await this.prisma.channel.findUnique({
          where: { directKey: `bot:${request.botId}` },
          select: { id: true, kind: true, archivedAt: true },
        });
        if (!dmChannel || dmChannel.kind !== "bot_dm" || dmChannel.archivedAt)
          throw new ApiError(409, "computer_network_policy_approval_unavailable", "The bot's owner chat is unavailable for approval.");

        const input = request.arguments && typeof request.arguments === "object" && !Array.isArray(request.arguments)
          ? request.arguments as Record<string, unknown> : {};
        const approvalId = input.approvalId;
        if (approvalId !== undefined && (typeof approvalId !== "string" || !UUID.test(approvalId) || Object.keys(input).length !== 1))
          throw new ApiError(400, "computer_network_policy_approval_invalid", "Pass only a valid approvalId to continue a firewall request.");

        const prepared = approvalId === undefined
          ? await this.computerNetworkPolicy.prepareBotRequest(input) : null;
        const approval = prepared
          ? await this.prisma.computerNetworkPolicyApproval.upsert({
              where: { sourceRunId_sourceCallId: { sourceRunId: request.runId, sourceCallId: request.callId } },
              create: {
                botId: request.botId,
                channelId: dmChannel.id,
                sourceRunId: request.runId,
                sourceCallId: request.callId,
                expectedRevision: prepared.expectedRevision,
                mode: prepared.mode,
                rules: prepared.rules as unknown as Prisma.InputJsonValue,
                expiresAt: new Date(Date.now() + 15 * 60_000),
              },
              update: {},
            })
          : await this.prisma.computerNetworkPolicyApproval.findFirst({
              where: { id: String(approvalId), botId: request.botId, channelId: dmChannel.id },
            });
        if (!approval || approval.consumedAt || ["denied", "expired"].includes(approval.status))
          throw new ApiError(403, "computer_network_policy_approval_invalid", "The firewall request is missing, denied, expired, or already used.");
        if (approval.expiresAt <= new Date()) {
          await this.prisma.computerNetworkPolicyApproval.updateMany({
            where: { id: approval.id, consumedAt: null }, data: { status: "expired" },
          });
          throw new ApiError(403, "computer_network_policy_approval_invalid", "The firewall request expired. Request a new policy verification.");
        }
        if (prepared) {
          const destinations = (value: unknown) => JSON.stringify((value as Array<{address: string; port: number | string; label?: string | null}>).map(
            ({ address, port, label }) => ({ address, port, label: label ?? null })
          ));
          if (approval.mode !== prepared.mode || destinations(approval.rules) !== destinations(prepared.rules))
            throw new ApiError(409, "computer_network_policy_request_conflict", "This tool call already requested a different firewall policy.");
        }
        if (approval.status === "approved")
          return this.computerNetworkPolicy.applyApproved(approval.id, request.botId, dmChannel.id);
        const verification = approval.status === "verification_pending";
        const waiting = {
          sent: true,
          waiting_for_user: true,
          ...(verification ? { waiting_for_verification: true } : { waiting_for_approval: true }),
          approvalId: approval.id,
          expectedRevision: approval.expectedRevision,
          instruction: "Stop this turn and wait for the user to answer the card.",
        };
        if (approval.widgetMessageId) return waiting;
        const ruleText = (approval.rules as unknown as Array<{address: string; port: number | string; label?: string | null}>)
          .map((rule) => `- ${rule.address} TCP ${rule.port}${rule.label ? ` (${rule.label})` : ""}`).join("\n") || "- none";
        const impact = approval.mode === "lan"
          ? "LAN access permits all private TCP destinations."
          : "Only the listed private TCP destinations, model endpoints, and system management exceptions remain reachable.";
        await this.messaging.sendVisible(
          { ...context, channelId: dmChannel.id, replyToMessageId: null, isFork: false,
            callId: `firewall:${approval.id}:${verification ? "verify" : "approve"}` },
          {
            type: "widget",
            end_turn: true,
            widget: {
              prompt: verification
                ? `Verify this exact cloud computer firewall policy in ${approval.mode} mode.`
                : `Approve this cloud computer firewall change to ${approval.mode} mode?`,
              helpText: `${impact} Public traffic continues through the managed exit. Revision ${approval.expectedRevision}; expires at ${approval.expiresAt.toISOString()}. ${verification ? "Verification does not apply the policy; a separate approval card follows." : "Approval authorizes only this exact policy. Existing connections may be interrupted."} Rules:\n${ruleText}`,
              options: verification
                ? [{ label: "Verify policy", value: "verify", style: "default" }, { label: "Cancel", value: "deny", style: "default" }]
                : [{ label: "Approve firewall change", value: "approve", style: "danger" }, { label: "Deny", value: "deny", style: "default" }],
            },
          },
          async (tx, messageId) => {
            const bound = await tx.computerNetworkPolicyApproval.updateMany({
              where: { id: approval.id, status: approval.status, widgetMessageId: null, expiresAt: { gt: new Date() } },
              data: { widgetMessageId: messageId },
            });
            if (!bound.count)
              throw new ApiError(409, "computer_network_policy_request_conflict", "The firewall request changed before its card was published.");
          }
        );
        return waiting;
      }

      // Private to the computer: a finished sentence of a SendToUser message still being written, spoken at once.
      if (request.tool === "VoiceSpeak") {
        if (childIdentity || backgroundRun) throw new ApiError(403, "speech_unavailable", "Only the user-facing parent may speak");
        const input = (request.arguments ?? {}) as { callId?: unknown; text?: unknown };
        if (typeof input.callId !== "string" || typeof input.text !== "string" || !input.text.trim()) throw new ApiError(400, "invalid_speech", "A call id and text are required");
        return { spoken: this.onSpeechChunk ? await this.onSpeechChunk(request.runId, input.callId, input.text.slice(0, 2_000)) : false };
      }
      // Private to the computer's narrator, never registered in any model catalog.
      if (request.tool === "VoiceNarration") {
        if (childIdentity || backgroundRun) throw new ApiError(403, "narration_unavailable", "Only the user-facing parent may narrate");
        const text = (request.arguments as { text?: unknown } | null)?.text;
        if (typeof text !== "string") throw new ApiError(400, "invalid_narration", "Narration text is required");
        const { acknowledgement } = await this.messaging.sendNarration(context, text);
        const messageId = typeof acknowledgement === "object" ? acknowledgement.message_id : undefined;
        // The persisted chat message is authoritative; the voice session speaks it through the same path as an answer.
        if (typeof messageId === "string" && this.onVisibleMessage) await this.onVisibleMessage(request.runId, messageId).catch(() => undefined);
        return typeof acknowledgement === "object" ? acknowledgement : { sent: true };
      }
      if (request.tool === "RecordUserFormRemap" && !childIdentity && this.richMessages) {
        return this.richMessages.recordFormRemap(request.botId, request.arguments as import("@outcomego/contracts").UserFormReceipt);
      }
      const parentOnlyTools = new Set([
        "DraftExternalMessage", "CreateBotShareJson", "SendIMessage",
        "RequestUserForm",
        "RemapUserFormTargets",
        "RecallMemory",
        "ReadTranscript",
        "ReadAgentActivity",
        "ListSections",
        "Task",
        "CheckSubagent",
        "MessageSubagent",
        "StopSubagent",
        "CreateAgent",
        "UpdateAgent",
        "CreateChannel",
        "UpdateChannel",
        "SendToAgent",
        "SearchPlugins",
        "GetPlugin",
        "GetMcpServerStatus",
        "InstallPlugin",
        "UninstallPlugin",
        "AddMcpServer",
        "UninstallMcpServer",
        "AuthenticateMcpServer",
        "RestartMcpServers",
        "RenameMcpAccount",
        "RemoveMcpAccount",
        "request_box_help",
        "SetMcpInstructions",
      ]);
      if (childIdentity && parentOnlyTools.has(request.tool)) {
        throw new ApiError(403, "subagent_tool_forbidden", "This tool is parent-agent only");
      }
      if (request.tool === "ReadTranscript") return readTranscript(this.prisma, context, request.arguments);
      if (request.tool === "ReadAgentActivity") return readAgentActivity(this.prisma, { botId: childIdentity?.parentBotId ?? request.botId }, request.arguments);
      if (request.tool === "RecallMemory") {
        return this.messaging.agentData.recallMemory(request.botId, request.arguments, run.channelId);
      }
      if (request.tool === "CreateBotShareJson") {
        if (!this.richMessages) throw new Error("Review service unavailable");
        return this.richMessages.sharedTemplates.publish(context, request.arguments);
      }
      if (request.tool === "DraftExternalMessage") {
        if (!this.richMessages) throw new Error("Draft service unavailable");
        return this.richMessages.externalDrafts.create(context, request.arguments);
      }
      if (request.tool === "SendIMessage") {
        if (!this.richMessages?.messagesSends) throw new Error("Messages sending is unavailable");
        return this.richMessages.messagesSends.create(context, request.arguments);
      }
      if (request.tool === "RequestUserForm") {
        if (!this.richMessages) throw new Error("User form service is unavailable");
        return this.richMessages.createUserForm(context, request.arguments);
      }
      if (request.tool === "ListSections") {
        const sections = await this.messaging.agentData.listSections();
        return sections.length ? sections.map((section) => `- ${section.name} (id: ${section.id})`).join("\n")
          : "If there are no custom sections, CreateAgent should omit section_id.";
      }
      if (request.tool === "SearchPlugins") {
        const input =
          request.arguments && typeof request.arguments === "object"
            ? (request.arguments as Record<string, unknown>)
            : {};
        return this.plugins.searchCatalog(typeof input.query === "string" ? input.query : "");
      }
      if (request.tool === "GetPlugin") {
        const input =
          request.arguments && typeof request.arguments === "object"
            ? (request.arguments as Record<string, unknown>)
            : {};
        const pluginKey = input.plugin_id ?? input.pluginKey;
        if (typeof pluginKey !== "string") {
          throw new ApiError(400, "plugin_key_required", "pluginKey is required");
        }
        return this.plugins.catalogDetail(pluginKey);
      }
      if (request.tool === "GetMcpServerStatus") {
        const input =
          request.arguments && typeof request.arguments === "object"
            ? (request.arguments as Record<string, unknown>)
            : {};
        const resolved = await this.plugins.resolveToolArguments(request.tool, input).catch((error) => {
          // An unknown server_id is answered by the listing formatter, as in the reference.
          if (error instanceof ApiError && error.code === "connection_not_found") return null;
          throw error;
        });
        if (!resolved) return { connections: [] };
        return this.plugins.connectionStatuses(typeof resolved.connectionId === "string" ? resolved.connectionId : undefined);
      }
      if (
        [
          "InstallPlugin",
          "UninstallPlugin",
          "AddMcpServer",
          "UninstallMcpServer",
          "AuthenticateMcpServer",
          "RestartMcpServers",
          "RenameMcpAccount",
          "RemoveMcpAccount",
          "SetMcpInstructions",
        ].includes(request.tool)
      ) {
        return this.plugins.requestAction({
          runId: request.runId,
          botId: request.botId,
          callId: request.callId,
          action: request.tool,
          arguments: request.arguments,
          origin: run.origin,
        }, signal);
      }
      if (request.tool === "PluginCall") {
        const input =
          request.arguments && typeof request.arguments === "object"
            ? (request.arguments as Record<string, unknown>)
            : {};
        if (typeof input.connectionId !== "string" || typeof input.toolName !== "string") {
          throw new ApiError(400, "invalid_plugin_call", "Plugin call is missing identifiers");
        }
        return withConnectorDraftCardReminder(this.prisma, { connectionId: input.connectionId, toolName: input.toolName }, !childIdentity && !backgroundRun, await this.plugins.invoke({
          connectionId: input.connectionId,
          namespace: typeof input.namespace === "string" ? input.namespace : undefined,
          botId:
            subagentUsesParentConnectors(childIdentity?.subagentType) ? childIdentity!.parentBotId : request.botId,
          runId: request.runId,
          callId: request.callId,
          toolName: input.toolName,
          arguments: input.arguments ?? {},
        }, signal));
      }
      if (isStateTool(request.tool)) {
        const result = await this.durableState.executeTool(
          request.botId,
          request.callId,
          request.tool,
          request.arguments,
          request.runId
        );
        return formatMemoryToolResult(result);
      }
      if (request.tool === "ReactToMessage") {
        return this.messaging.reactToMessage(
          context,
          Schema.decodeUnknownSync(ReactToMessageInput)(request.arguments)
        );
      }
      if (request.tool === "TodoWrite") {
        return this.todos.write(
          request.botId,
          request.callId,
          Schema.decodeUnknownSync(TodoWriteInput)(request.arguments)
        );
      }
      if (request.tool === "Task") {
        return this.subagents.task(context, Schema.decodeUnknownSync(TaskInput)(request.arguments));
      }
      if (request.tool === "CheckSubagent") {
        return this.subagents.check(
          request.botId,
          Schema.decodeUnknownSync(CheckSubagentInput)(request.arguments)
        );
      }
      if (request.tool === "MessageSubagent") {
        return this.subagents.message(
          request.botId,
          request.callId,
          Schema.decodeUnknownSync(MessageSubagentInput)(request.arguments)
        );
      }
      if (request.tool === "StopSubagent") {
        return this.subagents.stop(
          request.botId,
          request.callId,
          Schema.decodeUnknownSync(StopSubagentInput)(request.arguments),
          context.runId
        );
      }
      if (request.tool === "CreateAgent") {
        return this.administration.createAgent(
          request.botId,
          request.callId,
          Schema.decodeUnknownSync(CreateAgentInput)(request.arguments)
        );
      }
      if (request.tool === "UpdateAgent") {
        return this.administration.updateAgent(
          request.botId,
          request.callId,
          Schema.decodeUnknownSync(UpdateAgentInput)(request.arguments)
        );
      }
      if (request.tool === "CreateChannel") {
        return this.administration.createChannel(
          request.botId,
          request.callId,
          Schema.decodeUnknownSync(CreateChannelInput)(request.arguments)
        );
      }
      if (request.tool === "UpdateChannel") {
        return this.administration.updateChannel(
          request.botId,
          request.callId,
          Schema.decodeUnknownSync(UpdateChannelInput)(request.arguments)
        );
      }
      if (request.tool === "request_box_help") {
        const input = Schema.decodeUnknownSync(RequestBoxHelpInput)(request.arguments);
        const reason = input.instruction ?? (input.reason && !["auth", "captcha", "payment", "other"].includes(input.reason)
          ? input.reason : "Please complete the manual step on the computer.");
        const result = await this.messaging.sendVisible(context, {
          type: "computer-handoff",
          content: reason,
          computerHandoff: { reason, ...(input.reason ? { category: ["auth", "captcha", "payment", "other"].includes(input.reason) ? input.reason : "other" } : {}),
            ...(input.domain ? { domain: input.domain } : {}), ...(input.idp_domain ? { idpDomain: input.idp_domain } : {}) },
        });
        return {
          sent: true,
          acknowledgement: result.acknowledgement,
          waiting_for_user: true,
          instruction: "Stop this turn. You will be resumed when the user finishes or skips.",
        };
      }
      let result;
      if (request.tool === "SendToAgent") {
        result = await this.messaging.sendToAgent(
          context,
          Schema.decodeUnknownSync(SendToAgentInput)(request.arguments)
        );
      } else if (request.tool === "SendToUser") {
        validateSendToUserInput(request.arguments);
        const input = Schema.decodeUnknownSync(AgentSendToUserInput)(request.arguments);
        // A turn that began as a message from an outside chat (WeChat, ...) answers there. The chat
        // itself is the Bot's own, so cards, forms and requests simply land in the app as usual.
        const externalOrigin = input.channel ? null : await this.externalOriginOf(request.runId);
        if (input.type === "secret-request" && input.secret?.name) {
          validateProcessSecretName(input.secret.name);
          if (input.channel || childIdentity || !await this.prisma.channel.count({ where: { id: request.channelId, kind: "bot_dm", directKey: `bot:${request.botId}`, archivedAt: null } }))
            throw new ApiError(403, "secret_owner_dm_required", "Ask for this secret only in the owner's bot DM");
        }
        // `platform:peer` on a messaging connector goes through the delivery service; only text and files can.
        const addressed = input.channel && this.externalDelivery && (input.type === "text" || input.type === "attachment")
          ? await this.externalDelivery.resolveAddress(request.botId, input.channel)
          : null;
        if (externalOrigin && input.to !== "dm" && this.externalDelivery && (input.type === "text" || input.type === "attachment")) {
          result = this.externalAck(await this.externalDelivery.send({ context, input, mappingId: externalOrigin }));
        } else if (!input.channel) {
          result = await this.messaging.sendVisible(context, input);
          const messageId = result && typeof result === "object" && "acknowledgement" in result && result.acknowledgement && typeof result.acknowledgement === "object" && "message_id" in result.acknowledgement && typeof result.acknowledgement.message_id === "string" ? result.acknowledgement.message_id : null;
          if (messageId) this.replyPreviews?.commit(context.channelId, context.runId, context.callId);
          if (messageId && this.onVisibleMessage) await this.onVisibleMessage(request.runId, messageId).catch(() => undefined);
        } else if (addressed) {
          // A messaging platform: the same delivery service and the same honest result as an automatic reply.
          result = this.externalAck(await this.externalDelivery!.send({ context, input: { ...input, channel: undefined }, mappingId: addressed.mappingId }));
        } else {
          const content = input.type === "text" ? input.content ?? "" : input.alt ?? "";
          const sources = input.type === "text" ? input.images ?? [] : input.type === "attachment" ? [{url:input.url!,alt:input.alt}] : [];
          try {
            const files = await Promise.all(sources.map(async source => {
              const asset = await this.messaging.assets.ingestSource(source);
              return {assetId:asset.assetId,name:asset.fileName,mimeType:asset.mimeType,bytes:Buffer.from(await Bun.file(this.messaging.assets.contentPath(asset.assetId)).arrayBuffer())};
            }));
            const address = input.channel;
            if (context.origin === "background_revival") {
              const receipt = await this.prisma.pluginInvocation.findUnique({
                where: { callId: `connected-channel:${request.callId}` },
                select: { status: true, botId: true, runId: true },
              });
              if (receipt?.status !== "completed" || receipt.botId !== request.botId || receipt.runId !== request.runId)
                await this.prisma.$transaction(tx => assertBackgroundRequestDeliveryAllowed(tx, context));
            }
            const delivery = await this.plugins.deliverConnectedChannel({
              botId: request.botId,
              runId: request.runId,
              callId: request.callId,
              address,
              content,
              files,
            });
            result = {
              acknowledgement: {
                sent: true,
                channel: input.channel,
                connection_id: delivery.connectionId,
                tool: delivery.toolName,
              },
              interruptRunId: null,
            };
          } catch (error) {
            if (error instanceof ApiError && ["request_stopped", "tool_context_invalid"].includes(error.code)) throw error;
            if(error instanceof ApiError&&error.code==="external_file_review_required")throw error;
            // Nothing left the box for these, so refuse now with the reason.
            if (error instanceof ApiError && error.code === "connected_channel_address_invalid")
              throw new ApiError(400, error.code, `"${input.channel}" is not a valid channel address, so nothing was sent. An address is shaped platform:chat.`);
            if (error instanceof ApiError && ["connected_channel_unavailable", "connected_channel_ambiguous", "connected_channel_delivery_unsupported"].includes(error.code))
              throw new ApiError(error.status, error.code, `${error.message}. Nothing was sent.`);
            const recoveryRunId = await this.messaging.enqueueChannelDeliveryFailure(
              context,
              input.channel,
              error
            );
            result = {
              acknowledgement: {
                sent: false,
                channel: input.channel,
                delivery_failed: true,
                reason: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
                recovery_run_id: recoveryRunId,
              },
              interruptRunId: null,
            };
          }
        }
      } else {
        throw new ApiError(400, "unknown_dynamic_tool", `Unknown tool ${request.tool}`);
      }
      if (result.interruptRunId) await this.interruptNonUserRun(result.interruptRunId);
      return result.acknowledgement;
    });
}
