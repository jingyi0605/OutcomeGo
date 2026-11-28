import type { OutcomeSummary } from "@outcomego/contracts/outcomes";
import type { ActivityItem } from "@outcomego/contracts/task-overview";
import type { TimelineTone } from "../timeline/timeline-status";
import { BOT_OUTCOME_STATUSES, STUCK_OUTCOME_STATUSES, type AttentionRow } from "./dashboard-state";

/**
 * What the activity area of the dashboard shows and how (specs/004.10 design §3.3). Pure: no number is defined here.
 * The card limit and the layout choice come from the owner's policy as arguments.
 */

export interface ActivityStateStyle {
  /** English source string for the i18n catalog. */
  label: string;
  icon: string;
  tone: TimelineTone;
  /** Only work that is moving animates, and the stylesheet turns that off for reduced motion. */
  animated: boolean;
}

/** The states an activity or in-progress goal item can be in. */
export const ACTIVITY_STATE_STYLE: Record<string, ActivityStateStyle> = {
  in_progress: { label: "In progress", icon: "▶", tone: "review", animated: true },
  verifying: { label: "Verifying", icon: "◎", tone: "review", animated: false },
  waiting: { label: "Waiting", icon: "⧗", tone: "plan", animated: false },
  check_not_fired: { label: "Check did not fire", icon: "!", tone: "action", animated: false },
  needs_owner: { label: "Needs you", icon: "?", tone: "action", animated: false },
  blocked: { label: "Blocked", icon: "✕", tone: "fail", animated: false },
  no_follow_up: { label: "No one is following up", icon: "!", tone: "action", animated: false },
  completed: { label: "Completed", icon: "✓", tone: "pass", animated: false },
  accepted: { label: "Accepted", icon: "✓", tone: "pass", animated: false },
  queued: { label: "Queued", icon: "⧗", tone: "plan", animated: false },
  cancelled: { label: "Cancelled", icon: "–", tone: "muted", animated: false },
  running: { label: "Running", icon: "▶", tone: "review", animated: true },
  planning: { label: "Planning", icon: "◎", tone: "plan", animated: false },
  approved: { label: "Starting execution", icon: "◷", tone: "plan", animated: false },
  failed: { label: "Failed", icon: "✕", tone: "fail", animated: false },
  skipped: { label: "Skipped", icon: "–", tone: "muted", animated: false },
  paused: { label: "Paused", icon: "⏸", tone: "muted", animated: false },
  idle: { label: "Idle", icon: "◌", tone: "muted", animated: false },
  scheduled: { label: "Scheduled", icon: "◷", tone: "plan", animated: false },
  preparing: { label: "Preparing", icon: "◷", tone: "plan", animated: false },
  deferred: { label: "Deferred", icon: "⏸", tone: "plan", animated: false },
};

/** A state this version does not know (a newer server) still shows, as itself, without pretending to mean anything. */
export const styleForActivity = (state: string): ActivityStateStyle =>
  ACTIVITY_STATE_STYLE[state] ?? { label: state, icon: "·", tone: "muted", animated: false };

export type ActivityBucket = "working" | "waiting" | "blocked" | "other";

const BUCKETS: Record<string, ActivityBucket> = {
  in_progress: "working", verifying: "working", running: "working", planning: "working", approved: "working",
  waiting: "waiting", scheduled: "waiting", deferred: "waiting", paused: "waiting", idle: "waiting",
  blocked: "blocked", failed: "blocked", check_not_fired: "blocked", no_follow_up: "blocked", needs_owner: "blocked",
};

/** Which of the three counts a state belongs to in a group's summary. Finished and skipped work is counted in none. */
export const activityBucket = (state: string): ActivityBucket => BUCKETS[state] ?? "other";

/** What is drawn here: everything not already on the owner's "needs me" list, so nothing shows twice. */
export const visibleActivity = (items: readonly ActivityItem[]): ActivityItem[] => items.filter((item) => !item.needsOwner);

