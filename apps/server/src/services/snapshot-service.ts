import { notificationRouting, channelNotificationStates } from "@outcomego/messaging";
import {
  ApiError,
  type ChannelClientState,
  type ChannelHistoryPage,
  type ChatBranchPage,
  type ChannelMessageContextView,
  CLIENT_CAPABILITIES,
  type ClientBootstrapView,
  type ClientRuntimeView,
  type ClientSnapshot,
  type ServerInferenceSettings,
  type Snapshot,
} from "@outcomego/contracts";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { serviceEffect } from "./service-utils";
import {
  channelUnreadCounts,
  type StoredChannelMessage,
  threadContextFor,
} from "./snapshot/message-queries";
import { clientBots, clientChannels } from "./snapshot/roster-queries";
import { RuntimeHealth } from "./snapshot/runtime-health";
import { channelViews, messageViews, roundViews, runViews, workspaceView } from "./snapshot/views";
import { subagentActivityView } from "./subagent/view";
import { toBotView } from "./view-mappers";
import { pendingOutcomeEvidenceEventSql } from "./outcome-event-retention";

const DEFAULT_HISTORY_LIMIT = 100;

const MAX_HISTORY_LIMIT = 200;

const DEFAULT_CONTEXT_EXTENT = 50;

const MAX_CONTEXT_EXTENT = 100;

const EVENT_BATCH_SIZE = 500;

const MAX_RETAINED_EVENTS = 100_000;

export const CHANNEL_CLIENT_STATE_LIMITS = {
  channelRounds: 100,
  runs: 100,
  runItems: 1_000,
  subagents: 100,
} as const;

export const normalizeHistoryLimit = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.trunc(value)))
    : DEFAULT_HISTORY_LIMIT;

export const normalizeMessageContextExtent = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(MAX_CONTEXT_EXTENT, Math.max(0, Math.trunc(value)))
    : DEFAULT_CONTEXT_EXTENT;

export const selectBoundedActivity = <T extends { id: string; createdAt: Date }>(
  current: readonly T[],
  recent: readonly T[],
  limit: number
): { items: T[]; truncated: boolean } => {
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const item of [...current, ...recent]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (selected.length < limit) selected.push(item);
  }
  return {
    items: selected.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    truncated: seen.size > limit,
  };
};

export class SnapshotService {
  private readonly runtimeHealth: RuntimeHealth;

