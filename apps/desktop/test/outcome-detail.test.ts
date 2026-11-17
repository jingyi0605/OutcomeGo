import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OutcomeDetail } from "../src/renderer/components/outcomego/outcomes/detail/outcome-detail";
import { ReviewPanel, initialReviewEntries } from "../src/renderer/components/outcomego/outcomes/detail/review-panel";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import { outcomeFixture } from "./outcome-fixture";

test("detail renders revision, WorkItem, Run, Output and advisory evidence provenance", () => {
  const html = renderToStaticMarkup(createElement(OutcomeDetail, { outcomeId: outcomeFixture.id, client: {} as OutcomeClient, initialOutcome: outcomeFixture }));
  for (const text of ["Contract revision", "Research backups", "Root Run run-1", "Comparison report", "Agent report · advisory", "output:output-1", "Acceptance review", "Request rework", "Refresh from server", "Show read-only transcript"]) expect(html).toContain(text);
  expect(html).not.toContain('Read-only transcript</summary>');
});
test("review state is rebuilt from server history, preserves latest sequence, and never infers owner confirmation", () => {
  const state = initialReviewEntries({ ...outcomeFixture, reviews: [...outcomeFixture.reviews, { ...outcomeFixture.reviews[0]!, id: "r2", sequence: 2, result: "PASS", comment: "Second inspection" }] });
  expect(state["criterion-1"]).toMatchObject({ result: "PASS", comment: "Second inspection", userConfirmed: false });
  expect(initialReviewEntries(outcomeFixture)["criterion-1"]?.result).toBe("FAIL");
});
test("terminal details and pending submissions disable review; evidence credibility remains visible", () => {
  const html = renderToStaticMarkup(createElement(ReviewPanel, { outcome: { ...outcomeFixture, status: "accepted" }, busy: false, onSubmit() {}, onRework() {} }));
  expect(html).toContain('<fieldset disabled=""'); expect(html).toContain("agent_report");
  const busy = renderToStaticMarkup(createElement(ReviewPanel, { outcome: outcomeFixture, busy: true, onSubmit() {}, onRework() {} }));
  expect(busy).toContain('<fieldset disabled=""'); expect(busy).toContain("I personally verified this criterion.");
});
