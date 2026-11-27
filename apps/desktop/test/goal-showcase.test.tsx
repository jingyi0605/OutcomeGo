import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { missingKeys, sourceTranslations, translate } from "../src/renderer/lib/i18n-catalog";
import { GOAL_POSTER_MS, GOAL_STORIES, goalPosters } from "../src/renderer/lib/goal-showcase";
import { goalShowcaseTranslations } from "../src/renderer/lib/goal-showcase-catalog";
import { goalRoleTranslations } from "../src/renderer/lib/goal-showcase-roles-catalog";
import { localDeployShowcaseTranslations } from "../src/renderer/lib/local-deploy-showcase-catalog";

// The posters on the goal management entry page: four animated pages for each role the owner can pick,
// in a guide that can be folded away.
const dom = parseHTML("<!doctype html><html><body></body></html>");
const globals = new Map<string, PropertyDescriptor | undefined>();
const storage = new Map<string, string>();
let locale = "en-US";
let createRoot: typeof import("react-dom/client").createRoot;
let GoalGuide: typeof import("../src/renderer/components/outcomego/outcomes/showcase/goal-guide").GoalGuide;
let I18nProvider: typeof import("../src/renderer/lib/i18n").I18nProvider;
let root: Root | undefined;

// Timers run by hand, so a minute of posters takes none.
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
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Object.defineProperties(dom.window, {
    localStorage: {
      configurable: true,
      value: {
        getItem: (key: string) => (key.endsWith(".locale") ? locale : (storage.get(key) ?? null)),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
    matchMedia: { configurable: true, value: matchMedia },
    setTimeout: { configurable: true, value: (run: () => void, ms = 0) => { timers.set(nextTimer, { at: now + ms, run }); return nextTimer++; } },
    clearTimeout: { configurable: true, value: (id: number) => timers.delete(id) },
    setInterval: { configurable: true, value: (run: () => void, ms: number) => { timers.set(nextTimer, { at: now + ms, every: ms, run }); return nextTimer++; } },
    clearInterval: { configurable: true, value: (id: number) => timers.delete(id) },
  });
  Object.assign(dom.document, { oninput: null, hasFocus: () => true });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver, matchMedia, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: class { observe() {} disconnect() {} },
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ GoalGuide } = await import("../src/renderer/components/outcomego/outcomes/showcase/goal-guide"));
  // The guide loads the carousel on demand; loading it here keeps each mount immediate.
  await import("../src/renderer/components/outcomego/outcomes/showcase/goal-showcase");
  ({ I18nProvider } = await import("../src/renderer/lib/i18n"));
});

beforeEach(() => {
  locale = "en-US";
  storage.clear();
});

