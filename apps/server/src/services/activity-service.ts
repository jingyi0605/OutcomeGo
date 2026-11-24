import { messagePreviewText } from "@outcomego/contracts/message-preview";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import {
  ACTIVITY_LIST_LIMIT,
  ACTIVITY_TITLE_LIMIT,
  deriveRequestDisplayState,
  type ActivityItem,
  type ActivityResponse,
  type RequestBlockSource,
  type RequestDisplayState,
  type RequestProgressDetailView,
  type RequestProgressState,
} from "@outcomego/contracts/task-overview";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { INDEPENDENT_RUN_ORIGINS, readFeatureSettings } from "@outcomego/messaging";

/** What the runtime keeps in `Run.requestProgress`: written by the bot, bounded by its tool. */
interface StoredProgress {
  state: RequestProgressState;
  summary: string;
  evidence?: string[];
  remaining?: string[];
  nextAction?: string;
  checkAt?: string;
  deadline?: string;
  blockSource?: RequestBlockSource;
  toolError?: string;
}

export interface ActivityQuery {
  /** Only this bot's work. Without it, every bot of the owner. */
  botId?: string;
  /** Also what is hidden by default: finished work older than the "recently completed" window. */
  includeAll?: boolean;
  /** Overrides the policy's "recently completed" window, in hours. */
  recentHours?: number;
}

/** These states already show in the "needs me" queue, so the activity list marks them and does not draw them twice. */
const NEEDS_OWNER: readonly RequestDisplayState[] = ["needs_owner", "no_follow_up", "check_not_fired"];
/** A request that is moving needs no reason; every other state says why it is not. */
const NO_REASON: readonly RequestDisplayState[] = ["in_progress", "completed"];

const requestRows = {
  id: true,
  botId: true,
  conversationId: true,
  userMessageId: true,
  requestProgress: true,
  requestRevision: true,
  requestReconciliations: true,
  requestNextCheckAt: true,
  updatedAt: true,
} satisfies Prisma.RunSelect;
type RequestRow = Prisma.RunGetPayload<{ select: typeof requestRows }>;

/**
 * What every bot is doing, for the owner (specs/004.10 design §3). Read-only and derived: it presents the request
 * progress the runtime already keeps and stores nothing of its own. It is reached only through owner routes and is
 * never exposed to a bot tool, so what one bot wrote cannot reach another bot through it.
 */
export class ActivityService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: ActivityQuery, now = new Date()): Promise<ActivityResponse> {
    const policy = await this.policy();
    const recentHours = query.recentHours ?? policy.recentCompletedHours;
    const cutoff = new Date(now.getTime() - recentHours * 3_600_000);
    const rows = await this.prisma.run.findMany({
      where: {
        requestProgress: { not: Prisma.DbNull },
        requestStoppedAt: null,
        origin: { notIn: [...INDEPENDENT_RUN_ORIGINS] },
        ...(query.botId ? { botId: query.botId } : {}),
        // Finished work leaves the list after the window; everything unfinished stays however old it is.
        ...(query.includeAll
          ? {}
          : { OR: [{ NOT: { requestProgress: { path: ["state"], equals: "complete" } } }, { updatedAt: { gte: cutoff } }] }),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIST_LIMIT + 1,
      select: requestRows,
    });
    const truncated = rows.length > ACTIVITY_LIST_LIMIT;
    const kept = truncated ? rows.slice(0, ACTIVITY_LIST_LIMIT) : rows;
    const titles = await this.titles(kept.map((row) => row.userMessageId));
    return {
      items: kept.map((row) => this.item(row, titles.get(row.userMessageId) ?? "", now, policy.checkOverdueMinutes)),
      truncated,
    };
  }

  /** One request with what the list leaves out (evidence, the tool's error). Null when it is not a tracked request. */
  async requestDetail(requestRunId: string, now = new Date()): Promise<RequestProgressDetailView | null> {
    const row = await this.prisma.run.findFirst({
      where: {
        id: requestRunId,
        requestProgress: { not: Prisma.DbNull },
        origin: { notIn: [...INDEPENDENT_RUN_ORIGINS] },
      },
      select: requestRows,
    });
    if (!row) return null;
    const policy = await this.policy();
    const progress = row.requestProgress as unknown as StoredProgress;
    const titles = await this.titles([row.userMessageId]);
    return {
      requestRunId: row.id,
      botId: row.botId,
      title: titles.get(row.userMessageId) ?? "",
      state: progress.state,
      displayState: this.displayState(row, progress, now, policy.checkOverdueMinutes),
      summary: progress.summary,
      remaining: progress.remaining ?? [],
      nextAction: progress.nextAction ?? null,
      blockSource: progress.blockSource ?? null,
      checkAt: progress.checkAt ?? null,
      deadline: progress.deadline ?? null,
      updatedAt: row.updatedAt.toISOString(),
      revision: row.requestRevision,
      reconciliations: row.requestReconciliations,
      evidence: progress.evidence ?? [],
      toolError: progress.toolError ?? null,
    };
  }

  private async policy(): Promise<{ recentCompletedHours: number; checkOverdueMinutes: number }> {
    const policy = resolveTaskPolicy((await readFeatureSettings(this.prisma)).taskPolicy);
    return {
      recentCompletedHours: policy["activity.recentCompletedHours"] as number,
      checkOverdueMinutes: policy["activity.checkOverdueMinutes"] as number,
    };
  }

  /** The start of the owner's own message, one query for all of them. */
  private async titles(messageIds: readonly string[]): Promise<Map<string, string>> {
    if (!messageIds.length) return new Map();
    const messages = await this.prisma.message.findMany({ where: { id: { in: [...messageIds] } }, select: { id: true, content: true } });
    return new Map(messages.map((message) => [message.id, messagePreviewText(message.content, ACTIVITY_TITLE_LIMIT)]));
  }

  private displayState(row: RequestRow, progress: StoredProgress, now: Date, checkOverdueMinutes: number): RequestDisplayState {
    return deriveRequestDisplayState(
      {
        state: progress.state,
        blockSource: progress.blockSource,
        reconciliations: row.requestReconciliations,
        nextCheckAt: row.requestNextCheckAt,
      },
      now,
      { checkOverdueMinutes }
    );
  }

  private item(row: RequestRow, title: string, now: Date, checkOverdueMinutes: number): ActivityItem {
    const progress = row.requestProgress as unknown as StoredProgress;
    const state = this.displayState(row, progress, now, checkOverdueMinutes);
    return {
      id: `request:${row.id}`,
      type: "request",
      botId: row.botId,
      title,
      state,
      reason: NO_REASON.includes(state) ? null : (progress.nextAction ?? progress.summary),
      doing: progress.summary,
      progress: null,
      lastActivityAt: row.updatedAt.toISOString(),
      nextCheckAt: row.requestNextCheckAt?.toISOString() ?? null,
      needsOwner: NEEDS_OWNER.includes(state),
      link: { type: "conversation", id: row.conversationId },
    };
  }
}
