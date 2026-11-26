import { expect, test } from "bun:test";
import type { TimeItem } from "@outcomego/contracts/task-overview";
import { calendarDays, dayStart, defaultCalendarKinds, itemsByDay } from "../src/renderer/components/outcomego/outcomes/calendar/calendar-dates";
import {
  computeCalendarMetrics,
  isSameMonth,
  isWeekend,
  periodContainsDate,
  visibleCountForCell,
} from "../src/renderer/components/outcomego/outcomes/calendar/calendar-layout";

test("calendar sources include one-time arrangements by default", () => {
  expect(defaultCalendarKinds).toEqual(["goal_due", "human_task", "work_item", "todo", "follow_up", "scheduled_once"]);
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
