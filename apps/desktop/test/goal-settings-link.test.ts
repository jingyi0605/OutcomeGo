import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUTCOMEGO_DEEP_LINK_EVENT, parseOutcomeGoDeepLink, settingsViewForAnchor } from "../src/renderer/lib/app-deep-links";
import { GOAL_SETTINGS_LINK, openGoalSettings } from "../src/renderer/components/outcomego/settings/goal-settings-link";

// Specs/004.10 task 2.9, requirement E1.4: General keeps one row that only jumps to the goal-management page.
describe("the jump from General to goal management", () => {
  test("the link is a settings deep link that resolves to the goal-management page", () => {
    expect(GOAL_SETTINGS_LINK).toBe("outcomego://app/v1/settings?id=goal-management");
    const parsed = parseOutcomeGoDeepLink(GOAL_SETTINGS_LINK);
    expect(parsed).toEqual({ kind: "settings", anchor: "goal-management" });
    expect(settingsViewForAnchor("goal-management")).toBe("goals");
  });

  test("opening it sends the existing deep-link event with that link, once", () => {
    const seen: string[] = [];
    const target = new EventTarget();
    target.addEventListener(OUTCOMEGO_DEEP_LINK_EVENT, (event) => seen.push((event as CustomEvent<{ url: string }>).detail.url));
    openGoalSettings(target);
    expect(seen).toEqual([GOAL_SETTINGS_LINK]);
  });

  test("the General page keeps no switch, dialog or role settings for goal management: one editable place only", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/renderer/components/outcomego/settings/general.tsx"), "utf8");
    expect(source).not.toContain("OutcomeRoleSettings");
    expect(source).not.toContain("outcomesEnabled");
    expect(source).not.toContain("Goal management settings");
    expect(source).toContain("openGoalSettings");
  });

  test("the row that stays is not editable: it is a button that opens the page, with a label for screen readers", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/renderer/components/outcomego/settings/general.tsx"), "utf8");
    expect(source).toMatch(/onClick=\{\(\) => openGoalSettings\(\)\}/);
  });

  test("the streaming and floating-window settings stay on General", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/renderer/components/outcomego/settings/general.tsx"), "utf8");
    expect(source).toContain("streamBotReplies");
    expect(source).toContain("BotDockSettings");
  });
});
