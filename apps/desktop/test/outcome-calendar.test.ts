import { expect, test } from "bun:test";
import type { TimeItem } from "@outcomego/contracts/task-overview";
import { countTodayCalendarItems } from "../src/renderer/lib/outcome-counts";
import { calendarDays, dayStart, defaultCalendarKinds, itemsByDay, nestFollowUps } from "../src/renderer/components/outcomego/outcomes/calendar/calendar-dates";
import {
  computeCalendarMetrics,
  isSameMonth,
  isWeekend,
  periodContainsDate,
  visibleCountForCell,
} from "../src/renderer/components/outcomego/outcomes/calendar/calendar-layout";

test("calendar sources include one-time arrangements by default", () => {
  expect(defaultCalendarKinds).toEqual(["goal_due", "human_task", "work_item", "group_task", "todo", "follow_up", "scheduled_once"]);
});

test("calendar density adapts progressively from detailed to minimal based on viewport size", () => {
  const large = computeCalendarMetrics({ width: 1280, height: 900, view: "month", weekRows: 5 });
  expect(large.density).toBe("detailed");
  expect(large.showTime).toBe(true);
  expect(large.showMeta).toBe(true);
  expect(large.showTodayLabel).toBe(true);
  expect(large.maxVisibleItems).toBeGreaterThanOrEqual(2);

  const medium = computeCalendarMetrics({ width: 960, height: 640, view: "month", weekRows: 5 });
  expect(medium.density).toBe("comfortable");
  expect(medium.showTime).toBe(true);

  const small = computeCalendarMetrics({ width: 700, height: 480, view: "month", weekRows: 6 });
  expect(small.density).toBe("compact");
  expect(small.showMeta).toBe(false);
  expect(small.maxVisibleItems).toBeGreaterThanOrEqual(1);

  const tiny = computeCalendarMetrics({ width: 480, height: 360, view: "month", weekRows: 6 });
  expect(tiny.density).toBe("minimal");
  expect(tiny.maxVisibleItems).toBe(0);
  expect(tiny.weekdayFormat).toBe("narrow");
  expect(visibleCountForCell(4, tiny)).toBe(0);

  // Day view splits into 2 columns on wide viewports and collapses to 1 on narrow viewports.
  expect(computeCalendarMetrics({ width: 920, height: 700, view: "day", weekRows: 1 }).dayColumns).toBe(2);
  expect(computeCalendarMetrics({ width: 640, height: 700, view: "day", weekRows: 1 }).dayColumns).toBe(1);
});

test("visibleCountForCell avoids redundant overflow labels when all items fit", () => {
  const metrics = computeCalendarMetrics({ width: 1280, height: 900, view: "month", weekRows: 5 });
  expect(visibleCountForCell(0, metrics)).toBe(0);
  expect(visibleCountForCell(metrics.maxVisibleItems, metrics)).toBe(metrics.maxVisibleItems);
  expect(visibleCountForCell(metrics.maxVisibleItems + 3, metrics)).toBe(metrics.maxVisibleItemsWithOverflow);
});

test("calendar date classification helpers distinguish months, weekends and active ranges", () => {
  expect(isSameMonth("2026-11-26", "2026-11-01")).toBe(true);
  expect(isSameMonth("2026-12-01", "2026-11-26")).toBe(false);
  expect(isWeekend("2026-11-28")).toBe(true); // Saturday
  expect(isWeekend("2026-11-29")).toBe(true); // Sunday
  expect(isWeekend("2026-11-26")).toBe(false); // Thursday
  expect(periodContainsDate(calendarDays("2026-11-26", "month"), "2026-11-26")).toBe(true);
  expect(periodContainsDate(calendarDays("2026-12-15", "month"), "2026-11-26")).toBe(false);
});

