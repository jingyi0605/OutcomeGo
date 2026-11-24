import { PLAN_ESTIMATE_MINUTES } from "@outcomego/contracts/outcomes";

/**
 * Turning what the owner typed into the change to send (specs/004.10 requirements C7 and C8). Pure and shape-only:
 * whether a time is allowed, in order, or too late is the server's call. The estimate range is the contract's own, so
 * this file holds no number of its own.
 */

export interface ScheduleDraft {
  /** `datetime-local` text, or "" for none. */
  scheduledAt: string;
  dueAt: string;
  /** Whole minutes as text, or "" for none. */
  estimateMinutes: string;
}

/** What goes to the server. A field that is left out is unchanged there; `null` clears it. */
export interface ScheduleChange {
  scheduledAt?: string | null;
  dueAt?: string | null;
  estimateMinutes?: number | null;
}

export type ScheduleField = keyof ScheduleDraft;

export type ScheduleDraftResult =
  | { ok: true; /** Null when nothing changed, so there is nothing to send. */ change: ScheduleChange | null }
  | { ok: false; fields: ScheduleField[] };

const pad = (value: number) => String(value).padStart(2, "0");
// `datetime-local` always writes this form. Anything else (a bare date would be read as UTC) is refused rather than guessed.
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** A stored instant as the local date and time a `datetime-local` box takes, to the minute. Empty when there is none. */
export function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function draftFrom(item: {
  scheduledAt?: string | null;
  dueAt?: string | null;
  estimateMinutes?: number | null;
}): ScheduleDraft {
  return {
    scheduledAt: toLocalInput(item.scheduledAt),
    dueAt: toLocalInput(item.dueAt),
    estimateMinutes: typeof item.estimateMinutes === "number" ? String(item.estimateMinutes) : "",
  };
}

const FIELDS: readonly ScheduleField[] = ["scheduledAt", "dueAt", "estimateMinutes"];

/**
 * Only fields that differ from where the owner started are sent, so a field left alone stays untouched on the
 * server. An emptied box clears its field. A bad value stops everything and names every bad field: nothing is half-sent.
 */
export function changeFromDraft(initial: ScheduleDraft, draft: ScheduleDraft): ScheduleDraftResult {
  const change: ScheduleChange = {};
  const bad: ScheduleField[] = [];
  for (const field of FIELDS) {
    if (draft[field] === initial[field]) continue;
    const text = draft[field].trim();
    if (text === "") {
      change[field] = null;
    } else if (field === "estimateMinutes") {
      const minutes = Number(text);
      if (/^\d+$/.test(text) && minutes >= PLAN_ESTIMATE_MINUTES.min && minutes <= PLAN_ESTIMATE_MINUTES.max) change.estimateMinutes = minutes;
      else bad.push(field);
    } else {
      const instant = LOCAL_DATE_TIME.test(text) ? new Date(text) : null;
      if (instant && !Number.isNaN(instant.getTime())) change[field] = instant.toISOString();
      else bad.push(field);
    }
  }
  if (bad.length) return { ok: false, fields: bad };
  return { ok: true, change: Object.keys(change).length ? change : null };
}

/** The server's reasons for refusing a schedule change, as English catalog keys keyed by error code. */
export const SCHEDULE_ERROR_TEXT: Record<string, string> = {
  schedule_not_editable: "This task has already started or finished, so its schedule can no longer change",
  invalid_schedule: "The schedule is not valid. Check the dates and the estimate.",
  outcome_not_open: "This goal is finished, so its dates can no longer change",
  work_item_not_found: "That task no longer exists. Refresh the goal and try again.",
};

/** What to tell the owner when a change is refused: the server's reason in their language, or its own words. */
export function scheduleErrorMessage(error: unknown, t: (key: string) => string): string {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
  const known = code ? SCHEDULE_ERROR_TEXT[code] : undefined;
  if (known) return t(known);
  return error instanceof Error && error.message ? error.message : t("The request failed. Try again.");
}
