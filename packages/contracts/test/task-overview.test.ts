import { describe, expect, test } from "bun:test";
import {
  AGENT_WORK_ITEM_STATUSES,
  HUMAN_WORK_ITEM_STATUSES,
  type WorkItemStatus,
} from "../src/outcomes";
import {
  deriveRequestDisplayState,
  deriveRoutineDisplayState,
  deriveWorkItemDisplayState,
  hasUnfinishedDependency,
  isOverdue,
  isRecentlyCompleted,
  isWorkItemOverdue,
  localDateOf,
} from "../src/task-overview";

// Specs/004.10 task 1.2. Policy values below are placeholders chosen to differ from any
// shipped default: the derivation must read them from its argument and never from a literal.
const NOW = new Date("2026-11-24T12:00:00.000Z");
const minutes = (value: number) => new Date(NOW.getTime() + value * 60_000);
const POLICY = { checkOverdueMinutes: 7 };

describe("request display state (design §2.2)", () => {
  const request = (overrides: Partial<Parameters<typeof deriveRequestDisplayState>[0]> = {}) => ({
    state: "working" as const,
    reconciliations: 0,
    nextCheckAt: null,
    ...overrides,
  });
  const derive = (input: ReturnType<typeof request>, policy = POLICY) => deriveRequestDisplayState(input, NOW, policy);

  test("working with no reconciliation is in progress", () => {
    expect(derive(request())).toBe("in_progress");
  });

  test("working after at least one reconciliation is being verified, not alarming", () => {
    expect(derive(request({ reconciliations: 1 }))).toBe("verifying");
    expect(derive(request({ reconciliations: 2 }))).toBe("verifying");
  });

  test("waiting with a future check, or no check recorded, is waiting", () => {
    expect(derive(request({ state: "waiting", nextCheckAt: minutes(30) }))).toBe("waiting");
    expect(derive(request({ state: "waiting", nextCheckAt: null }))).toBe("waiting");
  });

  test("a waiting check is overdue only after the policy tolerance has passed", () => {
    const waiting = (overdueBy: number) => request({ state: "waiting", nextCheckAt: minutes(-overdueBy) });
    expect(derive(waiting(7))).toBe("waiting");
    expect(derive(waiting(8))).toBe("check_not_fired");
  });

  test("the tolerance comes from the policy argument", () => {
    const stale = request({ state: "waiting", nextCheckAt: minutes(-8) });
    expect(derive(stale, { checkOverdueMinutes: 30 })).toBe("waiting");
    expect(derive(stale, { checkOverdueMinutes: 1 })).toBe("check_not_fired");
  });

  test("blocked maps by its source: user and policy need the owner, tool is blocked, runtime has nobody following up", () => {
    expect(derive(request({ state: "blocked", blockSource: "user" }))).toBe("needs_owner");
    expect(derive(request({ state: "blocked", blockSource: "policy" }))).toBe("needs_owner");
    expect(derive(request({ state: "blocked", blockSource: "tool" }))).toBe("blocked");
    expect(derive(request({ state: "blocked", blockSource: "runtime" }))).toBe("no_follow_up");
  });

  test("a blocked record without a source falls back to blocked rather than inventing an owner action", () => {
    expect(derive(request({ state: "blocked" }))).toBe("blocked");
  });

  test("complete is completed", () => {
    expect(derive(request({ state: "complete" }))).toBe("completed");
  });

  test("the recent-completed window comes from the policy hours argument", () => {
    const finished = new Date(NOW.getTime() - 5 * 3_600_000);
    expect(isRecentlyCompleted(finished, NOW, 6)).toBe(true);
    expect(isRecentlyCompleted(finished, NOW, 5)).toBe(true);
    expect(isRecentlyCompleted(finished, NOW, 4)).toBe(false);
  });
});

