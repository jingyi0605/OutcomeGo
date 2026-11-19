import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OutcomeDetail } from "../src/renderer/components/outcomego/outcomes/detail/outcome-detail";
import { OutcomeResultChartView } from "../src/renderer/components/outcomego/outcomes/detail/outcome-result-chart";
import {
  ReviewPanel,
  initialReviewEntries,
} from "../src/renderer/components/outcomego/outcomes/detail/review-panel";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import { outcomeFixture } from "./outcome-fixture";
import { I18nProvider } from "../src/renderer/lib/i18n";

test("chart scales keep signed quantities and percentages outside the reference range visible", () => {
  const renderChart = (unit: string, values: number[], type: "bar" | "line" = "bar") =>
    renderToStaticMarkup(createElement(OutcomeResultChartView, {
      chart: {
        type,
        title: "Measured change",
        unit,
        points: values.map((value, index) => ({ value, label: String(index + 1), citation: 0 })),
      },
    }));
  const signed = renderChart("GB", [-40, 60]);
  expect(signed).toContain("left:0%;width:40%");
  expect(signed).toContain("left:40%;width:60%");
  expect(signed).toContain('<div class="outcome-chart-scale"><span>-40 GB</span><span>60 GB</span></div>');
  const percentage = renderChart("％", [50, 125]);
  expect(percentage).toContain("left:0%;width:40%");
  expect(percentage).toContain("left:0%;width:100%");
  expect(percentage).toContain('<div class="outcome-chart-scale"><span>0%</span><span>125%</span></div>');
  const trend = renderChart("%", [84, 72, 63], "line");
  expect(trend).toContain('<div class="outcome-chart-scale"><span>100%</span><span>0%</span></div>');
});

test("detail starts with the current action; the result report and provenance open on demand", () => {
  const html = renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(OutcomeDetail, {
        outcomeId: outcomeFixture.id,
        client: {} as OutcomeClient,
        initialOutcome: { ...outcomeFixture, status: "running" },
      }),
    })
  );
  for (const text of ["Refresh from server", "More details"])
    expect(html).toContain(text);
  for (const text of [
    "Comparison report",
    "Acceptance summary",
    "Execution progress",
    "Review evidence",
    "Full contract",
    "Root Run run-1",
    "output:output-1",
    "Request rework",
    "Show read-only transcript",
    "Compare backup plans",
  ])
    expect(html).not.toContain(text);
  expect(html).not.toContain("Read-only transcript</summary>");
});
test("review state is rebuilt from server history, preserves latest sequence, and never infers owner confirmation", () => {
  const state = initialReviewEntries({
    ...outcomeFixture,
    reviews: [
      ...outcomeFixture.reviews,
      {
        ...outcomeFixture.reviews[0]!,
        id: "r2",
        sequence: 2,
        result: "PASS",
        comment: "Second inspection",
      },
    ],
  });
  expect(state["criterion-1"]).toMatchObject({
    result: "PASS",
    comment: "Second inspection",
    userConfirmed: false,
  });
  expect(initialReviewEntries(outcomeFixture)["criterion-1"]?.result).toBe("FAIL");
});
test("terminal details and pending submissions disable review; evidence credibility remains visible", () => {
  const html = renderToStaticMarkup(
    createElement(ReviewPanel, {
      receiptReview: true,
      outcome: { ...outcomeFixture, status: "accepted" },
      busy: false,
      onSubmit() {},
      onRework() {},
    })
  );
  expect(html).toContain('<fieldset disabled=""');
  expect(html).toContain("agent_report");
  const busy = renderToStaticMarkup(
    createElement(ReviewPanel, {
      receiptReview: true,
      outcome: outcomeFixture,
      busy: true,
      onSubmit() {},
      onRework() {},
    })
  );
  expect(busy).toContain('<fieldset disabled=""');
  expect(busy).toContain("I personally verified this criterion.");
});
