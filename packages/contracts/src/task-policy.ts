/**
 * Task policy (specs/004.10 design §2.6): the business numbers the owner can tune.
 *
 * `TASK_POLICY_FIELDS` is the single place these numbers are defined. The server validates against it, the
 * settings page renders from it, and `resolveTaskPolicy` reads from it. Business code never writes a policy
 * number as a literal; it calls `resolveTaskPolicy` and uses the result.
 *
 * `min` / `max` are format and scale limits (they only stop obviously wrong input), not product preferences.
 * `initial` is the central default the owner agreed to try first; it is a starting choice, not logic.
 */

export type TaskPolicyFieldType = "integer" | "boolean" | "time" | "enum";
export type TaskPolicyGroup = "schedule" | "activity" | "todo" | "inspection";

export interface TaskPolicyField {
  /** Dotted key, stored flat: `schedule.graceMinutes`. */
  key: string;
  group: TaskPolicyGroup;
  type: TaskPolicyFieldType;
  /** Display unit for an integer field, as an English source string for the i18n catalog. */
  unit?: string;
  min?: number;
  max?: number;
  options?: readonly string[];
  /** The value used when the owner has not set one. `null` means unset (see `unlimitedWhenUnset`). */
  initial: number | boolean | string | null;
  /** Unset means "no limit": the field starts unset and the page shows an explicit "no limit" state. */
  unlimitedWhenUnset?: true;
}

const DAY_LIMIT = 3650;
const COUNT_LIMIT = 100_000;

const POLICY_FIELDS = [
  { key: "schedule.graceMinutes", group: "schedule", type: "integer", unit: "minutes", min: 0, max: 10_080, initial: 60 },
  { key: "schedule.deferMaxCount", group: "schedule", type: "integer", unit: "times", min: 1, max: 1000, initial: 10 },
  { key: "schedule.deferMaxDays", group: "schedule", type: "integer", unit: "days", min: 1, max: DAY_LIMIT, initial: 180 },
  { key: "activity.recentCompletedHours", group: "activity", type: "integer", unit: "hours", min: 1, max: 24 * 365, initial: 24 },
  { key: "activity.checkOverdueMinutes", group: "activity", type: "integer", unit: "minutes", min: 1, max: 10_080, initial: 10 },
  { key: "activity.cardMaxItems", group: "activity", type: "integer", unit: "items", min: 1, max: 200, initial: 8 },
  { key: "activity.dashboardLayout", group: "activity", type: "enum", options: ["both", "activity", "lanes"], initial: "both" },
  { key: "todo.suggestionTtlDays", group: "todo", type: "integer", unit: "days", min: 0, max: DAY_LIMIT, initial: 14 },
  { key: "todo.restoreRetentionDays", group: "todo", type: "integer", unit: "days", min: 1, max: DAY_LIMIT, initial: 30 },
  { key: "todo.maxPendingSuggestionsPerBot", group: "todo", type: "integer", unit: "items", min: 1, max: COUNT_LIMIT, initial: null, unlimitedWhenUnset: true },
  { key: "todo.ownerRef.maxAgeHours", group: "todo", type: "integer", unit: "hours", min: 1, max: 24 * 365, initial: 24 },
  { key: "todo.ownerRef.maxTodosPerMessage", group: "todo", type: "integer", unit: "items", min: 1, max: COUNT_LIMIT, initial: null, unlimitedWhenUnset: true },
  { key: "todo.autoAccept.maxPerRulePerDay", group: "todo", type: "integer", unit: "times", min: 1, max: COUNT_LIMIT, initial: null, unlimitedWhenUnset: true },
  { key: "todo.highUrgencyNotify", group: "todo", type: "boolean", initial: false },
  { key: "todo.digest.enabled", group: "todo", type: "boolean", initial: false },
  { key: "todo.digest.localTime", group: "todo", type: "time", initial: "08:30" },
  { key: "todo.digest.maxTitles", group: "todo", type: "integer", unit: "items", min: 1, max: 50, initial: 5 },
  { key: "inspection.enabled", group: "inspection", type: "boolean", initial: true },
  { key: "inspection.leadHours", group: "inspection", type: "integer", unit: "hours", min: 1, max: 24 * 30, initial: 24 },
] as const satisfies readonly TaskPolicyField[];

