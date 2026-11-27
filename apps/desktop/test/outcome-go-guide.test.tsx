import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { missingKeys, sourceTranslations, translate } from "../src/renderer/lib/i18n-catalog";
import { dismissOutcomeGoGuide, OUTCOME_GO_GUIDE_KEY, restartOutcomeGoGuide } from "../src/renderer/lib/outcome-go-guide";
import { outcomeGoGuideTranslations } from "../src/renderer/lib/outcome-go-guide-catalog";
import { WINDOW_VISIBILITY_EVENT } from "../src/renderer/lib/window-visibility";

// The guide to the Outcome and Go entries: shown once per client, one step at a time.
const dom = parseHTML("<!doctype html><html><body></body></html>");
const globals = new Map<string, PropertyDescriptor | undefined>();
const storage = new Map<string, string>();
let locale = "en-US";
let createRoot: typeof import("react-dom/client").createRoot;
let Slot: typeof import("../src/renderer/components/outcomego/outcome-go-guide-slot").OutcomeGoGuideSlot;
let I18nProvider: typeof import("../src/renderer/lib/i18n").I18nProvider;
let root: Root | undefined;
let host: HTMLElement;
const frames: Array<() => void> = [];
const observers = new Set<() => void>();
let rectLeft = 20;
let hidden = false;

beforeAll(async () => {
  Object.defineProperties(dom.window, {
    localStorage: {
      configurable: true,
      value: {
        getItem: (key: string) => (key.endsWith(".locale") ? locale : (storage.get(key) ?? null)),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
    innerWidth: { configurable: true, writable: true, value: 1200 },
    requestAnimationFrame: { configurable: true, value: (run: () => void) => frames.push(run) },
    cancelAnimationFrame: { configurable: true, value: () => {} },
    // Reduced motion: the buttons' own width animation needs a real browser.
    matchMedia: { configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) },
  });
  // linkedom has no layout: every element sits in the same spot unless marked as not drawn.
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    getClientRects: { configurable: true, value(this: Element) { return this.closest("[data-not-drawn]") ? [] : [{}]; } },
    getBoundingClientRect: { configurable: true, value: () => ({ left: rectLeft, top: 50, bottom: 86, right: rectLeft + 100, width: 100, height: 36 }) },
  });
  Object.assign(dom.document, { oninput: null, hasFocus: () => true });
  Object.defineProperty(dom.document, "hidden", { configurable: true, get: () => hidden });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true,
    // Changes to the page are delivered by hand (see `settle`).
    MutationObserver: class { constructor(private run: () => void) {} observe() { observers.add(this.run); } disconnect() { observers.delete(this.run); } },
    ResizeObserver: class { observe() {} disconnect() {} },
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ OutcomeGoGuideSlot: Slot } = await import("../src/renderer/components/outcomego/outcome-go-guide-slot"));
  // The slot loads the guide on demand; loading it here keeps each mount immediate.
  await import("../src/renderer/components/outcomego/outcome-go-guide");
  ({ I18nProvider } = await import("../src/renderer/lib/i18n"));
});

beforeEach(() => {
  locale = "en-US";
  rectLeft = 20;
  hidden = false;
  storage.clear();
  restartOutcomeGoGuide();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  frames.length = 0;
});

afterAll(() => {
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const opened: string[] = [];
/** The app's two buttons, as the guide finds them, with the guide beside them. */
const mount = async (entries: readonly string[] = ["outcome", "go"]) => {
  opened.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <I18nProvider>
      {entries.map((entry, index) => (
        <button data-guide-target={entry} key={`${entry}-${index}`} onClick={() => opened.push(entry)} type="button">{entry}</button>
      ))}
      <Slot />
    </I18nProvider>
  ));
  await settle();
};
/** Delivers a change to the page and the frame it asks for. */
const settle = () => act(async () => {
  for (const run of observers) run();
  for (const run of frames.splice(0)) run();
});
const press = async (target: Element) => {
  await act(async () => { target.dispatchEvent(new dom.window.Event("click", { bubbles: true, cancelable: true })); });
  await settle();
};
const card = () => document.querySelector<HTMLElement>(".outcome-go-guide");
const step = () => card()?.getAttribute("data-step") ?? null;
const entry = (name: string) => document.querySelector(`button[data-guide-target="${name}"]`)!;
const lit = () => Array.from(document.querySelectorAll("[data-guide-lit]")).map((element) => element.getAttribute("data-guide-target"));
const stored = () => storage.get(OUTCOME_GO_GUIDE_KEY) ?? null;
const unmount = async () => {
  await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
};
/** Quits the app and opens it again. */
const restart = async () => {
  await unmount();
  restartOutcomeGoGuide();
  await mount();
};

test("a client with no record of it is shown the guide, however long it has been in use", async () => {
  storage.set("openteam:theme", "dark");
  storage.set("openteam:selected-channel", "an-old-chat");
  await mount();
  expect([step(), lit(), stored()]).toEqual(["outcome", ["outcome"], "shown"]);
});

test("once it has appeared it never comes back, even with nothing pressed", async () => {
  await mount();
  expect(step()).toBe("outcome");
  await restart();
  expect([card(), lit(), stored()]).toEqual([null, [], "shown"]);
});

test("a client that holds a record isn't shown it", async () => {
  storage.set(OUTCOME_GO_GUIDE_KEY, "shown");
  await mount();
  expect([card(), lit()]).toEqual([null, []]);
});

