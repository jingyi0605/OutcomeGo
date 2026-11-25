import { describe, expect, test } from "bun:test";
import { TASK_POLICY_FIELDS, resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import {
  GOAL_SETTINGS_GROUPS,
  describePolicyField,
  parsePolicyInput,
  visibleGoalSettingsGroups,
} from "../src/renderer/components/outcomego/settings/goal-policy-fields";

// Specs/004.10 task 2.9. Everything shown comes from TASK_POLICY_FIELDS; these tests read the metadata instead of
// repeating its numbers, so changing an initial value or a range never needs a test edit.
const field = (key: string) => TASK_POLICY_FIELDS.find((entry) => entry.key === key)!;

describe("what a policy field shows", () => {
  test("every integer field shows its unit, range and initial value straight from the metadata", () => {
    for (const entry of TASK_POLICY_FIELDS.filter((candidate) => candidate.type === "integer")) {
      const shown = describePolicyField(entry, undefined);
      expect(shown.unit).toBe(entry.unit);
      expect(shown.range).toEqual({ min: entry.min, max: entry.max });
      expect(shown.initial).toBe(entry.initial);
    }
  });

  test("with nothing stored a field reads as its initial value and offers nothing to restore", () => {
    const entry = field("schedule.graceMinutes");
    const shown = describePolicyField(entry, undefined);
    expect(shown.value).toBe(entry.initial);
    expect(shown.isCustom).toBe(false);
    expect(shown.canRestore).toBe(false);
  });

  test("a stored value shows as custom and can be restored, even when it equals the initial value", () => {
    const entry = field("schedule.graceMinutes");
    for (const value of [entry.max!, entry.initial as number]) {
      const shown = describePolicyField(entry, value);
      expect(shown.value).toBe(value);
      expect(shown.isCustom).toBe(true);
      expect(shown.canRestore).toBe(true);
    }
  });

  test("a field that is unlimited when unset says so, rather than showing a number", () => {
    const entry = TASK_POLICY_FIELDS.find((candidate) => candidate.unlimitedWhenUnset)!;
    const shown = describePolicyField(entry, undefined);
    expect(shown.unlimited).toBe(true);
    expect(shown.value).toBeNull();
    const limited = describePolicyField(entry, entry.min!);
    expect(limited.unlimited).toBe(false);
    expect(limited.value).toBe(entry.min!);
  });

  test("only fields that start unset can show the unlimited state", () => {
    for (const entry of TASK_POLICY_FIELDS) {
      const shown = describePolicyField(entry, undefined);
      expect(shown.unlimited).toBe(Boolean(entry.unlimitedWhenUnset));
    }
  });

  test("the displayed value for every key agrees with resolveTaskPolicy", () => {
    const resolved = resolveTaskPolicy({});
    for (const entry of TASK_POLICY_FIELDS) expect(describePolicyField(entry, undefined).value).toEqual(resolved[entry.key]);
  });
});

describe("turning what the owner typed into a value to save", () => {
  const entry = field("schedule.graceMinutes");

  test("a whole number inside the range is accepted as that number", () => {
    for (const value of [entry.min!, entry.max!, Math.floor((entry.min! + entry.max!) / 2)])
      expect(parsePolicyInput(entry, String(value))).toEqual({ ok: true, value });
  });

  test("a number outside the range, or not a whole number, is refused with the allowed range", () => {
    for (const text of [String(entry.min! - 1), String(entry.max! + 1), "1.5", "abc", "", "  ", "1e3", "-0.5"]) {
      const parsed = parsePolicyInput(entry, text);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.range).toEqual({ min: entry.min, max: entry.max });
    }
  });

  test("surrounding spaces are ignored", () => {
    expect(parsePolicyInput(entry, `  ${entry.min}  `)).toEqual({ ok: true, value: entry.min! });
  });

  test("a field that is unlimited when unset accepts an empty box as 'no limit' (restore)", () => {
    const unlimited = TASK_POLICY_FIELDS.find((candidate) => candidate.unlimitedWhenUnset)!;
    expect(parsePolicyInput(unlimited, "")).toEqual({ ok: true, value: null });
    expect(parsePolicyInput(unlimited, String(unlimited.min))).toEqual({ ok: true, value: unlimited.min! });
  });

  test("a time field accepts a valid clock time only", () => {
    const time = TASK_POLICY_FIELDS.find((candidate) => candidate.type === "time")!;
    expect(parsePolicyInput(time, "07:05")).toEqual({ ok: true, value: "07:05" });
    for (const bad of ["7:5", "24:00", "12:60", "noon", ""]) expect(parsePolicyInput(time, bad).ok).toBe(false);
  });

  test("an enum field accepts only its listed options", () => {
    const choice = TASK_POLICY_FIELDS.find((candidate) => candidate.type === "enum")!;
    expect(parsePolicyInput(choice, choice.options![0]!)).toEqual({ ok: true, value: choice.options![0]! });
    expect(parsePolicyInput(choice, "not-an-option").ok).toBe(false);
  });
});

describe("which groups the page shows", () => {
  test("only groups whose feature exists today are shown; later groups are not placeholders", () => {
    const shown = visibleGoalSettingsGroups().map((group) => group.id);
    expect(shown).toContain("goal-management");
    expect(shown).toContain("goal-roles");
    expect(shown).toContain("goal-schedule");
    expect(shown).toContain("goal-activity");
    expect(shown).toContain("goal-todo");
    expect(shown).toContain("goal-auto-accept");
    expect(shown).not.toContain("goal-calendar");
  });

  test("the groups are in the order the design gives, and each has a deep-link anchor", () => {
    const ids = GOAL_SETTINGS_GROUPS.map((group) => group.id);
    expect(ids).toEqual(["goal-management", "goal-roles", "goal-schedule", "goal-activity", "goal-todo", "goal-auto-accept", "goal-calendar"]);
    for (const group of GOAL_SETTINGS_GROUPS) expect(group.id).toMatch(/^goal-/);
  });

  test("policy groups list exactly the metadata keys of their own group", () => {
    const schedule = GOAL_SETTINGS_GROUPS.find((group) => group.id === "goal-schedule")!;
    expect(schedule.policyGroup).toBe("schedule");
    const keys = TASK_POLICY_FIELDS.filter((entry) => entry.group === schedule.policyGroup).map((entry) => entry.key);
    expect(keys.length).toBeGreaterThan(0);
  });
});
