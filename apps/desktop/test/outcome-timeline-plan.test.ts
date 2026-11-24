import { describe, expect, test } from "bun:test";
import type { WorkItemView } from "@outcomego/contracts/outcomes";
import { buildTimelineLayout } from "../src/renderer/components/outcomego/outcomes/timeline/timeline-layout";

// Specs/004.10 task 3.1 (requirements C1.5, C9.1 to C9.4): planned time, estimate, due flag and overdue marking.
// Fixtures are scenario-neutral placeholders, and every rule is checked on two different fixtures.
const NOW = new Date("2026-11-24T12:00:00.000Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

let counter = 0;
const task = (overrides: Partial<WorkItemView> = {}): WorkItemView => {
  counter += 1;
  return {
    id: `task-${counter}`,
    contractRevision: 1,
    executorType: "agent",
    kind: "initial",
    title: `Task ${counter}`,
    status: "queued",
    statusReason: null,
    ordinal: counter,
    dependsOn: [],
    rootRunId: null,
    runIds: [],
    reworkOfWorkItemId: null,
    startedAt: null,
    completedAt: null,
    runSegments: [],
    createdAt: at(-100),
    updatedAt: at(-100),
    ...overrides,
  };
};
const running = (from: number) => ({ id: `run-${from}`, status: "running" as const, startedAt: at(from), completedAt: null });
const rowOf = (item: WorkItemView, goal?: Parameters<typeof buildTimelineLayout>[3]) => buildTimelineLayout([item], NOW, 1, goal).rows[0]!;

// Two unrelated shapes of the same situation, so a rule cannot pass by matching one fixture's wording or numbers.
const FIXTURES = [
  { name: "first", future: 6, estimate: 90, past: -4 },
  { name: "second", future: 30, estimate: 600, past: -50 },
] as const;

describe("planned time", () => {
  for (const f of FIXTURES) {
    test(`(${f.name}) a task scheduled for later and not started is marked at its scheduled time`, () => {
      const row = rowOf(task({ scheduledAt: at(f.future) }));
      expect(row.plannedAt).toBe(at(f.future));
      expect(row.segments).toEqual([]);
    });

    test(`(${f.name}) a task that has not been scheduled has no planned time, and none is made up`, () => {
      const row = rowOf(task());
      expect(row.plannedAt).toBeNull();
      expect(row.estimate).toBeNull();
    });

    test(`(${f.name}) a finished task shows no planned marker: what happened is on the actual bars`, () => {
      const done = task({ status: "completed", scheduledAt: at(f.past), startedAt: at(f.past), completedAt: at(f.past + 1), runSegments: [{ id: "r", status: "completed", startedAt: at(f.past), completedAt: at(f.past + 1) }] });
      expect(rowOf(done).plannedAt).toBeNull();
    });
  }

  test("a deferred task marks the time it resumes", () => {
    const deferred = task({
      scheduledAt: at(5), statusReason: "deferred_by_agent", startedAt: at(-3),
      runSegments: [{ id: "r1", status: "completed", startedAt: at(-3), completedAt: at(-2) }],
    });
    expect(rowOf(deferred).plannedAt).toBe(at(5));
  });

  test("a human task's booked time is marked the same way, with a diamond", () => {
    const booked = task({ executorType: "human", kind: "human_action", status: "ready", scheduledAt: at(8) });
    const row = rowOf(booked);
    expect(row.plannedAt).toBe(at(8));
    expect(row.marker).toBe("diamond");
  });
});

describe("estimate", () => {
  for (const f of FIXTURES) {
    test(`(${f.name}) an estimate starts at the scheduled time and runs for exactly the estimated minutes`, () => {
      const row = rowOf(task({ scheduledAt: at(f.future), estimateMinutes: f.estimate }));
      expect(row.estimate).toEqual({ minutes: f.estimate, from: at(f.future), to: new Date(NOW.getTime() + f.future * 3_600_000 + f.estimate * 60_000).toISOString() });
    });

    test(`(${f.name}) an estimate with nothing to anchor it to is not drawn, but is still reported in minutes`, () => {
      const row = rowOf(task({ estimateMinutes: f.estimate }));
      expect(row.estimate).toBeNull();
      expect(row.estimateMinutes).toBe(f.estimate);
    });
  }

  test("a running task's estimate starts at its real start", () => {
    const row = rowOf(task({ status: "running", startedAt: at(-1), estimateMinutes: 120, runSegments: [running(-1)] }));
    expect(row.estimate).toEqual({ minutes: 120, from: at(-1), to: at(1) });
  });

  test("a task that is over keeps no estimate bar", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const row = rowOf(task({ status, scheduledAt: at(-5), estimateMinutes: 60, startedAt: at(-5), runSegments: [{ id: "r", status: "completed", startedAt: at(-5), completedAt: at(-4) }] }));
      expect(row.estimate).toBeNull();
    }
  });

  test("an estimate that has run out raises no overdue mark: it only draws a bar", () => {
    const row = rowOf(task({ status: "running", startedAt: at(-10), estimateMinutes: 30, runSegments: [running(-10)] }));
    expect(row.overdue).toBe(false);
  });
});

