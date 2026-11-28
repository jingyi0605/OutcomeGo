import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewPanel } from "../src/renderer/components/outcomego/outcomes/detail/review-panel";
import { OutcomeDetail } from "../src/renderer/components/outcomego/outcomes/detail/outcome-detail";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import { outcomeFixture } from "./outcome-fixture";
import { I18nProvider } from "../src/renderer/lib/i18n";

test("ReviewPanel renders preliminary review summary, attention questions, and Adopt button for current revision", () => {
  const html = renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(ReviewPanel, {
        outcome: {
          ...outcomeFixture,
          status: "review_pending",
          prereview: {
            turnId: "turn-pre-1",
            revision: 1,
            summary: "Required metric table is complete; optional appendix left blank.",
            attention: [{ criterionId: "criterion-1", question: "Confirm Q3 total matches finance export?" }],
            results: [
              { criterionId: "criterion-1", suggestion: "likely_pass", reason: "Verified table", evidenceIds: [] },
            ],
            createdAt: new Date().toISOString(),
          },
        },
        busy: false,
        onSubmit: () => {},
        onAdoptPrereview: () => {},
        onRework: () => {},
      }),
    })
  );
  expect(html).toContain("Required metric table is complete");
  expect(html).toContain("Confirm Q3 total matches finance export?");
  expect(html).toContain("Adopt likely-pass items");
});

test("ReviewPanel keeps attention criterion rationales collapsed under Review rationale", () => {
  const html = renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(ReviewPanel, {
        outcome: {
          ...outcomeFixture,
          status: "review_pending",
          prereview: {
            turnId: "turn-pre-2",
            revision: 1,
            summary: "Main output is ready; one verification check is still missing.",
            attention: [{ criterionId: "criterion-1", question: "Did the device test pass on Android?" }],
            results: [
              {
                criterionId: "criterion-1",
                suggestion: "unclear",
                reason: "Detailed technical audit log citing ChatScreen.kt:509 and missing adb device receipt.",
                evidenceIds: [],
              },
            ],
            createdAt: new Date().toISOString(),
          },
        },
        busy: false,
        onSubmit: () => {},
        onAdoptPrereview: () => {},
        onRework: () => {},
      }),
    })
  );
  const [layer1, layer2 = ""] = html.split('<details class="outcome-technical">');
  expect(layer1).toContain("Main output is ready; one verification check is still missing.");
  expect(layer1).toContain("Did the device test pass on Android?");
  expect(layer1).toContain("AI prereview: needs check");
  expect(layer1).not.toContain("Detailed technical audit log citing ChatScreen.kt:509");
  expect(layer2).toContain("Review rationale");
  expect(layer2).toContain("Detailed technical audit log citing ChatScreen.kt:509");
});

test("ReviewPanel blocks Adopt button and warns when prereview revision is stale", () => {
  const html = renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(ReviewPanel, {
        outcome: {
          ...outcomeFixture,
          status: "review_pending",
          prereview: {
            turnId: "turn-pre-old",
            revision: 0,
            summary: "Old summary",
            attention: [],
            results: [
              { criterionId: "criterion-1", suggestion: "likely_pass", reason: "Ok", evidenceIds: [] },
            ],
            createdAt: new Date().toISOString(),
          },
        },
        busy: false,
        onSubmit: () => {},
        onAdoptPrereview: () => {},
        onRework: () => {},
      }),
    })
  );
  expect(html).not.toContain("Adopt likely-pass items");
  expect(html).toContain("cannot be adopted on revision");
});

test("review report displays the conclusion once with grounded charts; stale batches hide previous suggestions", () => {
  const reviewSummary = "The main cache is below its limit.";
  const outcome = { ...outcomeFixture, status: "review_pending" as const };
  const render = (changes: Partial<typeof outcome>) => renderToStaticMarkup(
    createElement(I18nProvider, { children: createElement(ReviewPanel, {
      outcome: { ...outcome, ...changes }, busy: false, onSubmit: () => {}, onRework: () => {}, onAdoptPrereview: () => {},
    }) }),
  );
  const html = render({ prereview: {
    turnId: "review-1", revision: 1, summary: reviewSummary, createdAt: outcome.createdAt, attention: [], results: [],
    report: { outcomeId: outcome.id, revisionId: outcome.currentRevisionView!.id, reviewTurnId: "review-1",
      summary: reviewSummary, details: "", sources: [{ title: "check", quote: "Cache is 63% full.", credibility: "external_record" }],
      charts: [{ type: "metric", title: "Cache use", unit: "%", points: [{ label: "Main cache", value: 63, citation: 0 }] }],
    },
  } });
  expect(html.split(reviewSummary)).toHaveLength(2);
  expect(html).toContain('data-chart-type="metric"');
  expect(html).toContain("External record");
  const stale = render({ prereview: null, prereviewStatus: "stale" });
  expect(stale).toContain("Suggestions from the previous review can no longer be adopted.");
  expect(stale).not.toContain("Adopt likely-pass items");
});

test("OutcomeDetail keeps the full task plan behind advanced details", () => {
  const html = renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(OutcomeDetail, {
        outcomeId: outcomeFixture.id,
        client: {} as OutcomeClient,
        bots: [{ id: outcomeFixture.botId, name: "Writer Bot" }],
        initialOutcome: {
          ...outcomeFixture,
          status: "pending_approval",
          plan: {
            notes: "Split by chapter.",
            tasks: [
              {
                key: "draft-ch1",
                title: "Draft chapter 1",
                instructions: "Write",
                botId: outcomeFixture.botId,
                covers: ["criterion-1"],
                nature: "deliverable",
              },
              {
                key: "publish-ch1",
                title: "Send draft notice",
                instructions: "Notify",
                botId: outcomeFixture.botId,
                dependsOn: ["draft-ch1"],
                covers: ["criterion-1"],
                nature: "action",
              },
            ],
          },
          workItems: [
            {
              ...outcomeFixture.workItems[0]!,
              botId: outcomeFixture.botId,
              planKey: "draft-ch1",
              nature: "deliverable",
              review: {
                state: "rejected_once",
                findings: [{ kind: "omission", basis: { criterionId: "criterion-1" }, reason: "Missing section 2" }],
                reworkWorkItemId: "rw-1",
              },
            },
          ],
        },
      }),
    })
  );
  expect(html).toContain("More details");
  expect(html).not.toContain("Split by chapter.");
  expect(html).not.toContain("Task plan");
  expect(html).not.toContain("Missing section 2");
});
