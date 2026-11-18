import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Root } from "react-dom/client";
import { I18nProvider } from "../src/renderer/lib/i18n";
let OutcomeDetail: typeof import("../src/renderer/components/outcomego/outcomes/detail/outcome-detail").OutcomeDetail;
let OutcomeChatCardView: typeof import("../src/renderer/components/outcomego/outcomes/outcome-chat-card").OutcomeChatCardView;
let BotAvatar: typeof import("../src/renderer/components/outcomego/avatar").BotAvatar;
let OutcomeExecutionCard: typeof import("../src/renderer/components/outcomego/outcomes/outcome-execution-card").OutcomeExecutionCard;
import {
  OUTCOME_CARD_STAGES,
  parseOutcomeChatCard,
  outcomeCardStage,
  type OutcomeChatCard,
} from "@outcomego/contracts/outcome-chat";
import { messageDisplayProjection } from "@outcomego/product-core/messages";
import type { ChannelMessageView } from "@outcomego/contracts";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import { OUTCOMEGO_DEEP_LINK_EVENT } from "../src/renderer/lib/app-deep-links";
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
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
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
  plan: unexpected,
  getPlan: unexpected,
  create: unexpected,
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
  await mount(
    <OutcomeDetail outcomeId={outcomeFixture.id} client={client} initialOutcome={outcomeFixture} />
  );
  expect(host.textContent).toContain("Review results");
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
  await click("Review results");
  expect(host.textContent).toContain("Acceptance review");
  expect(host.textContent).toContain("I personally verified this criterion.");
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
  await click("Review results");
  const review = host.querySelector('[aria-label="Review and rework"]')!;
  expect(review.textContent).toContain("Compare costs");
  expect(review.textContent).not.toContain("Future-only criterion");
  expect(review.textContent).toContain("Reviewing receipt Contract revision 1");
});
test("card is compact: stage, title and one line, with details left to the modal", async () => {
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
    expect(main.getAttribute("aria-haspopup")).toBe("dialog");
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

test("Modify is directly actionable without a mandatory comment and never approves the current plan", async () => {
  let approvals = 0,
    revisions = 0,
    plans = 0;
  await mount(
    <OutcomeDetail
      outcomeId={semanticGoal.id}
      initialOutcome={semanticGoal}
      client={{
        ...client,
        get: async () => semanticGoal,
        approve: async () => {
          approvals++;
          return semanticGoal;
        },
        revise: async () => {
          revisions++;
          return semanticGoal;
        },
        plan: async (input) => {
          plans++;
          expect(JSON.parse(input.sourceText).requestedChanges).toContain(
            "I do not approve this plan."
          );
          return planFixture;
        },
      }}
    />
  );
  expect(plans).toBe(0);
  await click("Modify");
  expect(plans).toBe(1);
  expect(approvals).toBe(0);
  expect(revisions).toBe(0);
  expect(host.textContent).toContain("Choose changes to your plan");
  expect(host.querySelector('[data-outcome-status="pending_approval"]')).not.toBeNull();
});

test("custom changes generate selectable options and save a pending successor without approval or a new goal", async () => {
  let approved = 0,
    created = 0,
    planned = 0;
  let saved: unknown;
  const changePlan = {
    ...planFixture,
    goal: { ...planFixture.goal, options: [{ id: "goal-1", text: "Record the baseline only" }] },
    acceptance: {
      ...planFixture.acceptance,
      options: [{ id: "acceptance-1", text: "All pool counts are recorded", required: true }],
    },
    boundaries: {
      ...planFixture.boundaries,
      options: [{ id: "boundaries-1", text: "Delete files", kind: "excluded" as const }],
    },
  };
  const updated = {
    ...semanticGoal,
    currentRevision: 2,
    currentRevisionView: {
      ...semanticGoal.currentRevisionView,
      id: "revision-custom-2",
      revision: 2,
      goal: ["Record the baseline only"],
      criteria: [
        {
          ...semanticGoal.currentRevisionView.criteria[0]!,
          statement: "All pool counts are recorded",
        },
      ],
      boundaries: { included: [], excluded: ["Delete files"] },
    },
  };
  await mount(
    <OutcomeDetail
      outcomeId={semanticGoal.id}
      initialOutcome={semanticGoal}
      client={{
        ...client,
        get: async () => semanticGoal,
        plan: async (input) => {
          planned++;
          const source = JSON.parse(input.sourceText);
          expect(source.requestedChanges).toBe("Measure only; no cleanup yet");
          expect(source.savedPlan.goal).toEqual(semanticGoal.currentRevisionView.goal);
          expect(input.context.botId).toBe(semanticGoal.currentRevisionView.executionBotId);
          return changePlan;
        },
        revise: async (id, input) => {
          expect(id).toBe(semanticGoal.id);
          saved = input;
          return updated;
        },
        approve: async () => {
          approved++;
          return semanticGoal;
        },
        create: async () => {
          created++;
          return semanticGoal;
        },
      }}
    />
  );
  await editChanges("Measure only; no cleanup yet");
  await click("Modify");
  expect(planned).toBe(1);
  expect(approved).toBe(0);
  expect(host.textContent).toContain("Choose changes to your plan");
  for (let step = 0; step < 3; step++) {
    await act(async () =>
      host
        .querySelector('input[type="checkbox"]')!
        .dispatchEvent(new dom.window.Event("click", { bubbles: true }))
    );
    await click("Next");
  }
  await click("Save proposed changes");
  expect(saved).toMatchObject({
    baseRevision: 1,
    changeSummary: "Measure only; no cleanup yet",
    contract: {
      goal: ["Record the baseline only"],
      acceptance: [{ statement: "All pool counts are recorded", required: true }],
      boundaries: { included: [], excluded: ["Delete files"] },
    },
  });
  expect(approved).toBe(0);
  expect(created).toBe(0);
  expect(host.querySelector('[data-outcome-status="pending_approval"]')).not.toBeNull();
  expect(
    (host.querySelector('textarea[aria-label="Approval comments"]') as HTMLTextAreaElement).value
  ).toBe("");
  expect(host.querySelector(".outcome-now")?.textContent).toContain("Yes, approve");
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
