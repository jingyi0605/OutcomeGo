import { ApiError } from "@outcomego/contracts";
import { messagePreviewText } from "@outcomego/contracts/message-preview";
import { OUTCOME_TERMINAL_STATUSES, parseOffsetTimestamp } from "@outcomego/contracts/outcomes";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import {
  ACTIVITY_TITLE_LIMIT, deriveRequestDisplayState, deriveRoutineDisplayState,
  deriveWorkItemDisplayState, hasUnfinishedDependency, isOverdue, isWorkItemOverdue, isWorkItemScheduleEditable, localDateOf,
  SCHEDULE_ITEM_LIMIT, SCHEDULE_RANGE_DAYS,
  type ScheduleQuery, type ScheduleResponse, type TimeItem, type TimeItemKind,
} from "@outcomego/contracts/task-overview";
import { deriveTodoDisplayState } from "@outcomego/contracts/todo";
import type { PrismaClient } from "@outcomego/db";
import { INDEPENDENT_RUN_ORIGINS, inferRoutineScheduleAnchor, nextRoutineTriggerRun, readFeatureSettings, readUserTimeZone } from "@outcomego/messaging";

type Window = Omit<ScheduleQuery, "from" | "to"> & { from: Date; to: Date };
type LocatedItem = TimeItem & { at: number };
const dayMs = 86_400_000;
const routineOccurrenceLimit = 100;

function deadlineFormatter(timeZone: string) {
  const clock = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  return (instant: Date) => {
    const allDay = instant.getUTCMilliseconds() === 0 && clock.format(instant) === "00:00:00";
    return { allDay, end: allDay ? localDateOf(instant, timeZone) : instant.toISOString() };
  };
}

function dependencyIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function conversationLink(row: { conversationId: string; channelId: string | null }): TimeItem["link"] {
  return row.channelId ? { type: "channel", id: row.channelId } : { type: "conversation", id: row.conversationId };
}

export class ScheduleService {
  constructor(private readonly db: PrismaClient) {}

  async list(ownerId: string, query: ScheduleQuery, now = new Date(), timeZone?: string): Promise<ScheduleResponse> {
    const from = parseOffsetTimestamp(query.from);
    const to = parseOffsetTimestamp(query.to);
    if (!from || !to || from >= to || to.getTime() - from.getTime() > SCHEDULE_RANGE_DAYS * dayMs) {
      throw new ApiError(400, "invalid_range", `Use an increasing range of at most ${SCHEDULE_RANGE_DAYS} days with UTC offsets`);
    }
    return this.collect(ownerId, { ...query, from, to }, now, timeZone ?? await readUserTimeZone(this.db));
  }

