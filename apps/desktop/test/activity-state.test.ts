import { describe, expect, test } from "bun:test";
import type { OutcomeSummary } from "@outcomego/contracts/outcomes";
import type { ActivityItem } from "@outcomego/contracts/task-overview";
import { missingKeys } from "../src/renderer/lib/i18n-catalog";
import {
  ACTIVITY_STATE_STYLE,
  activityBucket,
  activityPresentation,
  completedActivityItems,
  groupActivityByBot,
  mergeInProgressItems,
  styleForActivity,
  visibleActivity,
} from "../src/renderer/components/outcomego/outcomes/dashboard/activity-state";

// Specs/004.10 task 4.3 (requirements A1, A9): what the activity area shows and how. Pure functions, scenario-neutral
// fixtures, and no number of its own: the card limit and the layout choice arrive as arguments from the owner's policy.
let counter = 0;
const item = (overrides: Partial<ActivityItem> = {}): ActivityItem => {
  counter += 1;
  return {
    id: `request:${counter}`, type: "request", botId: "bot-a", title: `Item ${counter}`, state: "in_progress", reason: null, doing: null,
    progress: null, lastActivityAt: new Date(2026, 10, 25, 12, counter).toISOString(), nextCheckAt: null, needsOwner: false,
    link: { type: "channel", id: "c" }, ...overrides,
  };
};

describe("what is drawn in the activity area", () => {
  test("an item already on the owner's list is not drawn again", () => {
    const mine = item({ needsOwner: true });
    const other = item();
    expect(visibleActivity([mine, other]).map((entry) => entry.id)).toEqual([other.id]);
  });

  test("an empty list is empty, not an error", () => {
    expect(visibleActivity([])).toEqual([]);
    expect(groupActivityByBot([], () => "Bot")).toEqual([]);
  });
});

describe("grouping by bot", () => {
  const name = (id: string) => ({ "bot-a": "Alpha", "bot-b": "Beta", "bot-c": "Gamma" })[id] ?? "Bot";

  test("each bot is a group, in the order of its most recent item, with the items in the order they came", () => {
    const a1 = item({ botId: "bot-a", lastActivityAt: "2026-11-25T10:00:00.000Z" });
    const b1 = item({ botId: "bot-b", lastActivityAt: "2026-11-25T12:00:00.000Z" });
    const a2 = item({ botId: "bot-a", lastActivityAt: "2026-11-25T09:00:00.000Z" });
    const groups = groupActivityByBot([b1, a1, a2], name);
    expect(groups.map((group) => group.name)).toEqual(["Beta", "Alpha"]);
    expect(groups[1]!.items.map((entry) => entry.id)).toEqual([a1.id, a2.id]);
  });

  test("a group counts what is working, waiting and blocked, and nothing else", () => {
    const group = groupActivityByBot(
      [
        item({ state: "in_progress" }), item({ state: "verifying" }), item({ state: "running", type: "goal_task" }),
        item({ state: "waiting" }), item({ state: "scheduled", type: "goal_task" }), item({ state: "deferred", type: "goal_task" }),
        item({ state: "blocked" }), item({ state: "failed", type: "routine" }), item({ state: "completed" }),
      ],
      name
    )[0]!;
    expect(group.summary).toEqual({ working: 3, waiting: 3, blocked: 2 });
  });

  test("a bot with nothing to show has no group", () => {
    expect(groupActivityByBot([item({ botId: "bot-c" })], name).map((group) => group.name)).toEqual(["Gamma"]);
  });
});

describe("cards or a table", () => {
  test("up to the owner's limit it is cards, past it a table, and the limit is not ours to choose", () => {
    for (const limit of [3, 8, 20]) {
      expect(activityPresentation(limit, limit)).toBe("cards");
      expect(activityPresentation(limit + 1, limit)).toBe("table");
      expect(activityPresentation(0, limit)).toBe("cards");
    }
  });
});

