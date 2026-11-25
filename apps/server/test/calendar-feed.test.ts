import { expect, test } from "bun:test";
import type { TimeItem } from "@outcomego/contracts/task-overview";
import { calendarFeedWindow, renderCalendarFeed } from "../src/services/icalendar";

const now = new Date("2026-03-08T16:00:00Z");
const item: TimeItem = {
  id: "goal_due:fixture", kind: "goal_due", title: "Alpha, beta; \\ text\r\nDESCRIPTION:omit",
  start: null, end: "2026-03-08", allDay: true, timeBasis: "due", state: "approved", overdue: false, owner: "me",
  link: { type: "outcome", id: "fixture" }, outcomeId: "fixture", editable: true, updatedAt: "2026-03-08T13:15:00Z",
};

test("writes stable UIDs, all-day dates, UTC instants and escaped text", () => {
  const timed = { ...item, id: "work_item:fixture", kind: "work_item" as const, start: "2026-03-08T14:00:00Z", end: "2026-03-08T15:00:00Z", allDay: false };
  const text = renderCalendarFeed("Fixture; 一", [item, timed, { ...item, id: "external_event:fixture", kind: "external_event", title: "Private" }], now, false);
  expect(text).toContain("X-WR-CALNAME:Fixture\\; 一\r\n");
  expect(text).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\nX-PUBLISHED-TTL:PT1H\r\n");
  expect(text).toContain("DTSTART;VALUE=DATE:20260308\r\n");
  expect(text).toContain("DTSTART:20260308T140000Z\r\nDTEND:20260308T150000Z\r\n");
  expect(text).toContain("DTSTAMP:20260308T160000Z\r\nLAST-MODIFIED:20260308T131500Z\r\n");
  expect(text).toContain("SUMMARY:Alpha\\, beta\\; \\\\ text\\nDESCRIPTION:omit\r\n");
  expect(text).not.toMatch(/\r\n(?:URL:|DESCRIPTION:)|Private/);
  const withLinks = renderCalendarFeed("Other", [item], new Date("2026-04-01T00:00:00Z"), true);
  expect(withLinks).toContain(text.match(/^UID:.*$/m)![0]);
  expect(withLinks).toContain("URL:outcomego://app/v1/outcomes?id=fixture\r\n");
});

test("folds long Unicode properties by bytes and preserves text on unfolding", () => {
  const title = "中🙂".repeat(80);
  const text = renderCalendarFeed("Fixture", [{ ...item, title }], now, false);
  expect(text).toContain("\r\n ");
  expect(text.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  expect(text.replaceAll("\r\n ", "")).toContain(`SUMMARY:${title}\r\n`);
});

test("uses inclusive owner dates across the DST change", () => {
  const { from, to } = calendarFeedWindow(now, "America/New_York");
  expect(from.toISOString()).toBe("2026-02-06T05:00:00.000Z");
  expect(to.toISOString()).toBe("2026-09-05T04:00:00.000Z");
});
