import { expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/renderer/lib/i18n";
import { outcomeFixture } from "./outcome-fixture";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import type { InboxClient } from "../src/renderer/components/outcomego/outcomes/inbox/inbox-api";
import type { HumanMaterialClient } from "../src/renderer/components/outcomego/outcomes/human-work/human-api";
import {
  decisionFixture,
  exploreFixture,
  fixtureIds,
  humanFixture,
  inboxFixture,
} from "./outcome-client-fixtures";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
if (!storageDescriptor) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}
if (!windowDescriptor) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { href: "http://127.0.0.1/" }, localStorage: storage },
  });
}
const [
  { DecisionCardView }, { OutcomeInbox }, { HumanAction },
  { ExploreIdeaDetails }, { RecoveryDiagnostics }, { ReviewPanel },
] = await Promise.all([
  import("../src/renderer/components/outcomego/outcomes/inbox/decision-card"),
  import("../src/renderer/components/outcomego/outcomes/inbox/outcome-inbox"),
  import("../src/renderer/components/outcomego/outcomes/human-work/human-action"),
  import("../src/renderer/components/outcomego/outcomes/explore/explore-panel"),
  import("../src/renderer/components/outcomego/outcomes/inbox/recovery-diagnostics"),
  import("../src/renderer/components/outcomego/outcomes/detail/review-panel"),
]).finally(() => {
  if (!windowDescriptor) Reflect.deleteProperty(globalThis, "window");
  if (!storageDescriptor) Reflect.deleteProperty(globalThis, "localStorage");
});

const render = (element: ReactNode) =>
  renderToStaticMarkup(createElement(I18nProvider, { children: element }));

