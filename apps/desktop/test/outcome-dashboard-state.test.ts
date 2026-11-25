import { expect, test } from "bun:test";
import type { OutcomeSummary } from "@outcomego/contracts/outcomes";
import {
  activeOutcomes,
  attentionRows,
  BOT_OUTCOME_STATUSES,
  brief,
  formatCount,
  laneOutcomes,
  needsMeQueue,
  quickDecisionMode,
  STALE_AFTER_MINUTES,
  summarizeOutcomes,
  waitingLabel,
  waitingMinutes,
} from "../src/renderer/components/outcomego/outcomes/dashboard/dashboard-state";
import { decisionFixture, inboxFixture } from "./outcome-client-fixtures";

const goal = (id: string, status: OutcomeSummary["status"], updatedAt: string): OutcomeSummary => ({
  id,
  title: id,
  status,
  botId: "bot",
  currentRevision: 1,
  updatedAt,
});

test("stats count live goals, accepted goals and the total; drafts and stopped goals are not live", () => {
  const items = [
    goal("a", "running", "2026-11-20T00:00:00Z"),
    goal("b", "decision_pending", "2026-11-21T00:00:00Z"),
    goal("c", "accepted", "2026-11-19T00:00:00Z"),
    goal("d", "cancelled", "2026-11-18T00:00:00Z"),
    goal("e", "draft", "2026-11-17T00:00:00Z"),
    goal("f", "failed", "2026-11-16T00:00:00Z"),
  ];
  expect(summarizeOutcomes(items)).toEqual({ active: 2, accepted: 1, total: 6 });
});

test("active goals are the most recently updated first and respect the row limit", () => {
  const items = [
    goal("old", "running", "2026-11-01T00:00:00Z"),
    goal("new", "paused", "2026-11-22T00:00:00Z"),
    goal("done", "accepted", "2026-11-23T00:00:00Z"),
    goal("mid", "review_pending", "2026-11-10T00:00:00Z"),
  ];
  expect(activeOutcomes(items).map((item) => item.id)).toEqual(["new", "mid", "old"]);
  expect(activeOutcomes(items, 2).map((item) => item.id)).toEqual(["new", "mid"]);
});

test("counts above 99 collapse to 99+", () => {
  expect(formatCount(99)).toBe("99");
  expect(formatCount(100)).toBe("99+");
});

const option = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  label,
  consequence: label,
  resolutionEffect: "plan_only" as const,
  source: "planner" as const,
  ...extra,
});

test("the owner's list is Inbox steps first, then goals waiting on the owner without a step, oldest first", () => {
  const goals = [
    goal("covered", "decision_pending", "2026-11-20T00:00:00Z"),
    goal("late", "review_pending", "2026-11-21T00:00:00Z"),
    goal("early", "pending_approval", "2026-11-19T00:00:00Z"),
    goal("busy", "running", "2026-11-18T00:00:00Z"),
  ];
  const rows = attentionRows([{ ...inboxFixture, outcomeId: "covered" }], goals);
  expect(rows.map((row) => row.outcomeId)).toEqual(["covered", "early", "late"]);
  expect(rows.map((row) => row.category)).toEqual([
    "decision_pending",
    "decision_pending",
    "acceptance_pending",
  ]);
  expect(rows[0]!.step).toBeDefined();
  expect(rows[1]!.step).toBeUndefined();
});

test("goals in preliminary review do not appear in the owner's action list", () => {
  const goals = [
    { ...goal("reviewing", "review_pending", "2026-11-22T00:00:00Z"), prereviewStatus: "pending" as const },
    goal("ready", "review_pending", "2026-11-21T00:00:00Z"),
  ];
  const rows = attentionRows([], goals);
  expect(rows.map((row) => row.outcomeId)).toEqual(["ready"]);
});

test("Bot lanes hide goals that are already on the owner's list and cap their rows", () => {
  const goals = [
    ...Array.from({ length: 7 }, (_, index) => goal(`run-${index}`, "running", `2026-11-1${index}T00:00:00Z`)),
    goal("listed", "running", "2026-11-20T00:00:00Z"),
  ];
  const attention = attentionRows([{ ...inboxFixture, outcomeId: "listed" }], goals);
  const lane = laneOutcomes(goals, BOT_OUTCOME_STATUSES, attention);
  expect(lane.total).toBe(7);
  expect(lane.rows).toHaveLength(5);
  expect(lane.rows.map((row) => row.id)).not.toContain("listed");
});

