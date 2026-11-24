import type {
  AgentWorkItemStatus,
  HumanWorkItemStatus,
  WorkItemExecutorType,
  WorkItemStatus,
} from "./outcomes";

/**
 * Display states shared by the activity view, the "needs me" queue, the goal timeline, the calendar and
 * calendar feeds (specs/004.10 design §2.2). Everything here is derived when it is read and never stored;
 * the task state machine and the Outcome status derivation are unchanged.
 *
 * Business numbers (tolerances, retention hours) are never defined in this file. Callers pass them in from the
 * task policy, so changing a policy takes effect without a code change.
 */

// ---------------------------------------------------------------------------
// Requests (Run.requestProgress)
// ---------------------------------------------------------------------------

export type RequestProgressState = "working" | "waiting" | "blocked" | "complete";
export type RequestBlockSource = "user" | "policy" | "tool" | "runtime";

export type RequestDisplayState =
  | "in_progress"
  | "verifying"
  | "waiting"
  | "check_not_fired"
  | "needs_owner"
  | "blocked"
  | "no_follow_up"
  | "completed";

export interface RequestDisplayInput {
  state: RequestProgressState;
  blockSource?: RequestBlockSource | undefined;
  /** How many times the runtime has privately asked the parent to reconcile this request. */
  reconciliations: number;
  /** When the saved check is due. Null when none is recorded. */
  nextCheckAt: Date | null;
}

/**
 * A request is only presented, never changed: "verifying", "no one following up" and "check not fired" are
 * read off fields the request progress record already keeps (design §3.5, property 11).
 */
export function deriveRequestDisplayState(
  input: RequestDisplayInput,
  now: Date,
  policy: { checkOverdueMinutes: number }
): RequestDisplayState {
  switch (input.state) {
    case "working":
      // The runtime moves a request to blocked once its reminders are used up, so any working request that
      // has been reconciled at all is in the verifying stage.
      return input.reconciliations > 0 ? "verifying" : "in_progress";
    case "waiting": {
      if (!input.nextCheckAt) return "waiting";
      const overdueMs = now.getTime() - input.nextCheckAt.getTime();
      return overdueMs > policy.checkOverdueMinutes * 60_000 ? "check_not_fired" : "waiting";
    }
    case "blocked":
      if (input.blockSource === "user" || input.blockSource === "policy") return "needs_owner";
      if (input.blockSource === "runtime") return "no_follow_up";
      return "blocked";
    case "complete":
      return "completed";
  }
}

/** Whether a finished request is still inside the "recently completed" window set by policy. */
export function isRecentlyCompleted(completedAt: Date, now: Date, recentCompletedHours: number): boolean {
  return now.getTime() - completedAt.getTime() <= recentCompletedHours * 3_600_000;
}

// ---------------------------------------------------------------------------
// Work items (bot tasks and human tasks of a goal)
// ---------------------------------------------------------------------------

export type WorkItemDisplayState =
  | WorkItemStatus
  | "waiting_dependency"
  | "scheduled"
  | "deferred"
  | "missed_schedule";

export interface WorkItemDisplayInput {
  executorType: WorkItemExecutorType;
  status: WorkItemStatus;
  statusReason: string | null;
  scheduledAt: Date | null;
  hasUnfinishedDependency: boolean;
}

/** Dependencies count as finished in exactly these states: the same rule the dispatcher uses to release a task. */
const FINISHED_DEPENDENCY_STATUSES: readonly WorkItemStatus[] = ["completed", "accepted"];

export function hasUnfinishedDependency(
  dependsOn: readonly string[],
  statusById: ReadonlyMap<string, WorkItemStatus>
): boolean {
  return dependsOn.some((id) => {
    const status = statusById.get(id);
    return status === undefined || !FINISHED_DEPENDENCY_STATUSES.includes(status);
  });
}

/**
 * Only a queued bot task gets a derived state; every other task keeps its stored status. Scheduled, deferred and
 * missed-schedule are reads of the existing status, reason and date, not new stored states.
 */
