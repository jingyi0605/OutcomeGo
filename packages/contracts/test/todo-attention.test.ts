import { expect, test } from "bun:test";
import type { OutcomeStatusFor } from "../src/outcomes";
import { compareOutcomeTodoAttention, deriveOutcomeTodoAttention, deriveOutcomeTodoDisplayState } from "../src/task-overview";

const now = new Date("2026-11-25T23:45:00Z");
const base = { status: "open" as OutcomeStatusFor<"todo">, dueAt: null, scheduledAt: null, snoozeUntil: null, followUpAt: null, expiresAt: null };

test("follow-ups enter on time and snoozed or future items stay out", () => {
  expect(deriveOutcomeTodoAttention({ ...base, status: "waiting", followUpAt: now }, now, "Asia/Singapore")).toBe("follow_up");
  expect(deriveOutcomeTodoAttention({ ...base, status: "waiting", followUpAt: new Date(+now + 1) }, now, "Asia/Singapore")).toBeNull();
  expect(deriveOutcomeTodoAttention({ ...base, status: "waiting", followUpAt: now, snoozeUntil: new Date(+now + 1) }, now, "Asia/Singapore")).toBeNull();
  expect(deriveOutcomeTodoAttention({ ...base, dueAt: new Date("2026-11-26T02:00:00Z") }, now, "Asia/Singapore")).toBe("today");
  expect(deriveOutcomeTodoAttention({ ...base, dueAt: new Date("2026-11-26T02:00:00Z") }, now, "UTC")).toBeNull();
  expect(deriveOutcomeTodoAttention(base, now, "UTC")).toBeNull();
});

test("urgency sorts within the zone after overdue and before the wait time", () => {
  const rows = [
    { attention: "suggested", urgency: "high", since: "01", key: "high-suggested" },
    { attention: "today", urgency: "low", since: "02", key: "low-today-new" },
    { attention: "today", urgency: "low", since: "01", key: "low-today-old" },
    { attention: "follow_up", urgency: "high", since: "03", key: "high-follow-up" },
    { attention: "overdue", urgency: "low", since: "03", key: "low-overdue" },
  ] as const;
  expect([...rows].sort(compareOutcomeTodoAttention).map(({ key }) => key)).toEqual([
    "low-overdue", "high-follow-up", "low-today-old", "low-today-new", "high-suggested",
  ]);
});

test("terminal todo Outcomes stay out of the attention queue", () => {
  for (const status of ["accepted", "cancelled"] as const) {
    const outcome = { ...base, status, dueAt: new Date(+now - 1) };
    expect(deriveOutcomeTodoAttention(outcome, now, "UTC")).toBeNull();
    expect(deriveOutcomeTodoDisplayState(outcome, now, "UTC")).toEqual({ displayState: status, overdue: false });
  }
});