describe("due and overdue", () => {
  for (const f of FIXTURES) {
    test(`(${f.name}) a task past its due time and not finished is overdue`, () => {
      expect(rowOf(task({ dueAt: at(f.past) })).overdue).toBe(true);
    });

    test(`(${f.name}) a task whose due time has not come is not overdue`, () => {
      expect(rowOf(task({ dueAt: at(f.future) })).overdue).toBe(false);
    });
  }

  test("a task with no due time is never overdue, however late it runs", () => {
    const late = task({ status: "running", scheduledAt: at(-200), startedAt: at(-100), runSegments: [running(-100)] });
    const row = rowOf(late);
    expect(row.dueAt).toBeNull();
    expect(row.overdue).toBe(false);
  });

  test("finished tasks are not overdue", () => {
    for (const status of ["completed", "failed", "cancelled"] as const)
      expect(rowOf(task({ status, dueAt: at(-5) })).overdue).toBe(false);
  });

  test("a human task is overdue until a receipt is in", () => {
    expect(rowOf(task({ executorType: "human", kind: "human_action", status: "in_progress", dueAt: at(-1) })).overdue).toBe(true);
    expect(rowOf(task({ executorType: "human", kind: "human_action", status: "submitted", dueAt: at(-1) })).overdue).toBe(false);
  });
});

describe("goal due flag", () => {
  test("a goal with a due time gets a flag, overdue once it has passed and the goal is not finished", () => {
    const item = task();
    expect(buildTimelineLayout([item], NOW, 1, { dueAt: at(24), finished: false }).goal).toEqual({ dueAt: at(24), overdue: false });
    expect(buildTimelineLayout([item], NOW, 1, { dueAt: at(-24), finished: false }).goal).toEqual({ dueAt: at(-24), overdue: true });
  });

  test("a finished goal is not overdue, and a goal with no due time has no flag", () => {
    const item = task();
    expect(buildTimelineLayout([item], NOW, 1, { dueAt: at(-24), finished: true }).goal).toEqual({ dueAt: at(-24), overdue: false });
    expect(buildTimelineLayout([item], NOW, 1, { dueAt: null, finished: false }).goal).toBeNull();
    expect(buildTimelineLayout([item], NOW, 1).goal).toBeNull();
  });
});

describe("axis", () => {
  test("it reaches the planned time, the estimate end, the due times and now", () => {
    const item = task({ scheduledAt: at(10), estimateMinutes: 60 * 5, dueAt: at(20) });
    const layout = buildTimelineLayout([item], NOW, 1, { dueAt: at(40), finished: false });
    expect(layout.axis).toEqual({ start: NOW.toISOString(), end: at(40) });
  });

  test("a goal due date alone is enough to have an axis, so the flag and today line can be drawn", () => {
    const layout = buildTimelineLayout([task()], NOW, 1, { dueAt: at(48), finished: false });
    expect(layout.axis).toEqual({ start: NOW.toISOString(), end: at(48) });
  });

  test("with no time at all there is still no axis and no invented date", () => {
    expect(buildTimelineLayout([task()], NOW, 1).axis).toBeNull();
  });

  test("a past start is still where the axis begins", () => {
    const done = task({ status: "completed", startedAt: at(-30), completedAt: at(-20), runSegments: [{ id: "r", status: "completed", startedAt: at(-30), completedAt: at(-20) }] });
    expect(buildTimelineLayout([done], NOW, 1).axis).toEqual({ start: at(-30), end: NOW.toISOString() });
  });
});

describe("nothing is predicted", () => {
  test("no row or layout field carries a predicted finish date", () => {
    const item = task({ scheduledAt: at(6), estimateMinutes: 90, dueAt: at(30) });
    const layout = buildTimelineLayout([item], NOW, 1, { dueAt: at(60), finished: false });
    const text = JSON.stringify(layout).toLowerCase();
    expect(text).not.toContain("predict");
    expect(text).not.toContain("forecast");
    expect(text).not.toContain("criticalpath");
    // The only end times are the ones the data gave: the estimate end is start plus the stated minutes, nothing else.
    expect(layout.rows[0]!.estimate!.to).toBe(new Date(Date.parse(at(6)) + 90 * 60_000).toISOString());
  });
});
