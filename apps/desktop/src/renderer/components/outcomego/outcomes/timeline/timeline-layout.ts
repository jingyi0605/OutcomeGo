import type { RunSegmentView, WorkItemView } from "@outcomego/contracts/outcomes";
import {
  deriveWorkItemDisplayState,
  hasUnfinishedDependency,
  type WorkItemDisplayState,
} from "@outcomego/contracts/task-overview";

/**
 * Layout for the goal timeline (specs/004.10 design §5.6). Pure: it decides which segments, gaps, links and
 * unscheduled tasks exist and leaves drawing to the component. Times are facts read from task and run records.
 * Nothing here predicts a date, estimates a finish or invents a start for a task that has none.
 */

/**
 * A work item as the timeline reads it. `scheduledAt` is not on the shared view yet (a later task adds it);
 * it is accepted here so a deferred task can say when it resumes, and is simply absent until then.
 */
export type TimelineWorkItem = WorkItemView & { scheduledAt?: string | null };

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

export interface TimelineLayout {
  rows: TimelineRow[];
  unscheduled: TimelineUnscheduled[];
  links: TimelineLink[];
  /** Earliest known start to now (or the latest end when later). Null when no task has any time. */
  axis: { start: string; end: string } | null;
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

export function buildTimelineLayout(
  workItems: readonly TimelineWorkItem[],
  now: Date,
  currentRevision?: number | null
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
    };
  });

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

  const stamps = rows.flatMap((row) => row.segments.flatMap((segment) => [segment.start, segment.end]));
  const axis = stamps.length
    ? {
        start: stamps.reduce((min, value) => (value < min ? value : min)),
        end: [nowIso, ...stamps].reduce((max, value) => (value > max ? value : max)),
      }
    : null;

  return { rows, unscheduled, links, axis };
}