describe("work item display state (design §2.2)", () => {
  const item = (overrides: Partial<Parameters<typeof deriveWorkItemDisplayState>[0]> = {}) => ({
    executorType: "agent" as const,
    status: "queued" as WorkItemStatus,
    statusReason: null,
    scheduledAt: null,
    hasUnfinishedDependency: false,
    ...overrides,
  });
  const derive = (input: ReturnType<typeof item>) => deriveWorkItemDisplayState(input, NOW);

  test("queued with no schedule and an unfinished dependency waits on the dependency", () => {
    expect(derive(item({ hasUnfinishedDependency: true }))).toBe("waiting_dependency");
  });

  test("queued with a future schedule is scheduled, even when a dependency is still open", () => {
    expect(derive(item({ scheduledAt: minutes(60) }))).toBe("scheduled");
    expect(derive(item({ scheduledAt: minutes(60), hasUnfinishedDependency: true }))).toBe("scheduled");
  });

  test("queued, scheduled and deferred by the agent is deferred", () => {
    expect(derive(item({ scheduledAt: minutes(60), statusReason: "deferred_by_agent" }))).toBe("deferred");
  });

  test("a missed schedule wins over the schedule itself", () => {
    expect(derive(item({ scheduledAt: minutes(-120), statusReason: "missed_schedule" }))).toBe("missed_schedule");
    // The owner moved the date but the marker is not cleared yet: still reported as missed until it is.
    expect(derive(item({ scheduledAt: minutes(60), statusReason: "missed_schedule" }))).toBe("missed_schedule");
  });

  test("queued with no schedule, or a schedule that has arrived, and nothing blocking is plain queued", () => {
    expect(derive(item())).toBe("queued");
    expect(derive(item({ scheduledAt: minutes(-1) }))).toBe("queued");
    // Exactly at the scheduled time the task is due, not scheduled.
    expect(derive(item({ scheduledAt: minutes(0) }))).toBe("queued");
  });

  // Gap in the §2.2 table: due time already reached while a dependency is still open. The dependency is what
  // actually holds the task back, so it is reported as waiting on it. Recorded in docs, to be confirmed.
  test("a schedule that has arrived does not hide an unfinished dependency", () => {
    expect(derive(item({ scheduledAt: minutes(-1), hasUnfinishedDependency: true }))).toBe("waiting_dependency");
  });

  test("every non-queued agent status passes through unchanged, whatever the reason or schedule", () => {
    for (const status of AGENT_WORK_ITEM_STATUSES.filter((value) => value !== "queued")) {
      expect(derive(item({ status, statusReason: "deferred_by_agent", scheduledAt: minutes(60), hasUnfinishedDependency: true }))).toBe(status);
    }
  });

  test("human work items keep their own statuses", () => {
    for (const status of HUMAN_WORK_ITEM_STATUSES) {
      expect(derive(item({ executorType: "human", status, scheduledAt: minutes(60) }))).toBe(status);
    }
  });
});

describe("unfinished dependencies", () => {
  const statuses = new Map<string, WorkItemStatus>([
    ["done", "completed"],
    ["accepted", "accepted"],
    ["busy", "running"],
    ["failed", "failed"],
  ]);

  test("no dependencies means nothing is unfinished", () => {
    expect(hasUnfinishedDependency([], statuses)).toBe(false);
  });

  test("completed and accepted dependencies are finished, the same rule the dispatcher applies", () => {
    expect(hasUnfinishedDependency(["done", "accepted"], statuses)).toBe(false);
  });

  test("any other status, or an unknown id, leaves the dependency unfinished", () => {
    expect(hasUnfinishedDependency(["done", "busy"], statuses)).toBe(true);
    expect(hasUnfinishedDependency(["failed"], statuses)).toBe(true);
    expect(hasUnfinishedDependency(["missing"], statuses)).toBe(true);
  });
});

describe("overdue is only an overlay on something with a due date", () => {
  test("nothing without a due date is ever overdue, in any state", () => {
    expect(isOverdue(null, NOW, false)).toBe(false);
    for (const status of [...AGENT_WORK_ITEM_STATUSES, ...HUMAN_WORK_ITEM_STATUSES]) {
      for (const executorType of ["agent", "human"] as const) {
        expect(isWorkItemOverdue({ executorType, status, dueAt: null }, NOW)).toBe(false);
      }
    }
  });

  test("a due date is overdue only once it has passed and the work is not finished", () => {
    expect(isOverdue(minutes(-1), NOW, false)).toBe(true);
    expect(isOverdue(minutes(0), NOW, false)).toBe(false);
    expect(isOverdue(minutes(5), NOW, false)).toBe(false);
    expect(isOverdue(minutes(-1), NOW, true)).toBe(false);
  });

  test("agent tasks stop being overdue once they reach a terminal state", () => {
    const overdue = (status: WorkItemStatus) => isWorkItemOverdue({ executorType: "agent", status, dueAt: minutes(-60) }, NOW);
    for (const status of ["queued", "running", "waiting_decision", "waiting_human", "retry_pending", "needs_review"] as const) expect(overdue(status)).toBe(true);
    for (const status of ["completed", "failed", "cancelled"] as const) expect(overdue(status)).toBe(false);
  });

  test("human tasks are overdue until a receipt is submitted", () => {
    const overdue = (status: WorkItemStatus) => isWorkItemOverdue({ executorType: "human", status, dueAt: minutes(-60) }, NOW);
    for (const status of ["pending", "ready", "in_progress", "paused", "rejected"] as const) expect(overdue(status)).toBe(true);
    for (const status of ["submitted", "review_pending", "accepted", "cancelled"] as const) expect(overdue(status)).toBe(false);
  });
});