export function deriveWorkItemDisplayState(input: WorkItemDisplayInput, now: Date): WorkItemDisplayState {
  if (input.executorType !== "agent" || input.status !== "queued") return input.status;
  if (input.statusReason === "missed_schedule") return "missed_schedule";
  if (input.scheduledAt && input.scheduledAt.getTime() > now.getTime()) {
    return input.statusReason === "deferred_by_agent" ? "deferred" : "scheduled";
  }
  // A due time that has arrived does not hide a dependency that is still open: the dependency is what holds
  // the task back.
  return input.hasUnfinishedDependency ? "waiting_dependency" : "queued";
}

// ---------------------------------------------------------------------------
// Overdue (an overlay, never a state)
// ---------------------------------------------------------------------------

/** Nothing without a due date is ever overdue; nothing finished is overdue. */
export function isOverdue(dueAt: Date | null, now: Date, finished: boolean): boolean {
  return dueAt !== null && !finished && dueAt.getTime() < now.getTime();
}

const FINISHED_AGENT_STATUSES: readonly AgentWorkItemStatus[] = ["completed", "failed", "cancelled"];
/** Human work stops being overdue once a receipt is in, or the task is closed. */
const FINISHED_HUMAN_STATUSES: readonly HumanWorkItemStatus[] = ["submitted", "review_pending", "accepted", "cancelled"];

export function isWorkItemOverdue(
  input: { executorType: WorkItemExecutorType; status: WorkItemStatus; dueAt: Date | null },
  now: Date
): boolean {
  const finished =
    input.executorType === "agent"
      ? FINISHED_AGENT_STATUSES.includes(input.status as AgentWorkItemStatus)
      : FINISHED_HUMAN_STATUSES.includes(input.status as HumanWorkItemStatus);
  return isOverdue(input.dueAt, now, finished);
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export type RoutineDisplayState = "running" | "failed" | "skipped" | "paused" | "idle";
export type RoutineExecutionState = "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";

/** The latest execution decides first; a pause never hides a failure or a run in flight. */
export function deriveRoutineDisplayState(input: {
  pausedAt: Date | null;
  lastExecutionStatus: RoutineExecutionState | null;
}): RoutineDisplayState {
  if (input.lastExecutionStatus === "running" || input.lastExecutionStatus === "queued") return "running";
  if (input.lastExecutionStatus === "failed") return "failed";
  if (input.lastExecutionStatus === "skipped") return "skipped";
  return input.pausedAt ? "paused" : "idle";
}

export type DisplayState = RequestDisplayState | WorkItemDisplayState | RoutineDisplayState;

// ---------------------------------------------------------------------------
// Dates in the owner's time zone
// ---------------------------------------------------------------------------

/** The calendar date (YYYY-MM-DD) an instant falls on in a time zone. Calendar and feed all-day items use it. */
export function localDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// ---------------------------------------------------------------------------
// Shared read models (types only; sources are added by later tasks)
// ---------------------------------------------------------------------------

export type TimeItemKind = "goal_due" | "work_item" | "human_task" | "todo" | "follow_up" | "routine_run" | "external_event";

export interface TimeItem {
  /** Stable: `<kind>:<source id>[:<sequence>]`. The same thing always has the same id (calendar feed UID). */
  id: string;
  kind: TimeItemKind;
  title: string;
  /** ISO 8601, UTC. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  timeBasis: "actual" | "scheduled" | "estimated" | "due";
  state: DisplayState;
  overdue: boolean;
  owner: "me" | "bot" | "external";
  botId?: string;
  outcomeId?: string;
  link: { type: string; id: string };
  editable: boolean;
  updatedAt: string;
}

export type ActivityItemType = "request" | "routine" | "goal_task";

export interface ActivityItem {
  /** Stable: `<type>:<source id>`. */
  id: string;
  type: ActivityItemType;
  botId: string;
  title: string;
  state: DisplayState;
  /** Why it is blocked or waiting. Bot-written text: render as plain text and label it as written by the bot. */
  reason: string | null;
  doing: string | null;
  progress: { done: number; total: number; phase?: string } | null;
  lastActivityAt: string;
  nextCheckAt: string | null;
  /** True when the item already shows in the "needs me" queue, so the activity list does not repeat it. */
  needsOwner: boolean;
  link: { type: string; id: string };
  /** Executors summarised under a request. */
  workerCount?: number;
}
