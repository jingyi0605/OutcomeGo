import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import type { ActivityItem } from "@outcomego/contracts/task-overview";
import type { OutcomeSummary } from "@outcomego/contracts/outcomes";

// Specs/004.10 task 4.3 (requirements A1.5 to A1.8, A9): the activity area on the dashboard, beside the two goal lanes.
// The clients are replaced, so no request leaves the test. Fixtures are scenario-neutral placeholders.
const dom = parseHTML("<!doctype html><html><body></body></html>");
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | undefined;
let host: HTMLElement;

beforeAll(async () => {
  for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "Event", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT", "localStorage", "navigator"])
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const storage = new Map<string, string>();
  Object.defineProperty(dom.window, "localStorage", { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } });
  Object.defineProperty(dom.window, "navigator", { configurable: true, value: { language: "en" } });
  Object.defineProperty(dom.window, "location", { configurable: true, value: { href: "http://127.0.0.1:5173/" } });
  Object.assign(dom.document, { oninput: null, visibilityState: "visible" });
  // The refresh button measures itself and reads the reduced-motion preference; this DOM stand-in has neither.
  Object.assign(dom.window.HTMLElement.prototype, { getClientRects: () => [] });
  Object.assign(dom.window, {
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
});
afterAll(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

let counter = 0;
const activity = (overrides: Partial<ActivityItem> = {}): ActivityItem => {
  counter += 1;
  return {
    id: `request:${counter}`, type: "request", botId: "bot-a", title: `Activity ${counter}`, state: "in_progress", reason: null, doing: null,
    progress: null, lastActivityAt: new Date(2026, 10, 25, 12, counter).toISOString(), nextCheckAt: null, needsOwner: false,
    link: { type: "channel", id: `channel-${counter}` }, ...overrides,
  };
};
const goal = (status: OutcomeSummary["status"], title: string): OutcomeSummary =>
  ({ id: `goal-${title}`, title, status, botId: "bot-a", currentRevision: 1, updatedAt: "2026-11-25T10:00:00.000Z", prereviewStatus: null } as unknown as OutcomeSummary);

interface Options {
  items?: ActivityItem[];
  goals?: OutcomeSummary[];
  /** Replaces the activity call; omit it altogether to model a server that has no such call. */
  activity?: ((query?: { includeAll?: boolean }) => Promise<unknown>) | null;
  stopRequest?: (id: string) => Promise<{ stopped: true; requestRunId: string }>;
  cardMaxItems?: number;
}
async function mount(options: Options = {}) {
  const { OutcomeDashboard } = await import("../src/renderer/components/outcomego/outcomes/dashboard/outcome-dashboard");
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  const calls: Array<{ includeAll?: boolean } | undefined> = [];
  const opened = { outcome: [] as string[], channel: [] as string[], steps: 0, goals: 0 };
  const outcomes = {
    list: async () => ({ items: options.goals ?? [], nextCursor: null }),
    ...(options.activity === null
      ? {}
      : { activity: options.activity ?? (async (query?: { includeAll?: boolean }) => (calls.push(query), { items: options.items ?? [], truncated: false })) }),
    ...(options.stopRequest ? { stopRequest: options.stopRequest } : {}),
  };
  const inbox = { list: async () => ({ items: [], nextCursor: null }), decision: async () => null, resolve: async () => null };
  host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(I18nProvider, {
        children: createElement(OutcomeDashboard as never, {
          outcomes, inbox, bots: [{ id: "bot-a", name: "Alpha" }, { id: "bot-b", name: "Beta" }],
          onSelectOutcome: (id: string) => opened.outcome.push(id), onSelectStep: () => undefined,
          onShowSteps: () => { opened.steps += 1; },
          onShowGoals: () => { opened.goals += 1; }, onCreateGoal: () => undefined, onCreateIdea: () => undefined,
          onOpenChannel: (id: string) => opened.channel.push(id),
          ...(options.cardMaxItems !== undefined
            ? { activityPolicy: { cardMaxItems: options.cardMaxItems } }
            : {}),
        }),
      })
    )
  );
  // The dashboard loads its data after it mounts.
  await act(async () => void (await Promise.resolve()));
  return { calls, opened };
}
const text = () => host.textContent ?? "";
const section = (name: string) => host.querySelector(`section[aria-label="${name}"]`);
const click = (el: Element) => act(async () => void el.dispatchEvent(new dom.window.Event("click", { bubbles: true })));

