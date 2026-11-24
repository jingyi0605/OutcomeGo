import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkItemView } from "@outcomego/contracts/outcomes";
import { OutcomeTimeline } from "../src/renderer/components/outcomego/outcomes/timeline/outcome-timeline";
import { I18nProvider } from "../src/renderer/lib/i18n";

// Specs/004.10 tasks 1.3 and 1.4. Scenario-neutral placeholders only.
const NOW = new Date("2026-11-24T12:00:00.000Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
let counter = 0;
const task = (overrides: Partial<WorkItemView> & { scheduledAt?: string | null } = {}): WorkItemView => {
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
const seg = (id: string, from: number, to: number | null, status: "completed" | "running" = "completed") => ({
  id,
  status,
  startedAt: at(from),
  completedAt: to === null ? null : at(to),
});
const render = (workItems: WorkItemView[], currentRevision: number | null = 1) =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(OutcomeTimeline, { workItems, currentRevision, now: NOW }),
    })
  );

describe("goal timeline", () => {
  test("renders nothing for a goal without tasks", () => {
    expect(render([])).toBe("");
  });

  test("one task that never ran still shows, with no chart and no invented date", () => {
    const html = render([task({ title: "Only task", startedAt: null, completedAt: null, runSegments: [] })]);
    expect(html).toContain("Only task");
    expect(html).toContain("No runs yet");
    expect(html).not.toContain("outcome-timeline-chart");
  });

  test("a task with runs draws a chart and lists the same runs in the table", () => {
    const html = render([
      task({ title: "Done task", status: "completed", startedAt: at(-30), completedAt: at(-20), runSegments: [seg("r1", -30, -20)] }),
    ]);
    expect(html).toContain("outcome-timeline-chart");
    expect(html).toContain("outcome-timeline-segment");
    expect(html).toContain("outcome-timeline-today-layer");
    expect(html).toContain("<table");
    expect(html).toContain('scope="row"');
  });

  test("the drawing is hidden from assistive technology while the table is not", () => {
    const html = render([task({ status: "running", startedAt: at(-2), runSegments: [seg("r1", -2, null, "running")] })]);
    expect(html).toMatch(/class="outcome-timeline-chart" aria-hidden="true"/);
    expect(html).not.toMatch(/<table[^>]*aria-hidden/);
  });

  test("status is carried by words and an icon as well as a tone", () => {
    const html = render([task({ status: "running", startedAt: at(-2), runSegments: [seg("r1", -2, null, "running")] })]);
    expect(html).toContain("Running");
    expect(html).toContain('class="outcome-timeline-icon"');
    expect(html).toContain('data-tone="review"');
  });

  test("a deferred task shows when it resumes, in the chart and in the table", () => {
    const html = render([
      task({ status: "queued", statusReason: "deferred_by_agent", scheduledAt: at(48), startedAt: at(-30), runSegments: [seg("r1", -30, -28), seg("r2", -10, -9)] }),
    ]);
    expect(html).toContain("Deferred until");
    expect(html.match(/Deferred until/g)!.length).toBe(2);
    expect(html).toContain("outcome-timeline-gap");
  });

  test("a task with no time that waits on another goes to the not-scheduled area and names it", () => {
    const first = task({ title: "Prepare", status: "running", startedAt: at(-1), runSegments: [seg("r1", -1, null, "running")] });
    const second = task({ title: "Assemble", dependsOn: [first.id] });
    const html = render([first, second]);
    expect(html).toContain("Not scheduled");
    expect(html).toContain("Waiting for: Prepare");
  });

  test("a server that sends no time fields shows order and status with a notice, and no chart", () => {
    const html = render([task({ title: "One", status: "completed" }), task({ title: "Two", status: "running" })]);
    expect(html).toContain("This server does not report task times yet");
    expect(html).not.toContain("outcome-timeline-chart");
    expect(html.indexOf("One")).toBeLessThan(html.indexOf("Two"));
    expect(html).toContain("Completed");
    expect(html).toContain("Running");
  });

  test("nothing shows a predicted finish or an overdue marker for a task without a due date", () => {
    const html = render([task({ status: "running", startedAt: at(-2), runSegments: [seg("r1", -2, null, "running")] })]);
    expect(html.toLowerCase()).not.toContain("overdue");
    expect(html.toLowerCase()).not.toContain("estimated");
    expect(html.toLowerCase()).not.toContain("expected finish");
  });
});