afterEach(async () => {
  if (root) {
    // Back to the first poster: the carousel remembers where it was between mounts.
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
  await act(async () => root!.render(<I18nProvider><GoalGuide /></I18nProvider>));
};
const press = (target: Element) =>
  act(async () => { target.dispatchEvent(Object.assign(new Event("click", { bubbles: true, cancelable: true }), { detail: 1 })); });
const pages = () => Array.from(document.querySelectorAll(".showcase-page"));
const shown = () => document.querySelector(".goal-showcase")?.getAttribute("data-poster") ?? null;
const fold = () => document.querySelector(".goal-guide-bar button")!;
const roles = () => Array.from(document.querySelectorAll(".goal-guide-roles button"));
const role = (id: string) => document.querySelector(`.goal-guide-roles button[data-role-id="${id}"]`)!;
const picked = () => roles().filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.getAttribute("data-role-id"));
const heading = () => document.querySelector(".showcase-copy h2")!.textContent;

const anyRole = GOAL_STORIES[0]!;
const general = goalPosters(anyRole);
const zh: Record<string, string> = { ...goalShowcaseTranslations, ...goalRoleTranslations };
const chinese = (key: string) => zh[key] ?? translate("zh-CN", key);

test("the switch offers the roles, starting with the telling for anyone", () => {
  expect(GOAL_STORIES.map((story) => chinese(story.name))).toEqual([
    "通用", "销售", "设计师", "开发", "项目经理", "财务", "市场运营", "人事", "管理者",
  ]);
  expect(new Set(GOAL_STORIES.map((story) => story.id)).size).toBe(GOAL_STORIES.length);
});

test("every role has four pages: what goals are, then three steps of using them", () => {
  for (const story of GOAL_STORIES) {
    const posters = goalPosters(story);
    expect(posters.map((poster) => poster.id)).toEqual(["concept", "capture", "approve", "accept"]);
    expect(posters.map((poster) => chinese(poster.eyebrow!))).toEqual([
      "功能概念",
      "使用说明 · 第 1 步",
      "使用说明 · 第 2 步",
      "使用说明 · 第 3 步",
    ]);
    for (const poster of posters) expect(poster.points).toHaveLength(3);
  }
});

test("each role tells its own story", () => {
  const own = GOAL_STORIES.map(({ concept, capture, approve, accept, picture }) => [
    concept.title, concept.body, capture.title, capture.body, capture.also, approve.title, approve.body,
    accept.title, accept.body, picture.line, picture.plan, picture.bot.name,
  ]);
  for (let field = 0; field < own[0]!.length; field++) {
    expect(new Set(own.map((words) => words[field])).size).toBe(GOAL_STORIES.length);
  }
});

const wordsOf = (story: (typeof GOAL_STORIES)[number]) => {
  const { bot, line, file, plan, criteria, asks } = story.picture;
  return [
    story.name, bot.name, line, file, plan, ...criteria, ...asks,
    ...goalPosters(story).flatMap(({ eyebrow, title, body, points }) => [eyebrow!, title, body, ...points!]),
  ];
};

test("every word of every role is translated, and no translation is defined twice", () => {
  const catalogs = [goalShowcaseTranslations, goalRoleTranslations];
  expect(missingKeys([...GOAL_STORIES.flatMap(wordsOf), ...catalogs.flatMap(Object.keys)])).toEqual([]);
  for (const catalog of catalogs) {
    expect(Object.keys(catalog).filter((key) => key in sourceTranslations)).toEqual([]);
  }
  expect(Object.keys(goalRoleTranslations).filter((key) => key in goalShowcaseTranslations)).toEqual([]);
  // The catalogs share one table once loaded: the same key must not read two ways.
  expect(
    Object.entries({ ...goalShowcaseTranslations, ...goalRoleTranslations })
      .filter(([key, value]) => (localDeployShowcaseTranslations[key] ?? value) !== value)
  ).toEqual([]);
});

// The pictures are drawn on a fixed canvas where these strings don't wrap.
test("the words inside the pictures fit the room they have", () => {
  const tooLong: string[] = [];
  const fits = (key: string, english: number, inChinese: number) => {
    if (key.length > english) tooLong.push(`${key} (${key.length} > ${english})`);
    const translated = chinese(key);
    if ([...translated].length > inChinese) tooLong.push(`${translated} (${[...translated].length} > ${inChinese})`);
  };
  for (const { picture } of GOAL_STORIES) {
    fits(picture.line, 34, 15);
    fits(picture.file, 18, 12);
    fits(picture.bot.name, 16, 6);
    fits(picture.plan, 22, 10);
    for (const criterion of picture.criteria) fits(criterion, 28, 12);
    for (const ask of picture.asks) fits(ask, 23, 11);
  }
  expect(tooLong).toEqual([]);
});

test("the pictures' own words are translated too", () => {
  const source = readFileSync(
    new URL("../src/renderer/components/outcomego/outcomes/showcase/goal-showcase-scenes.tsx", import.meta.url),
    "utf8"
  );
  const called = [...source.matchAll(/\bt\("([^"]+)"/g)].map(([, key]) => key!);
  const listed = [...source.matchAll(/\blabel: "([^"]+)"/g)].map(([, key]) => key!);
  const inLists = [...source.matchAll(/const (?:KINDS|VERBS) = \[([^\]]+)\]/g)]
    .flatMap(([, items]) => [...items!.matchAll(/"([^"]+)"/g)].map(([, key]) => key!));
  expect(inLists).toHaveLength(8);
  expect(called).toContain("{result}, with evidence");
  expect(missingKeys([...called, ...listed, ...inLists])).toEqual([]);
});

test("a button or section named in the instructions reads as it does on screen, for every role", () => {
  for (const story of GOAL_STORIES) {
    const named = goalPosters(story).flatMap((poster) =>
      [poster.title, poster.body, ...poster.points!].flatMap((text) =>
        [...text.matchAll(/“([^”]+)”/g)].map(([, label]) => ({ text, label: label! })))
    );
    expect(named.map(({ label }) => label)).toEqual([
      "Go",
      "Whatever is on your mind",
      "Needs your action",
      "Yes, approve",
      "Send to bot",
      "Needs your action",
      "Dashboard",
      "Approve",
      "Calendar",
    ]);
    for (const { text, label } of named) {
      expect(Object.keys(sourceTranslations)).toContain(label);
      expect(chinese(text)).toContain(`“${translate("zh-CN", label)}”`);
    }
  }
});

test("the guide is open at first, and each page of each role draws its picture and words in the interface language", async () => {
  locale = "zh-CN";
  await mount();
  expect(fold().getAttribute("aria-expanded")).toBe("true");
  expect(roles().map((button) => button.textContent)).toEqual(GOAL_STORIES.map((story) => chinese(story.name)));
  expect(picked()).toEqual(["general"]);
  for (const story of GOAL_STORIES) {
    await press(role(story.id));
    expect(picked()).toEqual([story.id]);
    expect(pages()).toHaveLength(4);
    for (const [index, poster] of goalPosters(story).entries()) {
      await press(pages()[index]!);
      await advance(6_000);
      expect(shown()).toBe(poster.id);
      expect(heading()).toBe(chinese(poster.title));
      expect(Array.from(document.querySelectorAll(".showcase-copy li")).map((item) => item.textContent))
        .toEqual(poster.points!.map(chinese));
      const picture = document.querySelector(`.showcase-canvas[data-scene="${poster.id}"]`)!.textContent!;
      const { line, plan, criteria, asks } = story.picture;
      const expected = { concept: [plan], capture: [line], approve: [plan, ...criteria], accept: [...asks, ...criteria] }[poster.id];
      for (const key of expected) expect(picture).toContain(chinese(key));
    }
  }
  await press(role("general"));
});

test("another role starts from its first page, and the choice is kept", async () => {
  await mount();
  await press(pages()[2]!);
  await advance(1_000);
  await press(role("finance"));
  expect([shown(), picked()]).toEqual(["concept", ["finance"]]);
  expect(document.querySelectorAll(".showcase-poster")).toHaveLength(1);
  await press(pages()[1]!);
  await advance(1_000);
  // Picking the role already shown leaves the page alone.
  await press(role("finance"));
  expect(shown()).toBe("capture");
  await act(async () => root!.unmount());
  await mount();
  expect([shown(), picked()]).toEqual(["capture", ["finance"]]);
});

test("a role this version doesn't know falls back to the telling for anyone", async () => {
  storage.set("openteam:goal-guide-role", "astronaut");
  await mount();
  expect(picked()).toEqual(["general"]);
  expect(heading()).toBe(general[0]!.title);
});

test("pages turn on their own, tell their story, and come round again", async () => {
  await mount();
  expect(shown()).toBe("concept");
  expect(document.querySelectorAll(".gs-station[data-on]")).toHaveLength(0);
  await advance(5_000);
  expect(document.querySelectorAll(".gs-station[data-on]")).toHaveLength(4);
  await advance(GOAL_POSTER_MS - 5_000);
  expect(shown()).toBe("capture");
  await advance(GOAL_POSTER_MS * 3);
  expect(shown()).toBe("concept");
});

test("a folded guide stops its posters and stays folded next time", async () => {
  await mount();
  await press(fold());
  expect([shown(), fold().getAttribute("aria-expanded"), fold().textContent]).toEqual([null, "false", "Show guide"]);
  expect(roles()).toHaveLength(0);
  await act(async () => root!.unmount());
  await mount();
  expect(shown()).toBeNull();
  await press(fold());
  expect([shown(), fold().textContent, roles().length]).toEqual(["concept", "Hide guide", GOAL_STORIES.length]);
});
