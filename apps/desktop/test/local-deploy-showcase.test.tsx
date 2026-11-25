import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { missingKeys, sourceTranslations } from "../src/renderer/lib/i18n-catalog";
import { POSTER_MS, POSTERS, posterDirection, stepPoster } from "../src/renderer/lib/local-deploy-showcase";
import { localDeployShowcaseTranslations } from "../src/renderer/lib/local-deploy-showcase-catalog";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const globals = new Map<string, PropertyDescriptor | undefined>();
let reducedMotion = false;
let focused = true;
let hidden = false;
let locale = "en-US";
let createRoot: typeof import("react-dom/client").createRoot;
let DeployShowcase: typeof import("../src/renderer/components/outcomego/local-deploy-showcase").default;
let I18nProvider: typeof import("../src/renderer/lib/i18n").I18nProvider;
let root: Root | undefined;

// Timers run by hand, so ten seconds of posters take none.
type Timer = { at: number; every?: number; run: () => void };
const timers = new Map<number, Timer>();
let now = 0;
let nextTimer = 1;
const advance = async (ms: number) => {
  const end = now + ms;
  for (;;) {
    const due = [...timers].filter(([, timer]) => timer.at <= end).sort(([, a], [, b]) => a.at - b.at)[0];
    if (!due) break;
    const [id, timer] = due;
    now = timer.at;
    if (timer.every) timer.at += timer.every;
    else timers.delete(id);
    await act(async () => timer.run());
  }
  now = end;
};

beforeAll(async () => {
  const matchMedia = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} });
  Object.defineProperties(dom.window, {
    localStorage: { configurable: true, value: { getItem: () => locale } },
    matchMedia: { configurable: true, value: matchMedia },
    setTimeout: { configurable: true, value: (run: () => void, ms = 0) => { timers.set(nextTimer, { at: now + ms, run }); return nextTimer++; } },
    clearTimeout: { configurable: true, value: (id: number) => timers.delete(id) },
    setInterval: { configurable: true, value: (run: () => void, ms: number) => { timers.set(nextTimer, { at: now + ms, every: ms, run }); return nextTimer++; } },
    clearInterval: { configurable: true, value: (id: number) => timers.delete(id) },
  });
  Object.assign(dom.document, { oninput: null, hasFocus: () => focused });
  Object.defineProperty(dom.document, "hidden", { configurable: true, get: () => hidden });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver, matchMedia, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: class { observe() {} disconnect() {} },
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ default: DeployShowcase } = await import("../src/renderer/components/outcomego/local-deploy-showcase"));
  ({ I18nProvider } = await import("../src/renderer/lib/i18n"));
});

beforeEach(() => {
  reducedMotion = false;
  focused = true;
  hidden = false;
  locale = "en-US";
});

afterEach(async () => {
  // Back to the first poster: the showcase remembers where it was between mounts.
  if (root) {
    if (pages().length) await press(pages()[0]!);
    await act(async () => root!.unmount());
  }
  root = undefined;
  timers.clear();
});

afterAll(() => {
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const mount = async () => {
  root = createRoot(document.body);
  await act(async () => root!.render(<I18nProvider><DeployShowcase /></I18nProvider>));
};
const fire = (target: Element, type: string, extra: Record<string, unknown> = {}) =>
  act(async () => { target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), extra)); });
const press = (target: Element) => fire(target, "click", { detail: 1 });
const pages = () => Array.from(document.querySelectorAll(".showcase-page"));
const control = (label: string) => document.querySelector(`.showcase-nav button[aria-label="${label}"]`)!;
const showcase = () => document.querySelector(".deploy-showcase")!;
const shown = () => showcase().getAttribute("data-poster");
const titles = () => Array.from(document.querySelectorAll(".showcase-poster h2")).map((title) => title.textContent);

test("there are at least six posters, each with its own two lines", () => {
  expect(POSTERS.length).toBeGreaterThanOrEqual(6);
  for (const field of ["id", "title", "body"] as const) {
    expect(new Set(POSTERS.map((poster) => poster[field])).size).toBe(POSTERS.length);
  }
});

test("posters wrap around both ways and scroll the short way round", () => {
  const last = POSTERS.length - 1;
  expect([stepPoster(0, 1), stepPoster(last, 1), stepPoster(0, -1)]).toEqual([1, 0, last]);
  expect([posterDirection(1, 4), posterDirection(4, 1), posterDirection(last, 0), posterDirection(0, last)])
    .toEqual(["forward", "back", "forward", "back"]);
});

test("every word is translated, and no existing translation is overridden", () => {
  const words = POSTERS.flatMap(({ title, body }) => [title, body]);
  expect(missingKeys([...words, ...Object.keys(localDeployShowcaseTranslations)])).toEqual([]);
  expect(Object.keys(localDeployShowcaseTranslations).filter((key) => key in sourceTranslations)).toEqual([]);
});