/** Finished work that belongs in "Recently completed" rather than "In progress". */
export const isCompletedActivity = (item: ActivityItem): boolean => item.state === "completed" || item.state === "accepted";

const compareActivityByRecency = (a: ActivityItem, b: ActivityItem): number =>
  a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : a.id < b.id ? -1 : 1;

export interface ActivityGroup {
  botId: string;
  name: string;
  items: ActivityItem[];
  summary: { working: number; waiting: number; blocked: number };
}

/**
 * One group per bot, in the order of each bot's most recent item; the items keep the order they came in (the server
 * sends the most recently active first). The summary counts what is working, waiting and blocked.
 */
export function groupActivityByBot(items: readonly ActivityItem[], botName: (botId: string) => string): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();
  for (const item of items) {
    let group = groups.get(item.botId);
    if (!group) {
      group = { botId: item.botId, name: botName(item.botId), items: [], summary: { working: 0, waiting: 0, blocked: 0 } };
      groups.set(item.botId, group);
    }
    group.items.push(item);
    const bucket = activityBucket(item.state);
    if (bucket !== "other") group.summary[bucket] += 1;
  }
  return [...groups.values()].sort((a, b) => {
    const latest = (group: ActivityGroup) => group.items.reduce((max, entry) => (entry.lastActivityAt > max ? entry.lastActivityAt : max), "");
    return latest(a) < latest(b) ? 1 : latest(a) > latest(b) ? -1 : 0;
  });
}

/** Cards while the list is short enough to read at a glance, a table past the owner's limit. */
export const activityPresentation = (count: number, cardMaxItems: number): "cards" | "table" => (count <= cardMaxItems ? "cards" : "table");

/**
 * Merges active/waiting/blocked bot activity items with active/paused/failed outcomes into one deduplicated
 * "In progress" stream:
 * - Items already on the owner's "Needs your action" list stay out of this stream.
 * - Completed activity items stay out of "In progress" and are shown in "Recently completed" instead.
 * - Outcomes in planning/approved/running that are already represented by a live goal_task activity row are skipped
 *   so the same goal never shows twice.
 * - Paused and failed outcomes are always included (unless already on the owner's list) so stalled work is never hidden.
 */
export function mergeInProgressItems(
  activity: readonly ActivityItem[] | null | undefined,
  outcomes: readonly OutcomeSummary[],
  attention: readonly AttentionRow[],
): ActivityItem[] {
  const base = visibleActivity(activity ?? []).filter((item) => !isCompletedActivity(item));
  const attentionIds = new Set(attention.map((row) => row.outcomeId));
  const coveredOutcomeIds = new Set(
    base
      .filter((item) => (item.type === "goal_task" || item.type === "scheduled_once") && item.link.type === "outcome")
      .map((item) => item.link.id),
  );
  const synthesized: ActivityItem[] = [];
  for (const outcome of outcomes) {
    if (attentionIds.has(outcome.id)) continue;
    const isWorking = BOT_OUTCOME_STATUSES.includes(outcome.status);
    const isStuck = STUCK_OUTCOME_STATUSES.includes(outcome.status);
    if (!isWorking && !isStuck) continue;
    if (isWorking && coveredOutcomeIds.has(outcome.id)) continue;
    synthesized.push({
      id: `outcome:${outcome.id}`,
      type: "goal_task",
      botId: outcome.botId ?? "",
      title: outcome.title,
      state: outcome.status as ActivityItem["state"],
      reason: null,
      doing: null,
      progress: null,
      lastActivityAt: outcome.updatedAt,
      nextCheckAt: null,
      needsOwner: false,
      link: { type: "outcome", id: outcome.id },
    });
  }
  return [...base, ...synthesized].sort(compareActivityByRecency);
}

/** Completed bot activity items for the collapsible "Recently completed" section. */
export function completedActivityItems(activity: readonly ActivityItem[] | null | undefined): ActivityItem[] {
  return visibleActivity(activity ?? []).filter(isCompletedActivity).sort(compareActivityByRecency);
}
