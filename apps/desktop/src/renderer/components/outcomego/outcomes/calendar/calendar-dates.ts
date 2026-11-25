import { localDateOf, type TimeItem, type TimeItemKind } from "@outcomego/contracts/task-overview";

export const defaultCalendarKinds: readonly TimeItemKind[] = ["goal_due", "human_task", "work_item", "todo", "follow_up"];

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
