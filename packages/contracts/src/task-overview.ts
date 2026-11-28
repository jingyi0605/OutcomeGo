import { MISSED_SCHEDULE_REASON_CODE } from "./outcome-inbox-categories";
import type {
  AgentWorkItemStatus,
  HumanWorkItemStatus,
  OutcomeStatus,
  OutcomeStatusFor,
  OutcomeSummary,
  OutcomeUrgency,
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
  if (input.statusReason === MISSED_SCHEDULE_REASON_CODE) return "missed_schedule";
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

/** A task is finished for display when nothing more is expected of it: it ended, or the human's receipt is in. */
export function isWorkItemFinished(input: { executorType: WorkItemExecutorType; status: WorkItemStatus }): boolean {
  return input.executorType === "agent"
    ? FINISHED_AGENT_STATUSES.includes(input.status as AgentWorkItemStatus)
    : FINISHED_HUMAN_STATUSES.includes(input.status as HumanWorkItemStatus);
}

/**
 * Whether the owner can still change a task's schedule: a bot task that is waiting its turn, or a person's task until
 * the receipt is in. A preview for deciding whether to offer the control; the server decides and answers 409
 * `schedule_not_editable` (for example when a queued task's turn is already running).
 */
export function isWorkItemScheduleEditable(input: { executorType: WorkItemExecutorType; status: WorkItemStatus }): boolean {
  return input.executorType === "agent" ? input.status === "queued" : !isWorkItemFinished(input);
}

export function isWorkItemOverdue(
  input: { executorType: WorkItemExecutorType; status: WorkItemStatus; dueAt: Date | null },
  now: Date
): boolean {
  return isOverdue(input.dueAt, now, isWorkItemFinished(input));
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

let dateFormat: Intl.DateTimeFormat | undefined;
let dateFormatZone: string | undefined;

/** The calendar date (YYYY-MM-DD) an instant falls on in a time zone. Calendar and feed all-day items use it. */
export function localDateOf(instant: Date, timeZone: string): string {
  if (!dateFormat || dateFormatZone !== timeZone) {
    dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatZone = timeZone;
  }
  const parts = dateFormat.formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export type OutcomeTodoAttention = "overdue" | "today" | "follow_up" | "suggested";
export type OutcomeTodoDisplayState = OutcomeStatusFor<"todo"> | "today" | "this_week" | "upcoming" | "unscheduled" | "snoozed" | "follow_up";

export interface OutcomeTodoDigest {
  date: string;
  counts: Record<OutcomeTodoAttention, number>;
  titles: string[];
}

export interface OutcomeTodoAttentionItem {
  key: string;
  attention: OutcomeTodoAttention;
  urgency: OutcomeUrgency;
  since: string;
  outcome: OutcomeSummary;
}

const ATTENTION_RANK: Record<OutcomeTodoAttention, number> = { overdue: 0, today: 1, follow_up: 1, suggested: 2 };
const URGENCY_RANK: Record<OutcomeUrgency, number> = { high: 0, normal: 1, low: 2 };

type OutcomeTodoAttentionOrder = Pick<OutcomeTodoAttentionItem, "key" | "attention" | "urgency" | "since">;

export function compareOutcomeTodoAttention(left: OutcomeTodoAttentionOrder, right: OutcomeTodoAttentionOrder): number {
  return ATTENTION_RANK[left.attention] - ATTENTION_RANK[right.attention] ||
    URGENCY_RANK[left.urgency] - URGENCY_RANK[right.urgency] ||
    left.since.localeCompare(right.since) || left.key.localeCompare(right.key);
}

interface OutcomeTodoSchedule {
  status: OutcomeStatusFor<"todo">;
  dueAt: Date | null;
  scheduledAt: Date | null;
  snoozeUntil: Date | null;
  followUpAt: Date | null;
}

export function deriveOutcomeTodoAttention(input: OutcomeTodoSchedule & { expiresAt: Date | null }, now: Date, timeZone: string): OutcomeTodoAttention | null {
  const { status, dueAt, followUpAt, expiresAt } = input;
  if (input.snoozeUntil && input.snoozeUntil > now) return null;
  if (status === "suggested") return expiresAt && expiresAt <= now ? null : "suggested";
  if (status !== "open" && status !== "waiting") return null;
  if (isOverdue(dueAt, now, false)) return "overdue";
  if (status === "waiting" && followUpAt && followUpAt <= now) return "follow_up";
  const date = dueAt ?? (status === "open" ? input.scheduledAt : null);
  return date && localDateOf(date, timeZone) === localDateOf(now, timeZone) ? "today" : null;
}

export function deriveOutcomeTodoDisplayState(input: OutcomeTodoSchedule, now: Date, timeZone: string): { displayState: OutcomeTodoDisplayState; overdue: boolean } {
  const { status, dueAt, scheduledAt, snoozeUntil, followUpAt } = input;
  const overdue = isOverdue(dueAt, now, status !== "open" && status !== "waiting");
  if (status === "accepted" || status === "cancelled") return { displayState: status, overdue };
  if (snoozeUntil && snoozeUntil > now) return { displayState: "snoozed", overdue };
  if (status === "suggested") return { displayState: "suggested", overdue };
  if (status === "waiting") return { displayState: followUpAt && followUpAt <= now ? "follow_up" : "waiting", overdue };
  const date = dueAt ?? scheduledAt;
  if (!date) return { displayState: "unscheduled", overdue };
  const today = localDateOf(now, timeZone);
  const target = localDateOf(date, timeZone);
  const weekEnd = new Date(`${today}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + (7 - weekEnd.getUTCDay()) % 7);
  return { displayState: target <= today ? "today" : target <= weekEnd.toISOString().slice(0, 10) ? "this_week" : "upcoming", overdue };
}

// ---------------------------------------------------------------------------
// Shared read models (types only; sources are added by later tasks)
// ---------------------------------------------------------------------------

export const CALENDAR_FEED_KINDS = ["goal_due", "work_item", "human_task", "todo", "follow_up", "routine_run", "scheduled_once", "note"] as const;
export const TIME_ITEM_KINDS = [...CALENDAR_FEED_KINDS, "group_task", "external_event"] as const;
export type TimeItemKind = (typeof TIME_ITEM_KINDS)[number];
export type CalendarFeedKind = (typeof CALENDAR_FEED_KINDS)[number];

export interface CreateCalendarFeedInput {
  name: string;
  kinds: CalendarFeedKind[];
  includeLinks?: boolean;
}

export interface CalendarFeedView {
  id: string;
  name: string;
  kinds: CalendarFeedKind[];
  includeLinks: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CalendarFeedListResponse {
  items: CalendarFeedView[];
}

export interface CreatedCalendarFeed extends CalendarFeedView {
  url: string;
}

export interface ExternalCalendarSummary {
  id: string;
  name: string;
  primary: boolean;
}

export interface ExternalCalendarListResponse {
  calendars: ExternalCalendarSummary[];
  unavailable?: { code: string; message: string };
}

export interface ExternalCalendarResponse {
  items: TimeItem[];
  unavailable?: { code: string; message: string };
}

export const SCHEDULE_RANGE_DAYS = 93;
export const SCHEDULE_ITEM_LIMIT = 1000;

export interface ScheduleQuery {
  from: string;
  to: string;
  kinds?: readonly TimeItemKind[];
  botId?: string;
  outcomeId?: string;
  mine?: boolean;
}

export interface ScheduleResponse {
  items: TimeItem[];
  truncated: boolean;
}

export interface TimeItem {
  /** Stable: `<kind>:<source id>[:<sequence>]`. The same thing always has the same id (calendar feed UID). */
  id: string;
  kind: TimeItemKind;
  title: string;
  /** ISO 8601 UTC for timed items, YYYY-MM-DD in the owner's zone for all-day items. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  timeBasis: "actual" | "scheduled" | "estimated" | "due";
  state: DisplayState | OutcomeStatus | OutcomeTodoDisplayState;
  overdue: boolean;
  owner: "me" | "bot" | "external";
  botId?: string;
  outcomeId?: string;
  /** The to-do a request follow-up works on; views list the follow-up under it. It opens through `link`. */
  relatedOutcomeId?: string;
  link: { type: "outcome" | "work_item" | "conversation" | "channel" | "routine" | "external"; id: string };
  editable: boolean;
  updatedAt: string;
}

export type ActivityItemType = "request" | "routine" | "goal_task" | "scheduled_once" | "group_task";

export interface ActivityItem {
  /** Stable: `<type>:<source id>`. */
  id: string;
  type: ActivityItemType;
  botId: string;
  title: string;
  state: DisplayState | "preparing";
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
  /** The to-do a request works on, when the bot linked one. */
  relatedOutcome?: { id: string; title: string };
}

// ---------------------------------------------------------------------------
// Owner views of request progress and the activity list (specs/004.10 design §3.2, §3.8)
// ---------------------------------------------------------------------------

/** Longest title of a request in the activity list: the start of the owner's own message. A format limit, not a policy value. */
export const ACTIVITY_TITLE_LIMIT = 120;
/** The most items one activity query returns. A scale limit: more than this comes back with `truncated`. */
export const ACTIVITY_LIST_LIMIT = 200;

/**
 * What the owner sees of a request's progress. Everything in it was written by the bot, so clients show it as plain
 * text and say so. It never carries `evidence` or `toolError`; those are only in the single-request detail.
 */
export interface RequestProgressView {
  requestRunId: string;
  botId: string;
  state: RequestProgressState;
  summary: string;
  remaining: string[];
  nextAction: string | null;
  blockSource: RequestBlockSource | null;
  checkAt: string | null;
  deadline: string | null;
  updatedAt: string;
  revision: number;
  reconciliations: number;
}

/** The detail of one request: the list view plus what the list leaves out. Owner only. */
export interface RequestProgressDetailView extends RequestProgressView {
  title: string;
  displayState: DisplayState;
  evidence: string[];
  toolError: string | null;
}

export interface ActivityResponse {
  items: ActivityItem[];
  upcoming?: Array<ActivityItem & { runAt: string }>;
  /** True when more than {@link ACTIVITY_LIST_LIMIT} items matched and the rest were left out. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// The owner's "needs me" queue (specs/004.10 design §2.4, §3.8)
// ---------------------------------------------------------------------------

/** The states of a request that put it in the owner's queue. Every other state leaves it to the activity list. */
export type NeedsMeState = Extract<RequestDisplayState, "needs_owner" | "no_follow_up" | "check_not_fired">;

/** `exception`: nobody is following the work up. `blocked`: the owner's answer is what the work waits for. */
export type NeedsMeZone = "exception" | "blocked";

/** The zone a request state belongs to, or null when it does not need the owner. A zone never depends on urgency. */
export function needsMeZone(state: DisplayState): NeedsMeZone | null {
  if (state === "no_follow_up" || state === "check_not_fired") return "exception";
  if (state === "needs_owner") return "blocked";
  return null;
}

/** One request waiting on the owner. Its text was written by the bot: clients render it as plain text and say so. */
export interface NeedsMeItem {
  /** Stable: `<source>:<source id>`, the key the queue is deduplicated by. */
  key: string;
  source: "request";
  botId: string;
  title: string;
  state: NeedsMeState;
  zone: NeedsMeZone;
  reason: string | null;
  /** When the wait began; the longer ago, the earlier in its zone. */
  since: string;
  link: { type: string; id: string };
}

export interface NeedsMeResponse {
  items: NeedsMeItem[];
  todos?: OutcomeTodoAttentionItem[];
  todoDigest?: OutcomeTodoDigest | null;
}

const ZONE_RANK: Record<NeedsMeZone, number> = { exception: 0, blocked: 1 };

/** Zone first, then the longest wait, then the key so the order never flips between reads. */
export function compareNeedsMe(a: Pick<NeedsMeItem, "zone" | "since" | "key">, b: Pick<NeedsMeItem, "zone" | "since" | "key">): number {
  if (a.zone !== b.zone) return ZONE_RANK[a.zone] - ZONE_RANK[b.zone];
  if (a.since !== b.since) return a.since < b.since ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