test("the pictures' words are translated too", () => {
  const source = readFileSync(new URL("../src/renderer/components/outcomego/local-deploy-scenes.tsx", import.meta.url), "utf8");
  const called = [...source.matchAll(/\bt\("([^"]+)"\)/g)].map(([, key]) => key!);
  const listed = [...source.matchAll(/\b(?:label|role): "([^"]+)"/g)].map(([, key]) => key!);
  expect(called.length + listed.length).toBeGreaterThanOrEqual(10);
  expect(missingKeys([...called, ...listed])).toEqual([]);
});

test("every poster shares one set of colours: none brings its own", () => {
  const css = readFileSync(new URL("../src/renderer/components/outcomego/setup/local-deploy-showcase.css", import.meta.url), "utf8");
  // The stage, the glass and the three colours are defined once per theme, never per poster.
  expect(css).not.toContain("data-poster");
  expect(css.match(/^  --setup-tint:/gm)).toHaveLength(2);
  for (const name of ["--ice", "--accent", "--lilac"]) {
    expect(css.match(new RegExp(`^  ${name}:`, "gm"))).toHaveLength(1);
  }
});

test("each poster draws its picture and words, in the interface language", async () => {
  locale = "zh-CN";
  await mount();
  for (const [index, poster] of POSTERS.entries()) {
    await press(pages()[index]!);
    await advance(1_000);
    expect(shown()).toBe(poster.id);
    expect(titles()).toEqual([localDeployShowcaseTranslations[poster.title] ?? null]);
    expect(document.querySelector(`.showcase-canvas[data-scene="${poster.id}"]`)!.children.length).toBeGreaterThan(0);
    expect(document.querySelector(".showcase-copy p")!.textContent).toBe(localDeployShowcaseTranslations[poster.body] ?? null);
    expect(document.querySelector(".showcase-poster")!.getAttribute("aria-label")).toBe(
      `第 ${index + 1} 页，共 ${POSTERS.length} 页：${localDeployShowcaseTranslations[poster.title]}`
    );
  }
});

test("posters scroll on their own and come round again", async () => {
  await mount();
  expect(shown()).toBe(POSTERS[0]!.id);
  for (let index = 1; index <= POSTERS.length; index++) {
    await advance(POSTER_MS);
    expect(shown()).toBe(POSTERS[index % POSTERS.length]!.id);
    expect(showcase().getAttribute("data-direction")).toBe("forward");
  }
});

test("the old poster stays to scroll away, then leaves", async () => {
  await mount();
  await press(control("Next poster"));
  expect(titles()).toEqual([POSTERS[0]!.title, POSTERS[1]!.title]);
  expect(Array.from(document.querySelectorAll(".showcase-poster")).map((item) => [item.getAttribute("data-state"), item.getAttribute("aria-hidden")]))
    .toEqual([["leaving", "true"], ["entering", null]]);
  await advance(1_000);
  expect(titles()).toEqual([POSTERS[1]!.title]);
});

test("a story unfolds beat by beat while its poster is up", async () => {
  await mount();
  const told = () => document.querySelector(".vs-call")!.hasAttribute("data-on");
  expect(told()).toBe(false);
  await advance(POSTER_MS - 1_000);
  expect(told()).toBe(true);
});

test("pause holds the posters, and stepping while paused shows a finished picture", async () => {
  await mount();
  await press(control("Pause posters"));
  expect(showcase().hasAttribute("data-paused")).toBe(true);
  await advance(POSTER_MS * 2);
  expect(shown()).toBe(POSTERS[0]!.id);
  await press(control("Next poster"));
  expect(document.querySelector(".vs-seal")!.hasAttribute("data-on")).toBe(true);
  await press(control("Play posters"));
  await advance(POSTER_MS);
  expect(shown()).toBe(POSTERS[2]!.id);
});

test("posters can be stepped, jumped to and moved with the arrow keys", async () => {
  await mount();
  await press(control("Previous poster"));
  expect(shown()).toBe(POSTERS.at(-1)!.id);
  expect(showcase().getAttribute("data-direction")).toBe("back");
  await press(pages()[3]!);
  expect(shown()).toBe(POSTERS[3]!.id);
  expect(pages().map((page) => page.getAttribute("aria-current"))).toEqual(POSTERS.map((_, index) => (index === 3 ? "true" : null)));
  await fire(pages()[3]!, "keydown", { key: "ArrowRight" });
  expect(shown()).toBe(POSTERS[4]!.id);
  await fire(pages()[4]!, "keydown", { key: "ArrowLeft" });
  expect(shown()).toBe(POSTERS[3]!.id);
});

test("posters keep playing while the person looks at another window", async () => {
  focused = false;
  await mount();
  await advance(POSTER_MS);
  expect(shown()).toBe(POSTERS[1]!.id);
  await advance(POSTER_MS);
  expect(shown()).toBe(POSTERS[2]!.id);
});

test("posters wait only while the window can't be seen at all", async () => {
  hidden = true;
  await mount();
  await advance(POSTER_MS * 2);
  expect(shown()).toBe(POSTERS[0]!.id);
  hidden = false;
  await act(async () => { window.dispatchEvent(new Event("outcomego:visibility-change")); });
  await advance(POSTER_MS);
  expect(shown()).toBe(POSTERS[1]!.id);
});

test("a system asking for less motion doesn't stop the posters", async () => {
  reducedMotion = true;
  await mount();
  expect(control("Pause posters")).not.toBeNull();
  await advance(POSTER_MS);
  expect(shown()).toBe(POSTERS[1]!.id);
});

test("using the controls doesn't stop the posters", async () => {
  await mount();
  await fire(document.querySelector(".showcase-nav")!, "pointerover");
  await fire(pages()[1]!, "focusin");
  await press(pages()[1]!);
  await advance(POSTER_MS);
  expect(shown()).toBe(POSTERS[2]!.id);
});

test("starting again carries on from the poster shown last", async () => {
  await mount();
  await press(pages()[2]!);
  await act(async () => root!.unmount());
  await mount();
  expect(shown()).toBe(POSTERS[2]!.id);
});