test("waiting time reads in minutes, hours and days, and a day or more counts as stale", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  expect(waitingLabel(waitingMinutes("2026-11-22T11:59:30Z", now))).toEqual({ key: "Just arrived" });
  expect(waitingLabel(waitingMinutes("2026-11-22T11:15:00Z", now))).toEqual({ key: "{count}m", count: 45 });
  expect(waitingLabel(waitingMinutes("2026-11-22T07:00:00Z", now))).toEqual({ key: "{count}h", count: 5 });
  expect(waitingLabel(waitingMinutes("2026-11-19T12:00:00Z", now))).toEqual({ key: "{count}d", count: 3 });
  expect(waitingMinutes("2026-11-21T12:00:00Z", now)).toBeGreaterThanOrEqual(STALE_AFTER_MINUTES);
  expect(waitingMinutes("not a date", now)).toBe(0);
});

test("quick decisions: approvals and short choices yes; credentials, contract changes and crowded cards no", () => {
  const base = { ...decisionFixture, reasonCode: "x", customEntryAllowed: false };
  expect(quickDecisionMode(null)).toBe("none");
  expect(quickDecisionMode({ ...base, options: [option("y", "Approve"), option("n", "Reject")] })).toBe("approval");
  expect(quickDecisionMode({ ...base, options: [option("a", "A"), option("b", "B"), option("c", "C")] })).toBe("choice");
  expect(
    quickDecisionMode({
      ...base,
      reasonCode: "credential_access_required",
      options: [option("y", "Allow"), option("n", "Deny")],
    })
  ).toBe("none");
  expect(
    quickDecisionMode({
      ...base,
      options: [option("a", "A"), option("b", "B", { contract: { goal: ["x"] } })],
    })
  ).toBe("none");
  expect(
    quickDecisionMode({
      ...base,
      options: ["a", "b", "c", "d", "e"].map((id) => option(id, id)),
    })
  ).toBe("none");
  expect(
    quickDecisionMode({ ...base, truncatedOptionCount: 2, options: [option("a", "A"), option("b", "B")] })
  ).toBe("none");
  expect(
    quickDecisionMode({ ...base, status: "resolved", options: [option("y", "Approve"), option("n", "Reject")] })
  ).toBe("none");
});

test("descriptions shrink to one short line: first sentence if it fits, otherwise a cut with an ellipsis", () => {
  expect(brief("")).toBe("");
  expect(brief("  Choose a source.\n\nMore detail follows. ")).toBe("Choose a source");
  expect(brief("认可并补记台账。容量侧保持现状，继续延后")).toBe("认可并补记台账");
  const long = "只读核实发现：回收区 /mnt/user/Data/_trash_20261118 的 53G 内容已于 2026-11-22 被删除";
  const out = brief(long);
  expect([...out]).toHaveLength(30);
  expect(out.endsWith("…")).toBe(true);
  expect(brief("x".repeat(30))).toBe("x".repeat(30));
  expect(brief("版本 1.2 已发布，请确认")).toBe("版本 1.2 已发布，请确认");
});

// Specs/004.10 task 4.4 (requirement A4): one queue, each entry once, in the order of design §2.4.
const row = (key: string, since: string) => ({ key, outcomeId: key, title: key, category: "decision_pending" as const, since, completed: "", problem: "", next: "" });
const asked = (key: string, zone: "exception" | "blocked", since: string) => ({
  key, source: "request" as const, botId: "bot", title: key, state: zone === "blocked" ? ("needs_owner" as const) : ("no_follow_up" as const),
  zone, reason: null, since, link: { type: "channel", id: "c" },
});
const keys = (entries: ReturnType<typeof needsMeQueue>) => entries.map((entry) => entry.key);

test("with no request source the queue is the Inbox steps exactly as they were (an older server)", () => {
  const rows = [row("s2", "2026-11-02T00:00:00Z"), row("s1", "2026-11-01T00:00:00Z")];
  expect(keys(needsMeQueue(rows, []))).toEqual(["s2", "s1"]);
});

test("exceptions come before anything else, then blocked work, whichever waited longer first", () => {
  const rows = [row("s-old", "2026-11-01T00:00:00Z"), row("s-new", "2026-11-05T00:00:00Z")];
  const requests = [asked("r-mid", "blocked", "2026-11-03T00:00:00Z"), asked("r-late", "blocked", "2026-11-06T00:00:00Z"), asked("e-new", "exception", "2026-11-07T00:00:00Z")];
  expect(keys(needsMeQueue(rows, requests))).toEqual(["e-new", "s-old", "r-mid", "s-new", "r-late"]);
});

test("the Inbox steps keep the order the server gave them, even when it is not by time", () => {
  const rows = [row("urgent", "2026-11-09T00:00:00Z"), row("older", "2026-11-01T00:00:00Z")];
  expect(keys(needsMeQueue(rows, [asked("r", "blocked", "2026-11-10T00:00:00Z")]))).toEqual(["urgent", "older", "r"]);
});

test("an entry that arrives from two sources is there once", () => {
  const queue = needsMeQueue([row("same", "2026-11-01T00:00:00Z")], [asked("same", "blocked", "2026-11-01T00:00:00Z"), asked("same", "blocked", "2026-11-01T00:00:00Z")]);
  expect(keys(queue)).toEqual(["same"]);
});
