import { describe, expect, test } from "bun:test";
import { AGENT_WORK_ITEM_STATUSES, HUMAN_WORK_ITEM_STATUSES } from "@outcomego/contracts/outcomes";
import { missingKeys, sourceTranslations } from "../src/renderer/lib/i18n-catalog";
import {
  TIMELINE_STATUS,
  type TimelineTone,
} from "../src/renderer/components/outcomego/outcomes/timeline/timeline-status";

// Specs/004.10 task 1.3 / 1.4: a state is never carried by color alone, and every label is translated.
describe("timeline status presentation", () => {
  const styles = Object.entries(TIMELINE_STATUS);

  test("covers every stored task status and every derived state", () => {
    for (const status of [...AGENT_WORK_ITEM_STATUSES, ...HUMAN_WORK_ITEM_STATUSES])
      expect(TIMELINE_STATUS[status]).toBeDefined();
    for (const derived of ["waiting_dependency", "scheduled", "deferred", "missed_schedule"] as const)
      expect(TIMELINE_STATUS[derived]).toBeDefined();
  });

  test("every state has words, an icon and a tone", () => {
    const tones: TimelineTone[] = ["action", "review", "plan", "pass", "fail", "muted"];
    for (const [, style] of styles) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.icon.length).toBeGreaterThan(0);
      expect(tones).toContain(style.tone);
    }
  });

  test("states that share a tone still differ by words or icon, so color is never the only signal", () => {
    const seen = new Map<string, string>();
    for (const [state, style] of styles) {
      const key = `${style.tone}|${style.icon}|${style.label}`;
      expect(seen.has(key)).toBe(false);
      seen.set(key, state);
    }
  });

  test("only running work animates", () => {
    const animated = styles.filter(([, style]) => style.animated).map(([state]) => state);
    expect(animated.sort()).toEqual(["in_progress", "running"]);
  });

  test("every label is in the translation catalog with a translation that differs from the English", () => {
    const labels = styles.map(([, style]) => style.label);
    expect(missingKeys(labels)).toEqual([]);
    for (const label of labels) expect(sourceTranslations[label]).not.toBe(label);
  });
});