export type TaskPolicyKey = (typeof POLICY_FIELDS)[number]["key"];
/** The field table, typed wide so callers can read any optional property (unit, min, options…) on any entry. */
export const TASK_POLICY_FIELDS: ReadonlyArray<TaskPolicyField & { key: TaskPolicyKey }> = POLICY_FIELDS;
export const TASK_POLICY_KEYS: readonly TaskPolicyKey[] = POLICY_FIELDS.map((entry) => entry.key);

export type TaskPolicyValue = number | boolean | string | null;
/** The resolved policy: every key has a value (`null` only for fields that are unlimited when unset). */
export type TaskPolicy = { [Key in TaskPolicyKey]: TaskPolicyValue };
/** What is stored: only the keys the owner changed. */
export type TaskPolicyOverrides = Partial<Record<TaskPolicyKey, Exclude<TaskPolicyValue, null>>>;
/** What an update may carry: `null` restores the initial value of that key. */
export type TaskPolicyUpdate = Partial<Record<TaskPolicyKey, TaskPolicyValue>>;

const FIELD_BY_KEY: ReadonlyMap<string, TaskPolicyField> = new Map(TASK_POLICY_FIELDS.map((entry) => [entry.key, entry]));
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether a (non-null) value is acceptable for a field. */
function isValidValue(entry: TaskPolicyField, value: unknown): boolean {
  switch (entry.type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value) && value >= entry.min! && value <= entry.max!;
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && entry.options!.includes(value);
    case "time":
      return typeof value === "string" && TIME_PATTERN.test(value);
  }
}

/** Keeps only stored overrides that are known and valid; anything else is ignored so a bad row can't break reading. */
function sanitize(raw: unknown): TaskPolicyOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const clean: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = FIELD_BY_KEY.get(key);
    if (entry && value !== null && isValidValue(entry, value)) clean[key] = value as number | boolean | string;
  }
  return clean as TaskPolicyOverrides;
}

/** Reads the stored overrides and fills every key from the central initial values. Never throws. */
export function resolveTaskPolicy(raw: unknown): TaskPolicy {
  const overrides = sanitize(raw) as Record<string, number | boolean | string>;
  return Object.fromEntries(
    TASK_POLICY_FIELDS.map((entry) => [entry.key, overrides[entry.key] ?? entry.initial])
  ) as TaskPolicy;
}

export interface TaskPolicyError {
  key: string;
  message: string;
  min?: number;
  max?: number;
  options?: readonly string[];
}

export type TaskPolicyValidation = { ok: true } | { ok: false; errors: TaskPolicyError[] };

/** Checks a whole update before anything is saved, and reports every problem so the caller can show the allowed range. */
export function validateTaskPolicyUpdate(update: TaskPolicyUpdate): TaskPolicyValidation {
  const errors: TaskPolicyError[] = [];
  for (const [key, value] of Object.entries(update)) {
    const entry = FIELD_BY_KEY.get(key);
    if (!entry) {
      errors.push({ key, message: "Unknown policy key" });
      continue;
    }
    if (value === null) continue;
    if (!isValidValue(entry, value)) {
      errors.push({
        key,
        message: "Value is outside the allowed range",
        ...(entry.min !== undefined ? { min: entry.min } : {}),
        ...(entry.max !== undefined ? { max: entry.max } : {}),
        ...(entry.options ? { options: entry.options } : {}),
      });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Applies an update to the stored overrides: a value sets that key, `null` removes it (restoring the initial
 * value), other keys are untouched. Stored values that are no longer valid are dropped. The inputs are not changed.
 */
export function mergeTaskPolicy(stored: unknown, update: TaskPolicyUpdate): TaskPolicyOverrides {
  const merged: Record<string, number | boolean | string> = { ...(sanitize(stored) as Record<string, number | boolean | string>) };
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  return merged as TaskPolicyOverrides;
}