describe("merging bot activity and in-progress goals", () => {
  const outcome = (id: string, status: OutcomeSummary["status"], overrides: Partial<OutcomeSummary> = {}): OutcomeSummary =>
    ({
      id, title: `Goal ${id}`, status, botId: "bot-a", currentRevision: 1,
      updatedAt: "2026-11-25T11:00:00.000Z", prereviewStatus: null, ...overrides,
    }) as unknown as OutcomeSummary;

  test("deduplicates a running goal already covered by a live goal_task activity item", () => {
    const task = item({ id: "goal_task:1", type: "goal_task", state: "running", title: "Step 1 — Goal g1", link: { type: "outcome", id: "g1" } });
    const merged = mergeInProgressItems([task], [outcome("g1", "running"), outcome("g2", "planning")], []);
    expect(merged.map((entry) => entry.id)).toEqual(["goal_task:1", "outcome:g2"]);
  });

  test("keeps paused and failed goals visible and skips goals already on the owner's list", () => {
    const merged = mergeInProgressItems(
      [item({ id: "req:mine", needsOwner: true, state: "needs_owner" })],
      [outcome("g1", "paused"), outcome("g2", "failed"), outcome("g3", "running"), outcome("g4", "accepted")],
      [{ key: "s1", outcomeId: "g3", title: "Goal g3", category: "decision_pending", since: "2026-11-25T10:00:00.000Z", completed: "", problem: "", next: "" }],
    );
    expect(merged.map((entry) => entry.id)).toEqual(["outcome:g1", "outcome:g2"]);
  });

  test("splits completed activity items out of In progress into Recently completed", () => {
    const active = item({ id: "request:active", state: "in_progress", lastActivityAt: "2026-11-25T11:00:00.000Z" });
    const waiting = item({ id: "request:waiting", state: "waiting", lastActivityAt: "2026-11-25T10:30:00.000Z" });
    const doneOlder = item({ id: "request:done-1", state: "completed", lastActivityAt: "2026-11-25T09:00:00.000Z" });
    const doneNewer = item({ id: "request:done-2", state: "completed", lastActivityAt: "2026-11-25T12:00:00.000Z" });
    const doneNeedsOwner = item({ id: "request:done-3", state: "completed", needsOwner: true });

    expect(mergeInProgressItems([active, waiting, doneOlder, doneNewer, doneNeedsOwner], [], []).map((entry) => entry.id)).toEqual([
      "request:active",
      "request:waiting",
    ]);
    expect(completedActivityItems([active, waiting, doneOlder, doneNewer, doneNeedsOwner]).map((entry) => entry.id)).toEqual([
      "request:done-2",
      "request:done-1",
    ]);
  });
});

describe("how a state is shown", () => {
  test("every state carries words, an icon and a tone, so it never rests on color alone", () => {
    for (const [state, style] of Object.entries(ACTIVITY_STATE_STYLE)) {
      expect(style.label.length, state).toBeGreaterThan(0);
      expect(style.icon.length, state).toBeGreaterThan(0);
      expect(style.tone, state).toBeTruthy();
    }
  });

  test("only work that is moving animates", () => {
    const animated = Object.entries(ACTIVITY_STATE_STYLE).filter(([, style]) => style.animated).map(([state]) => state).sort();
    expect(animated).toEqual(["in_progress", "running"]);
  });

  test("a state this version does not know still shows, as itself, in a neutral way", () => {
    const style = styleForActivity("brand_new_state");
    expect(style.tone).toBe("muted");
    expect(style.label).toBe("brand_new_state");
  });

  test("every state belongs to exactly one bucket, and only the three counted ones are counted", () => {
    for (const state of Object.keys(ACTIVITY_STATE_STYLE)) expect(["working", "waiting", "blocked", "other"]).toContain(activityBucket(state));
    expect(activityBucket("completed")).toBe("other");
    expect(activityBucket("skipped")).toBe("other");
  });

  test("every label has a Chinese translation", () => {
    expect(missingKeys([...Object.values(ACTIVITY_STATE_STYLE).map((style) => style.label), "Recently completed", "Expand", "Collapse"])).toEqual([]);
  });
});
