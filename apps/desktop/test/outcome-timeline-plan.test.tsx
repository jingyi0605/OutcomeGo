import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkItemView } from "@outcomego/contracts/outcomes";
import { OutcomeTimeline } from "../src/renderer/components/outcomego/outcomes/timeline/outcome-timeline";
import { formatEstimate } from "../src/renderer/components/outcomego/outcomes/timeline/timeline-layout";
import { missingKeys } from "../src/renderer/lib/i18n-catalog";
import { I18nProvider } from "../src/renderer/lib/i18n";

// Specs/004.10 task 3.1 (requirements C1.5, C9.1 to C9.4). Scenario-neutral placeholders only.
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
const render = (workItems: WorkItemView[], goal?: { dueAt: string | null; finished: boolean }) =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(OutcomeTimeline, { workItems, currentRevision: 1, now: NOW, goal }),
    })
  );
/** The drawing only: from the chart to whichever block follows it (not-scheduled area, goal line or table). */
const chartOf = (html: string) => {
  const start = html.indexOf('class="outcome-timeline-chart"');
  if (start === -1) return "";
  const ends = ['<section class="outcome-timeline-unscheduled"', '<p class="outcome-timeline-goal-due"', "<table"]
    .map((marker) => html.indexOf(marker, start))
    .filter((index) => index !== -1);
  return html.slice(start, Math.min(...ends));
};
const tableOf = (html: string) => html.slice(html.indexOf("<table"), html.indexOf("</table>"));

const css = readFileSync(resolve(import.meta.dir, "../src/renderer/components/outcomego/outcomes/outcome-ui.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return start === -1 ? "" : css.slice(start, css.indexOf("}", start));
};

