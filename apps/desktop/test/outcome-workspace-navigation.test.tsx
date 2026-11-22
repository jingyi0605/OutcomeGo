import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import type { OutcomeDetail, OutcomeListPage } from "@outcomego/contracts/outcomes";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";
import { I18nProvider } from "../src/renderer/lib/i18n";
let TooltipProvider: typeof import("../src/renderer/components/ui/tooltip").TooltipProvider;
let OutcomeNavigation: typeof import("../src/renderer/components/outcomego/outcomes/outcome-navigation").OutcomeNavigation;
let OutcomeList: typeof import("../src/renderer/components/outcomego/outcomes/outcome-list").OutcomeList;
import { outcomeFixture, planFixture } from "./outcome-fixture";
import type { DecisionView, OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import {
  decisionFixture,
  decisionResolutionFixture,
  exploreFixture,
  inboxFixture,
} from "./outcome-client-fixtures";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
const bots = [
  { id: planFixture.botId, name: "Research Bot" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Delivery Bot" },
];
let current: OutcomeDetail;
let list: (query: string) => Promise<OutcomeListPage>;
const outcomes = createOutcomeApi(async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ path, body });
  if (path.startsWith("/api/outcomes?") || (path === "/api/outcomes" && !body))
    return (await list(path.split("?")[1] ?? "")) as T;
  if (path.endsWith("/thread")) return { threadId: null, turns: [] } as T;
  if (path === "/api/outcomes/threads")
    return { outcome: { ...current, status: "planning" }, turn: { id: "turn-1", purpose: "plan", trigger: body.text, status: "queued", reply: null, error: null, runId: null, createdAt: "now", updatedAt: "now" } } as T;
  if (path === "/api/outcomes" && body) {
    current = { ...current, title: body.title, status: "pending_approval" };
    current.currentRevisionView = {
      ...current.currentRevisionView!,
      status: "pending_approval",
      approvedAt: null,
    };
    return current as T;
  }
  if (path.endsWith("/approve")) {
    current = {
      ...current,
      status: "approved",
      currentRevisionView: {
        ...current.currentRevisionView!,
        status: "approved",
        approvedAt: planFixture.generatedAt,
      },
    };
  }
  if (path.endsWith("/runs"))
    current = {
      ...current,
      status: "running",
      workItems: structuredClone(outcomeFixture.workItems),
    };
  return current as T;
});
const api = {
  outcomes,
  outcomeInbox: {
    list: async () => ({ items: inboxItems, nextCursor: null }),
    decision: async () => decisionView,
    resolve: async (id: string, input: Record<string, unknown>) => {
      resolveCalls.push({ id, input });
      return decisionResolutionFixture;
    },
    humanItems: async () => [],
    forOutcome: async () => ({ items: [], nextCursor: null }),
  },
  explore: {
    list: async () => ({ items: [exploreFixture], nextCursor: null }),
    get: async () => exploreFixture,
  },
  outcomeRecovery: async () => ({ items: [], notificationFailures: [] }),
  outcomeAttention: async () => ({ recorded: true }),
  markChannelRead: async (...args: unknown[]) => {
    readCalls.push(args);
  },
};
const readCalls: unknown[][] = [];
let inboxItems: OutcomeInboxItemView[] = [inboxFixture];
let decisionView: DecisionView = decisionFixture;
const resolveCalls: Array<{ id: string; input: Record<string, unknown> }> = [];
mock.module("../src/renderer/client/outcomego-api", () => ({ api }));
let Workspace: typeof import("../src/renderer/components/outcomego/outcomes/inbox/outcome-workspace").default;
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | undefined;
let host: HTMLElement;
const textareaDefault = Object.getOwnPropertyDescriptor(
  dom.window.HTMLTextAreaElement.prototype,
  "defaultValue"
);
beforeAll(async () => {
  Object.defineProperty(dom.window, "location", {
    configurable: true,
    value: { href: "http://127.0.0.1:5173/" },
  });
  const storage = new Map<string, string>();
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(dom.window, "navigator", { configurable: true, value: { language: "en" } });
  Object.assign(dom.document, { oninput: null, hasFocus: () => true });
  // Linkedom has no layout or media queries; use the browser's no-layout/reduced-motion path.
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "defaultValue", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return this.textContent ?? "";
    },
    set(this: HTMLTextAreaElement, value: string) {
      this.textContent = value;
    },
  });
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
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    // The idea editor's @-picker measures rows; linkedom has no layout, so observe nothing.
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle,
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
  ({ TooltipProvider } = await import("../src/renderer/components/ui/tooltip"));
  ({ OutcomeNavigation } = await import(
    "../src/renderer/components/outcomego/outcomes/outcome-navigation"
  ));
  ({ OutcomeList } = await import("../src/renderer/components/outcomego/outcomes/outcome-list"));
  ({ createRoot } = await import("react-dom/client"));
  Workspace = (
    await import("../src/renderer/components/outcomego/outcomes/inbox/outcome-workspace")
  ).default;
});
beforeEach(() => {
  calls.length = 0;
  readCalls.length = 0;
  resolveCalls.length = 0;
  inboxItems = [inboxFixture];
  decisionView = decisionFixture;
  current = {
    ...structuredClone(outcomeFixture),
    workItems: [],
    outputs: [],
    evidence: [],
    reviews: [],
  };
  list = async () => ({
    items: [
      { ...outcomeFixture, status: "running" },
      {
        ...outcomeFixture,
        id: "outcome-2",
        title: "Prepare the delivery",
        status: "decision_pending",
        botId: bots[1]!.id,
      },
    ],
    nextCursor: null,
  });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
});
afterAll(() => {
  if (textareaDefault)
    Object.defineProperty(
      dom.window.HTMLTextAreaElement.prototype,
      "defaultValue",
      textareaDefault
    );
  else Reflect.deleteProperty(dom.window.HTMLTextAreaElement.prototype, "defaultValue");
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await render(node);
}
async function render(node: ReactNode) {
  await act(async () => {
    root!.render(
      <I18nProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </I18nProvider>
    );
  });
}
async function click(text: string, scope: ParentNode = document.body) {
  const button = [...scope.querySelectorAll("button")].find(
    (element) => element.textContent === text
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
}
async function showAllGoals() {
  const tab = [...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Outcome sections"] button')]
    .find((button) => button.textContent === "All goals")!;
  await act(async () => {
    tab.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
}
async function input(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) {
  if (element.localName === "input" && !element.getAttribute("type"))
    element.setAttribute("type", "text");
  if (element.localName === "select") {
    for (const option of element.querySelectorAll("option"))
      (option as HTMLOptionElement).selected = option.getAttribute("value") === value;
    // Linkedom does not reflect select.value consistently while options change.
    Object.defineProperty(element, "value", { configurable: true, value });
  } else
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(
      element,
      value
    );
  await act(async () => {
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const page = () => <Workspace target={{}} bots={bots} onClose={() => {}} />;

test("sidebar navigation exposes a selected page and stays usable when compact", async () => {
  let opened = 0;
  await mount(<OutcomeNavigation active onOpen={() => opened++} />);
  expect(host.querySelector('button[aria-current="page"]')?.getAttribute("aria-label")).toBe(
    "Outcomes"
  );
  await click("Outcomes");
  expect(opened).toBe(1);
  await render(<OutcomeNavigation compact active={false} onOpen={() => opened++} />);
  const compact = host.querySelector('button[aria-label="Outcomes"]')!;
  expect(compact.hasAttribute("aria-current")).toBe(false);
  await act(async () => {
    compact.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(opened).toBe(2);
});

test("navigation shows a colored count badge for each status that needs the owner", async () => {
  await mount(<OutcomeNavigation active={false} onOpen={() => {}} badges={{ approval: 2, review: 120 }} />);
  const badges = [...host.querySelectorAll("[data-outcome-badge]")];
  expect(badges.map((badge) => [badge.getAttribute("data-outcome-badge"), badge.textContent])).toEqual([
    ["approval", "2"],
    ["review", "99+"],
  ]);
  expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Outcomes, Pending action: 2, Awaiting review: 120"
  );
  await render(<OutcomeNavigation active={false} onOpen={() => {}} badges={{ approval: 0, review: 3 }} />);
  expect(host.querySelectorAll("[data-outcome-badge]").length).toBe(1);
  await render(<OutcomeNavigation compact active={false} onOpen={() => {}} badges={{ approval: 0, review: 0 }} />);
  expect(host.querySelector("[data-outcome-badge]")).toBeNull();
});

test("quick idea capture is a separate square button beside the Outcomes entry", async () => {
  let ideas = 0;
  let opened = 0;
  await mount(<OutcomeNavigation active={false} onOpen={() => opened++} onNewIdea={() => ideas++} />);
  const open = host.querySelector('button[aria-label="Outcomes"]')!;
  const idea = host.querySelector('button[aria-label="Capture an idea"]')!;
  expect(open.contains(idea)).toBe(false);
  expect(idea.parentElement).toBe(open.parentElement);
  expect(idea.className).toContain("size-9");
  expect(open.className).toContain("h-9");
  await act(async () => {
    idea.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect([ideas, opened]).toEqual([1, 0]);
  expect(idea.className).not.toContain("bg-selected");
  await render(<OutcomeNavigation active onOpen={() => {}} onNewIdea={() => {}} ideaActive />);
  const selectedIdea = host.querySelector('button[aria-label="Capture an idea"]')!;
  const selectedOpen = host.querySelector('button[aria-label="Outcomes"]')!;
  for (const el of [selectedIdea, selectedOpen]) {
    expect(el.className).toContain("bg-selected");
    expect(el.className).toContain("rounded-lg");
  }
});

const option = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  label,
  consequence: `${label} consequence`,
  resolutionEffect: "plan_only" as const,
  source: "planner" as const,
  ...extra,
});
const sectionTitles = () =>
  [...host.querySelectorAll(".outcome-dash-section")].map((node) => node.textContent ?? "");
const focus = () => host.querySelector<HTMLElement>(".outcome-dash-focus");
const settle = () => act(async () => {});

test("dashboard shows metrics, then whose turn it is: the owner first, then Bots, each goal once", async () => {
  list = async () => ({
    items: [
      { ...outcomeFixture, status: "running" },
      { ...outcomeFixture, id: "outcome-2", title: "Prepare the delivery", status: "decision_pending" },
      { ...outcomeFixture, id: "outcome-3", title: "Paused goal", status: "paused" },
      { ...outcomeFixture, id: "outcome-4", title: "Finished goal", status: "accepted" },
    ],
    nextCursor: null,
  });
  inboxItems = [{ ...inboxFixture, outcomeId: "outcome-2", title: "Choose delivery route" }];
  await mount(page());
  expect(
    host.querySelector('nav[aria-label="Outcome sections"] button[aria-current="page"]')
      ?.textContent
  ).toBe("Dashboard");
  expect(
    [...host.querySelectorAll(".outcome-dash-metric")].map((node) => node.textContent)
  ).toEqual(["3In progress", "1Needs your action", "1Accepted", "4All goals"]);
  const [mine, progress] = sectionTitles();
  expect(mine).toContain("Choose delivery route");
  expect(mine).toContain("Choose a source");
  expect(progress).toContain("Bots are working");
  expect(progress).toContain("Backup comparison");
  expect(progress).toContain("Paused or failed");
  expect(progress).toContain("Paused goal");
  // The goal behind the pending step is on the owner's list only.
  expect(host.textContent).not.toContain("Prepare the delivery");
});

test("a goal waiting on the owner without an Inbox step still reaches the owner's list", async () => {
  list = async () => ({
    items: [{ ...outcomeFixture, id: "outcome-2", title: "Prepare the delivery", status: "review_pending" }],
    nextCursor: null,
  });
  inboxItems = [];
  await mount(page());
  expect(focus()?.textContent).toContain("Prepare the delivery");
  expect(focus()?.textContent).toContain("Review result");
  expect(focus()?.querySelector(".outcome-dash-quick")).toBeNull();
});

test("the focus card answers an approval with one click and records the exact option", async () => {
  decisionView = {
    ...decisionFixture,
    reasonCode: "plan_approval",
    customEntryAllowed: false,
    recommendation: { optionId: "yes", reason: "The plan is complete." },
    options: [option("yes", "Approve"), option("no", "Reject")],
  };
  await mount(page());
  await settle();
  const buttons = [...focus()!.querySelectorAll(".outcome-dash-quick-buttons button")];
  expect(buttons.map((button) => button.textContent)).toEqual(["Approve", "Reject"]);
  await act(async () => {
    buttons[0]!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(resolveCalls).toHaveLength(1);
  expect(resolveCalls[0]!.id).toBe(decisionFixture.id);
  expect(resolveCalls[0]!.input).toMatchObject({
    optionId: "yes",
    customText: null,
    expectedContractRevision: 1,
  });
});

test("a multi-option decision starts on the recommended option and needs one confirmation", async () => {
  decisionView = {
    ...decisionFixture,
    reasonCode: "route_choice",
    recommendation: { optionId: "b", reason: "Cheapest." },
    options: [option("a", "Option A"), option("b", "Option B"), option("c", "Option C")],
  };
  await mount(page());
  await settle();
  const radios = [...focus()!.querySelectorAll<HTMLElement>('[role="radio"]')];
  expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  expect(radios[1]!.textContent).toContain("Recommended");
  await act(async () => {
    radios[2]!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(resolveCalls).toHaveLength(0);
  await click("Confirm: Option C", focus()!);
  expect(resolveCalls).toHaveLength(1);
  expect(resolveCalls[0]!.input).toMatchObject({ optionId: "c" });
});

test("credential grants and contract changes are never answered from the dashboard", async () => {
  decisionView = {
    ...decisionFixture,
    reasonCode: "credential_access_required",
    options: [option("allow", "Allow"), option("deny", "Deny")],
  };
  await mount(page());
  await settle();
  expect(focus()?.querySelector(".outcome-dash-quick")).toBeNull();
  expect(focus()?.querySelector(".outcome-dash-quick-buttons")).toBeNull();
  expect(
    [...focus()!.querySelectorAll("button")].some((button) => button.textContent === "View details")
  ).toBe(true);
  expect(resolveCalls).toHaveLength(0);
});

test("dashboard details button opens the decision in a dialog and keeps the dashboard behind it", async () => {
  await mount(page());
  await settle();
  await click("View details", focus()!);
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    host.querySelector('nav[aria-label="Outcome sections"] button[aria-current="page"]')
      ?.textContent
  ).toBe("Dashboard");
});

test("dashboard section links switch to the full lists and Bot lanes show five goals", async () => {
  list = async () => ({
    items: Array.from({ length: 7 }, (_, index) => ({
      ...outcomeFixture,
      id: `outcome-${index}`,
      title: `Goal ${index}`,
      status: "running" as const,
    })),
    nextCursor: null,
  });
  await mount(page());
  const progress = host.querySelectorAll<HTMLElement>(".outcome-dash-section")[1]!;
  expect(progress.querySelectorAll(".outcome-row").length).toBe(5);
  await click("View all", progress);
  expect(
    host.querySelector('nav[aria-label="Outcome sections"] button[aria-current="page"]')
      ?.textContent
  ).toBe("All goals");
  expect(host.querySelectorAll(".outcome-row").length).toBe(7);
});

test("dashboard capture-an-idea button opens the quick idea dialog", async () => {
  await mount(page());
  await click("Capture an idea", host);
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Capture an idea");
});

test("workspace opens a full page with all goals, Bot names and execution statuses", async () => {
  await mount(page());
  await showAllGoals();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("Outcomes");
  expect(host.textContent).toContain("Backup comparison");
  expect(host.textContent).toContain("Research Bot");
  expect(host.textContent).toContain("Delivery Bot");
  expect(host.querySelector('[data-outcome-status="running"]')?.textContent).toBe("Running");
  expect(host.querySelector('[data-outcome-status="decision_pending"]')?.textContent).toBe(
    "Awaiting decision"
  );
  expect(
    host.querySelector('nav[aria-label="Outcome sections"] button[aria-current="page"]')
      ?.textContent
  ).toBe("All goals");
});

test("goal rows open goal details without exposing execution transcript controls", async () => {
  list = async () => ({
    items: [
      { ...outcomeFixture, status: "running" },
      { ...outcomeFixture, id: "outcome-draft", title: "Not started yet", status: "pending_approval" },
    ],
    nextCursor: null,
  });
  let selected = "";
  await mount(
    <OutcomeList client={outcomes} bots={bots} onSelect={(id) => { selected = id; }} onCreate={() => {}} />
  );
  expect(host.querySelector(".outcome-row-action")).toBeNull();
  await act(async () => {
    host.querySelector(".outcome-row")!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(selected).toBe(outcomeFixture.id);
  expect(document.body.querySelector(".outcome-execution-dialog")).toBeNull();
});

test("all-goals status filtering queries the server and discards an obsolete response", async () => {
  let resolve!: (value: OutcomeListPage) => void;
  list = async (query) =>
    query
      ? {
          items: [{ ...outcomeFixture, title: "Only paused goal", status: "paused" }],
          nextCursor: null,
        }
      : new Promise((value) => {
          resolve = value;
        });
  await mount(
    <OutcomeList client={outcomes} bots={bots} onSelect={() => {}} onCreate={() => {}} />
  );
  await input(host.querySelector("select")!, "paused");
  expect(calls.some((call) => call.path === "/api/outcomes?status=paused")).toBe(true);
  expect(host.textContent).toContain("Only paused goal");
  await act(async () => {
    resolve({ items: [{ ...outcomeFixture, title: "Obsolete goal" }], nextCursor: null });
  });
  expect(host.textContent).not.toContain("Obsolete goal");
  expect(host.textContent).toContain("Only paused goal");
});

test("goal pagination retains existing goals, deduplicates overlap and passes the cursor", async () => {
  list = async (query) =>
    query
      ? {
          items: [
            { ...outcomeFixture },
            { ...outcomeFixture, id: "next", title: "Next page goal" },
          ],
          nextCursor: null,
        }
      : { items: [outcomeFixture], nextCursor: "cursor+one" };
  let selected = "";
  await mount(
    <OutcomeList
      client={outcomes}
      bots={bots}
      onSelect={(id) => {
        selected = id;
      }}
      onCreate={() => {}}
    />
  );
  await click("Load more");
  expect(calls.at(-1)!.path).toBe("/api/outcomes?cursor=cursor%2Bone");
  expect(host.querySelectorAll("ul > li")).toHaveLength(2);
  await act(async () => {
    host
      .querySelectorAll("ul > li .outcome-row")[1]!
      .dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(selected).toBe("next");
});

test("goal list errors offer a working retry and empty goals offer creation", async () => {
  list = async () => {
    throw new Error("offline");
  };
  let created = false;
  await mount(
    <OutcomeList
      client={outcomes}
      bots={bots}
      onSelect={() => {}}
      onCreate={() => {
        created = true;
      }}
    />
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load goals");
  list = async () => ({ items: [], nextCursor: null });
  await click("Retry");
  expect(host.textContent).toContain("No goals yet.");
  await click("New Outcome");
  expect(created).toBe(true);
});

test("attention and Explore are separate full-page sections and can return to all goals", async () => {
  await mount(page());
  await click("Needs attention", host.querySelector('nav[aria-label="Outcome sections"]')!);
  expect(host.textContent).toContain(inboxFixture.title);
  expect(host.textContent).toContain(inboxFixture.next);
  await click("Explore ideas", host.querySelector('nav[aria-label="Outcome sections"]')!);
  expect(host.textContent).toContain(exploreFixture.title);
  await click("New idea");
  // Recording an idea is one free-text box plus a save button, nothing else to fill in.
  expect(host.querySelector("[data-placeholder]")?.getAttribute("data-placeholder")).toContain("@");
  expect(host.querySelectorAll("input, select, textarea")).toHaveLength(0);
  expect(host.textContent).toContain("Save idea");
  await click("All goals", host.querySelector('nav[aria-label="Outcome sections"]')!);
  expect(host.textContent).toContain("Backup comparison");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

test("a new goal is handed to the chosen Bot in the owner's own words, and the window closes at once", async () => {
  await mount(page());
  await click("New Outcome");
  await input(document.body.querySelector('select[aria-label="Execution Bot"]')!, bots[1]!.id);
  const words = "Compare backup plans for this goal\n(keep it cheap)";
  await input(document.body.querySelector("textarea")!, words);
  await click("Hand to the bot");
  const created = calls.find((call) => call.path === "/api/outcomes/threads");
  // Nothing about the goal is decided for the owner: no options, no wizard, just the words and the bot.
  expect(created?.body).toMatchObject({ text: words, botId: bots[1]!.id });
  expect(calls.some((call) => call.path === "/api/outcomes/plans")).toBe(false);
  // The form is gone and the goal list is back.
  expect(document.body.textContent).not.toContain("Hand to the bot");
  expect(document.body.textContent).not.toContain("Generate planning options");
});

test("new Outcome with no Bots provides a way back to chat", async () => {
  let closed = false;
  await mount(
    <Workspace
      target={{}}
      bots={[]}
      onClose={() => {
        closed = true;
      }}
    />
  );
  await click("New Outcome");
  expect(document.body.textContent).toContain("Create a Bot in chat before planning an Outcome.");
  await click("Back to chats");
  expect(closed).toBe(true);
});

test("notification targets open the corresponding detail in a modal and mark only that notification read", async () => {
  await mount(
    <Workspace
      target={{
        decisionId: decisionFixture.id,
        channelId: "notification-channel",
        notificationSequence: "42",
      }}
      bots={bots}
      onClose={() => {}}
    />
  );
  expect(document.body.textContent).toContain("Choose the next step");
  expect(readCalls).toEqual([["notification-channel", "0", "42"]]);
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
});

async function openFirstGoal() {
  const row = host.querySelector<HTMLButtonElement>(".outcome-row")!;
  await act(async () => {
    row.focus();
    row.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  return row;
}

test("goal list opens a floating dialog; outside click closes it and retains the status filter", async () => {
  await mount(page());
  await showAllGoals();
  await input(host.querySelector("select")!, "running");
  const row = await openFirstGoal();
  expect(row.isConnected).toBe(true);
  expect(host.querySelector(".outcome-row")).toBe(row);
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
    "Backup comparison"
  );
  // DismissableLayer registers its document listener on the next task.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const overlay = document.querySelector(".outcome-modal-overlay")!;
  await act(async () => {
    const event = new dom.window.Event("pointerdown", { bubbles: true });
    Object.assign(event, { pointerType: "mouse", button: 0 });
    overlay.dispatchEvent(event);
  });
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector("select")?.value).toBe("running");
  expect(calls.at(-1)?.path).toBe("/api/outcomes?status=running");
  expect(calls.every((call) => !call.body)).toBe(true);
});

test("Escape closes a goal modal; inspecting the saved plan inside does not dismiss it", async () => {
  current = {
    ...current,
    status: "pending_approval",
    currentRevisionView: {
      ...current.currentRevisionView!,
      status: "pending_approval",
      approvedAt: null,
    },
  };
  await mount(page());
  await showAllGoals();
  await openFirstGoal();
  const info = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Source for Proposed plan"]'
  )!;
  await act(async () => {
    info.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  const source = document.querySelector("[data-outcome-source]")!;
  expect(source.textContent).toContain("Recommend a plan");
  expect(source.closest('[role="dialog"]')).not.toBeNull();
  await act(async () => {
    const event = new dom.window.Event("pointerdown", { bubbles: true });
    Object.assign(event, { pointerType: "mouse", button: 0 });
    source.dispatchEvent(event);
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => {
    info.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key: "Escape" });
    document.dispatchEvent(event);
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain("All goals");
  expect(calls.every((call) => !call.body)).toBe(true);
});
