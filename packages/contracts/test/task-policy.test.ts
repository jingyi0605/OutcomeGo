import { describe, expect, test } from "bun:test";
import {
  TASK_POLICY_FIELDS,
  TASK_POLICY_KEYS,
  mergeTaskPolicy,
  resolveTaskPolicy,
  validateTaskPolicyUpdate,
  type TaskPolicyKey,
} from "../src/task-policy";

// Specs/004.10 task 2.1 (design §2.6). Business numbers live only in TASK_POLICY_FIELDS; these tests read
// the metadata instead of repeating its numbers, so changing an initial value never needs a test edit.
const field = (key: TaskPolicyKey) => TASK_POLICY_FIELDS.find((entry) => entry.key === key)!;

describe("task policy metadata", () => {
  test("every key is defined once and every field says where it shows", () => {
    expect(new Set(TASK_POLICY_KEYS).size).toBe(TASK_POLICY_KEYS.length);
    for (const entry of TASK_POLICY_FIELDS) {
      expect(entry.group.length).toBeGreaterThan(0);
      expect(["integer", "boolean", "time", "enum"]).toContain(entry.type);
    }
  });

  test("each initial value is valid for its own field", () => {
    for (const entry of TASK_POLICY_FIELDS) {
      if (entry.initial === null) {
        expect(entry.unlimitedWhenUnset).toBe(true);
        continue;
      }
      if (entry.type === "integer") {
        expect(Number.isInteger(entry.initial)).toBe(true);
        expect(entry.initial as number).toBeGreaterThanOrEqual(entry.min!);
        expect(entry.initial as number).toBeLessThanOrEqual(entry.max!);
      }
      if (entry.type === "enum") expect([...(entry.options as readonly string[])]).toContain(entry.initial as string);
      if (entry.type === "boolean") expect(typeof entry.initial).toBe("boolean");
    }
  });

  test("only fields marked unlimited-when-unset may start unset", () => {
    for (const entry of TASK_POLICY_FIELDS) if (entry.initial === null) expect(entry.unlimitedWhenUnset).toBe(true);
    expect(TASK_POLICY_FIELDS.some((entry) => entry.unlimitedWhenUnset)).toBe(true);
  });
});

describe("resolving the policy", () => {
  test("with nothing stored every key comes from the central initial values", () => {
    const policy = resolveTaskPolicy(null);
    for (const entry of TASK_POLICY_FIELDS) expect(policy[entry.key]).toEqual(entry.initial);
    expect(resolveTaskPolicy(undefined)).toEqual(policy);
    expect(resolveTaskPolicy({})).toEqual(policy);
  });

  test("a stored override wins and other keys keep their initial value", () => {
    const key = "schedule.graceMinutes" as const;
    const policy = resolveTaskPolicy({ [key]: field(key).max! });
    expect(policy[key]).toBe(field(key).max!);
    expect(policy["schedule.deferMaxCount"]).toBe(field("schedule.deferMaxCount").initial as number);
  });

  test("stored garbage never breaks reading: unknown keys, wrong types and out-of-range values fall back", () => {
    const key = "schedule.graceMinutes" as const;
    const policy = resolveTaskPolicy({
      [key]: "soon",
      "not.a.key": 5,
      "schedule.deferMaxDays": field("schedule.deferMaxDays").max! + 1,
    });
    expect(policy[key]).toBe(field(key).initial as number);
    expect(policy["schedule.deferMaxDays"]).toBe(field("schedule.deferMaxDays").initial as number);
    expect(Object.keys(policy)).not.toContain("not.a.key");
  });

  test("non-object input is treated as nothing stored", () => {
    for (const bad of ["x", 3, [], true]) expect(resolveTaskPolicy(bad as unknown)).toEqual(resolveTaskPolicy(null));
  });
});

