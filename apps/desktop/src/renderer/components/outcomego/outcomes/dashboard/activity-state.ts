import type { ActivityItem } from "@outcomego/contracts/task-overview";
import type { TimelineTone } from "../timeline/timeline-status";

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

/** The states an activity item can be in: those of a request, a routine and a goal's bot task. */
export const ACTIVITY_STATE_STYLE: Record<string, ActivityStateStyle> = {
  in_progress: { label: "In progress", icon: "▶", tone: "review", animated: true },
  verifying: { label: "Verifying", icon: "◎", tone: "review", animated: false },
  waiting: { label: "Waiting", icon: "⧗", tone: "plan", animated: false },
  check_not_fired: { label: "Check did not fire", icon: "!", tone: "action", animated: false },
  needs_owner: { label: "Needs you", icon: "?", tone: "action", animated: false },
  blocked: { label: "Blocked", icon: "✕", tone: "fail", animated: false },
  no_follow_up: { label: "No one is following up", icon: "!", tone: "action", animated: false },
  completed: { label: "Completed", icon: "✓", tone: "pass", animated: false },
  queued: { label: "Queued", icon: "⧗", tone: "plan", animated: false },
  cancelled: { label: "Cancelled", icon: "–", tone: "muted", animated: false },
  running: { label: "Running", icon: "▶", tone: "review", animated: true },
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
  in_progress: "working", verifying: "working", running: "working",
  waiting: "waiting", scheduled: "waiting", deferred: "waiting", paused: "waiting", idle: "waiting",
  blocked: "blocked", failed: "blocked", check_not_fired: "blocked", no_follow_up: "blocked", needs_owner: "blocked",
};

/** Which of the three counts a state belongs to in a group's summary. Finished and skipped work is counted in none. */
export const activityBucket = (state: string): ActivityBucket => BUCKETS[state] ?? "other";

/** What is drawn here: everything not already on the owner's "needs me" list, so nothing shows twice. */
export const visibleActivity = (items: readonly ActivityItem[]): ActivityItem[] => items.filter((item) => !item.needsOwner);

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

export type DashboardLayout = "both" | "activity" | "lanes";

/**
 * What the owner chose to compare: the activity area, the goal lanes, or both. It only decides these two; the
 * owner's "needs you" area shows in every layout, and nothing here removes anything for good.
 */
export function dashboardSections(layout: unknown): { activity: boolean; lanes: boolean } {
  if (layout === "activity") return { activity: true, lanes: false };
  if (layout === "lanes") return { activity: false, lanes: true };
  return { activity: true, lanes: true };
}