  private clientInFlight: Promise<ClientSnapshot> | null = null;
  private bootstrapInFlight: Promise<ClientBootstrapView> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly workspaceRoot: string,
    private readonly computerUrl: string,
    private readonly isQueueReady: () => boolean | Promise<boolean>,
    private readonly runtimeProbeTimeoutMs = 10_000,
    private readonly inferenceSettings?: () => Promise<ServerInferenceSettings>,
    transcriptionStatus?: () => Promise<"configured" | "missing" | "invalid">,
    private readonly authMode: "required" | "disabled" = "required"
  ) {
    this.runtimeHealth = new RuntimeHealth(
      prisma,
      computerUrl,
      isQueueReady,
      runtimeProbeTimeoutMs,
      inferenceSettings,
      transcriptionStatus
    );
  }

  full = () =>
    serviceEffect(async (): Promise<Snapshot> => {
      const [
        bots,
        channels,
        channelMessages,
        channelRounds,
        messages,
        runs,
        runItems,
        subagentAttempts,
        cursor,
        runtime,
      ] = await Promise.all([
        this.prisma.bot.findMany({
          include: {
            conversation: true,
            channelMemberships: { include: { channel: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.channel.findMany({
          where: { archivedAt: null },
          include: {
            members: { orderBy: { ordinal: "asc" } },
            externalMapping: { select: { platform: true } },
          },
          orderBy: { updatedAt: "desc" },
        }),
        this.prisma.channelMessage.findMany({ orderBy: { sequence: "asc" } }),
        this.prisma.channelRound.findMany({ orderBy: { createdAt: "asc" } }),
        this.prisma.message.findMany({ orderBy: { createdAt: "asc" } }),
        this.prisma.run.findMany({ orderBy: { createdAt: "asc" } }),
        this.prisma.runItem.findMany({ orderBy: { createdAt: "asc" } }),
        this.prisma.subagentAttempt.findMany({
          include: {
            subagent: { select: { id: true, parentBotId: true, subagentType: true, status: true, currentRunId: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.event.findFirst({
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        }),
        this.runtimeHealth.runtimeStatus(),
      ]);
      const [unreadCounts, lineage] = await Promise.all([
        channelUnreadCounts(
          this.prisma,
          channels.map((channel) => channel.id)
        ),
        this.threadLineage(runs, subagentAttempts),
      ]);
      const globalInference = await this.inferenceSettings?.().catch(() => null) ?? null;
      return {
        cursor: cursor?.sequence.toString() ?? "0",
        notificationRouting: await notificationRouting(this.prisma, this.authMode),
        workspace: workspaceView(this.workspaceRoot),
        bots: bots
          .filter((bot) => bot.conversation)
          .filter((bot) =>
            bot.channelMemberships.some((membership) => membership.channel.kind === "bot_dm")
          )
          .map((bot) => toBotView(bot, globalInference)),
        channels: channelViews(
          channels,
          unreadCounts,
          await channelNotificationStates(
            this.prisma,
            channels.map((channel) => channel.id)
          )
        ),
        channelMessages: messageViews(channelMessages),
        channelRounds: roundViews(channelRounds),
        messages: messages.map((message) => ({
          ...message,
          createdAt: message.createdAt.toISOString(),
          updatedAt: message.updatedAt.toISOString(),
        })),
        runs: runViews(runs, lineage.forkRunIds),
        runItems: runItems.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        subagents: subagentAttempts.map((attempt) =>
          subagentActivityView(attempt, lineage.threadRunIds)
        ),
        runtime,
      } as Snapshot;
    });

  client = () => serviceEffect(() => this.sharedClientSnapshot());

  private async sharedClientSnapshot(): Promise<ClientSnapshot> {
    if (this.clientInFlight) return this.clientInFlight;
    this.clientInFlight = this.loadClientSnapshot().finally(() => {
      this.clientInFlight = null;
    });
    return this.clientInFlight;
  }

  private async loadClientSnapshot(): Promise<ClientSnapshot> {
    const [bots, channels, cursor, runtime] = await Promise.all([
      clientBots(this.prisma),
      clientChannels(this.prisma),
      this.prisma.event.findFirst({
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      }),
      this.runtimeStatusCached(),
    ]);
    const channelIds = channels.map((channel) => channel.id);
    const [channelMessages, channelRounds, runs, subagentAttempts, unreadCounts] =
      await Promise.all([
        this.prisma.channelMessage.findMany({
          where: { channelId: { in: channelIds } },
          orderBy: { sequence: "asc" },
        }),
        this.prisma.channelRound.findMany({
          where: { channelId: { in: channelIds } },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.run.findMany({
          where: { channelId: { in: channelIds } },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.subagentAttempt.findMany({
          where: { parentChannelId: { in: channelIds } },
          include: {
            subagent: { select: { id: true, parentBotId: true, subagentType: true, status: true, currentRunId: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        channelUnreadCounts(this.prisma, channelIds),
      ]);
    const runIds = runs.map((run) => run.id);
    const [runItems, lineage] = await Promise.all([
      this.prisma.runItem.findMany({
        where: { runId: { in: runIds }, kind: { notIn: ["agent_message", "reasoning"] } },
        orderBy: { createdAt: "asc" },
      }),
      this.threadLineage(runs, subagentAttempts),
    ]);
    const globalInference = await this.inferenceSettings?.().catch(() => null) ?? null;
    return {
      cursor: cursor?.sequence.toString() ?? "0",
      notificationRouting: await notificationRouting(this.prisma, this.authMode),
      workspace: workspaceView(this.workspaceRoot),
      bots: bots
        .filter((bot) => bot.conversation)
        .filter((bot) =>
          bot.channelMemberships.some((membership) => membership.channel.kind === "bot_dm")
        )
        .map((bot) => toBotView(bot, globalInference)),
      channels: channelViews(
        channels,
        unreadCounts,
        await channelNotificationStates(
          this.prisma,
          channels.map((channel) => channel.id)
        )
      ),
      channelMessages: messageViews(channelMessages),
      channelRounds: roundViews(channelRounds),
      runs: runViews(runs, lineage.forkRunIds),
      runItems: runItems.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      subagents: subagentAttempts.map((attempt) =>
        subagentActivityView(attempt, lineage.threadRunIds)
      ),
      runtime,
    } as ClientSnapshot;
  }

  /** Small startup surface for clients that load channel history on demand. */
  bootstrap = () => serviceEffect(() => this.sharedClientBootstrap());

  private async sharedClientBootstrap(): Promise<ClientBootstrapView> {
    if (this.bootstrapInFlight) return this.bootstrapInFlight;
    this.bootstrapInFlight = this.loadClientBootstrap().finally(() => {
      this.bootstrapInFlight = null;
    });
    return this.bootstrapInFlight;
  }

  private async loadClientBootstrap(): Promise<ClientBootstrapView> {
    const startCursor = await this.prisma.event.findFirst({
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const [bots, channels, runtime] = await Promise.all([
      clientBots(this.prisma),
      clientChannels(this.prisma),
      this.runtimeStatusCached(),
    ]);
    const channelIds = channels.map((channel) => channel.id);
    const [latestMessages, activeRuns, channelRounds, subagentAttempts, unreadCounts] =
      await Promise.all([
        channelIds.length === 0
          ? Promise.resolve([])
          : this.prisma.$queryRaw<StoredChannelMessage[]>(Prisma.sql`
              SELECT latest.*
              FROM unnest(${channelIds}::uuid[]) AS requested("channelId")
              CROSS JOIN LATERAL (
                SELECT
                  message."id",
                  message."clientId",
                  message."sequence",
                  message."channelId",
                  message."sender",
                  message."senderBotId",
                  message."sourceRunId",
                  message."content",
                  message."metadata",
                  message."createdAt"
                FROM "outcomego_channel_message" AS message
                WHERE message."channelId" = requested."channelId"
                ORDER BY message."sequence" DESC
                LIMIT 1
              ) AS latest
              ORDER BY latest."sequence" ASC
            `),
        this.prisma.run.findMany({
          where: {
            channelId: { in: channelIds },
            OR: [{ status: { in: ["queued", "running"] } }, { requestNextCheckAt: { not: null }, requestStoppedAt: null }],
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.channelRound.findMany({
          where: {
            channelId: { in: channelIds },
            status: { in: ["queued", "running"] },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.subagentAttempt.findMany({
          where: {
            parentChannelId: { in: channelIds },
            status: { in: ["provisioning", "queued", "running", "waiting"] },
          },
          include: {
            subagent: { select: { id: true, parentBotId: true, subagentType: true, status: true, currentRunId: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        channelUnreadCounts(this.prisma, channelIds),
      ]);
    const [globalInference, lineage] = await Promise.all([
      this.inferenceSettings?.().catch(() => null) ?? Promise.resolve(null),
      this.threadLineage(activeRuns, subagentAttempts),
    ]);
    return {
      cursor: startCursor?.sequence.toString() ?? "0",
      notificationRouting: await notificationRouting(this.prisma, this.authMode),
      workspace: workspaceView(this.workspaceRoot),
      bots: bots
        .filter((bot) => bot.conversation)
        .filter((bot) =>
          bot.channelMemberships.some((membership) => membership.channel.kind === "bot_dm")
        )
        .map((bot) => toBotView(bot, globalInference)),
      channels: channelViews(
        channels,
        unreadCounts,
        await channelNotificationStates(
          this.prisma,
          channels.map((channel) => channel.id)
        )
      ),
      latestMessages: messageViews(latestMessages),
      activeRuns: runViews(activeRuns, lineage.forkRunIds),
      channelRounds: roundViews(channelRounds),
      subagents: subagentAttempts.map((attempt) =>
        subagentActivityView(attempt, lineage.threadRunIds)
      ),
      runtime,
      capabilities: CLIENT_CAPABILITIES,
    };
  }

  history = (channelId: string, beforeSequence: bigint | null, requestedLimit: number) =>
    serviceEffect(async (): Promise<ChannelHistoryPage> => {
      const channel = await this.prisma.channel.findFirst({
        where: {
          id: channelId,
          archivedAt: null,
          members: {
            some: {
              bot: {
                status: { not: "archived" },
                subagentIdentity: { is: null },
              },
            },
          },
        },
        select: { id: true },
      });
      if (!channel) throw new ApiError(404, "channel_not_found", "Channel not found");
      const limit = normalizeHistoryLimit(requestedLimit);
      const [rows, revision] = await Promise.all([
        this.prisma.channelMessage.findMany({
          where: {
            channelId,
            ...(beforeSequence === null ? {} : { sequence: { lt: beforeSequence } }),
          },
          orderBy: { sequence: "desc" },
          take: limit + 1,
        }),
        this.prisma.event.findFirst({
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        }),
      ]);
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse();
      const threadContext = await threadContextFor(this.prisma, channelId, messages);
      return {
        channelId,
        messages: messageViews(messages),
        threadContext: messageViews(threadContext.messages),
        threadContextTruncated: threadContext.truncated,
        beforeSequence: messages[0]?.sequence.toString() ?? null,
        hasMore,
        revision: revision?.sequence.toString() ?? "0",
      };
    });

  chatBranches = (channelId: string, archived: boolean, before: bigint | null) =>
    serviceEffect(async (): Promise<ChatBranchPage> => {
      const channel = await this.prisma.channel.findFirst({
        where: { id: channelId, kind: "bot_dm", archivedAt: null, members: {
          some: { bot: { status: { not: "archived" }, subagentIdentity: { is: null } } },
        } },
        select: { id: true },
      });
      if (!channel) throw new ApiError(404, "channel_not_found", "Channel not found");
      const cutoff = new Date(Date.now() - 3 * 60 * 60_000);
      const liveRun = archived ? Prisma.sql`NOT active.running AND` : Prisma.sql`active.running OR`;
      const timeFilter = archived ? Prisma.sql`latest."createdAt" < ${cutoff}` : Prisma.sql`latest."createdAt" >= ${cutoff}`;
      const cursor = before === null ? Prisma.empty : Prisma.sql`AND latest.sequence < ${before}`;
      const rows = await this.prisma.$queryRaw<Array<{ id: string; messageId: string; title: string; updatedAt: Date; sequence: bigint; running: boolean }>>`
        WITH latest AS (
          SELECT DISTINCT ON (m.metadata->>'questionScopeId')
            m.metadata->>'questionScopeId' AS "scope", m.id, m.sequence, m."createdAt"
          FROM outcomego_channel_message m
          WHERE m."channelId" = ${channelId}::uuid
            AND m.metadata->'branched' = 'true'::jsonb
            AND m.metadata->>'questionScopeId' IS NOT NULL
          ORDER BY m.metadata->>'questionScopeId', m.sequence DESC
        )
        SELECT root.id, latest.id AS "messageId", left(root.content, 160) AS title,
          latest."createdAt" AS "updatedAt", latest.sequence, active.running
        FROM latest JOIN outcomego_channel_message root ON root.id = CASE
          WHEN latest.scope ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' THEN latest.scope::uuid END
          AND root."channelId" = ${channelId}::uuid
        CROSS JOIN LATERAL (
          SELECT EXISTS (
            SELECT 1 FROM outcomego_run r
            JOIN outcomego_inbox_event i ON i."runId" = r.id
            JOIN outcomego_channel_message m ON m."channelId" = r."channelId" AND m.id::text = i.payload->>'replyToMessageId'
            WHERE r."channelId" = root."channelId" AND r.origin = 'user'
              AND (r.status IN ('queued', 'running') OR (r."requestNextCheckAt" IS NOT NULL AND r."requestStoppedAt" IS NULL))
              AND m.metadata->'branched' = 'true'::jsonb AND m.metadata->>'questionScopeId' = latest.scope
          ) AS running
        ) active
        WHERE (${liveRun} ${timeFilter}) ${cursor}
        ORDER BY latest.sequence DESC LIMIT 41`;
      const page = rows.slice(0, 40);
      return {
        items: page.map(({ id, messageId, title, updatedAt, running }) => ({ id, messageId, title, updatedAt: updatedAt.toISOString(), ...(running ? { running } : {}) })),
        nextBefore: rows.length > 40 ? page.at(-1)!.sequence.toString() : null,
      };
    });

  /**
   * Resolve a search hit without downloading the channel's lifetime history.
   * Both sides are independently capped and the returned edge sequences plug
   * directly into the existing history cursor model.
   */
  messageContext = (messageId: string, requestedBefore: number, requestedAfter: number) =>
    serviceEffect(async (): Promise<ChannelMessageContextView> => {
      const target = await this.prisma.channelMessage.findFirst({
        where: {
          id: messageId,
          channel: {
            archivedAt: null,
            members: {
              some: {
                bot: {
                  status: { not: "archived" },
                  subagentIdentity: { is: null },
                },
              },
            },
          },
        },
      });
      if (!target) throw new ApiError(404, "message_not_found", "Message was not found");

      const beforeLimit = normalizeMessageContextExtent(requestedBefore);
      const afterLimit = normalizeMessageContextExtent(requestedAfter);
      const [beforeRows, afterRows, revision] = await Promise.all([
        this.prisma.channelMessage.findMany({
          where: { channelId: target.channelId, sequence: { lt: target.sequence } },
          orderBy: { sequence: "desc" },
          take: beforeLimit + 1,
        }),
        this.prisma.channelMessage.findMany({
          where: { channelId: target.channelId, sequence: { gt: target.sequence } },
          orderBy: { sequence: "asc" },
          take: afterLimit + 1,
        }),
        this.prisma.event.findFirst({
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        }),
      ]);
      const messages = [
        ...beforeRows.slice(0, beforeLimit).reverse(),
        target,
        ...afterRows.slice(0, afterLimit),
      ];
      const threadContext = await threadContextFor(this.prisma, target.channelId, messages);
      return {
        channelId: target.channelId,
        targetMessageId: target.id,
        messages: messageViews(messages),
        threadContext: messageViews(threadContext.messages),
        threadContextTruncated: threadContext.truncated,
        beforeSequence: (messages[0] ?? target).sequence.toString(),
        afterSequence: (messages.at(-1) ?? target).sequence.toString(),
        hasMoreBefore: beforeRows.length > beforeLimit,
        hasMoreAfter: afterRows.length > afterLimit,
        revision: revision?.sequence.toString() ?? "0",
      };
    });

  channelState = (channelId: string) =>
    serviceEffect(async (): Promise<ChannelClientState> => {
      const channel = await this.prisma.channel.findFirst({
        where: {
          id: channelId,
          archivedAt: null,
          members: {
            some: {
              bot: {
                status: { not: "archived" },
                subagentIdentity: { is: null },
              },
            },
          },
        },
        select: { id: true },
      });
      if (!channel) throw new ApiError(404, "channel_not_found", "Channel not found");
      const roundLimit = CHANNEL_CLIENT_STATE_LIMITS.channelRounds;
      const runLimit = CHANNEL_CLIENT_STATE_LIMITS.runs;
      const subagentLimit = CHANNEL_CLIENT_STATE_LIMITS.subagents;
      const [
        currentRounds,
        recentRounds,
        currentRuns,
        recentRuns,
        currentSubagents,
        recentSubagents,
        revision,
      ] = await Promise.all([
        this.prisma.channelRound.findMany({
          where: { channelId, status: { in: ["queued", "running"] } },
          orderBy: { createdAt: "desc" },
          take: roundLimit + 1,
        }),
        this.prisma.channelRound.findMany({
          where: { channelId, status: { notIn: ["queued", "running"] } },
          orderBy: { createdAt: "desc" },
          take: roundLimit + 1,
        }),
        this.prisma.run.findMany({
          where: { channelId, OR: [{ status: { in: ["queued", "running"] } }, { requestNextCheckAt: { not: null }, requestStoppedAt: null }] },
          orderBy: { createdAt: "desc" },
          take: runLimit + 1,
        }),
        this.prisma.run.findMany({
          where: {
            channelId,
            status: { notIn: ["queued", "running"] },
          },
          orderBy: { createdAt: "desc" },
          take: runLimit + 1,
        }),
        this.prisma.subagentAttempt.findMany({
          where: {
            parentChannelId: channelId,
            status: { in: ["provisioning", "queued", "running", "waiting"] },
          },
          include: {
            subagent: { select: { id: true, parentBotId: true, subagentType: true, status: true, currentRunId: true } },
          },
          orderBy: { createdAt: "desc" },
          take: subagentLimit + 1,
        }),
        this.prisma.subagentAttempt.findMany({
          where: {
            parentChannelId: channelId,
            status: { notIn: ["provisioning", "queued", "running", "waiting"] },
          },
          include: {
            subagent: { select: { id: true, parentBotId: true, subagentType: true, status: true, currentRunId: true } },
          },
          orderBy: { createdAt: "desc" },
          take: subagentLimit + 1,
        }),
        this.prisma.event.findFirst({
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        }),
      ]);
      const rounds = selectBoundedActivity(currentRounds, recentRounds, roundLimit);
      const runs = selectBoundedActivity(currentRuns, recentRuns, runLimit);
      const subagentAttempts = selectBoundedActivity(
        currentSubagents,
        recentSubagents,
        subagentLimit
      );
      const runIds = runs.items.map((run) => run.id);
      const currentRunIds = new Set(currentRuns.filter(run => ["queued", "running"].includes(run.status)).map((run) => run.id));
      const selectedCurrentRunIds = runIds.filter((runId) => currentRunIds.has(runId));
      const runItemLimit = CHANNEL_CLIENT_STATE_LIMITS.runItems;
      // Clients read run items only to describe queued or running work.
      // Finished runs' tool calls made this response megabytes in busy
      // channels, and it is re-read after every live event.
      const [currentRunItems, lineage] = await Promise.all([
        this.prisma.runItem.findMany({
          where: {
            runId: { in: selectedCurrentRunIds },
            kind: { notIn: ["agent_message", "reasoning"] },
          },
          orderBy: { createdAt: "desc" },
          take: runItemLimit + 1,
        }),
        this.threadLineage(runs.items, subagentAttempts.items),
      ]);
      const runItems = selectBoundedActivity(currentRunItems, [], runItemLimit);
      return {
        channelId,
        revision: revision?.sequence.toString() ?? "0",
        channelRounds: roundViews(rounds.items),
        runs: runViews(runs.items, lineage.forkRunIds),
        runItems: runItems.items.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })) as ClientSnapshot["runItems"],
        subagents: subagentAttempts.items.map((attempt) =>
          subagentActivityView(attempt, lineage.threadRunIds)
        ),
        truncated: {
          channelRounds: rounds.truncated,
          runs: runs.truncated,
          runItems: runItems.truncated,
          subagents: subagentAttempts.truncated,
        },
      };
    });

  private async threadLineage(
    runs: ReadonlyArray<{ id: string; botId: string; status: string; origin: string }>,
    attempts: ReadonlyArray<{ parentRunId: string; status: string }>
  ): Promise<{ forkRunIds: Set<string>; threadRunIds: Set<string> }> {
    const activeRuns = runs.filter((run) => run.status === "queued" || run.status === "running");
    const activeAttempts = attempts.filter((attempt) =>
      ["provisioning", "queued", "running"].includes(attempt.status)
    );
    const runIds = new Set(runs.map((run) => run.id));
    const missingParentRunIds = [
      ...new Set(
        activeAttempts.map((attempt) => attempt.parentRunId).filter((id) => !runIds.has(id))
      ),
    ];
    const forkRunIds = new Set<string>();
    const inboxFindMany = (this.prisma as Partial<PrismaClient>).inboxEvent?.findMany;
    if (inboxFindMany && activeRuns.length > 0) {
      const botIds = [...new Set(activeRuns.map((run) => run.botId))];
      const activeIds = activeRuns.map((run) => run.id);
      const forked = await inboxFindMany({
        where: {
          botId: { in: botIds },
          status: { in: ["pending", "processing"] },
          runId: { in: activeIds },
          payload: { path: ["isFork"], equals: true },
        },
        select: { runId: true },
      });
      for (const row of forked) forkRunIds.add(row.runId);
    }
    const threadRunIds = new Set(
      runs.filter((run) => run.origin === "outcome" || forkRunIds.has(run.id)).map((run) => run.id)
    );
    if (missingParentRunIds.length > 0) {
      const parentRuns = await this.prisma.run.findMany({
        where: { id: { in: missingParentRunIds } },
        select: { id: true, botId: true, origin: true },
      });
      for (const parent of parentRuns) {
        if (parent.origin === "outcome") threadRunIds.add(parent.id);
      }
      const nonOutcomeIds = parentRuns
        .filter((parent) => parent.origin !== "outcome")
        .map((parent) => parent.id);
      if (inboxFindMany && nonOutcomeIds.length > 0) {
        const parentBotIds = [...new Set(parentRuns.map((parent) => parent.botId))];
        const forkedParents = await inboxFindMany({
          where: {
            botId: { in: parentBotIds },
            runId: { in: nonOutcomeIds },
            payload: { path: ["isFork"], equals: true },
          },
          select: { runId: true },
        });
        for (const row of forkedParents) threadRunIds.add(row.runId);
      }
    }
    return { forkRunIds, threadRunIds };
  }

  clientRuntime = () =>
    serviceEffect(
      async (): Promise<ClientRuntimeView> => ({ runtime: await this.runtimeStatusCached() })
    );

  health = () => serviceEffect(() => this.runtimeStatusCached());

  async eventWindowAfter(sequence: bigint, requestedLimit = EVENT_BATCH_SIZE) {
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(EVENT_BATCH_SIZE, Math.max(1, Math.trunc(requestedLimit)))
      : EVENT_BATCH_SIZE;
    const [bounds, events] = await Promise.all([
      this.prisma.event.aggregate({
        _min: { sequence: true },
        _max: { sequence: true },
      }),
      this.prisma.event.findMany({
        where: { sequence: { gt: sequence }, NOT: { topic: { startsWith: "outcome." } } },
        orderBy: { sequence: "asc" },
        take: limit,
      }),
    ]);
    const oldest = bounds._min.sequence;
    const latest = bounds._max.sequence;
    return {
      oldest,
      latest,
      cursorExpired: sequence > 0n && oldest !== null && sequence < oldest - 1n,
      cursorAhead: sequence > 0n && (latest === null || sequence > latest),
      hasMore: events.length === limit,
      events: events.map((event) => ({
        sequence: event.sequence.toString(),
        topic: event.topic,
        entityId: event.entityId,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  async eventsAfter(sequence: bigint) {
    return (await this.eventWindowAfter(sequence)).events;
  }

  /** Retain the replay window and unreceipted inputs for the durable Evidence consumer. */
  async pruneEvents(): Promise<number> {
    return this.prisma.$executeRaw`
      WITH retention_floor AS (
        SELECT "sequence"
        FROM "outcomego_event"
        ORDER BY "sequence" DESC
        OFFSET ${MAX_RETAINED_EVENTS - 1}
        LIMIT 1
      )
      DELETE FROM "outcomego_event" AS event
      WHERE event."sequence" < (SELECT "sequence" FROM retention_floor)
        AND NOT COALESCE(${pendingOutcomeEvidenceEventSql}, FALSE)
    `;
  }

  private async runtimeStatusCached(): Promise<Snapshot["runtime"]> {
    return this.runtimeHealth.runtimeStatusCached();
  }
}
export { MAX_THREAD_CONTEXT_MESSAGES } from "./snapshot/message-queries";
