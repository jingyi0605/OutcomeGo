import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { OutcomeGoClientError } from "@outcomego/client-core";
import type { OutcomeDetail, OutcomeListPage } from "@outcomego/contracts/outcomes";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";
import { I18nProvider } from "../src/renderer/lib/i18n";
import type { ActivityResponse, ScheduleQuery, ScheduleResponse } from "@outcomego/contracts/task-overview";
import type { OutcomeThreadView } from "@outcomego/contracts/outcome-thread";
let TooltipProvider: typeof import("../src/renderer/components/ui/tooltip").TooltipProvider;
let OutcomeNavigation: typeof import("../src/renderer/components/outcomego/outcomes/outcome-navigation").OutcomeNavigation;
let CalendarNavigationButton: typeof import("../src/renderer/components/outcomego/outcomes/outcome-navigation").CalendarNavigationButton;
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
let activity: ActivityResponse | undefined;
let thread: OutcomeThreadView;
/** Answers the lifecycle and plan writes of the scheduled-goal tests. */
let write: ((path: string, body: Record<string, unknown>) => unknown) | undefined;
const goalKinds = "kinds=standard%2Ctracked%2Cscheduled_once";
const outcomes = createOutcomeApi(async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ path, body });
  if (path.startsWith("/api/activity")) {
    return (activity ?? current) as T;
  }
  if (path.startsWith("/api/outcomes?kinds=explore_idea")) return { items: [exploreFixture], nextCursor: null } as T;
  if (path.startsWith("/api/outcomes?") || (path === "/api/outcomes" && !body))
    return (await list(path.split("?")[1] ?? "")) as T;
  if (write && (body || init?.method === "PATCH")) return write(path, body) as T;
  if (path.endsWith("/thread")) return thread as T;
  if (path === "/api/outcomes" && body)
    return { outcome: { ...current, title: body.title, status: "planning" }, turn: null } as T;
  if (path.endsWith("/approve")) {
    current = {
      ...current,
      status: "approved",
      currentRevisionView: {
        ...current.currentRevisionView!,
        status: "approved",
        approvedAt: planFixture.generatedAt,
      },
    } as OutcomeDetail;
  }
  if (path.endsWith("/runs"))
    current = {
      ...current,
      status: "running",
      workItems: structuredClone(outcomeFixture.workItems),
    } as OutcomeDetail;
  return current as T;
});
const api = {
  outcomes,
  schedule: { list: async (_query: ScheduleQuery): Promise<ScheduleResponse> => ({ items: [], truncated: false }) },
  userTimeZone: async () => ({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
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
  // The workspace reads the owner's policy for the activity area; an empty answer means every initial value.
  featureSettings: async () => ({}),
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
    // The guide's robots pause out of view; linkedom has no viewport either.
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
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
  ({ CalendarNavigationButton, OutcomeNavigation } = await import(
    "../src/renderer/components/outcomego/outcomes/outcome-navigation"
  ));
  ({ OutcomeList } = await import("../src/renderer/components/outcomego/outcomes/outcome-list"));
  ({ createRoot } = await import("react-dom/client"));
  Workspace = (
    await import("../src/renderer/components/outcomego/outcomes/inbox/outcome-workspace")
  ).default;
});
beforeEach(() => {
  activity = undefined;
  write = undefined;
  thread = { threadId: null, turns: [] };
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
    .find((button) => button.textContent === "All")!;
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

test("the guide sits on the Dashboard, the entry page, and nowhere else", async () => {
  await mount(page());
  expect(host.querySelector(".goal-guide")).not.toBeNull();
  await showAllGoals();
  expect(host.querySelector(".goal-guide")).toBeNull();
});

test("sidebar navigation exposes a selected page and stays usable when compact", async () => {
  let opened = 0;
  await mount(<OutcomeNavigation active onOpen={() => opened++} />);
  expect(host.querySelector('button[aria-current="page"]')?.getAttribute("aria-label")).toBe(
    "Outcomes"
  );
  await click("Outcome");
  expect(opened).toBe(1);
  await render(<OutcomeNavigation compact active={false} onOpen={() => opened++} />);
  const compact = host.querySelector('button[aria-label="Outcomes"]')!;
  expect(compact.hasAttribute("aria-current")).toBe(false);
  expect(compact.querySelector('img[alt=""]')?.getAttribute("src")).toEndWith("outcomego-icon.png");
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

test("the brand row keeps separate Outcome and Go buttons in both locales", async () => {
  let ideas = 0;
  let opened = 0;
  await mount(<OutcomeNavigation active={false} onOpen={() => opened++} onNewIdea={() => ideas++} />);
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons).toHaveLength(2);
  const [open, idea] = buttons as [HTMLButtonElement, HTMLButtonElement];
  expect(open.getAttribute("aria-label")).toBe("Outcomes");
  expect(idea.getAttribute("aria-label")).toBe("Go");
  expect(open.textContent).toBe("Outcome");
  expect(open.querySelector('img[alt=""]')?.getAttribute("src")).toEndWith("outcomego-icon.png");
  expect(idea.textContent).toBe("Go");
  expect(idea.querySelector(".outcome-brand-go-text")?.textContent).toBe("Go");
  expect(idea.querySelector('svg.lucide-arrow-up-right[aria-hidden="true"]')).not.toBeNull();
  expect(open.contains(idea)).toBe(false);
  expect(idea.parentElement).toBe(open.parentElement);
  expect(open.className).toContain("h-9");
  expect(idea.className).toContain("h-9");
  expect(idea.className).toContain("outcome-brand-go-button");
  await act(async () => {
    idea.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect([ideas, opened]).toEqual([1, 0]);
  expect(idea.className).not.toContain("bg-selected");
  await render(<OutcomeNavigation active onOpen={() => {}} onNewIdea={() => {}} ideaActive />);
  const selectedOpen = host.querySelector('button[aria-label="Outcomes"]')!;
  const selectedIdea = host.querySelector('button[aria-label="Go"]')!;
  expect(selectedIdea.className).toContain("bg-selected");
  expect(selectedIdea.className).toContain("rounded-lg");
  expect(selectedOpen.className).not.toContain("bg-selected");
  expect(selectedOpen.className).toContain("bg-transparent");
  expect(selectedOpen.className).toContain("text-foreground");

  // Even under Chinese locale, the visible brand wordmark remains English "Outcome" and "Go".
  try {
    await act(async () => {
      window.dispatchEvent(new dom.window.CustomEvent("outcomego-locale-change", { detail: "zh-CN" }));
    });
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Outcome",
      "Go",
    ]);
  } finally {
    await act(async () => {
      window.dispatchEvent(new dom.window.CustomEvent("outcomego-locale-change", { detail: "en" }));
    });
  }
});

test("the calendar button opens the calendar and shows a localized today badge in both layouts", async () => {
  let opened = 0;
  const onOpen = () => opened++;
  const badge = () => host.querySelector('[data-calendar-badge="today"]');
  await mount(<CalendarNavigationButton onOpen={onOpen} />);
  const calendar = host.querySelector('button[aria-label="Calendar"]')!;
  expect(calendar).toBeTruthy();
  expect(badge()).toBeNull();
  await act(async () => calendar.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
  expect(opened).toBe(1);

  await render(<CalendarNavigationButton onOpen={onOpen} todayCount={120} />);
  expect(badge()?.textContent).toBe("99+");
  expect(calendar.getAttribute("aria-label")).toBe("Calendar, Today's goals & to-dos: 120");

  await render(<CalendarNavigationButton compact onOpen={onOpen} todayCount={4} />);
  expect(badge()?.textContent).toBe("4");
  try {
    await act(async () => {
      window.dispatchEvent(new dom.window.CustomEvent("outcomego-locale-change", { detail: "zh-CN" }));
    });
    expect(calendar.getAttribute("aria-label")).toBe("日历, 今日目标与待办: 4");
  } finally {
    await act(async () => {
      window.dispatchEvent(new dom.window.CustomEvent("outcomego-locale-change", { detail: "en" }));
    });
  }
});

/** The detail view is two lazy imports deep; the first load takes longer than a few ticks. */
async function waitForDetail() {
  for (let attempt = 0; attempt < 100 && !document.querySelector('article[aria-label="Scheduled goal details"]'); attempt++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
}

function scheduledGoalFixture(id: string, title: string, scheduledAt: string): Extract<OutcomeDetail, { kind: "scheduled_once" }> {
  return {
    ...structuredClone(outcomeFixture), id, kind: "scheduled_once", title, status: "scheduled", botId: bots[0]!.id,
    scheduledAt, description: "Check the saved notes", currentRevision: null, currentRevisionView: null, revisions: [],
    workItems: [], outputs: [], evidence: [], reviews: [], kindMeta: {},
  };
}

test("dashboard and calendar open the scheduled goal inside goal management", async () => {
  const { CalendarPage } = await import("../src/renderer/components/outcomego/outcomes/calendar/calendar-page");
  const runAt = new Date().toISOString();
  const botId = bots[0]!.id;
  const goalId = "once-goal";
  const title = "Review fixture notes";
  const link = { type: "outcome", id: goalId } as const;
  current = scheduledGoalFixture(goalId, title, runAt);
  activity = { items: [], truncated: false, upcoming: [{ id: `scheduled_once:${goalId}`, type: "scheduled_once", botId, title, state: "preparing", runAt,
    reason: null, doing: null, progress: null, lastActivityAt: runAt, nextCheckAt: runAt, needsOwner: false, link }] };
  const openRoutine = () => { throw new Error("Scheduled goals must stay in goal management"); };
  await mount(<Workspace target={{}} bots={bots} onClose={() => {}} onOpenRoutine={openRoutine} />);
  const upcoming = host.querySelector('section[aria-label="Upcoming work"]');
  expect(upcoming?.querySelectorAll("button")).toHaveLength(1);
  const row = upcoming!.querySelector("button")!;
  expect(row.textContent).toContain("Preparing");
  await act(async () => row.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
  await waitForDetail();
  expect(document.querySelector('article[aria-label="Scheduled goal details"]')?.textContent).toContain(title);
  const original = api.schedule.list;
  const queries: ScheduleQuery[] = [];
  api.schedule.list = async (query) => {
    queries.push(query);
    return { truncated: false, items: [{ id: `scheduled_once:${goalId}`, title, kind: "scheduled_once", botId, outcomeId: goalId,
      start: runAt, end: null, allDay: false, timeBasis: "scheduled", state: "preparing", overdue: false,
      owner: "bot", link, editable: true, updatedAt: runAt }] };
  };
  try {
    const { useState } = await import("react");
    function CalendarHost() {
      const [outcomeId, setOutcomeId] = useState<string>();
      return outcomeId
        ? <Workspace target={{ outcomeId }} bots={bots} onClose={() => {}} />
        : <CalendarPage bots={bots} onClose={() => {}} onOpenOutcome={setOutcomeId} onOpenRoutine={openRoutine} />;
    }
    await render(<CalendarHost />);
    expect(queries[0]?.kinds).toContain("scheduled_once");
    const cells = host.querySelectorAll(`[data-calendar-item="scheduled_once:${goalId}"]`);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.textContent).toContain("Preparing");
    await act(async () => cells[0]!.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
    await waitForDetail();
    expect(document.querySelector('article[aria-label="Scheduled goal details"]')?.textContent).toContain(title);
    expect(calls.some((call) => call.path === `/api/outcomes/${goalId}`)).toBe(true);
  } finally {
    api.schedule.list = original;
  }
});

test("all goals manages scheduled work and displays the planner's saved advice", async () => {
  const runAt = new Date(Date.now() + 3_600_000).toISOString();
  let goal = scheduledGoalFixture("test-scheduled-goal", "Consult the customer", runAt);
  current = goal;
  list = async () => ({ items: [goal], nextCursor: null });
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const save = (next: typeof goal) => { goal = next; current = next; return next; };
  const turn = (status: "queued" | "completed") => ({
    id: "advice-turn", purpose: "plan" as const, planMode: "advice" as const, trigger: "Research", status, reply: null, error: null,
    runId: null, outcomeRevision: goal.revision, createdAt: runAt, updatedAt: runAt,
    result: status === "completed"
      ? { schemaVersion: 1 as const, summary: "Confirm the revised delivery date.", facts: [], gaps: [], recommendations: [] }
      : null,
  });
  write = (path, body) => {
    writes.push({ path, body });
    if (path.endsWith("/plan")) {
      if (writes.length === 1) throw new Error("Connection interrupted");
      thread = { threadId: "thread", turns: [turn("queued")] };
      return thread.turns[0];
    }
    const status = body.action === "pause" ? "paused" : body.action === "resume" ? "scheduled" : "cancelled";
    return save({ ...goal, status, revision: goal.revision + 1 });
  };
  await mount(<Workspace target={{}} bots={bots} onClose={() => {}} />);
  await showAllGoals();
  expect(host.querySelector(".outcome-row")?.textContent).toContain("Scheduled time");
  await openFirstGoal();
  const detail = () => document.querySelector('article[aria-label="Scheduled goal details"]')!;
  await click("Generate run advice", detail());
  expect(detail().textContent).toContain("Connection interrupted");
  await click("Generate run advice", detail());
  expect(writes[0]).toEqual({ path: "/api/outcomes/test-scheduled-goal/plan", body: { mode: "advice", expectedRevision: 1, clientRequestId: expect.any(String) } });
  expect(writes[1]).toEqual(writes[0]!);
  expect(detail().textContent).toContain("Advice queued…");
  thread = { threadId: "thread", turns: [turn("completed")] };
  const { handleOutcomeThreadEvent, OUTCOME_THREAD_TOPIC } = await import("../src/renderer/lib/outcome-thread");
  await act(async () => handleOutcomeThreadEvent({ topic: OUTCOME_THREAD_TOPIC, entityId: goal.id, payload: { outcomeId: goal.id, status: "completed" } } as never));
  expect(detail().querySelector('section[aria-label="Run advice"]')?.textContent).toContain("Confirm the revised delivery date.");
  await click("Pause", detail());
  await click("Resume", detail());
  await click("Cancel scheduled goal", detail());
  const actions = () => writes.slice(2).map(({ body }) => [body.action, body.expectedRevision]);
  expect(actions()).toEqual([["pause", 1], ["resume", 2]]);
  await click("Confirm cancellation", detail());
  expect(actions().at(-1)).toEqual(["cancel", 3]);
  expect(detail().textContent).toContain("Cancelled");
});

test("the calendar retries without the one-time source on a legacy server", async () => {
  const { CalendarPage } = await import("../src/renderer/components/outcomego/outcomes/calendar/calendar-page");
  const original = api.schedule.list;
  const queries: ScheduleQuery[] = [];
  api.schedule.list = async (query) => {
    queries.push(query);
    if (query.kinds?.includes("scheduled_once")) throw new OutcomeGoClientError("Invalid schedule filter", "invalid_request", 400);
    return { items: [], truncated: false };
  };
  try {
    await mount(<CalendarPage bots={bots} onClose={() => {}} onOpenOutcome={() => {}} />);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.kinds).toEqual(["goal_due", "human_task", "work_item", "todo", "follow_up"]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    api.schedule.list = original;
  }
});

test("calendar lives as a tab inside OutcomeWorkspace, highlights today, and offers quick return to today", async () => {
  await mount(<Workspace target={{ section: "calendar" }} bots={bots} onClose={() => {}} />);
  // Wait for lazy CalendarPage import + initial schedule query.
  await act(async () => {
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  const nav = host.querySelector('nav[aria-label="Outcome sections"]')!;
  const calendarTab = Array.from(nav.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Calendar")
  );
  expect(calendarTab?.getAttribute("aria-current")).toBe("page");
  // Embedded tab omits the standalone "Back to outcomes" overlay header button.
  expect(host.textContent).not.toContain("Back to outcomes");
  // Today cell is highlighted in the current month grid.
  expect(host.querySelector('[data-calendar-today="true"]')).not.toBeNull();
  const todayBtn = () => host.querySelector<HTMLButtonElement>("[data-calendar-today-button]")!;
  expect(todayBtn().getAttribute("data-away")).toBe("false");
  // Navigating away switches the quick button into prominent "Back to today" mode.
  const nextBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Next period"]')!;
  await act(async () => nextBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
  await act(async () => nextBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
  expect(todayBtn().getAttribute("data-away")).toBe("true");
  expect(todayBtn().textContent).toContain("Back to today");
  // Clicking the quick button jumps directly back to today.
  await act(async () => todayBtn().dispatchEvent(new dom.window.Event("click", { bubbles: true })));
  expect(todayBtn().getAttribute("data-away")).toBe("false");
  expect(host.querySelector('[data-calendar-today="true"]')).not.toBeNull();
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
  ).toEqual(["1Needs your action", "2In progress", "1Accepted", "4All goals"]);
  const [mine, progress] = sectionTitles();
  expect(mine).toContain("Choose delivery route");
  expect(mine).toContain("Choose a source");
  expect(progress).toContain("Backup comparison");
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

test("the focus card shows the plan awaiting approval and approves it in place", async () => {
  current = {
    ...outcomeFixture,
    id: "outcome-2",
    title: "Prepare the delivery",
    status: "pending_approval",
    currentRevisionView: { ...outcomeFixture.currentRevisionView!, status: "pending_approval", approvedAt: null, approvedBy: null },
  };
  list = async () => ({
    items: [{ ...outcomeFixture, id: "outcome-2", title: "Prepare the delivery", status: "pending_approval" }],
    nextCursor: null,
  });
  inboxItems = [];
  calls.length = 0;
  await mount(page());
  await settle();
  const card = focus()!;
  // The owner sees what is being approved, not only the goal's title.
  expect(card.querySelector(".outcome-plan-scope")?.textContent).toContain("Recommend a plan");
  expect(card.textContent).toContain("Compare costs");
  await click("Yes, approve", card);
  const approve = calls.find((call) => call.path.endsWith("/approve"));
  expect(approve?.body).toMatchObject({ expectedRevision: 1 });
  expect(approve?.path).toContain("/api/outcomes/outcome-2/");
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

test("dashboard section links switch to the full lists and unified In progress lists active goals", async () => {
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
  expect(progress.querySelectorAll(".outcome-activity-card").length).toBe(7);
  await click("View all", progress);
  expect(
    host.querySelector('nav[aria-label="Outcome sections"] button[aria-current="page"]')
      ?.textContent
  ).toBe("All");
  expect(host.querySelectorAll(".outcome-row").length).toBe(7);
});

test("dashboard Go button opens the intake dialog", async () => {
  await mount(page());
  await click("Go", host);
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Whatever is on your mind");
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
  ).toBe("All");
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
    new URLSearchParams(query).has("statuses")
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
  expect(calls.some((call) => call.path === "/api/outcomes?statuses=paused")).toBe(true);
  expect(host.textContent).toContain("Only paused goal");
  await act(async () => {
    resolve({ items: [{ ...outcomeFixture, title: "Obsolete goal" }], nextCursor: null });
  });
  expect(host.textContent).not.toContain("Obsolete goal");
  expect(host.textContent).toContain("Only paused goal");
});

test("the goal list marks bot-registered rows and filters by visible category pills without losing the status filter", async () => {
  const tracked = { ...outcomeFixture, title: "Alpha goal", kind: "tracked", status: "running" } as const;
  const note = { ...outcomeFixture, id: "note-1", title: "Meeting note", kind: "note", botId: null, status: "active", currentRevision: null, tags: ["ops"] } as const;
  list = async (query) => {
    const kinds = new URLSearchParams(query).get("kinds");
    return {
      items: kinds === "note" ? [note] : kinds === "standard,tracked" ? [tracked] : [tracked, note],
      nextCursor: null,
    };
  };
  await mount(<OutcomeList client={outcomes} bots={bots} onSelect={() => {}} onCreate={() => {}} />);
  const rows = [...host.querySelectorAll(".outcome-row")];
  expect(rows.map((row) => row.textContent?.includes("Bot-registered"))).toEqual([true, false]);
  await input(host.querySelector("select")!, "active");
  const filterBar = host.querySelector('nav[aria-label="Outcome type"]')!;
  await click("Notes", filterBar);
  expect(calls.at(-1)!.path).toBe("/api/outcomes?kinds=note&statuses=active");
  expect(host.querySelectorAll(".outcome-row")).toHaveLength(1);
  expect(host.textContent).toContain("Meeting note");
  expect(host.textContent).toContain("#ops");
  expect(host.textContent).not.toContain("Alpha goal");
  await click("Goals", filterBar);
  expect(calls.at(-1)!.path).toBe("/api/outcomes?kinds=standard%2Ctracked&statuses=active");
  expect(host.textContent).toContain("Alpha goal");
  await click("All", filterBar);
  expect(calls.at(-1)!.path).toBe("/api/outcomes?statuses=active");
  expect(host.querySelectorAll(".outcome-row")).toHaveLength(2);
});

test("goal pagination retains existing goals, deduplicates overlap and passes the cursor", async () => {
  list = async (query) =>
    new URLSearchParams(query).has("cursor")
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
  expect(host.textContent).toContain("No Outcomes yet.");
  await click("Go");
  expect(created).toBe(true);
});

test("attention, notes and all sections navigate cleanly without a separate Explore tab, and Ideas filter works in All", async () => {
  await mount(page());
  const nav = host.querySelector('nav[aria-label="Outcome sections"]')!;
  expect(nav.textContent).not.toContain("Explore ideas");
  expect(nav.textContent).toContain("Notes");
  await click("Needs attention", nav);
  expect(host.textContent).toContain(inboxFixture.title);
  expect(host.textContent).toContain(inboxFixture.next);
  await click("Notes", nav);
  expect(calls.at(-1)?.path).toBe("/api/outcomes?kinds=note");
  await click("All", nav);
  expect(host.textContent).toContain("Backup comparison");
  await click("Ideas", host.querySelector('nav[aria-label="Outcome type"]')!);
  expect(host.textContent).toContain(exploreFixture.title);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

test("Go opens the shared intake surface and accepts pasted images while rejecting empty files", async () => {
  await mount(page());
  await click("Go");
  expect(document.body.textContent).toContain("Whatever is on your mind");
  const editor = document.body.querySelector<HTMLElement>('[role="textbox"]')!;
  const img = new dom.window.File(["png-bytes"], "clip.png", { type: "image/png" });
  const empty = new dom.window.File([], "empty.txt", { type: "text/plain" });
  await act(async () => {
    const paste = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [img, empty], items: [] } });
    editor.dispatchEvent(paste);
  });
  expect(document.body.textContent).toContain("clip.png");
  expect(document.body.textContent).not.toContain("empty.txt");
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Some files could not be attached");
});

test("Go intake remains available without Bots", async () => {
  await mount(
    <Workspace
      target={{}}
      bots={[]}
      onClose={() => {}}
    />
  );
  await click("Go");
  expect(document.body.textContent).toContain("Whatever is on your mind");
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
  await act(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
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
  expect(calls.at(-1)?.path).toBe("/api/outcomes?statuses=running");
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
  } as OutcomeDetail;
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
  expect(host.textContent).toContain("All");
  expect(calls.every((call) => !call.body)).toBe(true);
});
