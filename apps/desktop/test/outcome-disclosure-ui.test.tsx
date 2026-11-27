import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Root } from "react-dom/client";
import { I18nProvider } from "../src/renderer/lib/i18n";
let OutcomeDetail: typeof import("../src/renderer/components/outcomego/outcomes/detail/outcome-detail").OutcomeDetail;
let OutcomeChatCardView: typeof import("../src/renderer/components/outcomego/outcomes/outcome-chat-card").OutcomeChatCardView;
let OutcomeThreadPanel: typeof import("../src/renderer/components/outcomego/outcomes/thread/outcome-thread-panel").OutcomeThreadPanel;
let OutcomeThreadEntry: typeof import("../src/renderer/components/outcomego/outcomes/thread/outcome-thread-panel").OutcomeThreadEntry;
let BotAvatar: typeof import("../src/renderer/components/outcomego/avatar").BotAvatar;
let OutcomeExecutionCard: typeof import("../src/renderer/components/outcomego/outcomes/outcome-execution-card").OutcomeExecutionCard;
let clearOutcomeCardCache: typeof import("../src/renderer/components/outcomego/outcomes/inbox/outcome-card-cache").clearOutcomeCardCache;
import {
  OUTCOME_CARD_STAGES,
  parseOutcomeChatCard,
  outcomeCardStage,
  type OutcomeChatCard,
} from "@outcomego/contracts/outcome-chat";
import { messageDisplayProjection } from "@outcomego/product-core/messages";
import type { ChannelMessageView } from "@outcomego/contracts";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import type { OutcomeThreadTurnView, SendOutcomeThreadMessageInput } from "@outcomego/contracts/outcome-thread";
import { OUTCOMEGO_DEEP_LINK_EVENT } from "../src/renderer/lib/app-deep-links";
import { OUTCOME_REFRESH_DEBOUNCE_MS, refreshOutcomeViews } from "../src/renderer/lib/outcome-events";
import { handleOutcomeThreadEvent } from "../src/renderer/lib/outcome-thread";
import { outcomeFixture, planFixture } from "./outcome-fixture";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const descriptors = new Map<string, PropertyDescriptor | undefined>();
let root: Root | undefined;
let host: HTMLElement;
let createRoot: typeof import("react-dom/client").createRoot;
beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(dom.window, "location", {
    configurable: true,
    value: { href: "http://127.0.0.1:5173/" },
  });
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(dom.window, "navigator", { configurable: true, value: { language: "en" } });
  // Linkedom has no layout or media-query engine; exercise the static reduced-motion path.
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  dom.document.hasFocus = () => false;
  Object.assign(dom.document, { oninput: null });
  const computedStyle = () => ({
    display: "block",
    visibility: "visible",
    position: "static",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    direction: "ltr",
    animationName: "none",
    getPropertyValue: () => "",
  });
  Object.defineProperty(dom.window, "getComputedStyle", {
    configurable: true,
    value: computedStyle,
  });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
  });
  Object.defineProperty(dom.window, "cancelAnimationFrame", {
    configurable: true,
    value: clearTimeout,
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame,
    cancelAnimationFrame: dom.window.cancelAnimationFrame,
    NodeFilter: { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 },
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ OutcomeDetail } = await import(
    "../src/renderer/components/outcomego/outcomes/detail/outcome-detail"
  ));
  ({ OutcomeThreadPanel, OutcomeThreadEntry } = await import(
    "../src/renderer/components/outcomego/outcomes/thread/outcome-thread-panel"
  ));
  ({ OutcomeChatCardView } = await import(
    "../src/renderer/components/outcomego/outcomes/outcome-chat-card"
  ));
  ({ OutcomeBriefView } = await import(
    "../src/renderer/components/outcomego/outcomes/outcome-brief"
  ));
  ({ OutcomeExecutionCard } = await import(
    "../src/renderer/components/outcomego/outcomes/outcome-execution-card"
  ));
  ({ BotAvatar } = await import("../src/renderer/components/outcomego/avatar"));
  ({ clearOutcomeCardCache } = await import(
    "../src/renderer/components/outcomego/outcomes/inbox/outcome-card-cache"
  ));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  clearOutcomeCardCache();
});
afterAll(() => {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<I18nProvider>{node}</I18nProvider>);
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === text || el.getAttribute("aria-label") === text
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
}
async function expand(prefix: string) {
  const details = [...host.querySelectorAll("details")].find((el) =>
    el.querySelector("summary")?.textContent?.startsWith(prefix)
  );
  expect(details).toBeDefined();
  await act(async () => {
    details!.open = true;
    details!.dispatchEvent(new dom.window.Event("toggle"));
  });
}
async function editChanges(text: string) {
  const input = host.querySelector(
    'textarea[aria-label="Approval comments"]'
  ) as HTMLTextAreaElement;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, text);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const card: OutcomeChatCard = {
  stage: "draft",
  title: "Clean storage",
  outcomeId: outcomeFixture.id,
  updatedAt: new Date().toISOString(),
  summary: "Measure before deleting",
};
const unexpected = async (): Promise<never> => {
  throw new Error("Unexpected mutation or read");
};
const client: OutcomeClient = {
  get: async () => outcomeFixture,
  intake: unexpected,
  create: unexpected,
  update: unexpected,
  act: unexpected,
  convert: unexpected,
  list: unexpected,
  revise: unexpected,
  approve: unexpected,
  start: unexpected,
  review: unexpected,
  rework: unexpected,
  cancel: unexpected,
  transcript: unexpected,
};