test("Decision default layer prioritizes concise options and custom input; context stays hidden", () => {
  const html = render(
    createElement(DecisionCardView, {
      state: {
        phase: "ready",
        decision: decisionFixture,
        optionId: "source-a",
        customText: "",
        error: null,
        result: null,
      },
      onEdit() {},
      onRefresh() {},
      onResolve() {},
      outcomes: {} as OutcomeClient,
      onOutcome() {},
    })
  );
  for (const text of [
    "Choose a supported source.",
    "Use source A",
    "Source for Use source A",
    "Custom choice",
    "Recommendation, impact and evidence",
    'type="radio"',
    "Submit choice",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain(decisionFixture.completedSummary);
  expect(html).not.toContain(decisionFixture.options[0]!.consequence);
  expect(html).not.toContain("Read-only transcript");
});
test("expired and unknown Decision states disable mutation without clearing custom words", () => {
  const html = render(
    createElement(DecisionCardView, {
      state: {
        phase: "expired",
        decision: { ...decisionFixture, status: "withdrawn" },
        optionId: "custom",
        customText: "Keep this choice",
        error: null,
        result: null,
      },
      onEdit() {},
      onRefresh() {},
      onResolve() {},
      outcomes: {} as OutcomeClient,
      onOutcome() {},
    })
  );
  expect(html).toMatch(/<input[^>]*disabled=""/);
  expect(html).not.toContain('<fieldset disabled=""');
  expect(html).toContain("Keep this choice");
  expect(html).toContain("expired, withdrawn");
});
test("Inbox exposes all four categories and accessible server-fact summaries", () => {
  const html = render(
    createElement(OutcomeInbox, {
      client: {} as InboxClient,
      initialPage: { items: [inboxFixture], nextCursor: "next" },
      onSelect() {},
    })
  );
  for (const text of [
    "Decisions",
    "Acceptance review",
    "Human actions",
    "Completed",
    "Choose a source.",
    "No unresolved problem.",
    "Load more",
    'aria-label="Inbox categories"',
  ])
    expect(html).toContain(text);
});
test("paused human action restores saved summary and shows metadata without reading full sources", () => {
  const html = render(
    createElement(HumanAction, {
      workItemId: fixtureIds.human,
      client: {} as InboxClient,
      materials: {} as HumanMaterialClient,
      initialItem: humanFixture,
      upload: async () => ({ assetRef: "unused" }),
      onReview() {},
    })
  );
  for (const text of [
    "Resume action",
    "Observed the label; photos pending.",
    "Fixture procedure",
    "Only this short excerpt",
    "Evidence requirements",
    "Receipt history",
    "Equipment label",
    "Open Outcome and acceptance review",
  ])
    expect(html).toContain(text);
  expect(html).toContain('<fieldset disabled=""');
  expect(html).not.toContain("Full fixture source body");
});
test("converted and discarded Explore ideas preserve provenance and have no mutating controls", () => {
  for (const status of ["converted", "discarded"] as const) {
    const html = render(
      createElement(ExploreIdeaDetails, {
        idea: {
          ...exploreFixture,
          status,
          proposedOutcomeId: status === "converted" ? fixtureIds.outcome : null,
        },
        busy: false,
        bots: [],
        botId: "",
        onBot() {},
        onPropose() {},
        onDiscard() {},
        onOutcome() {},
      })
    );
    expect(html).toContain("read-only");
    expect(html).toContain("fixture:procedure");
    expect(html).not.toContain("Discard idea");
    expect(html).not.toContain("<fieldset");
  }
});
test("unknown recovery reasons remain visible alongside explicit reconciliation and no forced success", () => {
  const html = render(
    createElement(RecoveryDiagnostics, {
      outcomeId: fixtureIds.outcome,
      initialState: {
        outcomeId: fixtureIds.outcome,
        notificationFailures: [
          {
            id: "delivery-1",
            status: "failed",
            attempts: 5,
            errorCode: "notification_retry_exhausted",
          },
        ],
        items: [
          {
            id: "checkpoint",
            outcomeId: fixtureIds.outcome,
            contractRevision: 1,
            workItemId: fixtureIds.human,
            sequence: 1,
            status: "needs_review",
            reasonCode: "new_server_reason",
            retryCount: 3,
            recoveryCount: 2,
            completedItems: [],
            outputRefs: [],
            evidenceRefs: [],
            createdAt: "2026-11-17T00:00:00Z",
          },
        ],
      },
    })
  );
  expect(html).toContain("new_server_reason");
  expect(html).toContain("Reconcile persisted facts");
  expect(html).toContain("does not force success");
  expect(html).toContain("Retries");
  expect(html).toContain("Notification retries are exhausted.");
  expect(html).toContain("Outbox delivery-1");
});
test("receipt review loads approved N separately from pending N+1 and blocks after successor approval", () => {
  const original = outcomeFixture.currentRevisionView!;
  const successor = {
    ...outcomeFixture,
    currentRevision: original.revision + 1,
    currentRevisionView: {
      ...original,
      id: "new-revision",
      revision: original.revision + 1,
      status: "pending_approval" as const,
      criteria: [
        {
          ...original.criteria[0]!,
          id: "new-criterion",
          statement: "A different future criterion.",
        },
      ],
    },
    workItems: [
      {
        ...outcomeFixture.workItems[0]!,
        executorType: "human" as const,
        kind: "human_action" as const,
        status: "review_pending" as const,
      },
    ],
  };
  const html = render(
    createElement(ReviewPanel, {
      receiptReview: true,
      outcome: successor,
      reviewRevisionView: original,
      busy: false,
      onSubmit() {},
      onRework() {},
    })
  );
  expect(html).toContain(`Reviewing receipt Contract revision ${original.revision}`);
  expect(html).toContain(original.criteria[0]!.statement);
  expect(html).not.toContain("A different future criterion.");
  expect(html).not.toContain('<fieldset disabled=""');
  const approved = render(
    createElement(ReviewPanel, {
      receiptReview: true,
      outcome: {
        ...successor,
        currentRevisionView: { ...successor.currentRevisionView, status: "approved" },
      },
      reviewRevisionView: original,
      busy: false,
      onSubmit() {},
      onRework() {},
    })
  );
  expect(approved).toContain('<fieldset disabled=""');
  const unavailable = render(
    createElement(ReviewPanel, {
      receiptReview: true,
      outcome: successor,
      reviewRevisionView: null,
      busy: false,
      onSubmit() {},
      onRework() {},
    })
  );
  expect(unavailable).toContain('<fieldset disabled=""');
  expect(unavailable).not.toContain("A different future criterion.");
});

test("credential approval names the logins and answers with one click beside the shared comment box", () => {
  const grant = {
    connectionId: "11111111-1111-4111-8111-111111111111",
    itemId: "22222222-2222-4222-8222-222222222222",
    title: "Unraid",
    hostname: "10.255.0.75",
    instanceName: "Home vault",
  };
  const html = render(
    createElement(DecisionCardView, {
      state: {
        phase: "ready",
        decision: {
          ...decisionFixture,
          reasonCode: "credential_access_required",
          customEntryAllowed: true,
          nextStepSummary: "Allow reading these saved logins for this goal?",
          recommendation: null,
          options: [
            {
              id: "option-1",
              label: "Allow reading for this goal",
              consequence: "The listed logins can be read whenever this goal's steps need them.",
              resolutionEffect: "plan_only",
              source: "runtime",
              credentialGrant: [grant],
            },
            {
              id: "option-2",
              label: "Do not allow",
              consequence: "The goal continues without reading these credentials.",
              resolutionEffect: "plan_only",
              source: "runtime",
            },
          ],
        },
        optionId: null,
        customText: "",
        error: null,
        result: null,
      },
      onEdit() {},
      onRefresh() {},
      onResolve() {},
      outcomes: {} as OutcomeClient,
      onOutcome() {},
    })
  );
  expect(html).toContain("Allow reading these saved logins for this goal?");
  expect(html).toContain("Unraid · 10.255.0.75 · Home vault");
  expect(html).toContain("Allow reading for this goal");
  expect(html).toContain("Do not allow");
  // Same controls as the goal approval: comment box plus direct buttons, no radio list or submit step.
  expect(html).toContain("outcome-direct-buttons");
  expect(html).toContain("outcome-approval-comment");
  expect(html).not.toContain('type="radio"');
  expect(html).not.toContain("Submit choice");
});
test("human action opens on the next step; the long material stays behind disclosure rows", () => {
  const html = render(
    createElement(HumanAction, {
      workItemId: fixtureIds.human,
      client: {} as InboxClient,
      materials: {} as HumanMaterialClient,
      initialItem: humanFixture,
      upload: async () => ({ assetRef: "unused" }),
      onReview() {},
    })
  );
  expect(html).toContain("outcome-now");
  expect(html).toContain("Why this is needed");
  // Rows are collapsed unless the action is in progress.
  expect(html).not.toMatch(/<details class="outcome-brief-section" open/);
  expect(html.match(/class="outcome-brief-section"/g)!.length).toBeGreaterThanOrEqual(4);
});