test("it isn't used up while the window can't be seen", async () => {
  hidden = true;
  await mount();
  expect(stored()).toBeNull();
  // Quit from the tray without ever opening the window: the next start still has it to show.
  await restart();
  expect(stored()).toBeNull();
  hidden = false;
  await act(async () => { dom.window.dispatchEvent(new dom.window.Event(WINDOW_VISIBILITY_EVENT)); });
  expect([step(), stored()]).toEqual(["outcome", "shown"]);
});

test("nor while neither button is on screen", async () => {
  await mount([]);
  expect([card(), stored()]).toEqual([null, null]);
  await restart();
  expect([step(), stored()]).toEqual(["outcome", "shown"]);
});

test("the sidebar and the goal page mark the buttons the guide points at", () => {
  const read = (path: string) => readFileSync(new URL(`../src/renderer/components/outcomego/outcomes/${path}`, import.meta.url), "utf8");
  const sidebar = read("outcome-navigation.tsx");
  expect(sidebar).toContain('data-guide-target="outcome"');
  expect(sidebar).toContain('data-guide-target="go"');
  expect(read("inbox/outcome-workspace.tsx")).toContain('data-guide-target="go"');
});

test("it points at Outcome, then at Go, and the card's buttons press the real ones", async () => {
  await mount();
  expect([step(), lit()]).toEqual(["outcome", ["outcome"]]);
  expect(card()!.textContent).toContain("Step 1 of 2");
  await press(card()!.querySelector("[data-guide-try]")!);
  expect([opened, step(), lit()]).toEqual([["outcome"], "go", ["go"]]);
  expect(card()!.textContent).toContain("Step 2 of 2");
  await press(card()!.querySelector("[data-guide-try]")!);
  expect([opened, card(), lit()]).toEqual([["outcome", "go"], null, []]);
});

test("pressing the buttons themselves ticks the steps off, in either order", async () => {
  await mount();
  await press(entry("go"));
  expect([opened, step()]).toEqual([["go"], "outcome"]);
  await press(entry("outcome"));
  expect([opened, card()]).toEqual([["go", "outcome"], null]);
});

test("skipping ends it without opening anything", async () => {
  await mount();
  await press(card()!.querySelector("[data-guide-skip]")!);
  expect([opened, card(), lit(), stored()]).toEqual([[], null, [], "shown"]);
});

test("while the app runs it keeps its place if taken down and put back; a restart ends it", async () => {
  await mount();
  await press(entry("outcome"));
  // As when the app puts another screen up for a moment.
  await unmount();
  await mount();
  expect(step()).toBe("go");
  await restart();
  expect(card()).toBeNull();
});

test("it waits for a button that can be used: not hidden, and not behind a dialog", async () => {
  await mount(["go"]);
  expect(card()).toBeNull();
  const outcome = document.createElement("button");
  outcome.setAttribute("data-guide-target", "outcome");
  await act(async () => { host.appendChild(outcome); });
  await settle();
  expect(step()).toBe("outcome");
  // A dialog hides the rest of the page from assistive technology while it is open.
  host.setAttribute("aria-hidden", "true");
  await settle();
  expect([card(), lit()]).toEqual([null, []]);
  host.removeAttribute("aria-hidden");
  outcome.setAttribute("data-not-drawn", "");
  await settle();
  expect(card()).toBeNull();
  outcome.removeAttribute("data-not-drawn");
  await settle();
  expect(step()).toBe("outcome");
});

test("the card stays inside the window with its arrow on the button", async () => {
  rectLeft = 1120;
  await mount();
  // 1200 wide, a 280 card kept 8 from the edge; the button's middle is 258 along it.
  expect([card()!.style.left, card()!.style.top, card()!.style.getPropertyValue("--arrow")]).toEqual(["912px", "98px", "258px"]);
});

test("Escape dismisses it only from inside the card", async () => {
  await mount();
  const escape = (target: Element) => act(async () => {
    target.dispatchEvent(Object.assign(new dom.window.Event("keydown", { bubbles: true }), { key: "Escape" }));
  });
  await escape(entry("outcome"));
  expect(step()).toBe("outcome");
  await escape(card()!.querySelector("[data-guide-skip]")!);
  expect([card(), stored()]).toEqual([null, "shown"]);
});

test("it speaks the interface language, with every word translated once", async () => {
  const source = readFileSync(new URL("../src/renderer/components/outcomego/outcome-go-guide.tsx", import.meta.url), "utf8");
  const called = [...source.matchAll(/\bt\("([^"]+)"/g)].map(([, key]) => key!);
  const listed = [...source.matchAll(/\b(?:title|body|action): "([^"]+)"/g)].map(([, key]) => key!);
  expect(listed).toHaveLength(6);
  expect(missingKeys([...called, ...listed, ...Object.keys(outcomeGoGuideTranslations)])).toEqual([]);
  expect(Object.keys(outcomeGoGuideTranslations).filter((key) => key in sourceTranslations)).toEqual([]);
  locale = "zh-CN";
  await mount();
  expect(card()!.querySelector("h2")!.textContent).toBe(outcomeGoGuideTranslations["Open Outcome first"]!);
  expect(card()!.textContent).toContain(translate("zh-CN", "Step {current} of {total}", { current: 1, total: 2 }));
  await act(async () => dismissOutcomeGoGuide());
});