test("default details omit background, raw execution IDs, full contract and review forms", async () => {
  const running = { ...outcomeFixture, status: "running" as const };
  await mount(
    <OutcomeDetail outcomeId={running.id} client={{ ...client, get: async () => running }} initialOutcome={running} />
  );
  for (const hidden of ["Root Run", "output:output-1", "Required PASS", "Compare backup plans"]) {
    expect(host.textContent).not.toContain(hidden);
  }
  expect(host.querySelector("fieldset")).toBeNull();
  await expand("Background");
  await click("Source for Background and original request");
  expect(document.body.textContent).toContain(outcomeFixture.description);
  await click("Source for Background and original request");
  await click("More details");
  await expand("Execution progress");
  expect(host.textContent).toContain("Research backups");
  const ids = [...host.querySelectorAll("details")].find(
    (el) => el.querySelector("summary")?.textContent === "Execution IDs and provenance"
  )!;
  expect(ids.hasAttribute("open")).toBe(false);
  await expand("Review evidence");
  expect(host.textContent).toContain("Agent report · advisory");
  await click("Open acceptance review");
  expect(host.textContent).toContain("Acceptance summary");
  expect(host.textContent).not.toContain("I personally verified this criterion.");
});
test("approval buttons and comments are immediately available before background; approving is one explicit click", async () => {
  let approved = 0;
  const draft = {
    ...outcomeFixture,
    status: "pending_approval" as const,
    currentRevisionView: {
      ...outcomeFixture.currentRevisionView!,
      status: "pending_approval" as const,
      approvedAt: null,
    },
  };
  await mount(
    <OutcomeDetail
      outcomeId={draft.id}
      initialOutcome={draft}
      client={{
        ...client,
        get: async () => draft,
        approve: async (_id, revision, input) => {
          expect(revision).toBe(1);
          expect(input.expectedRevision).toBe(1);
          expect(input.confirmationText).toContain("I approve the saved goals");
          expect(input.confirmationText).toContain("Only measure storage for now");
          approved++;
          return draft;
        },
      }}
    />
  );
  expect(host.querySelector('input[type="radio"]')).toBeNull();
  expect(host.textContent).not.toContain("Review choices");
  expect(host.textContent).not.toContain("Decide later");
  expect(host.querySelector(".outcome-now textarea")?.getAttribute("rows")).toBe("1");
  expect(host.querySelectorAll(".outcome-approval .outcome-source-info")).toHaveLength(0);
  expect(host.querySelectorAll('button[aria-label="Source for Proposed plan"]')).toHaveLength(1);
  expect(host.innerHTML.indexOf("Yes, approve")).toBeLessThan(host.innerHTML.indexOf("Background"));
  expect(host.textContent).not.toContain("Modify production");
  await editChanges("Only measure storage for now");
  expect(approved).toBe(0);
  await click("Yes, approve");
  expect(approved).toBe(1);
});
test("attached evidence stays inspectable after explicitly opening an accepted goal's evidence", async () => {
  const sourceRef = `asset:${"a".repeat(64)}`;
  const outcome = {
    ...outcomeFixture,
    status: "accepted" as const,
    evidence: [{ ...outcomeFixture.evidence[0]!, sourceType: "asset" as const, sourceRef }],
  };
  await mount(
    <OutcomeDetail
      outcomeId={outcome.id}
      initialOutcome={outcome}
      client={{ ...client, get: async () => outcome }}
    />
  );
  expect(host.querySelector("[data-asset-ref]")).toBeNull();
  await click("More details");
  await expand("Review evidence");
  expect(host.querySelector("[data-asset-ref]")?.getAttribute("data-asset-ref")).toBe(sourceRef);
  expect(host.textContent).toContain("Inspect attached asset");
  expect(host.textContent).toContain("Download attached asset");
});
test("a historical receipt opens its original criteria without substituting a pending successor", async () => {
  const original = outcomeFixture.currentRevisionView!;
  const successor = {
    ...outcomeFixture,
    currentRevision: 2,
    currentRevisionView: {
      ...original,
      id: "revision-2",
      revision: 2,
      status: "pending_approval" as const,
      criteria: [
        { ...original.criteria[0]!, id: "criterion-2", statement: "Future-only criterion" },
      ],
    },
    workItems: [
      {
        ...outcomeFixture.workItems[0]!,
        executorType: "human" as const,
        status: "review_pending" as const,
      },
    ],
    evidence: [{ ...outcomeFixture.evidence[0]!, credibility: "human_confirmed" as const }],
    reviews: [{ ...outcomeFixture.reviews[0]!, result: "PASS" as const }],
  };
  const reads: number[] = [];
  await mount(
    <OutcomeDetail
      outcomeId={successor.id}
      reviewRevision={1}
      initialOutcome={successor}
      client={{
        ...client,
        get: async () => successor,
        getRevision: async (_id, revision) => {
          reads.push(revision);
          return original;
        },
      }}
    />
  );
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((revision) => revision === 1)).toBe(true);
  expect(host.querySelector('[data-outcome-section="review"]')?.hasAttribute("hidden")).toBe(false);
  expect(host.querySelector('[data-outcome-section="goal-details"]')?.hasAttribute("hidden")).toBe(true);
  const review = host.querySelector('[aria-label="Review and rework"]')!;
  expect(review.textContent).toContain("Compare costs");
  expect(review.textContent).not.toContain("Future-only criterion");
  expect(review.textContent).toContain("Reviewing receipt Contract revision 1");
  expect(review.textContent).toContain(
    "All required criteria are satisfied. Submit to record your review."
  );
});
test("card is compact until the user expands the in-chat actions", async () => {
  let target: unknown;
  const handler = (event: Event) => {
    target = (event as CustomEvent).detail;
  };
  window.addEventListener(OUTCOMEGO_DEEP_LINK_EVENT, handler);
  try {
    await mount(<OutcomeChatCardView card={card} client={client} />);
    expect(host.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("review");
    expect(host.textContent).toContain("Results ready for review");
    expect(host.querySelector(".outcome-brief")).toBeNull();
    expect(host.querySelector("details")).toBeNull();
    expect(host.querySelector("footer")).toBeNull();
    expect(host.textContent).not.toContain("Comparison report");
    expect(host.textContent).not.toContain("Plan A restores faster");
    const main = host.querySelector<HTMLButtonElement>("button.outcome-chat-card-main")!;
    expect(main.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".outcome-execution-card")).toBeNull();
    // Opening happens in place; it must never navigate to the goals page.
    await act(async () => {
      main.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    });
    expect(target).toBeUndefined();
  } finally {
    window.removeEventListener(OUTCOMEGO_DEEP_LINK_EVENT, handler);
  }
});
test("running card shows only the executor's step progress on one line", async () => {
  const running = {
    ...outcomeFixture,
    status: "running" as const,
    workItems: [
      {
        ...outcomeFixture.workItems[0]!,
        status: "running" as const,
        progress: {
          phase: "Scanning shares",
          updatedAt: "2026-11-18T02:00:00Z",
          tasks: [
            { id: "a", title: "List shares", status: "completed" as const },
            { id: "b", title: "Measure usage", status: "in_progress" as const },
            { id: "c", title: "Draft report", status: "pending" as const },
          ],
        },
      },
    ],
  };
  await mount(<OutcomeChatCardView card={card} client={{ ...client, get: async () => running }} />);
  const line = host.querySelector(".outcome-chat-line")!;
  expect(line.textContent).toBe("Scanning shares · 1/3 steps");
  expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
  expect(host.textContent).not.toContain("Measure usage");
});
test("chat card and goal overview count steps across every work item of the revision", async () => {
  const base = outcomeFixture.workItems[0]!;
  const step = (id: string, status: "completed" | "in_progress" | "pending") => ({ id, title: `Step ${id}`, status });
  const outcome = {
    ...outcomeFixture,
    status: "running" as const,
    workItems: [
      {
        ...base,
        id: "wi-done",
        title: "Finished item",
        status: "completed" as const,
        progress: {
          phase: "Done phase",
          updatedAt: "2026-11-18T01:00:00Z",
          tasks: ["a", "b", "c"].map((id) => step(id, "completed")),
        },
      },
      {
        ...base,
        id: "wi-run",
        title: "Running item",
        status: "running" as const,
        progress: {
          phase: "Running phase",
          updatedAt: "2026-11-18T02:00:00Z",
          tasks: [step("d", "completed"), step("e", "in_progress"), step("f", "pending")],
        },
      },
    ],
  };
  await mount(<OutcomeChatCardView card={card} client={{ ...client, get: async () => outcome }} />);
  expect(host.querySelector(".outcome-chat-line")!.textContent).toBe("Running phase · 4/6 steps");
  await mount(
    <OutcomeBriefView outcome={outcome} client={{ brief: async () => semanticBrief(outcome) }}>
      <p>Running</p>
    </OutcomeBriefView>
  );
  expect(host.textContent).toContain("6 tasks · 4 completed · 1 in progress");
  await expand("Tasks");
  expect(host.textContent).toContain("Finished item");
  expect(host.textContent).toContain("Running item");
  expect(host.textContent).toContain("Current phase: Running phase");
});
test("approved goals show that execution is starting, never an extra start prompt", async () => {
  await mount(
    <OutcomeChatCardView
      card={card}
      client={{
        get: async () => ({ ...outcomeFixture, status: "approved", outputs: [] }),
      }}
    />
  );
  expect(host.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("ready");
  expect(host.textContent).toContain("Starting execution");
  expect(host.textContent).not.toContain("Start approved Outcome");
});
test("read errors explicitly qualify saved state and allow a read-only retry", async () => {
  let attempts = 0;
  await mount(
    <OutcomeChatCardView
      card={card}
      client={{
        get: async () => {
          if (++attempts === 1) throw new Error("Controlled offline");
          return { ...outcomeFixture, status: "accepted" };
        },
      }}
    />
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("last saved");
  await click("Retry");
  expect(host.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("accepted");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
test("each stage has a readable static label; suggestions are closed and invalid cards fall back", () => {
  for (const stage of OUTCOME_CARD_STAGES) {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <OutcomeChatCardView
          card={{
            ...card,
            outcomeId: undefined,
            stage,
            suggestions: {
              goals: ["A goal"],
              acceptance: ["A criterion"],
              boundaries: ["A boundary"],
            },
          }}
        />
      </I18nProvider>
    );
    expect(html).toContain(`data-stage="${stage}"`);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<details open");
  }
  expect(outcomeCardStage("approved")).toBe("ready");
  expect(outcomeCardStage("review_pending")).toBe("review");
  expect(parseOutcomeChatCard({ ...card, suggestions: { goals: [1] } })).toBeNull();
  expect(parseOutcomeChatCard({ ...card, stage: "fake-success" })).toBeNull();
  expect(
    messageDisplayProjection({
      metadata: { type: "outcome-card" },
      content: "",
      sender: "agent",
    } as ChannelMessageView).richMessage
  ).toBe(true);
});
test("old unfinished snapshots stop the activity animation and reduced motion disables all card animation", async () => {
  await mount(
    <OutcomeChatCardView
      card={{
        ...card,
        outcomeId: undefined,
        stage: "generating",
        updatedAt: "2020-01-01T00:00:00Z",
      }}
    />
  );
  expect(host.querySelector('[data-stale="true"]')).not.toBeNull();
  expect(host.textContent).toContain("not been confirmed complete");
  const css = await Bun.file(
    new URL("../src/renderer/components/outcomego/outcomes/outcome-ui.css", import.meta.url)
  ).text();
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).toContain("animation: none !important");
});

const semanticGoal = {
  ...outcomeFixture,
  status: "pending_approval" as const,
  description:
    "Storage pressure is affecting the server. Confirm backups before cleanup. Measure space. Review candidates. Remove only approved items. RAW_BACKGROUND_DETAIL",
  currentRevisionView: {
    ...outcomeFixture.currentRevisionView!,
    status: "pending_approval" as const,
    goal: [
      "LONG_CONTRACT_GOAL: measure all pools and directories, rank cleanup by size, record every before and after measurement, and wait for explicit approval.",
    ],
    approvedAt: null,
  },
  workItems: [],
  outputs: [],
  evidence: [],
  reviews: [],
};
import {
  outcomeBriefSource,
  type OutcomeBrief,
  type OutcomeDetail as DetailView,
} from "@outcomego/contracts/outcomes";
let OutcomeBriefView: typeof import("../src/renderer/components/outcomego/outcomes/outcome-brief").OutcomeBriefView;
import {
  inboxFixture,
  decisionFixture,
  decisionResolutionFixture,
} from "./outcome-client-fixtures";
import type { InboxClient } from "../src/renderer/components/outcomego/outcomes/inbox/inbox-api";
import type { DecisionView, ResolveDecisionInput } from "@outcomego/contracts/outcome-inbox";
function semanticBrief(outcome: DetailView): OutcomeBrief {
  return {
    outcomeId: outcome.id,
    revisionId: outcome.currentRevisionView?.id ?? null,
    sourceKey: outcomeBriefSource(outcome),
    background: {
      title: "Recover space on the storage server.",
      explanation: "The server is under storage pressure; start with measurements.",
      quote: "Storage pressure is affecting the server.",
    },
    intent: {
      title: "Measure first, then confirm cleanup candidates.",
      explanation: "The contract asks for a measured baseline and explicitly approved cleanup.",
      quote: "LONG_CONTRACT_GOAL",
    },
    prerequisites: [
      {
        title: "Backup check",
        explanation: "Confirm that a restorable backup exists before cleanup.",
        quote: "Confirm backups before cleanup.",
      },
    ],
    risks: [],
    proposedTasks: [
      {
        title: "Measure space",
        explanation: "Save a usage baseline for comparison.",
        quote: "Measure space.",
      },
      {
        title: "Review candidates",
        explanation: "Choose which cleanup items may proceed.",
        quote: "Review candidates.",
      },
    ],
  };
}
test("decision-first default is short and categories reveal explanations before original material", async () => {
  const read = {
    ...client,
    get: async () => semanticGoal,
    brief: async () => semanticBrief(semanticGoal),
  };
  await mount(
    <OutcomeDetail outcomeId={semanticGoal.id} client={read} initialOutcome={semanticGoal} />
  );
  const overview = host.querySelector('[aria-label="Goal overview"]')!;
  expect(overview.firstElementChild?.getAttribute("aria-label")).toBe("What needs you now");
  expect(overview.textContent).toContain("Approve this plan?");
  expect(overview.textContent).toContain("Recover space on the storage server.");
  expect(overview.textContent).toContain("2 suggested tasks · 0 completed · 0 in progress");
  for (const hidden of [
    "RAW_BACKGROUND_DETAIL",
    "LONG_CONTRACT_GOAL",
    "Confirm that a restorable",
    "Save a usage baseline",
    "Recorded risks",
  ])
    expect(overview.textContent).not.toContain(hidden);
  expect(host.querySelector("input")).toBeNull();
  await expand("Background");
  expect(overview.textContent).toContain("The server is under storage pressure");
  expect(overview.textContent).not.toContain("RAW_BACKGROUND_DETAIL");
  await click("Source for Background and original request");
  expect(document.body.textContent).toContain("RAW_BACKGROUND_DETAIL");
  await click("Source for Background and original request");
  await expand("Prerequisites");
  const body = host.querySelector(".outcome-brief-body .outcome-item-heading")!.parentElement;
  expect(body?.textContent).toContain("Not met");
  const backup = [...host.querySelectorAll(".outcome-brief-list li")].find((item) =>
    item.textContent?.includes("Backup check")
  )!;
  expect(backup.textContent).toContain("Not verified");
  expect(backup.textContent).not.toContain("Confirm backups before cleanup.");
  await expand("Tasks");
  expect(overview.textContent).toContain("Suggested steps, not scheduled work items.");
  expect(overview.textContent).toContain("Save a usage baseline");
  expect(host.textContent).not.toContain("LONG_CONTRACT_GOAL");
  await click("Source for Proposed plan");
  expect(document.body.textContent).toContain("LONG_CONTRACT_GOAL");
});
test("recorded risks are optional, concise first and source text one level deeper", async () => {
  const brief = semanticBrief(semanticGoal);
  brief.risks = [
    {
      title: "Data loss",
      explanation: "Removing an active image could destroy data.",
      quote: "RAW_RISK_SOURCE",
    },
  ];
  await mount(
    <OutcomeBriefView outcome={semanticGoal} client={{ brief: async () => brief }}>
      <p>Your decision</p>
    </OutcomeBriefView>
  );
  expect(host.textContent).toContain("Data loss");
  expect(host.textContent).not.toContain("Removing an active");
  expect(host.textContent).not.toContain("RAW_RISK_SOURCE");
  await expand("Recorded risks");
  expect(host.textContent).toContain("Removing an active");
  expect(host.textContent).not.toContain("RAW_RISK_SOURCE");
  expect(host.querySelector('[data-record-status="unknown"]')?.textContent).toContain(
    "Not assessed"
  );
  const info = host.querySelector('button[aria-label="Source for Data loss"]')!;
  expect(info.parentElement?.tagName).toBe("P");
  await click("Source for Data loss");
  expect(document.body.textContent).toContain("RAW_RISK_SOURCE");
});
test("actual current-revision tasks and completed dependencies override proposed task display", async () => {
  const outcome = {
    ...semanticGoal,
    status: "running" as const,
    currentRevisionView: { ...semanticGoal.currentRevisionView, status: "approved" as const },
    workItems: [
      { ...outcomeFixture.workItems[0]!, title: "Saved baseline", dependsOn: [] },
      {
        ...outcomeFixture.workItems[0]!,
        id: "second-item",
        title: "Inspect candidates",
        status: "running" as const,
        dependsOn: ["item-1"],
      },
      {
        ...outcomeFixture.workItems[0]!,
        id: "old-item",
        contractRevision: 0,
        title: "Old revision task",
      },
    ],
  };
  await mount(
    <OutcomeBriefView outcome={outcome} client={{ brief: async () => semanticBrief(outcome) }}>
      <p>Running</p>
    </OutcomeBriefView>
  );
  expect(host.textContent).toContain("2 tasks · 1 completed · 1 in progress");
  expect(host.textContent).not.toContain("Proposed");
  expect(host.textContent).not.toContain("Old revision task");
  await expand("Prerequisites");
  const dependency = [...host.querySelectorAll("li")].find((item) =>
    item.textContent?.includes("Saved baseline")
  )!;
  expect(dependency.querySelector('[data-state="met"]')).not.toBeNull();
  const backup = [...host.querySelectorAll("li")].find((item) =>
    item.textContent?.includes("Backup check")
  )!;
  expect(backup.querySelector('[data-state="unknown"]')).not.toBeNull();
  await expand("Tasks");
  expect(host.querySelector('[data-record-status="completed"]')).not.toBeNull();
  expect(host.querySelector('[data-record-status="running"]')).not.toBeNull();
});
test("prerequisite checks reported by the executor replace the unverified summary entries", async () => {
  const outcome = {
    ...semanticGoal,
    status: "running" as const,
    currentRevisionView: { ...semanticGoal.currentRevisionView, status: "approved" as const },
    workItems: [
      {
        ...outcomeFixture.workItems[0]!,
        status: "running" as const,
        dependsOn: [],
        progress: {
          phase: "Checking access",
          tasks: [{ id: "scan", title: "Scan usage", status: "in_progress" as const }],
          prerequisites: [
            { id: "backup", title: "Backup check", status: "met" as const, summary: "Last backup verified" },
            { id: "vault", title: "Vault access", status: "unmet" as const },
          ],
          updatedAt: "2026-11-18T00:00:00Z",
        },
      },
    ],
  };
  await mount(
    <OutcomeBriefView outcome={outcome} client={{ brief: async () => semanticBrief(outcome) }}>
      <p>Running</p>
    </OutcomeBriefView>
  );
  await expand("Prerequisites");
  const rows = [...host.querySelectorAll("li")];
  const backup = rows.filter((item) => item.textContent?.includes("Backup check"));
  expect(backup).toHaveLength(1);
  expect(backup[0]!.querySelector('[data-state="met"]')).not.toBeNull();
  expect(backup[0]!.textContent).toContain("Last backup verified");
  const vault = rows.find((item) => item.textContent?.includes("Vault access"))!;
  expect(vault.querySelector('[data-state="unmet"]')).not.toBeNull();
  expect(host.textContent).toContain("1 pending");
});
test("summary failure leaves actions available and can retry without approving anything", async () => {
  let reads = 0;
  const read = {
    ...client,
    get: async () => semanticGoal,
    brief: async () => {
      if (++reads === 1) throw new Error("Controlled overview outage");
      return semanticBrief(semanticGoal);
    },
  };
  await mount(
    <OutcomeDetail outcomeId={semanticGoal.id} client={read} initialOutcome={semanticGoal} />
  );
  expect(host.textContent).toContain("Short overview unavailable");
  expect(host.querySelector(".outcome-now textarea")).not.toBeNull();
  await click("Retry summary");
  expect(host.textContent).toContain("Recover space on the storage server.");
});
test("collapsed task counts include human completion and activity without treating suggestions as work", async () => {
  const outcome = {
    ...semanticGoal,
    workItems: [
      {
        ...outcomeFixture.workItems[0]!,
        executorType: "human" as const,
        status: "accepted" as const,
      },
      {
        ...outcomeFixture.workItems[0]!,
        id: "human-running",
        executorType: "human" as const,
        status: "in_progress" as const,
      },
      {
        ...outcomeFixture.workItems[0]!,
        id: "queued",
        status: "queued" as const,
      },
    ],
  };
  await mount(
    <OutcomeBriefView outcome={outcome} client={{ brief: async () => semanticBrief(outcome) }}>
      <p>Pending</p>
    </OutcomeBriefView>
  );
  expect(host.querySelector(".outcome-task-counts")?.textContent).toBe(
    "3 tasks · 1 completed · 1 in progress"
  );
  expect(host.querySelectorAll(".outcome-brief-list [data-record-status]")).toHaveLength(0);
});
test("late old-revision brief cannot replace a new revision's overview", async () => {
  let resolveOld!: (brief: OutcomeBrief) => void;
  const old = new Promise<OutcomeBrief>((resolve) => {
    resolveOld = resolve;
  });
  const next = {
    ...semanticGoal,
    currentRevision: 2,
    currentRevisionView: { ...semanticGoal.currentRevisionView, id: "revision-2", revision: 2 },
  };
  const source = { brief: async (_id: string) => old };
  await mount(
    <OutcomeBriefView outcome={semanticGoal} client={source}>
      <p>Pending</p>
    </OutcomeBriefView>
  );
  expect(host.textContent).toContain("Preparing task overview…");
  expect(host.textContent).not.toContain("Task breakdown not recorded");
  const newBrief = {
    ...semanticBrief(next),
    background: { ...semanticBrief(next).background, title: "New revision summary" },
  };
  await act(async () =>
    root!.render(
      <I18nProvider>
        <OutcomeBriefView outcome={next} client={{ brief: async () => newBrief }}>
          <p>Pending</p>
        </OutcomeBriefView>
      </I18nProvider>
    )
  );
  await act(async () => resolveOld(semanticBrief(semanticGoal)));
  expect(host.textContent).toContain("New revision summary");
  expect(host.textContent).not.toContain("Recover space on the storage server.");
});
test("current real decision is first and opens its actual route; context is opt-in", async () => {
  const decision = {
    ...inboxFixture,
    outcomeId: semanticGoal.id,
    title: "May cleanup stop the media server?",
    problem: "RAW_DECISION_CONTEXT",
  };
  let selected = "";
  const outcome = {
    ...semanticGoal,
    status: "decision_pending" as const,
    currentRevisionView: { ...semanticGoal.currentRevisionView, status: "approved" as const },
  };
  await mount(
    <OutcomeDetail
      outcomeId={outcome.id}
      initialOutcome={outcome}
      client={{ ...client, get: async () => outcome, brief: async () => semanticBrief(outcome) }}
      actionItems={[
        decision,
        { ...decision, id: "resolved", title: "Already resolved", requiresAction: false },
      ]}
      onAction={(item) => {
        selected = item.decisionId!;
      }}
    />
  );
  expect(host.querySelector(".outcome-now h3")?.textContent).toBe(decision.title);
  expect(host.textContent).not.toContain("Start approved Outcome");
  expect(host.textContent).not.toContain("RAW_DECISION_CONTEXT");
  expect(host.textContent).not.toContain("Already resolved");
  // The real context is collapsed, never substituted by a generated decision.
  expect(host.querySelector(".outcome-now-context")?.hasAttribute("open")).toBe(false);
  await click("Decide");
  expect(selected).toBe(decision.decisionId!);
});

test("a mismatched server summary never displays another goal or revision", async () => {
  const wrong = semanticBrief({ ...semanticGoal, id: "another-goal" });
  await mount(
    <OutcomeBriefView outcome={semanticGoal} client={{ brief: async () => wrong }}>
      <p>Actual decision remains available</p>
    </OutcomeBriefView>
  );
  expect(host.textContent).toContain("Actual decision remains available");
  expect(host.textContent).toContain("Short overview unavailable");
  expect(host.textContent).not.toContain(wrong.background.title);
});

const turn = (overrides: Partial<OutcomeThreadTurnView> = {}): OutcomeThreadTurnView => ({
  id: "turn-1", purpose: "owner_message", trigger: "words", status: "queued", reply: null, error: null, runId: null,
  planMode: null, outcomeRevision: null, createdAt: "now", updatedAt: "now", ...overrides,
} as OutcomeThreadTurnView);
/** Stands in for the server's goal thread: it keeps what the owner sent until the test answers. */
function threadServer() {
  const turns: OutcomeThreadTurnView[] = [];
  const sent: SendOutcomeThreadMessageInput[] = [];
  return {
    turns,
    sent,
    client: {
      thread: async () => ({ threadId: "thread-1", turns: [...turns] }),
      sendThreadMessage: async (_id: string, input: SendOutcomeThreadMessageInput) => {
        sent.push(input);
        const created = turn({ id: `turn-${sent.length}`, trigger: input.text });
        turns.push(created);
        return created;
      },
    },
  };
}
const button = (text: string) => [...host.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);

test("the owner's words reach the goal's thread exactly as written; sending never approves the plan", async () => {
  let approvals = 0, revisions = 0, closed = 0;
  const server = threadServer();
  await mount(
    <OutcomeDetail
      outcomeId={semanticGoal.id}
      initialOutcome={semanticGoal}
      client={{
        ...client,
        ...server.client,
        get: async () => semanticGoal,
        approve: async () => (approvals++, semanticGoal),
        revise: async () => (revisions++, semanticGoal),
      }}
      onReplanStarted={() => closed++}
    />
  );
  // Nothing to send yet: no canned words are invented for the owner.
  expect((button("Send to bot") as HTMLButtonElement).disabled).toBe(true);
  const words = "取消目标\n  不需要重新规划 ";
  await editChanges(words);
  await click("Send to bot");
  expect(server.sent).toHaveLength(1);
  expect(server.sent[0]!.text).toBe(words);
  expect(approvals).toBe(0);
  expect(revisions).toBe(0);
  // The window can close at once: the bot works in the goal's own thread.
  expect(closed).toBe(1);
  expect(host.textContent).not.toContain("Choose changes to your plan");
});

test("while the bot works on a message the plan cannot be approved", async () => {
  await mount(
    <OutcomeDetail
      outcomeId={semanticGoal.id}
      initialOutcome={{ ...semanticGoal, status: "planning" }}
      client={{ ...client, ...threadServer().client, get: async () => ({ ...semanticGoal, status: "planning" }) }}
    />
  );
  expect((button("Yes, approve") as HTMLButtonElement).disabled).toBe(true);
  expect(host.textContent).toContain("The bot is working on your message");
});

test("the thread shows what the owner said and what the bot answered, and a question can be answered", async () => {
  const server = threadServer();
  server.turns.push(turn({ id: "t0", trigger: "做一个记账工具", status: "completed", reply: "要支持哪些货币？" }));
  server.turns.push(turn({ id: "t1", trigger: "只要人民币", status: "running" }));
  await mount(<OutcomeThreadPanel outcomeId={semanticGoal.id} client={{ ...client, ...server.client }} />);
  expect(host.textContent).toContain("做一个记账工具");
  expect(host.textContent).toContain("要支持哪些货币？");
  expect(host.textContent).toContain("只要人民币");
  expect(host.querySelector('[data-turn-status="running"]')?.textContent).toContain("The bot is working on this");
  const box = host.querySelector('textarea[aria-label="Message to the bot"]') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")!.set!.call(box, "还要美元");
    box.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    box.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await click("Send to bot");
  expect(server.sent.map((entry) => entry.text)).toEqual(["还要美元"]);
});

test("compact planner preview opens full history and sends the owner's exact words", async () => {
  const server = threadServer();
  server.turns.push(
    turn({ id: "first", trigger: "旧请求", status: "completed", reply: "旧回复" }),
    turn({ id: "second", trigger: "新请求", status: "completed", reply: "最新回复" })
  );
  await mount(<OutcomeThreadPanel outcomeId={semanticGoal.id} client={{ ...client, ...server.client }} compact />);
  expect(host.textContent).toContain("最新回复");
  expect(host.textContent).not.toContain("旧回复");
  const box = host.querySelector('textarea[aria-label="Message to the bot"]') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")!.set!.call(box, "只读检查\n  不要清理 ");
    box.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    box.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await click("Send to bot");
  expect(server.sent.map(entry => entry.text)).toEqual(["只读检查\n  不要清理 "]);
  await act(async () => {
    host.querySelector("button[aria-haspopup=dialog]")!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("旧回复");
});

test("a failed turn says so, and a finished goal keeps its record but takes no more messages", async () => {
  const server = threadServer();
  server.turns.push(turn({ status: "failed", error: { code: "run_failed", message: "model unavailable" } }));
  await mount(<OutcomeThreadPanel outcomeId={semanticGoal.id} client={{ ...client, ...server.client }} closed />);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("model unavailable");
  expect(host.querySelector('textarea[aria-label="Message to the bot"]')).toBeNull();
});

test("the conversation is a compact entry that opens in a dialog, and is absent when there is nothing to show", async () => {
  const server = threadServer();
  server.turns.push(turn({ id: "t0", trigger: "取消任务", status: "completed", reply: "任务已取消" }));
  await mount(<OutcomeThreadEntry outcomeId={semanticGoal.id} client={{ ...client, ...server.client }} />);
  expect(host.textContent).toContain("Conversation with the bot");
  expect(document.body.textContent).not.toContain("任务已取消");
  expect(document.body.querySelector("textarea")).toBeNull();
  await click("Conversation with the bot");
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("任务已取消");
  expect(document.body.querySelector('[role="dialog"] textarea')).not.toBeNull();
});

test("with an approval comment box and no history the conversation entry is not shown", async () => {
  await mount(<OutcomeThreadEntry outcomeId={semanticGoal.id} client={{ ...client, ...threadServer().client }} composer={false} />);
  expect(host.textContent).not.toContain("Conversation with the bot");
});

test("without a composer the thread only shows history, and an empty one shows nothing", async () => {
  const server = threadServer();
  await mount(<OutcomeThreadPanel outcomeId={semanticGoal.id} client={{ ...client, ...server.client }} composer={false} />);
  expect(host.textContent).not.toContain("Conversation with the bot");
  expect(host.querySelector("textarea")).toBeNull();
  server.turns.push(turn({ id: "t0", trigger: "只要人民币", status: "completed", reply: "好的，已改。" }));
  await mount(<OutcomeThreadPanel outcomeId={semanticGoal.id} client={{ ...client, ...server.client }} composer={false} />);
  expect(host.textContent).toContain("只要人民币");
  expect(host.textContent).toContain("好的，已改。");
  expect(host.querySelector("textarea")).toBeNull();
});

test("source info previews on hover, pins on click and dismisses with Escape", async () => {
  const brief = semanticBrief(semanticGoal);
  brief.risks = [
    { title: "Data loss", explanation: "Only remove approved files.", quote: "SOURCE_HOVER_PROOF" },
  ];
  await mount(
    <OutcomeBriefView outcome={semanticGoal} client={{ brief: async () => brief }}>
      <p>Pending</p>
    </OutcomeBriefView>
  );
  await expand("Recorded risks");
  const button = host.querySelector('button[aria-label="Source for Data loss"]')!;
  await act(async () =>
    button.dispatchEvent(new dom.window.Event("pointerover", { bubbles: true }))
  );
  expect(document.querySelector("[data-outcome-source]")?.textContent).toContain(
    "SOURCE_HOVER_PROOF"
  );
  await act(async () => {
    button.dispatchEvent(new dom.window.Event("pointerout", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  expect(document.querySelector("[data-outcome-source]")).toBeNull();
  await click("Source for Data loss");
  await act(async () => {
    button.dispatchEvent(new dom.window.Event("pointerout", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  expect(document.querySelector("[data-outcome-source]")).not.toBeNull();
  await act(async () => {
    const event = new dom.window.Event("keydown", { bubbles: true });
    Object.assign(event, { key: "Escape" });
    document.dispatchEvent(event);
  });
  expect(document.querySelector("[data-outcome-source]")).toBeNull();
});

function decisionInbox(decision: DecisionView, resolve: InboxClient["resolve"]): InboxClient {
  return {
    decision: async () => decision,
    resolve,
    list: unexpected,
    forOutcome: unexpected,
    humanItems: unexpected,
    humanItem: unexpected,
    startHuman: unexpected,
    pauseHuman: unexpected,
  };
}
const decisionGoal = {
  ...semanticGoal,
  status: "decision_pending" as const,
  currentRevisionView: { ...semanticGoal.currentRevisionView, status: "approved" as const },
};
const decisionItem = { ...inboxFixture, outcomeId: semanticGoal.id };
async function enterIdea(text: string) {
  const input = host.querySelector('input[aria-label="Your own idea"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, text);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

test("goal opens real route controls at the top; option details stay behind info and at most four suggestions are shown", async () => {
  const inputs: ResolveDecisionInput[] = [];
  let reads = 0,
    navigation = 0;
  const decision = {
    ...decisionFixture,
    outcomeId: decisionGoal.id,
    options: Array.from({ length: 5 }, (_, index) => ({
      ...decisionFixture.options[0]!,
      id: `route-${index}`,
      label: `Follow route ${index + 1}`,
      consequence: `RAW_IMPACT_${index}`,
      reason: `RAW_REASON_${index}`,
    })),
  };
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      client={{
        ...client,
        get: async () => {
          reads++;
          return decisionGoal;
        },
        brief: async () => semanticBrief(decisionGoal),
      }}
      inboxClient={decisionInbox(decision, async (_id, input) => {
        inputs.push(input);
        return decisionResolutionFixture;
      })}
      actionItems={[decisionItem]}
      onAction={() => {
        navigation++;
      }}
    />
  );
  const top = host.querySelector(".outcome-now")!;
  expect(top.textContent).toContain("Follow route 1");
  expect(top.textContent).not.toContain("Follow route 5");
  expect(top.querySelectorAll('input[type="radio"]')).toHaveLength(5);
  expect(host.textContent).not.toContain("RAW_IMPACT_0");
  expect(host.textContent).not.toContain("RAW_REASON_0");
  expect(host.innerHTML.indexOf("Follow route 1")).toBeLessThan(
    host.innerHTML.indexOf("Background")
  );
  await click("Source for Follow route 1");
  for (
    let i = 0;
    i < 30 && !document.querySelector('.outcome-source-content [data-streamdown="strong"]');
    i++
  )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  expect(document.querySelector(".outcome-source-content")?.textContent).toContain("RAW_IMPACT_0");
  expect(
    [...document.querySelectorAll('.outcome-source-content [data-streamdown="strong"]')].map(
      (el) => el.textContent
    )
  ).toContain("What happens");
  expect(inputs).toHaveLength(0);
  expect(
    [...top.querySelectorAll('input[type="radio"]')].every(
      (input) => !(input as HTMLInputElement).checked
    )
  ).toBe(true);
  await click("Source for Follow route 1");
  await act(async () =>
    host
      .querySelector('input[value="route-1"]')!
      .dispatchEvent(new dom.window.Event("click", { bubbles: true }))
  );
  await click("Submit choice");
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toMatchObject({
    optionId: "route-1",
    customText: null,
    expectedContractRevision: 1,
  });
  expect(navigation).toBe(0);
  expect(top.textContent).toContain("Decision recorded.");
  expect(top.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);
  expect(top.querySelector('input[value="route-1"]')?.hasAttribute("disabled")).toBe(true);
  await click("Source for Follow route 2");
  expect(document.querySelector(".outcome-source-content")?.textContent).toContain("RAW_IMPACT_1");
  expect(inputs).toHaveLength(1);
  expect(reads).toBeLessThan(4);
});

test("a pending work decision shows its revision's result chart before the choices", async () => {
  const reads: Array<[string, number]> = [];
  const originalText = "RAW_NEXT_STEP ".repeat(20);
  const decision = {
    ...decisionFixture,
    outcomeId: decisionGoal.id,
    workItemId: "result-task",
    nextStepSummary: originalText,
  };
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      client={{
        ...client,
        get: async () => decisionGoal,
        resultSummary: async (id, revision) => {
          reads.push([id, revision]);
          return {
            outcomeId: id, revisionId: decision.contractRevisionId,
            summary: "There is enough space; choose whether to record the early cleanup.", details: "",
            sources: [{ title: "Capacity reading", quote: "Cache 63%, array 34%" }],
            charts: [{ type: "bar", unit: "%", title: "Storage use", points: [
              { label: "Cache", value: 63, citation: 0 }, { label: "Array", value: 34, citation: 0 },
            ] }],
          };
        },
      }}
      inboxClient={decisionInbox(decision, unexpected)}
      actionItems={[decisionItem]}
    />
  );
  const card = host.querySelector('article[aria-label="Decision"]')!;
  expect(reads).toEqual([[decisionGoal.id, decision.contractRevision]]);
  expect(card.querySelector("h3")?.textContent).toBe("Choose how to proceed");
  expect(card.querySelector('figure[data-chart-type="bar"]')?.textContent).toContain("63%");
  expect(card.innerHTML.indexOf("Storage use")).toBeLessThan(card.innerHTML.indexOf("<form"));
  expect(card.textContent).not.toContain("RAW_NEXT_STEP");
  await expand("Recommendation, impact and evidence");
  expect(card.textContent).toContain(originalText.trim());
});

test("an open decision card shows the saved report when the review finishes without changing the choices", async () => {
  const decision = { ...decisionFixture, outcomeId: decisionGoal.id, workItemId: "result-task" };
  let reviewed = false;
  await mount(
    <OutcomeDetail outcomeId={decisionGoal.id} initialOutcome={decisionGoal}
      client={{ ...client, get: async () => decisionGoal, resultSummary: async () => reviewed ? {
        outcomeId: decision.outcomeId, revisionId: decision.contractRevisionId, reviewTurnId: "turn-1",
        summary: "Keep the current configuration.", details: "", sources: [],
      } : null }}
      inboxClient={decisionInbox(decision, unexpected)} actionItems={[decisionItem]}
    />,
  );
  const card = host.querySelector('article[aria-label="Decision"]')!;
  const form = card.querySelector("form")!;
  expect(card.textContent).not.toContain("Keep the current configuration.");
  reviewed = true;
  await act(async () => {
    refreshOutcomeViews({ sequence: "1", topic: "goal.thread.updated", entityId: decision.outcomeId,
      payload: { status: "completed" }, createdAt: new Date().toISOString() });
    await new Promise((resolve) => setTimeout(resolve, OUTCOME_REFRESH_DEBOUNCE_MS + 30));
  });
  expect(card.textContent).toContain("Keep the current configuration.");
  expect(card.querySelector("form")).toBe(form);
});

test("typing an independent custom route and submitting uses exact text without a separate reveal or radio click", async () => {
  const inputs: ResolveDecisionInput[] = [];
  const decision = { ...decisionFixture, outcomeId: decisionGoal.id };
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      client={{ ...client, get: async () => decisionGoal }}
      inboxClient={decisionInbox(decision, async (_id, input) => {
        inputs.push(input);
        return decisionResolutionFixture;
      })}
      actionItems={[decisionItem]}
    />
  );
  await enterIdea("  Measure only; I will decide on cleanup later.  ");
  expect(inputs).toHaveLength(0);
  await click("Submit choice");
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toMatchObject({
    optionId: null,
    customText: "  Measure only; I will decide on cleanup later.  ",
  });
});

test("a binary runtime decision uses direct buttons with comments above, and retains the exact chosen effect", async () => {
  const inputs: ResolveDecisionInput[] = [];
  const decision = {
    ...decisionFixture,
    outcomeId: decisionGoal.id,
    options: [
      { ...decisionFixture.options[0]!, id: "yes", label: "Yes" },
      {
        ...decisionFixture.options[0]!,
        id: "no",
        label: "No",
        resolutionEffect: "cancel_branch" as const,
      },
    ],
  };
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      client={{ ...client, get: async () => decisionGoal }}
      inboxClient={decisionInbox(decision, async (_id, input) => {
        inputs.push(input);
        return decisionResolutionFixture;
      })}
      actionItems={[decisionItem]}
    />
  );
  expect(host.querySelector('input[type="radio"]')).toBeNull();
  const input = host.querySelector(
    'textarea[aria-label="Decision comments"]'
  ) as HTMLTextAreaElement;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(
      input,
      "Please preserve the source files."
    );
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await click("No");
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toMatchObject({
    optionId: "no",
    customText: "Please preserve the source files.",
    expectedContractRevision: 1,
  });
});

test("a snapshot which disallows custom text never offers or submits a fabricated custom route", async () => {
  const decision = { ...decisionFixture, outcomeId: decisionGoal.id, customEntryAllowed: false };
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      client={{ ...client, get: async () => decisionGoal }}
      inboxClient={decisionInbox(decision, unexpected)}
      actionItems={[decisionItem]}
    />
  );
  expect(host.querySelector('[aria-label="Your own idea"]')).toBeNull();
  expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(1);
});

test("Bot photo stays mounted during same-Bot metadata refresh and clears when identity changes", async () => {
  const originalFetch = globalThis.fetch;
  const imagePrototype = dom.window.HTMLImageElement.prototype;
  const imageDescriptors = ["complete", "naturalWidth"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(imagePrototype, key)] as const
  );
  // Linkedom has no image decoder; only supply the successful decode metadata.
  Object.defineProperties(imagePrototype, {
    complete: { configurable: true, get: () => true },
    naturalWidth: { configurable: true, get: () => 36 },
  });
  let resolve!: (value: Response) => void;
  let reads = 0;
  globalThis.fetch = Object.assign(
    async () =>
      ++reads === 1
        ? new Response("fixture photo")
        : new Promise<Response>((done) => {
            resolve = done;
          }),
    { preconnect: originalFetch.preconnect }
  );
  const bot = {
    id: "avatar-fixture",
    updatedAt: "2026-11-18T01:00:00Z",
    hasAvatar: true,
    color: "#777777",
    icon: "round",
  };
  try {
    await mount(<BotAvatar bot={bot} mode="still" />);
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    const image = host.querySelector("img");
    expect(image).not.toBeNull();
    const oldSource = image!.getAttribute("src");
    await act(async () =>
      root!.render(
        <I18nProvider>
          <BotAvatar bot={{ ...bot, updatedAt: "2026-11-18T01:00:03Z" }} mode="still" />
        </I18nProvider>
      )
    );
    expect(reads).toBe(2);
    expect(host.querySelector("img")).toBe(image);
    expect(image!.getAttribute("src")).toBe(oldSource);
    await act(async () => resolve(new Response("new fixture photo")));
    expect(host.querySelector("img")).toBe(image);
    expect(image!.getAttribute("src")).not.toBe(oldSource);
    await act(async () =>
      root!.render(
        <I18nProvider>
          <BotAvatar bot={{ ...bot, id: "other-bot" }} mode="still" />
        </I18nProvider>
      )
    );
    expect(host.querySelector("img")).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of imageDescriptors) {
      if (descriptor) Object.defineProperty(imagePrototype, key, descriptor);
      else Reflect.deleteProperty(imagePrototype, key);
    }
  }
});

test("same-goal refresh keeps the displayed card while the next read is pending", async () => {
  const live = { ...semanticGoal, status: "running" as const };
  let resolve!: (value: typeof live) => void;
  let reads = 0;
  const source = {
    get: async () =>
      ++reads === 1
        ? live
        : new Promise<typeof live>((done) => {
            resolve = done;
          }),
    brief: async () => semanticBrief(live),
  };
  await mount(<OutcomeChatCardView card={card} client={source} />);
  const main = host.querySelector(".outcome-chat-card-main");
  expect(main?.textContent).toContain(live.title);
  await act(async () =>
    root!.render(
      <I18nProvider>
        <OutcomeChatCardView
          card={{ ...card, updatedAt: "2026-11-18T02:00:00Z" }}
          client={source}
        />
      </I18nProvider>
    )
  );
  expect(reads).toBe(2);
  expect(host.querySelector(".outcome-chat-card-main")).toBe(main);
  expect(main?.textContent).toContain(live.title);
  await act(async () => resolve(live));
  expect(host.querySelector(".outcome-chat-card-main")).toBe(main);
});

test("original source renders Markdown paragraphs, emphasis and lists", async () => {
  const { OutcomeSourceInfo } = await import(
    "../src/renderer/components/outcomego/outcomes/outcome-source-info"
  );
  await mount(
    <OutcomeSourceInfo
      name="Markdown source"
      text={
        "**Prerequisite**\n\nConfirm the backup.\n\n- **First:** measure usage.\n- Next: review results."
      }
    />
  );
  await click("Source for Markdown source");
  await act(async () => {
    await import("../src/renderer/components/ai-elements/message-response");
  });
  const content = document.querySelector("[data-outcome-source]")!;
  expect(content.querySelector('[data-streamdown="strong"]')?.textContent).toBe("Prerequisite");
  expect(content.querySelectorAll("li")).toHaveLength(2);
  expect(content.textContent).not.toContain("**");
});

const executionGoal = {
  ...outcomeFixture,
  status: "running" as const,
  workItems: [{ ...outcomeFixture.workItems[0]!, status: "running" as const }],
};
const executionPage = (text = "Measured **array** usage.") => ({
  total: 5,
  next_before: 2,
  rows: [
    {
      id: "execution-input",
      at: planFixture.generatedAt,
      role: "user",
      status: "completed",
      content: "INTERNAL_EXECUTION_INPUT",
    },
    {
      id: "visible-message",
      at: planFixture.generatedAt,
      role: "assistant",
      status: "completed",
      content: text,
    },
    {
      id: "visible-tool",
      at: planFixture.generatedAt,
      role: "tool",
      status: "completed",
      content: JSON.stringify({
        tool: "Shell",
        command: "df -h",
        output: "Fixture observable output",
        arguments: "SHOULD_NOT_RENDER",
      }),
    },
  ],
});

/** The execution conversation is a dialog rendered in a portal, outside the mounted host. */
const executionDialog = () => document.body.querySelector<HTMLElement>(".outcome-execution-dialog");
async function openExecution() {
  const entry = host.querySelector(".outcome-execution-card");
  expect(entry).not.toBeNull();
  await act(async () => {
    entry!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    await import("../src/renderer/components/ai-elements/message-response");
  });
}
async function clickInDialog(text: string) {
  const button = [...executionDialog()!.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === text
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
}

test("execution entry stays compact and reads only after the read-only conversation opens", async () => {
  const { createOutcomeApi } = await import("../src/renderer/client/outcome-api");
  const requests: Array<{ path: string; method: string }> = [];
  const reader = createOutcomeApi(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    requests.push({ path, method: init?.method ?? "GET" });
    return (
      path.includes("?before=")
        ? { ...executionPage("Earlier visible message"), next_before: null }
        : executionPage()
    ) as T;
  });
  await mount(<OutcomeExecutionCard outcome={executionGoal} client={reader} />);
  expect(requests).toHaveLength(0);
  expect(host.textContent).toContain("Read-only");
  expect(host.querySelector("details")).toBeNull();
  expect(executionDialog()).toBeNull();
  await openExecution();
  const dialog = executionDialog()!;
  expect(dialog.textContent).toContain("Fixture observable output");
  expect(dialog.textContent).toContain("Measured array usage.");
  expect(dialog.textContent).toContain("This chat is view-only");
  expect(dialog.textContent).not.toContain("SHOULD_NOT_RENDER");
  expect(dialog.textContent).not.toContain("INTERNAL_EXECUTION_INPUT");
  expect(dialog.querySelector(".outcome-execution-tool")?.hasAttribute("open")).toBe(false);
  // Chronological like a chat: the newest message is the last row, not the first.
  const roles = [...dialog.querySelectorAll(".outcome-execution-messages > li")].map((li) =>
    li.getAttribute("data-message-role")
  );
  expect(roles).toEqual(["assistant", "tool"]);
  const tool = dialog.querySelector(".outcome-execution-tool")!;
  expect(tool.querySelector(".outcome-execution-tool-type")?.textContent).toBe("Shell");
  expect(tool.querySelector(".outcome-execution-tool-preview")?.textContent).toBe("df -h");
  expect(dialog.querySelector('li[data-message-role="assistant"] strong')?.textContent).toBe("Bot");
  expect(dialog.querySelector('li .bot-markdown [data-streamdown="strong"]')?.textContent).toBe(
    "array"
  );
  expect(dialog.querySelector("textarea,input")).toBeNull();
  await clickInDialog("Earlier messages");
  expect(requests.at(-1)?.path).toBe(
    "/api/outcomes/outcome-1/work-items/item-1/transcript?before=2"
  );
  expect(dialog.textContent).toContain("Earlier visible message");
  await clickInDialog("Latest messages");
  expect(dialog.textContent).toContain("Measured array usage.");
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  await clickInDialog("Close Chat");
  expect(executionDialog()).toBeNull();
});

test("settled goal card is read once and carries no execution entry or footer", async () => {
  let reads = 0;
  await mount(
    <OutcomeChatCardView
      card={card}
      client={{
        get: async () => (reads++, { ...outcomeFixture, status: "accepted" as const }),
        transcript: async () => executionPage(),
      }}
    />
  );
  expect(host.querySelector(".outcome-chat-card > footer")).toBeNull();
  expect(host.querySelectorAll(".outcome-execution-card")).toHaveLength(0);
  expect(host.querySelectorAll(".outcome-chat-card button")).toHaveLength(1);
  expect(reads).toBe(1);
});

test("execution refresh preserves readable messages; closing stops the scheduled refresh", async () => {
  const originalTimeout = globalThis.setTimeout;
  let scheduled: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    const handle = originalTimeout(callback, ms, ...args);
    if (ms === 5000) {
      scheduled = callback as () => Promise<void>;
      timer = handle;
    }
    return handle;
  }) as typeof setTimeout;
  let resolve!: (value: ReturnType<typeof executionPage>) => void;
  let reads = 0;
  const reader = {
    transcript: async () =>
      ++reads === 1
        ? executionPage("First visible message")
        : new Promise<ReturnType<typeof executionPage>>((done) => {
            resolve = done;
          }),
  };
  try {
    await mount(<OutcomeExecutionCard outcome={executionGoal} client={reader} />);
    await openExecution();
    expect(reads).toBe(1);
    const message = executionDialog()!.querySelector("li");
    expect(scheduled).toBeDefined();
    clearTimeout(timer);
    let pending!: Promise<void>;
    await act(async () => {
      pending = scheduled!();
    });
    expect(reads).toBe(2);
    expect(executionDialog()!.querySelector("li")).toBe(message);
    expect(executionDialog()!.textContent).toContain("First visible message");
    await act(async () => {
      resolve(executionPage("Second visible message"));
      await pending;
    });
    expect(executionDialog()!.textContent).toContain("Second visible message");
    await clickInDialog("Close Chat");
    expect(executionDialog()).toBeNull();
    expect(reads).toBe(2);
  } finally {
    globalThis.setTimeout = originalTimeout;
  }
});

test("switching execution tasks discards a late old-task response and keeps current-task errors retryable", async () => {
  let resolveOld!: (value: ReturnType<typeof executionPage>) => void;
  let fail = true;
  const goal = {
    ...executionGoal,
    workItems: [
      ...executionGoal.workItems,
      { ...executionGoal.workItems[0]!, id: "second-task", title: "Inspect candidates" },
    ],
  };
  const reader = {
    transcript: async (_id: string, itemId: string) =>
      itemId === "item-1"
        ? new Promise<ReturnType<typeof executionPage>>((done) => {
            resolveOld = done;
          })
        : fail
          ? Promise.reject(new Error("offline"))
          : executionPage("Current task messages"),
  };
  await mount(<OutcomeExecutionCard outcome={goal} client={reader} />);
  await openExecution();
  const select = executionDialog()!.querySelector("select")!;
  await act(async () => {
    Object.defineProperty(select, "value", { configurable: true, value: "second-task" });
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  expect(executionDialog()!.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not load execution messages"
  );
  fail = false;
  await clickInDialog("Refresh");
  expect(executionDialog()!.textContent).toContain("Current task messages");
  await act(async () => resolveOld(executionPage("Obsolete task message")));
  expect(executionDialog()!.textContent).not.toContain("Obsolete task message");
  expect(executionDialog()!.textContent).toContain("Current task messages");
});

test("acceptance shows measured results and sends the rejection reason directly", async () => {
  const richOutcome = {
    ...outcomeFixture,
    currentRevisionView: {
      ...outcomeFixture.currentRevisionView!,
      criteria: [
        {
          ...outcomeFixture.currentRevisionView!.criteria[0]!,
          id: "criterion-1",
          ordinal: 1,
          statement: "Verify pool space measurements",
          latestResult: null,
        },
        {
          ...outcomeFixture.currentRevisionView!.criteria[0]!,
          id: "criterion-2",
          ordinal: 2,
          statement: "Confirm no active data deleted",
          required: false,
          latestResult: null,
        },
      ],
    },
    outputs: [
      {
        id: "output-file",
        workItemId: "item-1",
        runId: "run-1",
        kind: "file" as const,
        title: "Raw disk scan CSV",
        content: "pool,before_used_gb,after_used_gb\ncache,480,360",
        contentRef: "file:/tmp/scan.csv",
        createdAt: outcomeFixture.createdAt,
      },
      {
        id: "output-final",
        workItemId: "item-1",
        runId: "run-1",
        kind: "final_result" as const,
        title: "Storage cleanup assessment",
        content: "Migration completed. Cache use went from 84% to 63%.",
        contentRef: null,
        createdAt: outcomeFixture.createdAt,
      },
    ],
    evidence: [
      {
        id: "ev-check",
        criterionId: "criterion-1",
        contractRevision: 1,
        workItemId: "item-1",
        runId: "run-1",
        sourceType: "check" as const,
        sourceRef: "check:df-scan",
        contentSummary: "df -h verified 120 GB freeable",
        credibility: "deterministic_check" as const,
        capturedBy: "system:check",
        capturedAt: outcomeFixture.createdAt,
      },
      {
        id: "ev-prereview-1",
        criterionId: "criterion-1",
        contractRevision: 1,
        workItemId: "item-1",
        runId: "run-1",
        sourceType: "prereview" as const,
        sourceRef: "prereview:item-1:criterion-1",
        contentSummary: "likely_pass: Measurements match df output",
        credibility: "ai_prereview" as const,
        capturedBy: "system:outcome-prereview",
        capturedAt: outcomeFixture.createdAt,
      },
      {
        id: "ev-agent-1",
        criterionId: "criterion-1",
        contractRevision: 1,
        workItemId: "item-1",
        runId: "run-1",
        sourceType: "output" as const,
        sourceRef: "output:output-final",
        contentSummary: "Long agent output copy for criterion 1",
        credibility: "agent_report" as const,
        capturedBy: "bot:test",
        capturedAt: outcomeFixture.createdAt,
      },
      {
        id: "ev-agent-2",
        criterionId: "criterion-2",
        contractRevision: 1,
        workItemId: "item-1",
        runId: "run-1",
        sourceType: "output" as const,
        sourceRef: "output:output-final",
        contentSummary: "Long agent output copy for criterion 2",
        credibility: "agent_report" as const,
        capturedBy: "bot:test",
        capturedAt: outcomeFixture.createdAt,
      },
    ],
    reviews: [],
  };
  const summaryRequests: [string, number][] = [];
  const decisions: Parameters<NonNullable<OutcomeClient["decideAcceptance"]>>[1][] = [];

  await mount(
    <OutcomeDetail
      outcomeId={richOutcome.id}
      client={{
        ...client,
        get: async () => richOutcome,
        decideAcceptance: async (id, input) => {
          expect(id).toBe(richOutcome.id);
          decisions.push(input);
          return { ...richOutcome, status: "running" };
        },
        resultSummary: async (id, revision) => {
          summaryRequests.push([id, revision]);
          return {
            outcomeId: richOutcome.id,
            revisionId: richOutcome.currentRevisionView.id,
            summary: "120 GB freed on Cache. Used space fell from 480 GB (84%) to 360 GB (63%).",
            details: "The scan measured used space on Cache.",
            sources: [
              { title: "Raw disk scan CSV", quote: "cache,480,360" },
              { title: "Cleanup report", quote: "Cache use went from 84% to 63%." },
            ],
            charts: [{
              type: "bar",
              title: "Cache utilization",
              unit: "%",
              points: [
                { label: "Before", value: 84, citation: 1 },
                { label: "After", value: 63, citation: 1 },
              ],
            }],
          };
        },
      }}
    />
  );

  expect(summaryRequests).toEqual([[richOutcome.id, 1]]);
  const goalDetails = host.querySelector('[data-outcome-section="goal-details"]')!;
  expect(goalDetails.hasAttribute("hidden")).toBe(true);
  await click("Goal details");
  expect(goalDetails.hasAttribute("hidden")).toBe(false);
  await click("Goal details");
  expect(goalDetails.hasAttribute("hidden")).toBe(true);

  // Supporting records remain hidden when opening acceptance review.
  expect(host.textContent).not.toContain("Saved plan");
  expect(host.textContent).not.toContain("Execution progress");
  expect(host.textContent).not.toContain("More actions and diagnostics");

  const review = host.querySelector('[data-outcome-section="review"] [aria-label="Review and rework"]')!;
  expect(review).not.toBeNull();
  expect(review.textContent).toContain("Acceptance summary");
  const report = review.querySelector(".outcome-result-report")!;
  expect(report.textContent).toContain(
    "120 GB freed on Cache. Used space fell from 480 GB (84%) to 360 GB (63%)."
  );
  const chart = report.querySelector('figure[data-chart-type="bar"]')!;
  expect(report.firstElementChild?.textContent).toBe("Results summary · not reviewed");
  expect(report.innerHTML.indexOf("120 GB freed on Cache")).toBeLessThan(report.innerHTML.indexOf("<figure"));
  expect(chart.querySelector("figcaption")?.textContent).toBe("Cache utilization");
  expect([...chart.querySelectorAll("li strong")].map((value) => value.textContent)).toEqual(["84%", "63%"]);
  expect([...chart.querySelectorAll<HTMLElement>(".outcome-chart-bar-fill")].map((bar) => bar.style.width)).toEqual(["84%", "63%"]);
  expect([...chart.querySelectorAll(".outcome-chart-scale span")].map((label) => label.textContent)).toEqual(["0%", "100%"]);
  const details = report.querySelector("details")!;
  expect(details.hasAttribute("open")).toBe(false);
  expect(details.textContent).toContain("cache,480,360");
  expect(review.textContent).not.toContain("Review acceptance criteria");
  expect(review.textContent).not.toContain("Verify pool space measurements");
  expect(review.querySelector("fieldset")).toBeNull();
  const reject = [...review.querySelectorAll("button")].find((button) => button.textContent === "Reject")!;
  expect(reject.hasAttribute("disabled")).toBe(true);
  const reason = review.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(reason), "value")!.set!.call(
      reason,
      "  Include the before and after available space.  "
    );
    reason.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    reason.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  expect(reject.hasAttribute("disabled")).toBe(false);
  await click("Hide review");
  expect(host.querySelector('[data-outcome-section="review"]')?.hasAttribute("hidden")).toBe(true);
  await click("Review results");
  expect(reason.value).toBe("  Include the before and after available space.  ");
  expect(summaryRequests).toHaveLength(1);
  await click("Reject");
  expect(decisions).toHaveLength(1);
  expect(decisions[0]).toMatchObject({
    decision: "reject", expectedRevision: 1, reason: "Include the before and after available space.",
  });
});

test("approving a goal result takes one click and records acceptance", async () => {
  let decisions = 0;
  await mount(
    <OutcomeDetail
      outcomeId={outcomeFixture.id}
      initialOutcome={outcomeFixture}
      client={{
        ...client,
        decideAcceptance: async (id, input) => {
          decisions++;
          expect(id).toBe(outcomeFixture.id);
          expect(input).toMatchObject({ decision: "approve", expectedRevision: 1 });
          expect(input).not.toHaveProperty("reason");
          return { ...outcomeFixture, status: "accepted" };
        },
      }}
    />
  );
  await click("Approve");
  expect(decisions).toBe(1);
  expect(host.textContent).toContain("You accepted the result.");
  expect(host.querySelector('[aria-label="Result decision"]')).toBeNull();
});

test("review_pending sends approval feedback directly to the planner thread, shows waiting state, and displays planner reply", async () => {
  const sentMessages: SendOutcomeThreadMessageInput[] = [];
  const turns: OutcomeThreadTurnView[] = [];
  let decisions = 0;
  const threadClient: OutcomeClient = {
    ...client,
    get: async () => outcomeFixture,
    thread: async () => ({ threadId: "thread-1", turns: [...turns] }),
    sendThreadMessage: async (_id, input) => {
      sentMessages.push(input);
      const turn: OutcomeThreadTurnView = {
        id: `turn-${turns.length + 1}`,
        planMode: null,
        outcomeRevision: null,
        purpose: "owner_message",
        trigger: input.text,
        status: "running",
        reply: null,
        error: null,
        runId: `run-${turns.length + 1}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      turns.push(turn);
      return turn;
    },
    decideAcceptance: async (_id, input) => {
      decisions++;
      expect(input).toMatchObject({ decision: "approve", expectedRevision: 1 });
      return { ...outcomeFixture, status: "accepted" };
    },
  };

  await mount(
    <OutcomeDetail
      outcomeId={outcomeFixture.id}
      initialOutcome={outcomeFixture}
      client={threadClient}
    />
  );

  const review = host.querySelector('[data-outcome-section="review"] [aria-label="Review and rework"]')!;
  const sendButton = [...review.querySelectorAll("button")].find((b) => b.textContent === "Send to planner")!;
  const approveButton = [...review.querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
  expect(sendButton.hasAttribute("disabled")).toBe(true);
  expect(approveButton.hasAttribute("disabled")).toBe(false);

  const textarea = review.querySelector('textarea[aria-label="Approval feedback"]') as HTMLTextAreaElement;
  expect(textarea).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")!.set!.call(
      textarea,
      "执行一次备份后，结束目标"
    );
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  expect(sendButton.hasAttribute("disabled")).toBe(false);
  expect(approveButton.hasAttribute("disabled")).toBe(true);
  expect(host.textContent).toContain("Clear the text to approve immediately.");

  await click("Send to planner");
  expect(sentMessages).toHaveLength(1);
  expect(sentMessages[0]!.text).toBe("执行一次备份后，结束目标");
  expect(textarea.value).toBe("");
  expect(host.textContent).toContain("The planner is processing your approval feedback…");
  expect(approveButton.hasAttribute("disabled")).toBe(true);

  turns[0] = {
    ...turns[0]!,
    status: "completed",
    reply: "我还缺少一个定时备份开关的确认，请问是否需要开启每周自动备份？",
  };
  await act(async () => {
    handleOutcomeThreadEvent({
      topic: "goal.thread.updated",
      entityId: outcomeFixture.id,
      payload: { outcomeId: outcomeFixture.id, turnId: turns[0]!.id, status: "completed", title: outcomeFixture.title },
      createdAt: new Date().toISOString(),
    } as never);
    await Promise.resolve();
  });
  expect(host.textContent).toContain("Planner reply");
  expect(host.textContent).toContain("我还缺少一个定时备份开关的确认");
  expect(approveButton.hasAttribute("disabled")).toBe(false);

  await click("Approve");
  expect(decisions).toBe(1);
});

test("marking a failed criterion for rework automatically expands the Rework section", async () => {
  const receipt = {
    ...outcomeFixture,
    workItems: [
      ...outcomeFixture.workItems,
      { ...outcomeFixture.workItems[0]!, id: "receipt", executorType: "human" as const, status: "review_pending" as const },
    ],
  };
  await mount(
    <OutcomeDetail
      outcomeId={outcomeFixture.id}
      initialOutcome={receipt}
      client={{ ...client, get: async () => receipt }}
    />
  );
  await expand("Review acceptance criteria");
  await expand("1. Compare costs");
  await expand("Comment, evidence link or rework");
  const review = host.querySelector('[data-outcome-section="review"] [aria-label="Review and rework"]')!;
  const reworkDetails = [...review.querySelectorAll("details.outcome-brief-section")].find((el) =>
    el.querySelector("summary")?.textContent?.startsWith("Rework")
  )!;
  expect(reworkDetails.hasAttribute("open")).toBe(false);
  const reworkCheckbox = [...review.querySelectorAll("label")]
    .find((label) => label.textContent?.includes("Include in rework"))!
    .querySelector('input[type="checkbox"]') as HTMLInputElement;
  await act(async () => {
    reworkCheckbox.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(reworkDetails.hasAttribute("open")).toBe(true);
  expect(reworkDetails.textContent).toContain("1 criteria selected for rework");
});

test("accepted outcome review footer reflects accepted state rather than pending confirmation", async () => {
  const accepted = { ...outcomeFixture, status: "accepted" as const };
  await mount(
    <OutcomeDetail
      outcomeId={accepted.id}
      initialOutcome={accepted}
      client={{ ...client, get: async () => accepted }}
    />
  );
  await click("More details");
  await click("Open acceptance review");
  expect(host.textContent).toContain("You accepted the result. Its outputs remain available.");
  expect(host.textContent).not.toContain("Required criteria still need PASS");
});

test("summarizeOutputContent strips Markdown tables and code blocks into a readable summary", async () => {
  const { summarizeOutputContent } = await import(
    "../src/renderer/components/outcomego/outcomes/detail/review-panel"
  );
  const { preview, truncated } = summarizeOutputContent(
    "## Disk usage\n| Share | Reclaimable |\n| --- | --- |\n| cache | 120 GB |\n```sh\ndf -h\n```"
  );
  expect(truncated).toBe(false);
  expect(preview).toBe("Disk usage Share · Reclaimable cache · 120 GB");
});

test("the chat goal card shows the same plan text as the goal page, from the saved overview", async () => {
  const pending = {
    ...outcomeFixture,
    status: "pending_approval",
    currentRevisionView: { ...outcomeFixture.currentRevisionView!, status: "pending_approval", approvedAt: null, approvedBy: null },
  } as DetailView;
  const brief = semanticBrief(pending);
  const render = async (inChat: boolean) => {
    await mount(
      <OutcomeDetail
        outcomeId={pending.id}
        initialOutcome={pending}
        inChat={inChat}
        client={{ ...client, get: async () => pending, brief: async () => brief }}
      />
    );
    await act(async () => {});
    return host.textContent ?? "";
  };
  const chat = await render(true);
  expect(chat).toContain(brief.intent.title);
  expect(chat).not.toContain("Check the proposed scope before execution starts.");
  // The goal page reads the same overview, so both places say the same thing.
  expect(await render(false)).toContain(brief.intent.title);
});

test("expanded chat goal card matches normal message bubble width, hides goal details, and opens them from top info button", async () => {
  const css = await Bun.file(
    new URL("../src/renderer/components/outcomego/outcomes/outcome-ui.css", import.meta.url)
  ).text();
  const chatPaneSource = await Bun.file(
    new URL("../src/renderer/components/outcomego/chat-pane.tsx", import.meta.url)
  ).text();
  expect(css).toContain("width: 420px;");
  expect(css).toContain('.outcome-chat-card[data-expanded="true"]');
  expect(css).toContain("width: 640px;");
  expect(chatPaneSource).toContain("max-w-[min(88%,640px,calc(100%-82px))]");
  expect(chatPaneSource).not.toContain("760px");

  let briefCalls = 0;
  let modalRequests = 0;
  const server = threadServer();
  server.turns.push(turn({ id: "t1", trigger: "先检查容量", status: "completed", reply: "已复查完成" }));
  const decision = {
    ...decisionFixture,
    outcomeId: decisionGoal.id,
    workItemId: "result-task",
  };
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      inChat
      onOpenDetails={() => modalRequests++}
      client={{
        ...client,
        ...server.client,
        get: async () => decisionGoal,
        brief: async () => {
          briefCalls++;
          return semanticBrief(decisionGoal);
        },
        resultSummary: async (id, revision) => ({
          outcomeId: id,
          revisionId: decision.contractRevisionId,
          summary: "Main cache 63%, array 34%.",
          details: "",
          sources: [{ title: "Disk check", quote: "cache 63%" }],
          charts: [{ type: "bar", unit: "%", title: "Current storage", points: [{ label: "Cache", value: 63, citation: 0 }] }],
        }),
      }}
      inboxClient={decisionInbox(decision, unexpected)}
      actionItems={[decisionItem]}
    />
  );

  // Result report and choices are visible.
  expect(host.textContent).toContain("Main cache 63%, array 34%.");
  expect(host.textContent).toContain("Current storage");
  expect(host.textContent).toContain("Use source A");
  // The card reads the goal overview once so its plan text matches the goal page, but background,
  // prerequisites, thread history, and thread composer are omitted inline.
  expect(briefCalls).toBe(1);
  expect(host.textContent).not.toContain("Background");
  expect(host.textContent).not.toContain("Prerequisites");
  expect(host.textContent).not.toContain("Conversation with the planner");
  expect(host.querySelector('textarea[aria-label="Message to the bot"]')).toBeNull();

  await click("View goal details");
  expect(modalRequests).toBe(1);
  // Clicking info in chat opens the standalone modal instead of expanding inline records.
  expect(host.querySelector('[aria-label="Supporting records"]')).toBeNull();
});

test("OutcomeChatCardView expands with data-expanded and opens details modal on info click", async () => {
  await mount(
    <OutcomeChatCardView
      card={{ ...card, stage: "review" }}
      client={{
        ...client,
        get: async () => outcomeFixture,
        brief: async () => semanticBrief(outcomeFixture),
      }}
    />
  );
  const cardEl = host.querySelector(".outcome-chat-card")!;
  expect(cardEl.getAttribute("data-expanded")).toBeNull();
  const main = host.querySelector<HTMLButtonElement>("button.outcome-chat-card-main")!;
  await act(async () => {
    main.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(cardEl.getAttribute("data-expanded")).toBe("true");
  expect(main.getAttribute("aria-expanded")).toBe("true");
});

test("custom idea in decision card sends exact message to planner bot instead of resolving decision", async () => {
  const server = threadServer();
  let resolvedCalls = 0;
  const decision = { ...decisionFixture, outcomeId: decisionGoal.id };
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      client={{ ...client, ...server.client, get: async () => decisionGoal }}
      inboxClient={decisionInbox(decision, async () => {
        resolvedCalls++;
        return decisionResolutionFixture;
      })}
      actionItems={[decisionItem]}
    />
  );
  await enterIdea("  Keep VM image only and recheck backup folder size  ");
  expect(server.sent).toHaveLength(0);
  expect(resolvedCalls).toBe(0);
  await click("Send to bot");
  expect(resolvedCalls).toBe(0);
  expect(server.sent).toHaveLength(1);
  expect(server.sent[0]!.text).toBe("  Keep VM image only and recheck backup folder size  ");
  expect((host.querySelector('[aria-label="Your own idea"]') as HTMLInputElement).value).toBe("");
  expect(host.textContent).toContain("Sent to the goal planner");
});

test("OutcomeChatCardView keeps expanded subtree mounted across collapse/re-expand and animates smoothly", async () => {
  const css = await Bun.file(
    new URL("../src/renderer/components/outcomego/outcomes/outcome-ui.css", import.meta.url)
  ).text();
  expect(css).toContain(".outcome-chat-expandable");
  expect(css).toContain("grid-template-rows: 0fr");
  expect(css).toContain("grid-template-rows: 1fr");

  await mount(
    <OutcomeChatCardView
      card={{ ...card, stage: "review" }}
      client={{
        ...client,
        get: async () => outcomeFixture,
        brief: async () => semanticBrief(outcomeFixture),
      }}
    />
  );
  const cardEl = host.querySelector(".outcome-chat-card")!;
  const main = host.querySelector<HTMLButtonElement>("button.outcome-chat-card-main")!;
  expect(host.querySelector(".outcome-chat-expandable")).toBeNull();

  // Expand once.
  await act(async () => {
    main.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const expandable = host.querySelector(".outcome-chat-expandable")!;
  const expandedPanel = host.querySelector("[data-goal-chat-actions]")!;
  expect(cardEl.getAttribute("data-expanded")).toBe("true");
  expect(expandable.getAttribute("data-open")).toBe("true");
  expect(expandable.getAttribute("aria-hidden")).toBe("false");
  expect(expandable.hasAttribute("inert")).toBe(false);

  // Collapse: panel stays mounted (no reload on next open), just closed and inert.
  await act(async () => {
    main.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(cardEl.getAttribute("data-expanded")).toBeNull();
  expect(main.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector(".outcome-chat-expandable")).toBe(expandable);
  expect(host.querySelector("[data-goal-chat-actions]")).toBe(expandedPanel);
  expect(expandable.getAttribute("data-open")).toBe("false");
  expect(expandable.getAttribute("aria-hidden")).toBe("true");
  expect(expandable.hasAttribute("inert")).toBe(true);

  // Re-expand: exact same DOM node re-opens without remounting.
  await act(async () => {
    main.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(cardEl.getAttribute("data-expanded")).toBe("true");
  expect(host.querySelector("[data-goal-chat-actions]")).toBe(expandedPanel);
  expect(expandable.getAttribute("data-open")).toBe("true");
  expect(expandable.hasAttribute("inert")).toBe(false);
});

test("OutcomeResultReport retains loaded summary while a background refresh is pending", async () => {
  const decision = { ...decisionFixture, outcomeId: decisionGoal.id, workItemId: "result-task" };
  let calls = 0;
  let resolveSecond!: (value: any) => void;
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      inChat
      client={{
        ...client,
        get: async () => decisionGoal,
        resultSummary: async (id) => {
          calls++;
          if (calls === 1) {
            return {
              outcomeId: id,
              revisionId: decision.contractRevisionId,
              summary: "Main cache 63%, array 34%.",
              details: "",
              sources: [],
            };
          }
          return new Promise((resolve) => {
            resolveSecond = resolve;
          });
        },
      }}
      inboxClient={decisionInbox(decision, unexpected)}
      actionItems={[decisionItem]}
    />
  );

  expect(host.textContent).toContain("Main cache 63%, array 34%.");
  await act(async () => {
    refreshOutcomeViews({
      sequence: "2",
      topic: "goal.thread.updated",
      entityId: decision.outcomeId,
      payload: { status: "completed" },
      createdAt: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, OUTCOME_REFRESH_DEBOUNCE_MS + 30));
  });
  // Still visible while second fetch is pending — never flashes "Summarizing the results…".
  expect(host.textContent).toContain("Main cache 63%, array 34%.");
  expect(host.textContent).not.toContain("Summarizing the results");

  await act(async () => {
    resolveSecond({
      outcomeId: decision.outcomeId,
      revisionId: decision.contractRevisionId,
      summary: "Updated cache 61%, array 34%.",
      details: "",
      sources: [],
    });
  });
  expect(host.textContent).toContain("Updated cache 61%, array 34%.");
});

test("inChat mode removes redundant top action banner, splits conclusion/charts into two columns, and notifies onActionSubmitted", async () => {
  const css = await Bun.file(
    new URL("../src/renderer/components/outcomego/outcomes/outcome-ui.css", import.meta.url)
  ).text();
  expect(css).toContain(".outcome-result-split");

  const decision = {
    ...decisionFixture,
    outcomeId: decisionGoal.id,
    workItemId: "result-task",
  };
  const acceptanceItem = {
    ...decisionItem,
    id: "inbox-accept",
    category: "acceptance_pending" as const,
    decisionId: undefined,
    title: "Unraid 清理后容量复查",
    completed: "Cache checked",
    problem: "None",
    next: "Review results",
  };
  let submittedCount = 0;
  await mount(
    <OutcomeDetail
      outcomeId={decisionGoal.id}
      initialOutcome={decisionGoal}
      inChat
      onActionSubmitted={() => submittedCount++}
      client={{
        ...client,
        get: async () => decisionGoal,
        resultSummary: async (id) => ({
          outcomeId: id,
          revisionId: decision.contractRevisionId,
          summary: "1. Cache 63% · 2. Array 34%",
          details: "",
          sources: [],
          charts: [{ type: "bar", unit: "%", title: "Current storage", points: [{ label: "Cache", value: 63, citation: 0 }] }],
        }),
      }}
      inboxClient={decisionInbox(decision, async () => decisionResolutionFixture)}
      actionItems={[acceptanceItem, decisionItem]}
    />
  );

  // Top "What needs you now" eyebrow and redundant acceptance banner are removed in chat.
  expect(host.querySelector(".outcome-now > .outcome-now-eyebrow")).toBeNull();
  expect(host.textContent).not.toContain("What needs you now");
  expect(host.textContent).not.toContain("What is this decision based on?");
  expect(host.textContent).not.toContain("Review results");

  // Summary text and chart render in two columns (.outcome-result-split).
  const split = host.querySelector(".outcome-result-split")!;
  expect(split).not.toBeNull();
  expect(split.querySelector(".outcome-result-copy")?.textContent).toContain("Cache 63%");
  expect(split.querySelector(".outcome-result-charts")?.textContent).toContain("Current storage");

  // Selecting and submitting an option notifies onActionSubmitted so the card auto-collapses & refreshes.
  const radio = host.querySelector<HTMLInputElement>('input[type="radio"][value="source-a"]')!;
  await act(async () => {
    radio.click();
  });
  await click("Submit choice");
  expect(submittedCount).toBe(1);
});

test("OutcomeChatCardView auto-collapses and refreshes status when an inline decision is resolved", async () => {
  const { api } = await import("../src/renderer/client/outcomego-api");
  const originalGet = api.outcomes.get;
  const originalHuman = api.outcomeInbox.humanItems;
  const originalForOutcome = api.outcomeInbox.forOutcome;
  const originalDecision = api.outcomeInbox.decision;
  const originalResolve = api.outcomeInbox.resolve;
  const originalResultSummary = api.outcomes.resultSummary;

  const decision = {
    ...decisionFixture,
    outcomeId: decisionGoal.id,
    workItemId: "result-task",
  };
  let stageReads = 0;
  let resolved = false;
  api.outcomes.get = async () => {
    stageReads++;
    return resolved
      ? { ...decisionGoal, status: "running" as const }
      : { ...decisionGoal, status: "decision_pending" as const };
  };
  api.outcomeInbox.humanItems = async () => [];
  api.outcomeInbox.forOutcome = async () => ({
    items: resolved ? [] : [decisionItem],
    nextCursor: null,
  });
  api.outcomeInbox.decision = async () => decision;
  api.outcomeInbox.resolve = async () => {
    resolved = true;
    return decisionResolutionFixture;
  };
  api.outcomes.resultSummary = async () => null;

  try {
    await mount(
      <OutcomeChatCardView
        card={{ ...card, outcomeId: decisionGoal.id, stage: "attention" }}
      />
    );
    const cardEl = host.querySelector(".outcome-chat-card")!;
    const main = host.querySelector<HTMLButtonElement>("button.outcome-chat-card-main")!;

    await act(async () => {
      main.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(cardEl.getAttribute("data-expanded")).toBe("true");
    expect(host.textContent).toContain("Use source A");
    const readsBeforeSubmit = stageReads;

    const radio = host.querySelector<HTMLInputElement>('input[type="radio"][value="source-a"]')!;
    await act(async () => {
      radio.click();
    });
    await click("Submit choice");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(cardEl.getAttribute("data-expanded")).toBeNull();
    expect(main.getAttribute("aria-expanded")).toBe("false");
    expect(stageReads).toBeGreaterThan(readsBeforeSubmit);
    expect(cardEl.getAttribute("data-stage")).toBe("running");
  } finally {
    api.outcomes.get = originalGet;
    api.outcomeInbox.humanItems = originalHuman;
    api.outcomeInbox.forOutcome = originalForOutcome;
    api.outcomeInbox.decision = originalDecision;
    api.outcomeInbox.resolve = originalResolve;
    api.outcomes.resultSummary = originalResultSummary;
  }
});

test("OutcomeChatCardView waits until initial data is ready before expanding and shares cache across cards", async () => {
  const { api } = await import("../src/renderer/client/outcomego-api");
  const originalGet = api.outcomes.get;
  const originalHuman = api.outcomeInbox.humanItems;
  const originalForOutcome = api.outcomeInbox.forOutcome;
  const originalDecision = api.outcomeInbox.decision;
  const originalResultSummary = api.outcomes.resultSummary;

  const decision = {
    ...decisionFixture,
    outcomeId: decisionGoal.id,
    workItemId: "result-task",
  };
  let releaseSummary!: (value: any) => void;
  api.outcomes.get = async () => ({ ...decisionGoal, status: "cancelled" as const });
  api.outcomeInbox.humanItems = async () => [];
  api.outcomeInbox.forOutcome = async () => ({
    items: [decisionItem],
    nextCursor: null,
  });
  api.outcomeInbox.decision = async () => decision;
  api.outcomes.resultSummary = () =>
    new Promise((resolve) => {
      releaseSummary = resolve;
    });

  try {
    // Settled card does not prefetch on mount; clicking waits for summary before expanding.
    await mount(
      <OutcomeChatCardView
        card={{ ...card, outcomeId: decisionGoal.id, stage: "cancelled" }}
      />
    );
    const cardEl = host.querySelector(".outcome-chat-card")!;
    const main = host.querySelector<HTMLButtonElement>("button.outcome-chat-card-main")!;

    await act(async () => {
      main.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(cardEl.getAttribute("data-expanded")).toBeNull();
    expect(main.getAttribute("data-loading")).toBe("true");

    await act(async () => {
      releaseSummary({
        outcomeId: decisionGoal.id,
        revisionId: decision.contractRevisionId,
        summary: "Cache 63%, Array 34%.",
        details: "",
        sources: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(cardEl.getAttribute("data-expanded")).toBe("true");
    expect(main.getAttribute("data-loading")).toBeNull();
    expect(host.textContent).toContain("Cache 63%, Array 34%.");
    expect(host.textContent).toContain("Use source A");

    // Another card instance in the chat for the same outcome opens immediately from cache without loading flash.
    await act(async () => root!.unmount());
    host.remove();
    api.outcomes.resultSummary = () => new Promise(() => {});
    await mount(
      <OutcomeChatCardView
        card={{ ...card, outcomeId: decisionGoal.id, stage: "cancelled" }}
      />
    );
    const secondCardEl = host.querySelector(".outcome-chat-card")!;
    const secondMain = host.querySelector<HTMLButtonElement>("button.outcome-chat-card-main")!;
    await act(async () => {
      secondMain.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(secondCardEl.getAttribute("data-expanded")).toBe("true");
    expect(host.textContent).toContain("Cache 63%, Array 34%.");
    expect(host.textContent).not.toContain("Summarizing the results");
    expect(host.textContent).not.toContain("Loading Decision");
  } finally {
    api.outcomes.get = originalGet;
    api.outcomeInbox.humanItems = originalHuman;
    api.outcomeInbox.forOutcome = originalForOutcome;
    api.outcomeInbox.decision = originalDecision;
    api.outcomes.resultSummary = originalResultSummary;
  }
});
