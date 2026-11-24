import { describe, expect, test } from "bun:test";
import { SETTINGS_NAVIGATION } from "../src/renderer/components/outcomego/settings/navigation";

// Specs/004.10 task 2.9: "Goal management" sits between "Model" and "Voice notes"; every other page keeps its place.
describe("settings navigation", () => {
  test("goal management is between model and voice notes, and nothing else moved", () => {
    expect(SETTINGS_NAVIGATION.map((item) => item.id)).toEqual([
      "general", "keyboard", "computer", "model", "goals", "voice", "realtime-voice", "server", "providers", "updates",
    ]);
  });

  test("the page's label is the English source string the catalog translates", () => {
    expect(SETTINGS_NAVIGATION.find((item) => item.id === "goals")!.label).toBe("Goal management");
  });

  test("every page has a unique id and a label and an icon", () => {
    const ids = SETTINGS_NAVIGATION.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SETTINGS_NAVIGATION) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon).toBeDefined();
    }
  });
});
