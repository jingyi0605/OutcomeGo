import type { TimeItem, TimeItemKind } from "@outcomego/contracts/task-overview";

/** Calendar item kinds counted in the sidebar's today badge: goals (deadlines & scheduled) + to-dos. */
export const TODAY_CALENDAR_KINDS: readonly TimeItemKind[] = [
  "goal_due",
  "scheduled_once",
  "todo",
];

/** Fallback kinds when connected to a server that predates `scheduled_once` in `/api/schedule`. */
export const LEGACY_TODAY_CALENDAR_KINDS: readonly TimeItemKind[] = ["goal_due", "todo"];

const TODAY_CALENDAR_KIND_SET: ReadonlySet<TimeItemKind> = new Set(TODAY_CALENDAR_KINDS);

const DONE_CALENDAR_STATES: ReadonlySet<string> = new Set([
  "completed",
  "accepted",
  "cancelled",
  "skipped",
  "archived",
]);

/** Counts unfinished goals and to-dos scheduled or due today, deduplicated by outcome id. */
export function countTodayCalendarItems(items: readonly TimeItem[]): number {
  const seen = new Set<string>();
  for (const item of items) {
    if (!TODAY_CALENDAR_KIND_SET.has(item.kind)) continue;
    if (DONE_CALENDAR_STATES.has(item.state)) continue;
    seen.add(item.outcomeId ?? item.id);
  }
  return seen.size;
}

/** Goals per Bot: the floating window's yellow badge. */
export function countByBot(items: ReadonlyArray<{ botId: string | null }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) if (item.botId) counts[item.botId] = (counts[item.botId] ?? 0) + 1;
  return counts;
}

export const sameCounts = (
  left: Readonly<Record<string, number>> = {},
  right: Readonly<Record<string, number>> = {}
) => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
};
