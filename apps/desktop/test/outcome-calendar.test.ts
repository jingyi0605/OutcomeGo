import { expect, test } from "bun:test";
import type { TimeItem } from "@outcomego/contracts/task-overview";
import { calendarDays, dayStart, defaultCalendarKinds, itemsByDay } from "../src/renderer/components/outcomego/outcomes/calendar/calendar-dates";

test("calendar sources start with the five task and follow-up kinds", () => {
  expect(defaultCalendarKinds).toEqual(["goal_due", "human_task", "work_item", "todo", "follow_up"]);
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
