import type { TaskPolicyField, TaskPolicyGroup, TaskPolicyValue } from "@outcomego/contracts/task-policy";

/**
 * What the goal-management settings page shows and accepts, as plain functions (specs/004.10 design §2.7).
 * Every number the page displays (unit, range, initial value) is read from the metadata in the contracts package,
 * so this file and the components hold no business value. Rendering lives in the components.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface PolicyFieldView {
  /** The value in force: the owner's, or the initial one when nothing is stored. `null` means no limit. */
  value: TaskPolicyValue;
  /** English unit key for the i18n catalog (for example "minutes"); absent for fields without one. */
  unit: string | undefined;
  range: { min: number | undefined; max: number | undefined };
  initial: TaskPolicyValue;
  /** The owner has stored a value for this key. Equal to the initial value is still custom. */
  isCustom: boolean;
  /** "Restore the initial value" is meaningful: there is a stored value to remove. */
  canRestore: boolean;
  /** Unset means no limit, and nothing is set. Shown as an explicit state, not as an empty box. */
  unlimited: boolean;
}

/** What one field shows, given the value stored for it (undefined when the owner has not set one). */
export function describePolicyField(entry: TaskPolicyField, stored: number | boolean | string | undefined): PolicyFieldView {
  const isCustom = stored !== undefined;
  return {
    value: isCustom ? stored : entry.initial,
    unit: entry.unit,
    range: { min: entry.min, max: entry.max },
    initial: entry.initial,
    isCustom,
    canRestore: isCustom,
    unlimited: !isCustom && entry.unlimitedWhenUnset === true && entry.initial === null,
  };
}

export type PolicyInputResult =
  | { ok: true; value: number | boolean | string | null }
  | { ok: false; range: { min: number | undefined; max: number | undefined } };

/**
 * Turns what the owner typed into the value to save. `null` means restore the initial value (an empty box on a field
 * that starts unlimited). The same range check runs on the server; this one only saves a round trip.
 */
export function parsePolicyInput(entry: TaskPolicyField, text: string): PolicyInputResult {
  const range = { min: entry.min, max: entry.max };
  const trimmed = text.trim();
  switch (entry.type) {
    case "integer": {
      if (trimmed === "") return entry.unlimitedWhenUnset ? { ok: true, value: null } : { ok: false, range };
      if (!/^-?\d+$/.test(trimmed)) return { ok: false, range };
      const value = Number(trimmed);
      return Number.isInteger(value) && value >= entry.min! && value <= entry.max! ? { ok: true, value } : { ok: false, range };
    }
    case "time":
      return TIME_PATTERN.test(trimmed) ? { ok: true, value: trimmed } : { ok: false, range };
    case "enum":
      return entry.options!.includes(trimmed) ? { ok: true, value: trimmed } : { ok: false, range };
    case "boolean":
      return trimmed === "true" ? { ok: true, value: true } : trimmed === "false" ? { ok: true, value: false } : { ok: false, range };
  }
}

export interface GoalSettingsGroup {
  /** Also the deep-link anchor that opens the page at this group. */
  id: "goal-management" | "goal-roles" | "goal-schedule" | "goal-activity" | "goal-todo" | "goal-auto-accept" | "goal-calendar";
  /** English title for the i18n catalog. */
  title: string;
  /** The metadata group whose fields it lists, when it is a policy group. */
  policyGroup?: TaskPolicyGroup;
  /** False until the feature behind it ships: such a group is not shown at all, so there are no empty shells. */
  available: boolean;
}

/** The page in the order the design gives. A later task flips `available` when its feature exists. */
export const GOAL_SETTINGS_GROUPS: readonly GoalSettingsGroup[] = [
  { id: "goal-management", title: "Goal management", available: true },
  { id: "goal-roles", title: "Planning and review", available: true },
  { id: "goal-schedule", title: "Scheduling and deferral", policyGroup: "schedule", available: true },
  { id: "goal-activity", title: "Activity view", policyGroup: "activity", available: true },
  { id: "goal-todo", title: "To-dos", policyGroup: "todo", available: true },
  { id: "goal-auto-accept", title: "Auto-accept rules", available: true },
  { id: "goal-calendar", title: "Calendar", available: false },
];

export const visibleGoalSettingsGroups = (): GoalSettingsGroup[] => GOAL_SETTINGS_GROUPS.filter((group) => group.available);
