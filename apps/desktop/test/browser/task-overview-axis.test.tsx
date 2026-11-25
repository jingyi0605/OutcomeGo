import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTimelineTicks } from "../../src/renderer/components/outcomego/outcomes/timeline/timeline-axis";
import { OutcomeTimeline } from "../../src/renderer/components/outcomego/outcomes/timeline/outcome-timeline";
import { I18nProvider } from "../../src/renderer/lib/i18n";
import { missingKeys } from "../../src/renderer/lib/i18n-catalog";

const start = new Date(2026, 10, 25, 10);
const at = (days: number) => new Date(2026, 10, 25 + days, 10);
const axis = (days: number) => ({ start: start.toISOString(), end: at(days).toISOString() });

describe("task overview time axis", () => {
  for (const [days, unit] of [[1, "hour"], [14, "day"], [70, "week"]] as const) {
    test(`${unit} ticks stay within the time range and are bounded`, () => {
      const ticks = buildTimelineTicks(axis(days));
      expect(ticks.unit).toBe(unit);
      expect(ticks.dates.length).toBeGreaterThan(1);
      expect(ticks.dates.length).toBeLessThanOrEqual(8);
      expect(ticks.dates.every((date) => date >= start && date <= at(days))).toBe(true);
      expect(ticks.dates.every((date) => date.getMinutes() === 0)).toBe(true);
      if (unit !== "hour") expect(ticks.dates.every((date) => date.getHours() === 0)).toBe(true);
      if (unit === "week") expect(ticks.dates.every((date) => date.getDay() === 1)).toBe(true);
    });
  }

  test("a single known instant still has a tick", () => {
    expect(buildTimelineTicks(axis(0)).dates).toEqual([start]);
  });

  test("return to today is a translated button outside the hidden chart", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <OutcomeTimeline
          currentRevision={1}
          now={start}
          workItems={[{
            id: "item-a", contractRevision: 1, executorType: "agent", kind: "initial", title: "Item A",
            status: "queued", statusReason: null, ordinal: 1, dependsOn: [], rootRunId: null,
            runIds: [], reworkOfWorkItemId: null, scheduledAt: at(1).toISOString(),
            startedAt: null, completedAt: null, createdAt: start.toISOString(), updatedAt: start.toISOString(),
          }]}
        />
      </I18nProvider>
    );
    expect(html).toMatch(/<button type="button"[^>]*>Back to today<\/button>.*outcome-timeline-chart" aria-hidden="true"/);
    expect(html.match(/outcome-timeline-tick"/g)?.length).toBeGreaterThan(1);
    expect(missingKeys(["Back to today"])).toEqual([]);
  });
});