  async collect(ownerId: string, query: Window, now: Date, timeZone: string): Promise<ScheduleResponse> {
    const hasKind = (kind: TimeItemKind) => !query.kinds || query.kinds.includes(kind);
    const range = { gte: query.from, lt: query.to };
    const take = SCHEDULE_ITEM_LIMIT + 1;
    const bot = query.botId ? { botId: query.botId } : {};
    const outcome = query.outcomeId ? { outcomeId: query.outcomeId } : {};
    const deadline = deadlineFormatter(timeZone);

    const goals = hasKind("goal_due") ? this.db.outcome.findMany({
      where: { ...bot, ...(query.outcomeId ? { id: query.outcomeId } : {}), dueAt: range },
      select: { id: true, botId: true, title: true, dueAt: true, status: true, acceptedAt: true, cancelledAt: true, updatedAt: true },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }], take,
    }) : [];

    const work = async (kind: "work_item" | "human_task", field: "scheduledAt" | "dueAt" | "completedAt") => {
      const rows = await this.db.outcomeWorkItem.findMany({
        where: { ...bot, ...outcome, executorType: kind === "human_task" ? "human" : "agent", [field]: range,
          ...(field === "completedAt" ? { status: "completed" as const } : {}) },
        select: { id: true, outcomeId: true, botId: true, executorType: true, title: true, status: true, statusReason: true,
          dependsOn: true, scheduledAt: true, dueAt: true, completedAt: true, startedAt: true, estimateMinutes: true, updatedAt: true,
          outcome: { select: { acceptedAt: true, cancelledAt: true } },
          runs: { where: { status: { in: ["queued", "running"] } }, select: { id: true }, take: 1 } },
        orderBy: [{ [field]: "asc" }, { id: "asc" }], take,
      });
      const dependencyKeys = [...new Set(rows.flatMap((row) => dependencyIds(row.dependsOn)))];
      const dependencies = dependencyKeys.length ? await this.db.outcomeWorkItem.findMany({
        where: { id: { in: dependencyKeys } }, select: { id: true, status: true },
      }) : [];
      const statusById = new Map(dependencies.map((row) => [row.id, row.status]));
      return rows.map((row): LocatedItem => {
        const at = row[field]!;
        const isDue = field === "dueAt";
        const isActual = field === "completedAt";
        const estimate = field === "scheduledAt" && row.estimateMinutes;
        return {
          at: at.getTime(), id: `${kind}:${row.id}${isDue ? ":due" : isActual ? ":actual" : ""}`, kind, title: row.title,
          start: isDue || isActual ? null : at.toISOString(),
          ...(isDue ? deadline(at) : { allDay: false, end: isActual ? at.toISOString() : estimate ? new Date(at.getTime() + estimate * 60_000).toISOString() : null }),
          timeBasis: isDue ? "due" : isActual ? "actual" : estimate ? "estimated" : "scheduled",
          state: deriveWorkItemDisplayState({ ...row, hasUnfinishedDependency: hasUnfinishedDependency(dependencyIds(row.dependsOn), statusById) }, now),
          overdue: isWorkItemOverdue(row, now), owner: kind === "human_task" ? "me" : "bot", botId: row.botId, outcomeId: row.outcomeId,
          link: { type: "work_item", id: row.id }, updatedAt: row.updatedAt.toISOString(),
          editable: !isActual && !row.outcome.acceptedAt && !row.outcome.cancelledAt && isWorkItemScheduleEditable(row) &&
            (kind === "human_task" || (!isDue && !row.startedAt && row.runs.length === 0)),
        };
      });
    };

    const todos = async (field: "scheduledAt" | "dueAt" | "followUpAt") => {
      const followUp = field === "followUpAt";
      const rows = await this.db.ownerTodoItem.findMany({
        where: { ...bot, ...(query.outcomeId ? { linkedOutcomeId: query.outcomeId } : {}), ownerId,
          ...(query.mine ? { executor: "owner" } : {}), status: { in: followUp ? ["waiting"] : ["open", "waiting", "done"] }, [field]: range },
        select: { id: true, title: true, executor: true, status: true, dueAt: true, scheduledAt: true, snoozeUntil: true,
          followUpAt: true, botId: true, linkedOutcomeId: true, handoffMessageId: true, updatedAt: true },
        orderBy: [{ [field]: "asc" }, { id: "asc" }], take,
      });
      const messageIds = followUp ? rows.flatMap((row) => row.handoffMessageId ? [row.handoffMessageId] : []) : [];
      const runs = messageIds.length ? await this.db.run.findMany({
        where: { userMessageId: { in: messageIds } }, select: { userMessageId: true, conversationId: true, channelId: true },
      }) : [];
      const links = new Map(runs.map((run) => [run.userMessageId, conversationLink(run)]));
      return rows.map((row): LocatedItem => {
        const at = row[field]!;
        const isDue = field === "dueAt";
        const { displayState, overdue } = deriveTodoDisplayState(row, now, timeZone);
        return {
          at: at.getTime(), id: followUp ? `follow_up:todo:${row.id}` : `todo:${row.id}${isDue ? ":due" : ""}`,
          kind: followUp ? "follow_up" : "todo", title: row.title,
          start: isDue ? null : at.toISOString(), ...(isDue ? deadline(at) : { allDay: false, end: null }),
          timeBasis: isDue ? "due" : "scheduled", state: displayState, overdue,
          owner: row.executor === "owner" ? "me" : row.executor,
          ...(row.botId ? { botId: row.botId } : {}), ...(row.linkedOutcomeId ? { outcomeId: row.linkedOutcomeId } : {}),
          link: links.get(row.handoffMessageId ?? "") ?? { type: "todo", id: row.id },
          editable: !followUp && row.executor === "owner" && row.status !== "done", updatedAt: row.updatedAt.toISOString(),
        };
      });
    };

    const [goalRows, ...sources] = await Promise.all([
      goals,
      ...(hasKind("human_task") ? [work("human_task", "scheduledAt"), work("human_task", "dueAt")] : []),
      ...(hasKind("work_item") && !query.mine ? [work("work_item", "scheduledAt"), work("work_item", "dueAt"), work("work_item", "completedAt")] : []),
      ...(hasKind("todo") ? [todos("scheduledAt"), todos("dueAt")] : []),
      ...(hasKind("follow_up") ? [todos("followUpAt")] : []),
      ...(hasKind("follow_up") && !query.mine && !query.outcomeId ? [this.requestChecks(query, now)] : []),
      ...(hasKind("routine_run") && !query.mine && !query.outcomeId ? [this.routineRuns(query, now, timeZone)] : []),
    ]);
    const items: LocatedItem[] = goalRows.map((row) => ({
      at: row.dueAt!.getTime(), id: `goal_due:${row.id}`, kind: "goal_due", title: row.title, start: null,
      ...deadline(row.dueAt!), timeBasis: "due", state: row.status,
      overdue: isOverdue(row.dueAt, now, OUTCOME_TERMINAL_STATUSES.includes(row.status)),
      owner: "me", outcomeId: row.id, botId: row.botId, link: { type: "outcome", id: row.id },
      editable: !row.acceptedAt && !row.cancelledAt, updatedAt: row.updatedAt.toISOString(),
    }));
    for (const source of sources) items.push(...source);
    items.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
    return { items: items.slice(0, SCHEDULE_ITEM_LIMIT).map(({ at, ...item }) => item), truncated: items.length > SCHEDULE_ITEM_LIMIT };
  }

  private async requestChecks(query: Window, now: Date): Promise<LocatedItem[]> {
    const rows = await this.db.run.findMany({
      where: { requestNextCheckAt: { gte: query.from, lt: query.to }, requestStoppedAt: null,
        requestProgress: { path: ["state"], equals: "waiting" }, origin: { notIn: [...INDEPENDENT_RUN_ORIGINS] },
        ...(query.botId ? { botId: query.botId } : {}) },
      select: { id: true, botId: true, conversationId: true, channelId: true, userMessageId: true,
        requestNextCheckAt: true, requestReconciliations: true, updatedAt: true },
      orderBy: [{ requestNextCheckAt: "asc" }, { id: "asc" }], take: SCHEDULE_ITEM_LIMIT + 1,
    });
    if (!rows.length) return [];
    const [messages, feature] = await Promise.all([
      this.db.message.findMany({ where: { id: { in: rows.map((row) => row.userMessageId) } }, select: { id: true, content: true } }),
      readFeatureSettings(this.db),
    ]);
    const titles = new Map(messages.map((row) => [row.id, messagePreviewText(row.content, ACTIVITY_TITLE_LIMIT)]));
    const checkOverdueMinutes = resolveTaskPolicy(feature.taskPolicy)["activity.checkOverdueMinutes"] as number;
    return rows.map((row) => {
      const instant = row.requestNextCheckAt!;
      return {
        at: instant.getTime(), id: `follow_up:request:${row.id}`, kind: "follow_up", title: titles.get(row.userMessageId) ?? "",
        start: instant.toISOString(), end: null, allDay: false, timeBasis: "scheduled",
        state: deriveRequestDisplayState({ state: "waiting", nextCheckAt: instant, reconciliations: row.requestReconciliations }, now, { checkOverdueMinutes }),
        overdue: false, owner: "bot", botId: row.botId, link: conversationLink(row), editable: false, updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  private async routineRuns(query: Window, now: Date, timeZone: string): Promise<LocatedItem[]> {
    const bot = query.botId ? { OR: [{ botId: query.botId }, { executorBotId: query.botId }] } : {};
    const historicEnd = query.to < now ? query.to : now;
    const futureStart = query.from > now ? query.from : now;
    const [executions, routines] = await Promise.all([
      query.from < historicEnd ? this.db.routineExecution.findMany({
        where: { scheduledFor: { gte: query.from, lt: historicEnd }, routine: bot },
        select: { id: true, kind: true, events: true, scheduledFor: true, status: true, updatedAt: true,
          routine: { select: { id: true, name: true, botId: true, executorBotId: true, pausedAt: true } } },
        orderBy: [{ scheduledFor: "asc" }, { id: "asc" }], take: SCHEDULE_ITEM_LIMIT + 1,
      }) : [],
      futureStart < query.to ? this.db.routine.findMany({
        where: { ...bot, enabled: true, pausedAt: null, deletedAt: null, scheduleKind: { not: "event" }, nextRunAt: { lt: query.to } },
        select: { id: true, name: true, botId: true, executorBotId: true, createdAt: true, updatedAt: true, scheduleKind: true,
          scheduleText: true, trigger: true, timezone: true, cronExpression: true, intervalSeconds: true, scheduleAnchorAt: true, nextRunAt: true },
      }) : [],
    ]);
    const item = (routine: { id: string; name: string; botId: string | null; executorBotId: string | null }, instant: Date,
      id: string, basis: "actual" | "scheduled", state: TimeItem["state"], updatedAt: Date): LocatedItem => {
      const botId = routine.executorBotId ?? routine.botId;
      return {
        at: instant.getTime(), id: `routine_run:${routine.id}:${id}`, kind: "routine_run", title: routine.name,
        start: instant.toISOString(), end: null, allDay: false, timeBasis: basis, state, overdue: false, owner: "bot",
        ...(botId ? { botId } : {}), link: { type: "routine", id: routine.id }, editable: false, updatedAt: updatedAt.toISOString(),
      };
    };
    const items = executions.map((execution) => item(execution.routine, execution.scheduledFor,
      execution.kind === "scheduled" && !execution.events ? String(execution.scheduledFor.getTime()) : execution.id,
      "actual", execution.status === "completed" || execution.status === "cancelled" ? execution.status :
        deriveRoutineDisplayState({ pausedAt: execution.routine.pausedAt, lastExecutionStatus: execution.status }), execution.updatedAt));
    for (const routine of routines) {
      const anchor = await inferRoutineScheduleAnchor(this.db, routine);
      const next = (after: Date) => nextRoutineTriggerRun(routine.trigger as Record<string, unknown>, routine, after, timeZone, anchor);
      try {
        let instant = routine.nextRunAt!;
        if (instant < futureStart) instant = next(new Date(futureStart.getTime() - 1));
        for (let count = 0; count < routineOccurrenceLimit && instant >= futureStart && instant < query.to; count++) {
          items.push(item(routine, instant, String(instant.getTime()), "scheduled", "scheduled", routine.updatedAt));
          const following = next(instant);
          if (following <= instant) break;
          instant = following;
        }
      } catch {
        continue;
      }
    }
    return items;
  }
}
