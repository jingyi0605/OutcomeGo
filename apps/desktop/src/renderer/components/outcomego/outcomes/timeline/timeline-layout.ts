import type { RunSegmentView, WorkItemView } from "@outcomego/contracts/outcomes";
import {
  deriveWorkItemDisplayState,
  hasUnfinishedDependency,
  isOverdue,
  isWorkItemFinished,
  isWorkItemOverdue,
  type WorkItemDisplayState,
} from "@outcomego/contracts/task-overview";

/**
 * Layout for the goal timeline (specs/004.10 design §5.6). Pure: it decides which segments, gaps, links and
 * unscheduled tasks exist and leaves drawing to the component. Times are facts read from task and run records.
 * Nothing here predicts a date, estimates a finish or invents a start for a task that has none.
 */

/** A work item as the timeline reads it: the shared view, whose time fields are absent on older servers. */
export type TimelineWorkItem = WorkItemView;

export interface TimelineSegment {
  runId: string;
  status: RunSegmentView["status"];
  start: string;
  /** For a run still going this is "now", and `ongoing` is true. */
  end: string;
  ongoing: boolean;
}

export interface TimelineRow {
  id: string;
  title: string;
  status: WorkItemView["status"];
  displayState: WorkItemDisplayState;
  executorType: WorkItemView["executorType"];
  /** Human tasks are drawn as a diamond, bot tasks as bars. */
  marker: "bar" | "diamond";
  botId: string | undefined;
  segments: TimelineSegment[];
  /** Time between two runs. It is not run time and is never drawn as a continuous bar. */
  gaps: Array<{ from: string; to: string }>;
  /** When a task the agent deferred will run again; null for every other task. */
  deferredUntil: string | null;
  /**
   * True when the server sent time fields (an empty list means the task never ran). False for a server that
   * sends none: only order and status can be shown then.
   */
  timesKnown: boolean;
  /**
   * The time a bot task that has not run (or was deferred) is scheduled for, or a human task's booked time. A fact
   * read from the task, never a guess. Null for a finished task, whose actual bars say what happened.
   */
  plannedAt: string | null;
  /**
   * The planner's estimate laid out from a real anchor (the scheduled time, or the real start of a running task).
   * Null with no estimate, with nothing to anchor it to, or once the task is over. It is only a bar: it never
   * makes a task late.
   */
  estimate: { minutes: number; from: string; to: string } | null;
  /** The estimate in minutes even when it cannot be anchored, for the list view. */
  estimateMinutes: number | null;
  /** The task's own due time. Null when it has none, and then it can never be overdue. */
  dueAt: string | null;
  overdue: boolean;
  /** Nothing more is expected of the task: it ended, or the human's receipt is in. */
  finished: boolean;
}

export interface TimelineUnscheduled {
  id: string;
  title: string;
  waitingFor: Array<{ id: string; title: string }>;
}

export interface TimelineLink {
  from: string;
  to: string;
  /** End of the predecessor and start of the successor. */
  fromAt: string;
  toAt: string;
}

/** What the timeline needs to know about the goal itself. */
export interface TimelineGoal {
  dueAt: string | null | undefined;
  /** The goal is accepted or cancelled, so a passed due date no longer counts against it. */
  finished: boolean;
}

export interface TimelineLayout {
  rows: TimelineRow[];
  unscheduled: TimelineUnscheduled[];
  links: TimelineLink[];
  /**
   * The earliest to the latest known time, always including now: runs, planned times, estimate ends and due times.
   * Null when nothing carries a time, so no date is ever made up.
   */
  axis: { start: string; end: string } | null;
  /** The goal's due flag, with whether it is overdue. Null when the goal has no due time. */
  goal: { dueAt: string; overdue: boolean } | null;
}

const KIND_ORDER: Record<WorkItemView["kind"], number> = { initial: 0, rework: 1, supplement: 2, human_action: 3 };

/**
 * Plan tasks in dependency order, then the rest by kind and ordinal. Each step takes the lowest-ordinal task whose
 * planned dependencies are already placed; in a cycle nothing is ready, so the lowest ordinal goes next. The order
 * is stable and no task is ever dropped or left looping.
 */
function orderItems(items: readonly TimelineWorkItem[]): TimelineWorkItem[] {
  const byOrdinal = [...items].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.ordinal - b.ordinal);
  const remaining = byOrdinal.filter((item) => item.kind === "initial");
  const rest = byOrdinal.filter((item) => item.kind !== "initial");
  const plannedIds = new Set(remaining.map((item) => item.id));
  const placed = new Set<string>();
  const ordered: TimelineWorkItem[] = [];
  while (remaining.length) {
    const ready = remaining.findIndex((item) => item.dependsOn.every((id) => !plannedIds.has(id) || placed.has(id)));
    const [next] = remaining.splice(ready === -1 ? 0 : ready, 1);
    placed.add(next!.id);
    ordered.push(next!);
  }
  return [...ordered, ...rest];
}

const validTime = (value: string | null | undefined): string | null =>
  value && !Number.isNaN(Date.parse(value)) ? value : null;

