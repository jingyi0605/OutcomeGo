import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutcomeDetail as OutcomeDetailView } from "@outcomego/contracts/outcomes";
import { ReviewPanel } from "../src/renderer/components/outcomego/outcomes/detail/review-panel";
import {
  RevisionHistory,
  revisionMaterialLabel,
} from "../src/renderer/components/outcomego/outcomes/detail/revision-history";
import { outcomeFixture } from "./outcome-fixture";
import { I18nProvider } from "../src/renderer/lib/i18n";

test("a successor shows actual revision/Decision/user ancestry and keeps old material visibly historical", () => {
  const original = outcomeFixture.currentRevisionView!;
  const successor: OutcomeDetailView = {
    ...outcomeFixture,
    currentRevision: 2,
    currentRevisionView: {
      ...original,
      id: "revision-2",
      revision: 2,
      baseRevisionId: original.id,
      sourceDecisionId: "decision-1",
      changeSummary: "Expand comparison",
      criteria: [{ ...original.criteria[0]!, id: "criterion-2", latestResult: null }],
    },
    revisions: [
      {
        ...outcomeFixture.revisions[0]!,
        status: "superseded",
        createdBy: "owner:local",
        baseRevisionId: null,
        sourceDecisionId: null,
      },
      {
        id: "revision-2",
        revision: 2,
        status: "approved",
        baseRevisionId: original.id,
        sourceDecisionId: "decision-1",
        createdBy: "user:owner",
        changeSummary: "Expand comparison",
        createdAt: original.createdAt,
      },
    ],
  };
  const html = renderToStaticMarkup(createElement(RevisionHistory, { outcome: successor }));
  for (const text of [
    "Based on revision 1",
    "Source Decision: decision-1",
    "Created by user:owner",
    "Current contract",
    "Historical contract",
  ])
    expect(html).toContain(text);
  expect(revisionMaterialLabel(1, 2)).toBe(
    "Historical revision 1 · not used for current acceptance"
  );
  expect(html).not.toContain("Current revision 1");
  const review = renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(ReviewPanel, {
        receiptReview: true,
        outcome: successor,
        busy: false,
        onSubmit() {},
        onRework() {},
      }),
    })
  );
  expect(review).not.toContain("Costs were not compared");
  expect(review).not.toContain("Missing costs");
  expect(review).toContain("UNVERIFIED");
});

test("an older server response without provenance still renders revision history", () => {
  const html = renderToStaticMarkup(createElement(RevisionHistory, { outcome: outcomeFixture }));
  expect(html).toContain("Revision 1");
  expect(html).toContain("Current contract");
  expect(html).not.toContain("Based on revision");
  expect(html).not.toContain("Created by");
});
