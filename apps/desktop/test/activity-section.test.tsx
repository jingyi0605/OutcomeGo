import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActivityItem } from "@outcomego/contracts/task-overview";
import { ActivitySection } from "../src/renderer/components/outcomego/outcomes/dashboard/activity-section";
import { I18nProvider } from "../src/renderer/lib/i18n";

// Specs/004.10 task 4.3 (requirements A1, A2.4, A9): the activity area. Scenario-neutral placeholders only.
const bots: Record<string, string> = { "bot-a": "Alpha", "bot-b": "Beta" };
let counter = 0;
const item = (overrides: Partial<ActivityItem> = {}): ActivityItem => {
  counter += 1;
  return {
    id: `request:${counter}`, type: "request", botId: "bot-a", title: `Item ${counter}`, state: "in_progress", reason: null, doing: null,
    progress: null, lastActivityAt: new Date(2026, 10, 25, 12, counter).toISOString(), nextCheckAt: null, needsOwner: false,
    link: { type: "channel", id: `channel-${counter}` }, ...overrides,
  };
};
const render = (items: ActivityItem[], props: Partial<Parameters<typeof ActivitySection>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      children: createElement(ActivitySection, {
        items, botName: (id: string) => bots[id] ?? "Bot", cardMaxItems: 6, showAll: false, onToggleAll: () => undefined,
        onOpen: () => undefined, canOpen: () => true, ...props,
      }),
    })
  );

describe("the activity area", () => {
  test("each bot is a group with its name and how much of its work is moving, waiting or blocked", () => {
    const html = render([
      item({ botId: "bot-a", state: "in_progress" }), item({ botId: "bot-a", state: "waiting" }), item({ botId: "bot-b", state: "blocked" }),
    ]);
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("1 working");
    expect(html).toContain("1 waiting");
    expect(html).toContain("1 blocked");
  });

  test("an item already on the owner's list is not drawn here", () => {
    const html = render([item({ title: "On the owner's list", needsOwner: true }), item({ title: "Drawn here" })]);
    expect(html).toContain("Drawn here");
    expect(html).not.toContain("On the owner&#x27;s list");
  });

  test("with nothing to show it says so, and still offers 'Show all'", () => {
    const html = render([]);
    expect(html).toContain("No bot is working right now.");
    expect(html).toContain("Show all");
  });

  test("'Show all' turns into 'Show less' while everything is shown, and says which it is for assistive technology", () => {
    expect(render([item()], { showAll: false })).toMatch(/aria-pressed="false"[^>]*>Show all</);
    expect(render([item()], { showAll: true })).toMatch(/aria-pressed="true"[^>]*>Show less</);
  });
});

describe("cards or a table, by the owner's limit", () => {
  const three = () => [item(), item(), item()];
  test("up to the limit it is cards", () => {
    const html = render(three(), { cardMaxItems: 3 });
    expect(html).toContain("outcome-activity-card");
    expect(html).not.toContain("<table");
  });
  test("past the limit it is one table with a header row, and the same facts", () => {
    const html = render(three(), { cardMaxItems: 2 });
    expect(html).toContain("<table");
    expect(html).not.toContain("outcome-activity-card");
    for (const heading of ["Title", "Status", "Last activity", "Next check"]) expect(html).toContain(`>${heading}</th>`);
  });
  test("the limit is the argument, not a number of ours: the same items flip at whatever it is", () => {
    for (const limit of [1, 4, 10]) {
      const items = Array.from({ length: limit + 1 }, () => item());
      expect(render(items, { cardMaxItems: limit })).toContain("<table");
      expect(render(items.slice(0, limit), { cardMaxItems: limit })).not.toContain("<table");
    }
  });
});

describe("what one item says", () => {
  test("its state is words and an icon and a tone, and only moving work is marked animated", () => {
    const moving = render([item({ state: "in_progress" })]);
    expect(moving).toContain("In progress");
    expect(moving).toContain('class="outcome-activity-icon"');
    expect(moving).toContain('data-tone="review"');
    expect(moving).toContain("data-animated");
    expect(render([item({ state: "waiting" })])).not.toContain("data-animated");
  });

  test("what the bot wrote is plain text and says it is the bot's: nothing is read as markup or a link", () => {
    const html = render([
      item({ title: "Look into it", doing: "<script>alert(1)</script> and [a link](https://example.test) and **bold**", reason: "<img src=x onerror=alert(2)>" }),
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<strong");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Written by the bot");
  });

  test("a routine's own error is not labelled as written by a bot", () => {
    expect(render([item({ type: "routine", id: "routine:1", state: "failed", reason: "The host did not answer" })])).not.toContain("Written by the bot");
  });

  test("a goal task shows how far along it is, and a scheduled one when it starts, not as if it were working", () => {
    const running = render([item({ type: "goal_task", state: "running", progress: { done: 2, total: 5, phase: "Gathering" } })]);
    expect(running).toContain("2 of 5 parts done");
    expect(running).toContain("Gathering");
    const when = new Date(2026, 10, 30, 9, 0).toISOString();
    const scheduled = render([item({ type: "goal_task", state: "scheduled", nextCheckAt: when })]);
    expect(scheduled).toContain("Scheduled");
    expect(scheduled).toContain(new Date(when).toLocaleString());
    expect(scheduled).not.toContain("In progress");
  });

  test("the last activity, the next check, and how many helpers are working are all there", () => {
    const at = new Date(2026, 10, 25, 9, 30).toISOString();
    const next = new Date(2026, 10, 26, 8, 0).toISOString();
    const html = render([item({ lastActivityAt: at, nextCheckAt: next, workerCount: 3, state: "waiting" })]);
    expect(html).toContain(new Date(at).toLocaleString());
    expect(html).toContain(new Date(next).toLocaleString());
    expect(html).toContain("3 helpers working");
  });
});

describe("opening an item", () => {
  test("an item that can be opened is a button named by its title; one that cannot is only text", () => {
    const openable = render([item({ title: "Opens somewhere" })], { canOpen: () => true });
    expect(openable).toMatch(/<button[^>]*class="outcome-activity-card"/);
    const closed = render([item({ title: "Goes nowhere" })], { canOpen: () => false });
    expect(closed).not.toMatch(/<button[^>]*class="outcome-activity-card"/);
    expect(closed).toContain("Goes nowhere");
  });
});

describe("motion", () => {
  const css = readFileSync(resolve(import.meta.dir, "../src/renderer/components/outcomego/outcomes/outcome-ui.css"), "utf8");
  // Only this area's own rules, up to where the timeline's begin.
  const block = css.slice(css.indexOf("/* Activity area"), css.indexOf("/* Goal timeline (specs/004.10)"));

  test("the only animation in the activity area is the running icon, and reduced motion turns it off", () => {
    const uses = [...block.matchAll(/animation:\s*([^;]+);/g)].map((match) => match[1]!.trim()).filter((value) => value !== "none !important" && value !== "none");
    expect(uses).toHaveLength(1);
    expect(block).toMatch(/\.outcome-activity-status\[data-animated\] \.outcome-activity-icon\s*\{\s*animation:/);
    expect(block).toContain("@media (prefers-reduced-motion: reduce)");
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });
});