describe("the unified In progress area", () => {
  test("merges bot activity with active, paused and failed goals in one section and removes separate lanes", async () => {
    await mount({
      items: [activity({ title: "Something moving" })],
      goals: [goal("running", "A running goal"), goal("failed", "A failed goal"), goal("paused", "A paused goal")],
    });
    expect(section("Activity")).toBeNull();
    expect(host.querySelector(".outcome-dash-lanes")).toBeNull();
    const inProgress = section("In progress")!;
    expect(inProgress).not.toBeNull();
    expect(inProgress.textContent).toContain("Something moving");
    expect(inProgress.textContent).toContain("A running goal");
    expect(inProgress.textContent).toContain("A failed goal");
    expect(inProgress.textContent).toContain("A paused goal");
    expect(host.querySelector('input[aria-label="New to-do"]')).toBeNull();
  });

  test("deduplicates a running goal when its live goal_task is already shown in activity", async () => {
    const runningGoal = goal("running", "Duplicate goal");
    await mount({
      items: [activity({ id: "goal_task:1", type: "goal_task", state: "running", title: "Subtask — Duplicate goal", link: { type: "outcome", id: runningGoal.id } })],
      goals: [runningGoal],
    });
    const cards = [...section("In progress")!.querySelectorAll(".outcome-activity-card")];
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain("Subtask — Duplicate goal");
  });

  test("an item that is already on the owner's list is not drawn in In progress", async () => {
    await mount({ items: [activity({ title: "Waiting on the owner", needsOwner: true, state: "needs_owner" }), activity({ title: "Just working" })] });
    expect(section("In progress")!.textContent).toContain("Just working");
    expect(section("In progress")!.textContent).not.toContain("Waiting on the owner");
  });

  test("top status pills are clickable and navigate to the matching section", async () => {
    const { opened } = await mount({ goals: [goal("accepted", "Done goal")] });
    const pills = [...host.querySelectorAll<HTMLButtonElement>(".outcome-dash-metric")];
    expect(pills).toHaveLength(4);
    await click(pills[0]!);
    expect(opened.steps).toBe(1);
    await click(pills[3]!);
    expect(opened.goals).toBe(1);
  });
});

describe("an older server", () => {
  test("with no activity call, or one that fails, there is no error and goals still show in In progress without Show all", async () => {
    await mount({ activity: null, goals: [goal("running", "Still here")] });
    expect(section("In progress")!.textContent).toContain("Still here");
    expect(section("In progress")!.textContent).not.toContain("Show all");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root!.unmount());
    host.remove();
    await mount({ activity: async () => { throw Object.assign(new Error("not found"), { status: 404 }); }, goals: [goal("running", "Still here too")] });
    expect(section("In progress")!.textContent).toContain("Still here too");
    expect(section("In progress")!.textContent).not.toContain("Show all");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("showing everything, and opening an item", () => {
  test("'Show all' asks for everything, and 'Show less' goes back", async () => {
    const { calls } = await mount({ items: [activity()] });
    expect(calls).toEqual([{ includeAll: false }]);
    const toggle = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Show all" || b.textContent === "Show less")!;
    await click(toggle());
    expect(calls.at(-1)).toEqual({ includeAll: true });
    expect(toggle().textContent).toBe("Show less");
    await click(toggle());
    expect(calls.at(-1)).toEqual({ includeAll: false });
  });

  test("a goal task opens its goal, a request or routine in a channel opens that channel, and one that leads nowhere is text", async () => {
    const { opened } = await mount({
      items: [
        activity({ title: "Goal task", type: "goal_task", id: "goal_task:1", link: { type: "outcome", id: "goal-7" } }),
        activity({ title: "Channel request", link: { type: "channel", id: "channel-9" } }),
        activity({ title: "No way in", type: "routine", id: "routine:1", state: "failed", link: { type: "routine", id: "r-1" } }),
      ],
    });
    const card = (title: string) => Array.from(host.querySelectorAll<HTMLElement>(".outcome-activity-card")).find((el) => el.textContent?.includes(title))!;
    await click(card("Goal task"));
    await click(card("Channel request"));
    expect(opened).toMatchObject({ outcome: ["goal-7"], channel: ["channel-9"] });
    expect(card("No way in").tagName).toBe("DIV");
  });
});

describe("the owner's limit for cards", () => {
  test("it is cards up to the limit the owner set and a table past it", async () => {
    await mount({ cardMaxItems: 2, items: [activity(), activity()] });
    expect(host.querySelector(".outcome-activity-cards")).not.toBeNull();
    await act(async () => root!.unmount());
    host.remove();
    await mount({ cardMaxItems: 2, items: [activity(), activity(), activity()] });
    expect(host.querySelector(".outcome-activity-table")).not.toBeNull();
  });
});

describe("removing unwanted request records", () => {
  test("clicking Remove on an activity request calls stopRequest and removes it from In progress", async () => {
    const req = activity({ id: "request:22222222-2222-4222-8222-222222222222", title: "Stale delegated search" });
    let items = [req];
    const stopped: string[] = [];
    await mount({
      activity: async () => ({ items, truncated: false }),
      stopRequest: async (id) => {
        stopped.push(id);
        items = [];
        return { stopped: true, requestRunId: id };
      },
    });
    const removeButton = host.querySelector<HTMLButtonElement>(`[data-activity-remove="${req.id}"]`)!;
    expect(removeButton).not.toBeNull();
    await click(removeButton);
    await act(async () => void (await Promise.resolve()));
    expect(stopped).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(host.textContent).not.toContain("Stale delegated search");
  });
});