describe("routine display state", () => {
  const routine = (overrides: Partial<Parameters<typeof deriveRoutineDisplayState>[0]> = {}) => ({
    pausedAt: null,
    lastExecutionStatus: null,
    ...overrides,
  });

  test("the latest execution decides running, failed and skipped", () => {
    expect(deriveRoutineDisplayState(routine({ lastExecutionStatus: "running" }))).toBe("running");
    expect(deriveRoutineDisplayState(routine({ lastExecutionStatus: "queued" }))).toBe("running");
    expect(deriveRoutineDisplayState(routine({ lastExecutionStatus: "failed" }))).toBe("failed");
    expect(deriveRoutineDisplayState(routine({ lastExecutionStatus: "skipped" }))).toBe("skipped");
  });

  test("a paused routine with nothing noteworthy is paused", () => {
    expect(deriveRoutineDisplayState(routine({ pausedAt: NOW }))).toBe("paused");
    expect(deriveRoutineDisplayState(routine({ pausedAt: NOW, lastExecutionStatus: "completed" }))).toBe("paused");
  });

  test("a failure or a run in flight is not hidden by a pause", () => {
    expect(deriveRoutineDisplayState(routine({ pausedAt: NOW, lastExecutionStatus: "failed" }))).toBe("failed");
    expect(deriveRoutineDisplayState(routine({ pausedAt: NOW, lastExecutionStatus: "running" }))).toBe("running");
  });

  test("a successful, cancelled or absent execution is idle, so it does not become an activity row", () => {
    expect(deriveRoutineDisplayState(routine({ lastExecutionStatus: "completed" }))).toBe("idle");
    expect(deriveRoutineDisplayState(routine({ lastExecutionStatus: "cancelled" }))).toBe("idle");
    expect(deriveRoutineDisplayState(routine())).toBe("idle");
  });
});

describe("all-day dates in the owner's time zone", () => {
  const NEW_YORK = "America/New_York";

  test("the local date does not drift across the spring DST change (2026-03-08, a 23 hour day)", () => {
    expect(localDateOf(new Date("2026-03-08T04:59:00Z"), NEW_YORK)).toBe("2026-03-07");
    expect(localDateOf(new Date("2026-03-08T05:00:00Z"), NEW_YORK)).toBe("2026-03-08");
    expect(localDateOf(new Date("2026-03-09T03:59:00Z"), NEW_YORK)).toBe("2026-03-08");
    expect(localDateOf(new Date("2026-03-09T04:00:00Z"), NEW_YORK)).toBe("2026-03-09");
  });

  test("the local date does not drift across the autumn DST change (2026-11-01, a 25 hour day)", () => {
    expect(localDateOf(new Date("2026-11-01T03:59:00Z"), NEW_YORK)).toBe("2026-10-31");
    expect(localDateOf(new Date("2026-11-01T04:00:00Z"), NEW_YORK)).toBe("2026-11-01");
    expect(localDateOf(new Date("2026-11-02T04:59:00Z"), NEW_YORK)).toBe("2026-11-01");
    expect(localDateOf(new Date("2026-11-02T05:00:00Z"), NEW_YORK)).toBe("2026-11-02");
  });

  test("the same instant is a different calendar date in a different zone", () => {
    const instant = new Date("2026-11-24T20:00:00Z");
    expect(localDateOf(instant, "Asia/Shanghai")).toBe("2026-11-25");
    expect(localDateOf(instant, "UTC")).toBe("2026-11-24");
    expect(localDateOf(instant, "Pacific/Honolulu")).toBe("2026-11-24");
  });
});