describe("validating an update", () => {
  test("accepts values at the edges of the range", () => {
    const key = "schedule.graceMinutes" as const;
    expect(validateTaskPolicyUpdate({ [key]: field(key).min! })).toEqual({ ok: true });
    expect(validateTaskPolicyUpdate({ [key]: field(key).max! })).toEqual({ ok: true });
  });

  test("rejects values outside the range, naming the key and the allowed range", () => {
    const key = "schedule.graceMinutes" as const;
    for (const value of [field(key).min! - 1, field(key).max! + 1]) {
      const result = validateTaskPolicyUpdate({ [key]: value });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]!.key).toBe(key);
        expect(result.errors[0]!.min).toBe(field(key).min!);
        expect(result.errors[0]!.max).toBe(field(key).max!);
      }
    }
  });

  test("rejects non-integers, wrong types and unknown keys", () => {
    const key = "schedule.graceMinutes" as const;
    expect(validateTaskPolicyUpdate({ [key]: 1.5 }).ok).toBe(false);
    expect(validateTaskPolicyUpdate({ [key]: "10" as never }).ok).toBe(false);
    expect(validateTaskPolicyUpdate({ "todo.nope": 1 } as never).ok).toBe(false);
  });

  test("null is accepted for every key: it means restore the initial value", () => {
    const all = Object.fromEntries(TASK_POLICY_KEYS.map((key) => [key, null]));
    expect(validateTaskPolicyUpdate(all as never)).toEqual({ ok: true });
  });

  test("reports every problem at once, so nothing is half-saved", () => {
    const result = validateTaskPolicyUpdate({ "schedule.graceMinutes": -5, "todo.nope": 1 } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.key).sort()).toEqual(["schedule.graceMinutes", "todo.nope"]);
  });

  test("boolean, enum and time fields check their own kind of value", () => {
    const bool = TASK_POLICY_FIELDS.find((entry) => entry.type === "boolean");
    const choice = TASK_POLICY_FIELDS.find((entry) => entry.type === "enum");
    const time = TASK_POLICY_FIELDS.find((entry) => entry.type === "time");
    if (bool) {
      expect(validateTaskPolicyUpdate({ [bool.key]: true }).ok).toBe(true);
      expect(validateTaskPolicyUpdate({ [bool.key]: 1 } as never).ok).toBe(false);
    }
    if (choice) {
      expect(validateTaskPolicyUpdate({ [choice.key]: choice.options![0] }).ok).toBe(true);
      expect(validateTaskPolicyUpdate({ [choice.key]: "not-an-option" } as never).ok).toBe(false);
    }
    if (time) {
      expect(validateTaskPolicyUpdate({ [time.key]: "07:05" }).ok).toBe(true);
      for (const bad of ["7:5", "24:00", "12:60", "noon"]) expect(validateTaskPolicyUpdate({ [time.key]: bad } as never).ok).toBe(false);
    }
  });
});

describe("merging an update into the stored overrides", () => {
  test("only the keys in the update change", () => {
    const merged = mergeTaskPolicy({ "schedule.graceMinutes": 5 }, { "schedule.deferMaxCount": 3 });
    expect(merged).toEqual({ "schedule.graceMinutes": 5, "schedule.deferMaxCount": 3 });
  });

  test("null removes the override, so the key reads as its initial value again", () => {
    const merged = mergeTaskPolicy({ "schedule.graceMinutes": 5, "schedule.deferMaxCount": 3 }, { "schedule.graceMinutes": null });
    expect(merged).toEqual({ "schedule.deferMaxCount": 3 });
    expect(resolveTaskPolicy(merged)["schedule.graceMinutes"]).toBe(field("schedule.graceMinutes").initial as number);
  });

  test("merging does not mutate its inputs and tolerates nothing stored", () => {
    const stored = { "schedule.graceMinutes": 5 };
    mergeTaskPolicy(stored, { "schedule.graceMinutes": 6 });
    expect(stored).toEqual({ "schedule.graceMinutes": 5 });
    expect(mergeTaskPolicy(null, { "schedule.deferMaxCount": 3 })).toEqual({ "schedule.deferMaxCount": 3 });
  });

  test("a stored value that is no longer valid is dropped rather than carried forward", () => {
    const merged = mergeTaskPolicy({ "schedule.deferMaxDays": field("schedule.deferMaxDays").max! + 1 } as never, { "schedule.deferMaxCount": 3 });
    expect(merged).toEqual({ "schedule.deferMaxCount": 3 });
  });
});
