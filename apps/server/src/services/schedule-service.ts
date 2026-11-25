import { ApiError } from "@outcomego/contracts";
import { OUTCOME_TERMINAL_STATUSES, parseOffsetTimestamp } from "@outcomego/contracts/outcomes";
import {
  deriveWorkItemDisplayState, hasUnfinishedDependency, isOverdue, isWorkItemOverdue, isWorkItemScheduleEditable, localDateOf,
  SCHEDULE_ITEM_LIMIT, SCHEDULE_RANGE_DAYS,
  type ScheduleQuery, type ScheduleResponse, type TimeItem, type TimeItemKind,
} from "@outcomego/contracts/task-overview";
import { deriveTodoDisplayState } from "@outcomego/contracts/todo";
import type { PrismaClient } from "@outcomego/db";
import { readUserTimeZone } from "@outcomego/messaging";

type Window = Omit<ScheduleQuery, "from" | "to"> & { from: Date; to: Date };
type LocatedItem = TimeItem & { at: number };
const dayMs = 86_400_000;

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

    const todos = async (field: "scheduledAt" | "dueAt") => {
      const rows = await this.db.ownerTodoItem.findMany({
        where: { ...bot, ...(query.outcomeId ? { linkedOutcomeId: query.outcomeId } : {}), ownerId,
          ...(query.mine ? { executor: "owner" } : {}), status: { in: ["open", "waiting", "done"] }, [field]: range },
        select: { id: true, title: true, executor: true, status: true, dueAt: true, scheduledAt: true, snoozeUntil: true,
          followUpAt: true, botId: true, linkedOutcomeId: true, updatedAt: true },
        orderBy: [{ [field]: "asc" }, { id: "asc" }], take,
      });
      return rows.map((row): LocatedItem => {
        const at = row[field]!;
        const isDue = field === "dueAt";
        const { displayState, overdue } = deriveTodoDisplayState(row, now, timeZone);
        return {
          at: at.getTime(), id: `todo:${row.id}${isDue ? ":due" : ""}`, kind: "todo", title: row.title,
          start: isDue ? null : at.toISOString(), ...(isDue ? deadline(at) : { allDay: false, end: null }),
          timeBasis: isDue ? "due" : "scheduled", state: displayState, overdue,
          owner: row.executor === "owner" ? "me" : row.executor,
          ...(row.botId ? { botId: row.botId } : {}), ...(row.linkedOutcomeId ? { outcomeId: row.linkedOutcomeId } : {}),
          link: { type: "todo", id: row.id }, editable: row.executor === "owner" && row.status !== "done", updatedAt: row.updatedAt.toISOString(),
        };
      });
    };

    const [goalRows, ...sources] = await Promise.all([
      goals,
      ...(hasKind("human_task") ? [work("human_task", "scheduledAt"), work("human_task", "dueAt")] : []),
      ...(hasKind("work_item") && !query.mine ? [work("work_item", "scheduledAt"), work("work_item", "dueAt"), work("work_item", "completedAt")] : []),
      ...(hasKind("todo") ? [todos("scheduledAt"), todos("dueAt")] : []),
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
}