describe("planned time on the timeline", () => {
  test("a task scheduled for later is drawn as a marker at that time, with the time in the list", () => {
    const html = render([task({ title: "Later task", scheduledAt: at(6) })]);
    expect(html).toContain("outcome-timeline-chart");
    expect(chartOf(html)).toContain("outcome-timeline-plan");
    expect(tableOf(html)).toContain(new Date(at(6)).toLocaleString());
  });

  test("a human task's booked time is a diamond marker", () => {
    const html = render([task({ executorType: "human", kind: "human_action", status: "ready", scheduledAt: at(30) })]);
    expect(chartOf(html)).toMatch(/outcome-timeline-plan"[^>]*data-marker="diamond"/);
  });

  test("a task with no schedule and no history says 'Not scheduled' in the list and draws nothing for it", () => {
    const html = render([task({ title: "Open task" })]);
    expect(html).not.toContain("outcome-timeline-chart");
    expect(tableOf(html)).toContain("Not scheduled");
  });

  test("a server that sends no time fields shows a dash, not 'Not scheduled', which it cannot know", () => {
    const legacy = task({ title: "Old task" });
    delete (legacy as Partial<WorkItemView>).startedAt;
    delete (legacy as Partial<WorkItemView>).completedAt;
    delete (legacy as Partial<WorkItemView>).runSegments;
    expect(tableOf(render([legacy]))).not.toContain("Not scheduled");
  });
});

describe("estimate bars are dashed and labelled", () => {
  for (const [name, scheduledAt, minutes] of [["first", at(6), 90], ["second", at(40), 600]] as const) {
    test(`(${name}) an estimate is a dashed bar marked 'Estimate', never drawn as an actual run`, () => {
      const html = render([task({ scheduledAt, estimateMinutes: minutes })]);
      const chart = chartOf(html);
      expect(chart).toContain("outcome-timeline-estimate");
      expect(chart).toMatch(/outcome-timeline-estimate-label[^>]*>Estimate</);
      expect(chart).not.toContain("outcome-timeline-segment");
    });
  }

  test("the stylesheet gives the estimate a dashed outline and the actual bar a solid fill", () => {
    expect(rule(".outcome-timeline-estimate")).toMatch(/border:\s*1px dashed/);
    expect(rule(".outcome-timeline-estimate")).toMatch(/background:\s*transparent/);
    expect(rule(".outcome-timeline-segment")).not.toContain("dashed");
    expect(rule(".outcome-timeline-plan")).toMatch(/border:\s*1px solid/);
  });

  test("an estimate with nothing to anchor it is not drawn, but the list still shows the estimate in words", () => {
    const html = render([task({ estimateMinutes: 90 })]);
    expect(html).not.toContain("outcome-timeline-estimate");
    expect(tableOf(html)).toContain("1.5 h");
  });

  test("durations are written in the unit that fits, without rounding a figure into a different one", () => {
    expect(formatEstimate(1)).toEqual({ key: "{value} min", value: 1 });
    expect(formatEstimate(45)).toEqual({ key: "{value} min", value: 45 });
    expect(formatEstimate(60)).toEqual({ key: "{value} h", value: 1 });
    expect(formatEstimate(90)).toEqual({ key: "{value} h", value: 1.5 });
    expect(formatEstimate(1440)).toEqual({ key: "{value} d", value: 1 });
    expect(formatEstimate(10080)).toEqual({ key: "{value} d", value: 7 });
    // Not a whole number of hours and not worth a decimal: stay in minutes rather than show a misleading figure.
    expect(formatEstimate(61)).toEqual({ key: "{value} min", value: 61 });
  });
});

describe("overdue is only ever for a task that has a due time", () => {
  for (const [name, dueAt] of [["first", at(-4)], ["second", at(-90)]] as const) {
    test(`(${name}) a task past its due time and not finished is flagged in words and an icon, in both views`, () => {
      const html = render([task({ status: "running", startedAt: at(-6), runSegments: [{ id: "r", status: "running", startedAt: at(-6), completedAt: null }], dueAt })]);
      expect(chartOf(html)).toContain("Overdue");
      expect(tableOf(html)).toContain("Overdue");
      expect(html).toContain("⚑");
    });
  }

  test("a task with no due time never shows 'overdue' however late it is", () => {
    const html = render([task({ status: "running", scheduledAt: at(-300), startedAt: at(-200), runSegments: [{ id: "r", status: "running", startedAt: at(-200), completedAt: null }] })]);
    expect(html.toLowerCase()).not.toContain("overdue");
  });

  test("a finished task past its due time is not overdue", () => {
    const html = render([task({ status: "completed", dueAt: at(-10), startedAt: at(-20), completedAt: at(-12), runSegments: [{ id: "r", status: "completed", startedAt: at(-20), completedAt: at(-12) }] })]);
    expect(html.toLowerCase()).not.toContain("overdue");
  });
});

describe("goal due flag", () => {
  test("a goal with a due time shows a flag at the end of the timeline and a line a screen reader can read", () => {
    const html = render([task({ title: "Some task" })], { dueAt: at(72), finished: false });
    expect(chartOf(html)).toContain("outcome-timeline-flag");
    expect(html).toMatch(/<p class="outcome-timeline-goal-due"[^>]*>[^<]*Goal due/);
    expect(html).toContain("outcome-timeline-today");
    expect(html.toLowerCase()).not.toContain("overdue");
  });

  test("a goal past its due time and not finished is overdue, with words as well as a tone", () => {
    const html = render([task({ title: "Some task" })], { dueAt: at(-20), finished: false });
    expect(html).toMatch(/outcome-timeline-goal-due" data-overdue="true"/);
    expect(html).toContain("Overdue");
  });

  test("a finished goal is not overdue, and a goal with no due time has no flag", () => {
    expect(render([task()], { dueAt: at(-20), finished: true }).toLowerCase()).not.toContain("overdue");
    expect(render([task()], { dueAt: null, finished: false })).not.toContain("outcome-timeline-flag");
    expect(render([task()])).not.toContain("outcome-timeline-flag");
  });
});

describe("the list view carries the same new information", () => {
  test("it has planned, estimate and due columns", () => {
    const table = tableOf(render([task({ scheduledAt: at(6), estimateMinutes: 90, dueAt: at(30) })]));
    for (const heading of ["Planned for", "Estimate", "Due"]) expect(table).toContain(`>${heading}</th>`);
    expect(table).toContain(new Date(at(30)).toLocaleString());
  });
});

describe("honest time", () => {
  test("nothing on the page says 'predicted', 'expected finish' or 'critical path'", () => {
    const html = render(
      [task({ scheduledAt: at(6), estimateMinutes: 90, dueAt: at(30) }), task({ scheduledAt: at(40), estimateMinutes: 600 })],
      { dueAt: at(80), finished: false }
    ).toLowerCase();
    for (const phrase of ["predict", "expected finish", "expected completion", "critical path", "forecast"]) expect(html).not.toContain(phrase);
  });

  test("every new string has a Chinese translation", () => {
    const keys = ["Planned for", "Estimate", "Goal due {time}", "Estimate: {duration}", "{value} min", "{value} h", "{value} d", "Due", "Overdue", "Not scheduled"];
    expect(missingKeys(keys)).toEqual([]);
  });
});