for (const [zone, date, following, hours] of [
  ["America/New_York", "2026-03-08", "2026-03-09", 23],
  ["Europe/Berlin", "2026-10-25", "2026-10-26", 25],
] as const) {
  test(`owner dates survive the clock change in ${zone}`, () => {
    const start = dayStart(date, zone);
    expect((dayStart(following, zone).getTime() - start.getTime()) / 3_600_000).toBe(hours);
    const base = { id: "a", kind: "goal_due", title: "Fixture A", start: null, end: date, allDay: true, timeBasis: "due", state: "approved", overdue: false, owner: "me", link: { type: "outcome", id: "a" }, editable: true, updatedAt: start.toISOString() } satisfies TimeItem;
    const timed: TimeItem = { ...base, id: "b", allDay: false, end: start.toISOString() };
    expect(itemsByDay([base, timed], zone).get(date)?.map((item) => item.id).sort()).toEqual(["a", "b"]);
    expect(calendarDays(date, "week")).toHaveLength(7);
    expect(calendarDays(date, "day")).toEqual([date]);
    expect(calendarDays(date, "month").length % 7).toBe(0);
  });
}

test("countTodayCalendarItems counts unfinished goals and to-dos deduplicated by outcome id", () => {
  const base: Omit<TimeItem, "id" | "kind" | "state" | "outcomeId"> = {
    title: "Item",
    start: "2026-11-27T09:00:00.000Z",
    end: null,
    allDay: false,
    timeBasis: "scheduled",
    overdue: false,
    owner: "me",
    link: { type: "outcome", id: "x" },
    editable: true,
    updatedAt: "2026-11-27T08:00:00.000Z",
  };
  const items: TimeItem[] = [
    { ...base, id: "goal_due:g1", kind: "goal_due", state: "running", outcomeId: "g1" },
    { ...base, id: "goal_due:g2", kind: "goal_due", state: "accepted", outcomeId: "g2" }, // finished -> excluded
    { ...base, id: "scheduled_once:s1", kind: "scheduled_once", state: "scheduled", outcomeId: "s1" },
    { ...base, id: "scheduled_once:s2", kind: "scheduled_once", state: "cancelled", outcomeId: "s2" }, // cancelled -> excluded
    { ...base, id: "todo:t1", kind: "todo", state: "today", outcomeId: "t1" },
    { ...base, id: "todo:t1:due", kind: "todo", state: "today", outcomeId: "t1" }, // duplicate outcomeId -> deduplicated
    { ...base, id: "todo:t2", kind: "todo", state: "waiting", outcomeId: "t2" },
    { ...base, id: "todo:t3", kind: "todo", state: "accepted", outcomeId: "t3" }, // finished -> excluded
    { ...base, id: "work_item:w1", kind: "work_item", state: "queued", outcomeId: "g1" }, // non-goal/todo -> excluded
    { ...base, id: "routine_run:r1:1", kind: "routine_run", state: "scheduled" }, // routine -> excluded
  ];
  expect(countTodayCalendarItems(items)).toBe(4); // g1 + s1 + t1 + t2
});

test("a request follow-up is listed under the same day's to-do it works on", () => {
  const item = (id: string, kind: TimeItem["kind"], extra: Partial<TimeItem> = {}): TimeItem => ({
    id, kind, title: id, start: "2026-11-27T06:00:00.000Z", end: null, allDay: false, timeBasis: "scheduled",
    state: "waiting", overdue: false, owner: "bot", link: { type: "channel", id: "c" }, editable: false,
    updatedAt: "2026-11-27T01:00:00.000Z", ...extra,
  });
  const shape = (items: TimeItem[]) => nestFollowUps(items).map((entry) => [entry.item.id, entry.followUps.map((followUp) => followUp.id)]);
  const linked = item("check", "follow_up", { relatedOutcomeId: "t1" });
  const scheduled = item("todo", "todo", { outcomeId: "t1" });
  const due = item("todo:due", "todo", { outcomeId: "t1" });

  expect(shape([linked, scheduled, due])).toEqual([["todo", ["check"]], ["todo:due", []]]);
  // Without that to-do on the day (another day, or filtered out) the follow-up stands on its own.
  expect(shape([linked, item("other", "todo", { outcomeId: "t2" })])).toEqual([["check", []], ["other", []]]);
  expect(shape([item("unlinked", "follow_up"), scheduled])).toEqual([["unlinked", []], ["todo", []]]);
});
