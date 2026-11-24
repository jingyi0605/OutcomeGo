import { messagePreviewText, truncatePreviewText } from "@outcomego/contracts/message-preview";
import { parseOutcomeWorkItemProgress } from "@outcomego/contracts/outcomes";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import {
  ACTIVITY_LIST_LIMIT,
  ACTIVITY_TITLE_LIMIT,
  deriveRequestDisplayState,
  deriveRoutineDisplayState,
  deriveWorkItemDisplayState,
  type ActivityItem,
  type ActivityResponse,
  type RequestBlockSource,
  type RequestDisplayState,
  type RequestProgressDetailView,
  type RequestProgressState,
} from "@outcomego/contracts/task-overview";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { INDEPENDENT_RUN_ORIGINS, OPEN_REQUEST_WORKER_STATUSES, readFeatureSettings } from "@outcomego/messaging";

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

/** The longest reason copied from a failed run's error; a bad run cannot flood the list. A format limit. */
const REASON_LIMIT = 300;
/** More routines than this are not scanned for failures. A scale limit; an owner has far fewer. */
const ROUTINE_SCAN_LIMIT = 1000;

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
    // Each source reads its own records; they share the types, the derivation and the limit, and nothing else.
    const [requests, routines, goalTasks] = await Promise.all([
      this.requestItems(query, cutoff, now, policy.checkOverdueMinutes),
      this.routineItems(query, cutoff),
      this.goalTaskItems(query, now),
    ]);
    // A thing has one id (`<type>:<source id>`), so the same thing seen twice collapses to one row.
    const byId = new Map<string, ActivityItem>();
    for (const item of [...requests, ...routines, ...goalTasks]) if (!byId.has(item.id)) byId.set(item.id, item);
    const merged = [...byId.values()].sort(
      (a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : a.id < b.id ? -1 : 1)
    );
    return { items: merged.slice(0, ACTIVITY_LIST_LIMIT), truncated: merged.length > ACTIVITY_LIST_LIMIT };
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

  /** Unfinished requests, with the executors each one started folded in as a count. */
  private async requestItems(query: ActivityQuery, cutoff: Date, now: Date, checkOverdueMinutes: number): Promise<ActivityItem[]> {
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
    const titles = await this.titles(rows.map((row) => row.userMessageId));
    const workers = await this.workerCounts(rows.map((row) => row.id));
    return rows.map((row) => ({
      ...this.item(row, titles.get(row.userMessageId) ?? "", now, checkOverdueMinutes),
      workerCount: workers.get(row.id) ?? 0,
    }));
  }

  /** Executors still working, per request: they are summarised under their request and never listed on their own. */
  private async workerCounts(requestRunIds: readonly string[]): Promise<Map<string, number>> {
    if (!requestRunIds.length) return new Map();
    const groups = await this.prisma.subagent.groupBy({
      by: ["requestRunId"],
      where: { requestRunId: { in: [...requestRunIds] }, status: { in: [...OPEN_REQUEST_WORKER_STATUSES] } },
      _count: { _all: true },
    });
    return new Map(groups.flatMap((group) => (group.requestRunId ? [[group.requestRunId, group._count._all] as const] : [])));
  }

  /**
   * Routines whose last run is running, failed or skipped. A run that succeeded is not a row (it is in the routine's own
   * page), unless "show all" is asked for. A failure stays until the routine runs well again, however long ago it was,
   * because it still needs a look; a skip is noise and only shows inside the recent window.
   */
  private async routineItems(query: ActivityQuery, cutoff: Date): Promise<ActivityItem[]> {
    const routines = await this.prisma.routine.findMany({
      where: {
        enabled: true,
        deletedAt: null,
        ...(query.botId ? { OR: [{ botId: query.botId }, { executorBotId: query.botId }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: ROUTINE_SCAN_LIMIT,
      select: {
        id: true, name: true, botId: true, executorBotId: true, nextRunAt: true, pausedAt: true, updatedAt: true,
        executions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, error: true, skipReason: true, updatedAt: true } },
      },
    });
    return routines.flatMap((routine): ActivityItem[] => {
      const botId = routine.botId ?? routine.executorBotId;
      if (!botId) return [];
      const last = routine.executions[0] ?? null;
      const state = deriveRoutineDisplayState({ pausedAt: routine.pausedAt, lastExecutionStatus: last?.status ?? null });
      const quiet = state === "idle" || state === "paused";
      if (quiet && !query.includeAll) return [];
      if (state === "skipped" && !query.includeAll && (last?.updatedAt ?? routine.updatedAt) < cutoff) return [];
      const reason = state === "failed" ? errorText(last?.error) : state === "skipped" ? (last?.skipReason ?? null) : null;
      return [
        {
          id: `routine:${routine.id}`,
          type: "routine",
          botId,
          title: routine.name,
          state,
          reason: reason ? truncatePreviewText(reason, REASON_LIMIT) : null,
          doing: null,
          progress: null,
          lastActivityAt: (last?.updatedAt ?? routine.updatedAt).toISOString(),
          nextCheckAt: routine.nextRunAt?.toISOString() ?? null,
          needsOwner: false,
          link: { type: "routine", id: routine.id },
        },
      ];
    });
  }

  /**
   * A goal's bot tasks that are running, or waiting for a time that has not come. A task whose time has not come is
   * "scheduled" or "deferred", never "working". A goal a bot registered for itself has no task, so it is not here.
   */
  private async goalTaskItems(query: ActivityQuery, now: Date): Promise<ActivityItem[]> {
    const rows = await this.prisma.outcomeWorkItem.findMany({
      where: {
        executorType: "agent",
        ...(query.botId ? { botId: query.botId } : {}),
        outcome: { cancelledAt: null, acceptedAt: null },
        OR: [{ status: "running" }, { status: "queued", scheduledAt: { gt: now } }],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIST_LIMIT + 1,
      select: {
        id: true, botId: true, title: true, status: true, statusReason: true, scheduledAt: true, progress: true, updatedAt: true,
        contractRevisionId: true, outcome: { select: { id: true, title: true, currentRevisionId: true } },
      },
    });
    return rows.flatMap((row): ActivityItem[] => {
      // Only the current plan's tasks: a replaced plan's leftovers are not work in progress.
      if (row.contractRevisionId !== row.outcome.currentRevisionId) return [];
      const state = deriveWorkItemDisplayState(
        { executorType: "agent", status: row.status, statusReason: row.statusReason, scheduledAt: row.scheduledAt, hasUnfinishedDependency: false },
        now
      );
      const progress = state === "running" ? parseOutcomeWorkItemProgress(row.progress) : null;
      return [
        {
          id: `goal_task:${row.id}`,
          type: "goal_task",
          botId: row.botId,
          title: `${row.title} — ${row.outcome.title}`,
          state,
          reason: null,
          doing: progress?.summary ?? null,
          progress: progress
            ? { done: progress.tasks.filter((step) => step.status === "completed").length, total: progress.tasks.length, phase: progress.phase }
            : null,
          lastActivityAt: row.updatedAt.toISOString(),
          nextCheckAt: state === "scheduled" || state === "deferred" ? (row.scheduledAt?.toISOString() ?? null) : null,
          needsOwner: false,
          link: { type: "outcome", id: row.outcome.id },
        },
      ];
    });
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

/** The words of a failed run's error, as plain text. The runtime stores either a string or an object with a message. */
function errorText(error: unknown): string | null {
  if (typeof error === "string") return error || null;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message || null;
  return null;
}
