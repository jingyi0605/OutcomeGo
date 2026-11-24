import { describe, expect, test } from "bun:test";
import {
  buildTimelineLayout,
  type TimelineWorkItem,
} from "../src/renderer/components/outcomego/outcomes/timeline/timeline-layout";

// Specs/004.10 task 1.3. Fixtures are scenario-neutral placeholders.
const NOW = new Date("2026-11-24T12:00:00.000Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

let counter = 0;
const task = (overrides: Partial<TimelineWorkItem> = {}): TimelineWorkItem => {
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
    createdAt: at(-100),
    updatedAt: at(-100),
    ...overrides,
  };
};
const segment = (id: string, from: number, to: number | null, status: "completed" | "running" | "failed" = "completed") => ({
  id,
  status,
  startedAt: at(from),
  completedAt: to === null ? null : at(to),
});

describe("timeline layout", () => {
  test("an Outcome with no tasks has no rows and no axis", () => {
    const layout = buildTimelineLayout([], NOW);
    expect(layout.rows).toEqual([]);
    expect(layout.unscheduled).toEqual([]);
    expect(layout.axis).toBeNull();
  });

  test("a single task that never ran is shown, without an invented date", () => {
    const only = task({ title: "Only task" });
    const layout = buildTimelineLayout([only], NOW);
    expect(layout.rows.map((row) => row.id)).toEqual([only.id]);
    expect(layout.rows[0]!.segments).toEqual([]);
    expect(layout.axis).toBeNull();
    // It has no dependency and nothing is blocking it, so it is simply listed: nothing says it is waiting.
    expect(layout.unscheduled).toEqual([]);
  });

  test("each run is one solid segment from its real start to its real end", () => {
    const done = task({ status: "completed", startedAt: at(-30), completedAt: at(-20), runSegments: [segment("r1", -30, -20)] });
    const layout = buildTimelineLayout([done], NOW);
    expect(layout.rows[0]!.segments).toEqual([
      { runId: "r1", status: "completed", start: at(-30), end: at(-20), ongoing: false },
    ]);
  });

  test("a run that is still going is drawn up to now", () => {
    const running = task({ status: "running", startedAt: at(-2), runSegments: [segment("r1", -2, null, "running")] });
    const layout = buildTimelineLayout([running], NOW);
    expect(layout.rows[0]!.segments[0]).toEqual({ runId: "r1", status: "running", start: at(-2), end: NOW.toISOString(), ongoing: true });
  });

  test("a deferred task is drawn as separate segments with the gap marked and labelled with the resume time", () => {
    const deferred = task({
      status: "queued",
      statusReason: "deferred_by_agent",
      scheduledAt: at(48),
      startedAt: at(-30),
      runSegments: [segment("r1", -30, -28), segment("r2", -10, -9)],
    });
    const row = buildTimelineLayout([deferred], NOW).rows[0]!;
    expect(row.segments.map((entry) => entry.runId)).toEqual(["r1", "r2"]);
    // The gap between two runs is not run time.
    expect(row.gaps).toEqual([{ from: at(-28), to: at(-10) }]);
    // The task is waiting for its next run: label the resume time, not the gap.
    expect(row.deferredUntil).toBe(at(48));
  });

  test("a task is not labelled deferred unless its stored reason says so", () => {
    const scheduled = task({ status: "queued", scheduledAt: at(48), startedAt: at(-30), runSegments: [segment("r1", -30, -28)] });
    expect(buildTimelineLayout([scheduled], NOW).rows[0]!.deferredUntil).toBeNull();
  });

  test("a task with no time information and an open dependency goes to the unscheduled area and names what it waits on", () => {
    const first = task({ title: "Prepare", status: "running", startedAt: at(-1), runSegments: [segment("r1", -1, null, "running")] });
    const second = task({ title: "Assemble", dependsOn: [first.id] });
    const layout = buildTimelineLayout([first, second], NOW);
    expect(layout.unscheduled).toEqual([{ id: second.id, title: "Assemble", waitingFor: [{ id: first.id, title: "Prepare" }] }]);
    expect(layout.rows.find((row) => row.id === second.id)!.segments).toEqual([]);
  });

  test("a dependency that is finished does not put a task in the unscheduled area", () => {
    const first = task({ status: "completed", startedAt: at(-5), completedAt: at(-4), runSegments: [segment("r1", -5, -4)] });
    const second = task({ dependsOn: [first.id] });
    expect(buildTimelineLayout([first, second], NOW).unscheduled).toEqual([]);
  });

  test("dependency lines run from the end of the predecessor to the start of the successor, and only when both are known", () => {
    const first = task({ status: "completed", startedAt: at(-5), completedAt: at(-4), runSegments: [segment("r1", -5, -4)] });
    const second = task({ status: "running", dependsOn: [first.id], startedAt: at(-3), runSegments: [segment("r2", -3, null, "running")] });
    const third = task({ dependsOn: [second.id] });
    const links = buildTimelineLayout([first, second, third], NOW).links;
    expect(links).toEqual([{ from: first.id, to: second.id, fromAt: at(-4), toAt: at(-3) }]);
  });

  test("rows follow the plan order, then rework and supplement tasks, then human actions", () => {
    const planned = task({ title: "Planned", ordinal: 1 });
    const rework = task({ title: "Rework", ordinal: 2, kind: "rework", reworkOfWorkItemId: planned.id });
    const supplement = task({ title: "Supplement", ordinal: 3, kind: "supplement" });
    const human = task({ title: "By hand", ordinal: 4, kind: "human_action", executorType: "human", status: "pending" });
    const layout = buildTimelineLayout([human, supplement, rework, planned], NOW);
    expect(layout.rows.map((row) => row.title)).toEqual(["Planned", "Rework", "Supplement", "By hand"]);
    expect(layout.rows.find((row) => row.title === "By hand")!.marker).toBe("diamond");
    expect(layout.rows.find((row) => row.title === "Planned")!.marker).toBe("bar");
  });

  test("tasks from superseded contract revisions are left out", () => {
    const current = task({ contractRevision: 2 });
    const old = task({ contractRevision: 1 });
    expect(buildTimelineLayout([old, current], NOW, 2).rows.map((row) => row.id)).toEqual([current.id]);
  });

  test("the axis spans the earliest start to now, with the latest end included", () => {
    const early = task({ status: "completed", startedAt: at(-30), completedAt: at(-20), runSegments: [segment("r1", -30, -20)] });
    const layout = buildTimelineLayout([early], NOW);
    expect(layout.axis).toEqual({ start: at(-30), end: NOW.toISOString() });
  });

  test("a server that sends no time fields degrades to order and status only", () => {
    const legacy = [task({ title: "One", status: "completed" }), task({ title: "Two", status: "running" })];
    for (const entry of legacy) {
      delete (entry as Partial<TimelineWorkItem>).startedAt;
      delete (entry as Partial<TimelineWorkItem>).completedAt;
      delete (entry as Partial<TimelineWorkItem>).runSegments;
    }
    const layout = buildTimelineLayout(legacy, NOW);
    expect(layout.rows.map((row) => [row.title, row.status])).toEqual([["One", "completed"], ["Two", "running"]]);
    expect(layout.rows.every((row) => row.segments.length === 0 && row.timesKnown === false)).toBe(true);
    expect(layout.axis).toBeNull();
  });

  test("a task that has run reports its times as known", () => {
    const ran = task({ status: "completed", startedAt: at(-5), completedAt: at(-4), runSegments: [segment("r1", -5, -4)] });
    const never = task({ startedAt: null, completedAt: null, runSegments: [] });
    const [first, second] = buildTimelineLayout([ran, never], NOW).rows;
    expect(first!.timesKnown).toBe(true);
    // The server sent the fields and they are empty: it never ran. That is different from a server that sends nothing.
    expect(second!.timesKnown).toBe(true);
  });
  test("planned tasks follow their dependency order even when their ordinals disagree", () => {
    const later = task({ title: "Depends on the other", ordinal: 1 });
    const earlier = task({ title: "Comes first", ordinal: 2 });
    later.dependsOn = [earlier.id];
    expect(buildTimelineLayout([later, earlier], NOW).rows.map((row) => row.title)).toEqual(["Comes first", "Depends on the other"]);
  });

  test("a dependency cycle does not hang or drop rows", () => {
    const a = task({ title: "A", ordinal: 1 });
    const b = task({ title: "B", ordinal: 2 });
    a.dependsOn = [b.id];
    b.dependsOn = [a.id];
    expect(buildTimelineLayout([a, b], NOW).rows.map((row) => row.title)).toEqual(["A", "B"]);
  });

  test("each row carries the shared display state, not a second derivation", () => {
    const first = task({ status: "running", startedAt: at(-1), runSegments: [segment("r1", -1, null, "running")] });
    const waiting = task({ dependsOn: [first.id] });
    const scheduled = task({ scheduledAt: at(5) });
    const deferred = task({ scheduledAt: at(5), statusReason: "deferred_by_agent" });
    const rows = buildTimelineLayout([first, waiting, scheduled, deferred], NOW).rows;
    expect(rows.map((row) => row.displayState)).toEqual(["running", "waiting_dependency", "scheduled", "deferred"]);
  });
});
