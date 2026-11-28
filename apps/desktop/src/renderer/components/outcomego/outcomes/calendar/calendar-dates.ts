import { localDateOf, type TimeItem, type TimeItemKind } from "@outcomego/contracts/task-overview";

export const defaultCalendarKinds: readonly TimeItemKind[] = ["goal_due", "human_task", "work_item", "group_task", "todo", "follow_up", "scheduled_once"];

export type CalendarView = "day" | "week" | "month";

const dateParts = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
};

export function dayStart(value: string, timeZone: string): Date {
  const utc = Date.parse(value);
  let lower = utc - 86_400_000;
  let upper = utc + 86_400_000;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (localDateOf(new Date(middle), timeZone) < value) lower = middle + 1;
    else upper = middle;
  }
  return new Date(lower);
}

export function shiftDate(value: string, amount: number): string {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

export function movePeriod(value: string, view: CalendarView, amount: number): string {
  if (view !== "month") return shiftDate(value, amount * (view === "week" ? 7 : 1));
  const { year, month } = dateParts(value);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 10);
}

export function moveToCalendarDate(instant: string, date: string, timeZone: string): string {
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const source = new Date(instant);
  const requested = `${date}T${clock.format(source)}.${String(source.getUTCMilliseconds()).padStart(3, "0")}Z`;
  const requestedMs = Date.parse(requested);
  let result = requestedMs;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = new Date(result);
    const local = `${localDateOf(current, timeZone)}T${clock.format(current)}.${String(current.getUTCMilliseconds()).padStart(3, "0")}Z`;
    const difference = requestedMs - Date.parse(local);
    if (!difference) return current.toISOString();
    result += difference;
  }
  throw new Error("invalid_schedule");
}

export function calendarDays(value: string, view: CalendarView): string[] {
  const { year, month, day } = dateParts(value);
  if (view === "day") return [value];
  if (view === "week") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    return Array.from({ length: 7 }, (_, index) => shiftDate(value, mondayOffset + index));
  }
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const firstWeekday = first.getUTCDay() === 0 ? 6 : first.getUTCDay() - 1;
  const count = Math.ceil((firstWeekday + last.getUTCDate()) / 7) * 7;
  return Array.from({ length: count }, (_, index) => shiftDate(value.slice(0, 8) + "01", index - firstWeekday));
}

export function itemsByDay(items: readonly TimeItem[], timeZone: string): Map<string, TimeItem[]> {
  const grouped = new Map<string, TimeItem[]>();
  for (const item of items) {
    if (!item.start && !item.end) continue;
    const instant = item.allDay ? item.end ?? item.start : item.start ?? item.end;
    if (!instant) continue;
    const day = item.allDay ? instant : localDateOf(new Date(instant), timeZone);
    const entries = grouped.get(day) ?? [];
    entries.push(item);
    grouped.set(day, entries);
  }
  for (const entries of grouped.values()) entries.sort((left, right) => (left.start ?? left.end ?? "").localeCompare(right.start ?? right.end ?? ""));
  return grouped;
}

export interface CalendarEntry {
  item: TimeItem;
  /** Request follow-ups listed under this to-do. */
  followUps: TimeItem[];
}

/** Lists a request follow-up under the same day's to-do it works on, so one matter reads as one entry. */
export function nestFollowUps(items: readonly TimeItem[]): CalendarEntry[] {
  const todos = new Map<string, TimeItem[]>();
  for (const item of items) if (item.kind === "todo" && item.outcomeId && !todos.has(item.outcomeId)) todos.set(item.outcomeId, []);
  const entries: CalendarEntry[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const siblings = item.relatedOutcomeId ? todos.get(item.relatedOutcomeId) : undefined;
    if (siblings) {
      siblings.push(item);
      continue;
    }
    // A to-do listed twice on one day (scheduled and due) takes its follow-ups once.
    const key = item.kind === "todo" ? item.outcomeId : undefined;
    entries.push({ item, followUps: key && !placed.has(key) ? todos.get(key)! : [] });
    if (key) placed.add(key);
  }
  return entries;
}