export function buildTimelineLayout(
  workItems: readonly TimelineWorkItem[],
  now: Date,
  currentRevision?: number | null,
  goalInput?: TimelineGoal
): TimelineLayout {
  const items = orderItems(
    currentRevision == null ? workItems : workItems.filter((item) => item.contractRevision === currentRevision)
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  const statusById = new Map(items.map((item) => [item.id, item.status] as const));
  const nowIso = now.toISOString();

  const rows: TimelineRow[] = items.map((item) => {
    const timesKnown = item.runSegments !== undefined || item.startedAt !== undefined || item.completedAt !== undefined;
    const segments: TimelineSegment[] = (item.runSegments ?? []).map((segment) => ({
      runId: segment.id,
      status: segment.status,
      start: segment.startedAt,
      end: segment.completedAt ?? nowIso,
      ongoing: segment.completedAt === null && segment.status === "running",
    }));
    // A run with no recorded end that is not running (it was cut off) is drawn to its own start, not to now.
    for (const entry of segments) if (entry.end === nowIso && !entry.ongoing) entry.end = entry.start;
    const gaps = segments.slice(1).map((segment, index) => ({ from: segments[index]!.end, to: segment.start }));
    const scheduledAt = item.scheduledAt ? new Date(item.scheduledAt) : null;
    const displayState = deriveWorkItemDisplayState(
      {
        executorType: item.executorType,
        status: item.status,
        statusReason: item.statusReason,
        scheduledAt,
        hasUnfinishedDependency: hasUnfinishedDependency(item.dependsOn, statusById),
      },
      now
    );
    const finished = isWorkItemFinished(item);
    const scheduled = validTime(item.scheduledAt);
    // A task that has run and is not deferred has its real bars; a planned time only matters for one still to start.
    const plannedAt = !finished && scheduled && (segments.length === 0 || displayState === "deferred") ? scheduled : null;
    const anchor = segments.length > 0 && displayState !== "deferred" ? segments[0]!.start : plannedAt;
    const estimateMinutes = typeof item.estimateMinutes === "number" ? item.estimateMinutes : null;
    const estimate =
      !finished && estimateMinutes !== null && anchor
        ? { minutes: estimateMinutes, from: anchor, to: new Date(Date.parse(anchor) + estimateMinutes * 60_000).toISOString() }
        : null;
    const dueAt = validTime(item.dueAt);
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      displayState,
      executorType: item.executorType,
      marker: item.executorType === "human" ? "diamond" : "bar",
      botId: item.botId,
      segments,
      gaps,
      deferredUntil: displayState === "deferred" ? (item.scheduledAt ?? null) : null,
      timesKnown,
      plannedAt,
      estimate,
      estimateMinutes,
      dueAt,
      finished,
      // Nothing without a due time is overdue, and an estimate that has run out is not a due time.
      overdue: isWorkItemOverdue({ executorType: item.executorType, status: item.status, dueAt: dueAt ? new Date(dueAt) : null }, now),
    };
  });

  const goalDue = validTime(goalInput?.dueAt);
  const goal = goalDue
    ? { dueAt: goalDue, overdue: isOverdue(new Date(goalDue), now, goalInput!.finished) }
    : null;

  // A task with no time of its own that is held back by an open dependency has no place on the axis.
  const unscheduled: TimelineUnscheduled[] = rows.flatMap((row) => {
    const item = byId.get(row.id)!;
    if (row.segments.length > 0 || row.displayState !== "waiting_dependency") return [];
    const waitingFor = item.dependsOn
      .filter((id) => hasUnfinishedDependency([id], statusById))
      .map((id) => ({ id, title: byId.get(id)?.title ?? id }));
    return [{ id: row.id, title: row.title, waitingFor }];
  });

  const links: TimelineLink[] = rows.flatMap((row) => {
    const successorStart = row.segments[0]?.start;
    if (!successorStart) return [];
    return byId.get(row.id)!.dependsOn.flatMap((dependencyId) => {
      const predecessor = rows.find((candidate) => candidate.id === dependencyId);
      const predecessorEnd = predecessor?.segments.at(-1)?.end;
      return predecessor && predecessorEnd && !predecessor.segments.at(-1)!.ongoing
        ? [{ from: dependencyId, to: row.id, fromAt: predecessorEnd, toAt: successorStart }]
        : [];
    });
  });

  const stamps = [
    ...rows.flatMap((row) => [
      ...row.segments.flatMap((segment) => [segment.start, segment.end]),
      ...(row.plannedAt ? [row.plannedAt] : []),
      ...(row.estimate ? [row.estimate.to] : []),
      ...(row.dueAt ? [row.dueAt] : []),
    ]),
    ...(goal ? [goal.dueAt] : []),
  ];
  // Always from the earliest to the latest known time with "now" inside, so the today line is on the axis.
  const axis = stamps.length
    ? {
        start: [nowIso, ...stamps].reduce((min, value) => (value < min ? value : min)),
        end: [nowIso, ...stamps].reduce((max, value) => (value > max ? value : max)),
      }
    : null;

  return { rows, unscheduled, links, axis, goal };
}

/**
 * How an estimate is written: the unit that states it exactly. A whole number of days, or a multiple of half an hour
 * from one hour up, or minutes. Nothing is rounded into a different figure, so the list never says more than was given.
 */
export function formatEstimate(minutes: number): { key: "{value} min" | "{value} h" | "{value} d"; value: number } {
  if (minutes >= 1440 && minutes % 1440 === 0) return { key: "{value} d", value: minutes / 1440 };
  if (minutes >= 60 && minutes % 30 === 0) return { key: "{value} h", value: minutes / 60 };
  return { key: "{value} min", value: minutes };
}
