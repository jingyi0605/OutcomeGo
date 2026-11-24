import { describe, expect, test } from "bun:test";
import { PLAN_ESTIMATE_MINUTES } from "@outcomego/contracts/outcomes";
import { missingKeys } from "../src/renderer/lib/i18n-catalog";
import {
  changeFromDraft,
  draftFrom,
  scheduleErrorMessage,
  SCHEDULE_ERROR_TEXT,
  toLocalInput,
  type ScheduleDraft,
} from "../src/renderer/components/outcomego/outcomes/timeline/schedule-edit";

// Specs/004.10 task 3.2 (requirements C7, C8): turning what the owner typed into the change to send. Pure functions,
// and no number from the policy or the business appears in them: the estimate range is the contract's own.
// Local-time fixtures are built from local parts, so the tests give the same answer in every time zone.
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);
const iso = (date: Date) => date.toISOString();
const EMPTY: ScheduleDraft = { scheduledAt: "", dueAt: "", estimateMinutes: "" };

describe("showing a stored time in a date-time box", () => {
  test("an empty or missing time is an empty box", () => {
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput(undefined)).toBe("");
    expect(toLocalInput("")).toBe("");
  });

  test("a stored instant is shown as local date and time to the minute", () => {
    expect(toLocalInput(iso(local(2026, 11, 25, 14, 30)))).toBe("2026-11-25T14:30");
    expect(toLocalInput(iso(local(2027, 1, 3, 0, 5)))).toBe("2027-01-03T00:05");
  });

  test("something that is not a time is an empty box, not 'Invalid Date'", () => {
    expect(toLocalInput("not a time")).toBe("");
  });

  test("a task's draft starts from what it has", () => {
    const draft = draftFrom({ scheduledAt: iso(local(2026, 11, 25, 9, 0)), dueAt: null, estimateMinutes: 90 });
    expect(draft).toEqual({ scheduledAt: "2026-11-25T09:00", dueAt: "", estimateMinutes: "90" });
  });
});

describe("what is sent", () => {
  const start = draftFrom({ scheduledAt: iso(local(2026, 11, 25, 9, 0)), dueAt: iso(local(2026, 11, 28, 17, 0)), estimateMinutes: 60 });

  test("nothing changed means nothing is sent", () => {
    expect(changeFromDraft(start, { ...start })).toEqual({ ok: true, change: null });
    expect(changeFromDraft(EMPTY, { ...EMPTY })).toEqual({ ok: true, change: null });
  });

  test("only the fields that changed are sent, so a field left alone is left alone on the server", () => {
    expect(changeFromDraft(start, { ...start, scheduledAt: "2026-11-26T10:15" })).toEqual({
      ok: true,
      change: { scheduledAt: iso(local(2026, 11, 26, 10, 15)) },
    });
    expect(changeFromDraft(start, { ...start, estimateMinutes: "45" })).toEqual({ ok: true, change: { estimateMinutes: 45 } });
  });

  test("a time is sent as an instant with an explicit zone, so the server can read it unambiguously", () => {
    const result = changeFromDraft(EMPTY, { ...EMPTY, dueAt: "2027-02-01T08:00" });
    expect(result).toEqual({ ok: true, change: { dueAt: iso(local(2027, 2, 1, 8, 0)) } });
    expect((result as { change: { dueAt: string } }).change.dueAt).toMatch(/Z$|[+-]\d\d:\d\d$/);
  });

  test("emptying a box clears that field with null", () => {
    expect(changeFromDraft(start, { ...start, dueAt: "" })).toEqual({ ok: true, change: { dueAt: null } });
    expect(changeFromDraft(start, { ...start, estimateMinutes: "" })).toEqual({ ok: true, change: { estimateMinutes: null } });
    expect(changeFromDraft(start, { ...start, scheduledAt: "   " })).toEqual({ ok: true, change: { scheduledAt: null } });
  });

  test("several fields at once are all sent", () => {
    expect(changeFromDraft(EMPTY, { scheduledAt: "2026-12-01T09:00", dueAt: "2026-12-02T09:00", estimateMinutes: "30" })).toEqual({
      ok: true,
      change: { scheduledAt: iso(local(2026, 12, 1, 9, 0)), dueAt: iso(local(2026, 12, 2, 9, 0)), estimateMinutes: 30 },
    });
  });
});

describe("what is stopped before it is sent", () => {
  test("the estimate must be a whole number inside the contract's own range", () => {
    for (const bad of ["0", String(PLAN_ESTIMATE_MINUTES.max + 1), "1.5", "abc", "-5", "1e3"])
      expect(changeFromDraft(EMPTY, { ...EMPTY, estimateMinutes: bad })).toEqual({ ok: false, fields: ["estimateMinutes"] });
    for (const good of [PLAN_ESTIMATE_MINUTES.min, PLAN_ESTIMATE_MINUTES.max])
      expect(changeFromDraft(EMPTY, { ...EMPTY, estimateMinutes: String(good) })).toEqual({ ok: true, change: { estimateMinutes: good } });
  });

  test("a time that is not a time is stopped, and every bad field is named", () => {
    expect(changeFromDraft(EMPTY, { scheduledAt: "tomorrow", dueAt: "2026-13-45T99:99", estimateMinutes: "oops" })).toEqual({
      ok: false,
      fields: ["scheduledAt", "dueAt", "estimateMinutes"],
    });
  });

  test("a bad field does not stop the owner seeing which ones are fine: nothing is half-sent", () => {
    const result = changeFromDraft(EMPTY, { scheduledAt: "2026-12-01T09:00", dueAt: "", estimateMinutes: "nope" });
    expect(result).toEqual({ ok: false, fields: ["estimateMinutes"] });
  });
});

describe("the reason shown when the server refuses", () => {
  const t = (key: string) => `«${key}»`;
  const failure = (code: string, message = "server words") => Object.assign(new Error(message), { code, status: 409 });

  test("a code the server gives is shown in the owner's language", () => {
    for (const code of Object.keys(SCHEDULE_ERROR_TEXT))
      expect(scheduleErrorMessage(failure(code), t)).toBe(t(SCHEDULE_ERROR_TEXT[code]!));
  });

  test("a task that has started is explained as such", () => {
    expect(scheduleErrorMessage(failure("schedule_not_editable"), (key) => key)).toMatch(/already started or finished/);
  });

  test("a code it does not know falls back to what the server said, and an unknown failure to a plain retry message", () => {
    expect(scheduleErrorMessage(failure("something_else", "The server's own words"), t)).toBe("The server's own words");
    expect(scheduleErrorMessage("not an error", t)).toBe(t("The request failed. Try again."));
  });

  test("every message the owner can see has a Chinese translation", () => {
    expect(missingKeys([...Object.values(SCHEDULE_ERROR_TEXT), "The request failed. Try again."])).toEqual([]);
  });
});
