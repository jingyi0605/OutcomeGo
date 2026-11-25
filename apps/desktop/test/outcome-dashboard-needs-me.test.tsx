import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import type { NeedsMeItem } from "@outcomego/contracts/task-overview";
import type { OutcomeSummary } from "@outcomego/contracts/outcomes";

// Specs/004.10 task 4.4 (requirement A4): the owner's queue on the dashboard, with the requests nobody else can move.
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
const asked = (overrides: Partial<NeedsMeItem> = {}): NeedsMeItem => {
  counter += 1;
  return {
    key: `request:${counter}`, source: "request", botId: "bot-a", title: `Request ${counter}`, state: "needs_owner", zone: "blocked",
    reason: null, since: new Date(2026, 10, 25, 9, counter).toISOString(), link: { type: "channel", id: `channel-${counter}` }, ...overrides,
  };
};
const step = (id: string, title: string, availableAt: string) => ({
  id, outcomeId: `goal-${id}`, title, category: "decision_pending", availableAt, completed: "", problem: "", next: "", status: "pending",
});

interface Options {
  requests?: NeedsMeItem[];
  steps?: unknown[];
  /** Replaces the call; null models a server that has no such call. */
  needsMe?: (() => Promise<unknown>) | null;
}
async function mount(options: Options = {}) {
  const { OutcomeDashboard } = await import("../src/renderer/components/outcomego/outcomes/dashboard/outcome-dashboard");
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  const opened = { channel: [] as string[] };
  const outcomes = {
    list: async () => ({ items: [], nextCursor: null }),
    ...(options.needsMe === null ? {} : { needsMe: options.needsMe ?? (async () => ({ items: options.requests ?? [] })) }),
  };
  const inbox = { list: async () => ({ items: options.steps ?? [], nextCursor: null }), decision: async () => null, resolve: async () => null };
  host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(I18nProvider, {
        children: createElement(OutcomeDashboard as never, {
          outcomes, inbox, bots: [{ id: "bot-a", name: "Alpha" }, { id: "bot-b", name: "Beta" }],
          onSelectOutcome: () => undefined, onSelectStep: () => undefined, onShowSteps: () => undefined,
          onShowGoals: () => undefined, onCreateGoal: () => undefined, onCreateIdea: () => undefined,
          onOpenChannel: (id: string) => opened.channel.push(id),
        }),
      })
    )
  );
  await act(async () => void (await Promise.resolve()));
  return { opened };
}
const text = () => host.textContent ?? "";
const queue = () => host.querySelector('section[aria-label="Needs your action"]')!;
const rows = () => [...queue().querySelectorAll("[data-needs-me-request]")].map((row) => row.getAttribute("data-needs-me-request"));
const click = (el: Element) => act(async () => void el.dispatchEvent(new dom.window.Event("click", { bubbles: true })));

describe("requests in the owner's queue", () => {
  for (const [name, title, bot, reason] of [
    ["first request", "Pick one of the two options", "Alpha", "Needs a choice"],
    ["second request", "Confirm the numbers", "Beta", "Waiting for a yes"],
  ] as const) {
    test(`(${name}) shows its title, the bot, its state and the reason as plain text, labelled as written by the bot`, async () => {
      await mount({ requests: [asked({ title, botId: bot === "Alpha" ? "bot-a" : "bot-b", reason })] });
      expect(queue().textContent).toContain(title);
      expect(queue().textContent).toContain(bot);
      expect(queue().textContent).toContain("Needs you");
      expect(queue().textContent).toContain(reason);
      expect(queue().textContent).toContain("Written by the bot");
    });
  }

  test("the reason is text: markup in it is shown as it is and creates no element", async () => {
    await mount({ requests: [asked({ reason: '<img src=x onerror="alert(1)"> **bold**' })] });
    expect(queue().querySelector("img")).toBeNull();
    expect(queue().textContent).toContain("<img src=x");
  });

  test("the count is on show and counts the requests, and the empty message is gone", async () => {
    await mount({ requests: [asked(), asked({ zone: "exception", state: "no_follow_up" })] });
    expect(host.querySelector(".outcome-dash-metrics")!.textContent).toContain("2");
    expect(text()).not.toContain("You're all caught up.");
  });

  test("exceptions are first, and Inbox steps and blocked requests share one list", async () => {
    const blocked = asked({ since: "2026-11-25T08:00:00.000Z" });
    const exception = asked({ zone: "exception", state: "no_follow_up", since: "2026-11-25T11:00:00.000Z" });
    await mount({ requests: [blocked, exception], steps: [step("s1", "An Inbox step", "2026-11-25T07:00:00.000Z")] });
    expect(rows()[0]).toBe(exception.key);
    expect(queue().textContent).toContain("An Inbox step");
    expect(rows()).toContain(blocked.key);
  });

  test("opening a request opens its channel; one that leads nowhere is text only", async () => {
    const { opened } = await mount({ requests: [asked({ link: { type: "channel", id: "the-channel" } }), asked({ link: { type: "conversation", id: "c" } })] });
    const [withChannel, without] = [...queue().querySelectorAll("[data-needs-me-request]")];
    expect(without!.querySelector("button")).toBeNull();
    await click(withChannel!.querySelector("button")!);
    expect(opened.channel).toEqual(["the-channel"]);
  });

  test("an older server, or a failing call, shows the Inbox steps alone and no error", async () => {
    for (const needsMe of [null, async () => { throw new Error("no such call"); }]) {
      await mount({ needsMe, steps: [step("s1", "An Inbox step", "2026-11-25T07:00:00.000Z")] });
      expect(text()).toContain("An Inbox step");
      expect(rows()).toEqual([]);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await act(async () => root!.unmount());
      host.remove();
    }
  });

  test("with nothing waiting the dashboard says so", async () => {
    await mount({ requests: [] });
    expect(text()).toContain("You're all caught up.");
  });
});
