import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  ApproveContractRevisionInput,
  CreateContractRevisionInput,
  CreateOutcomeInput,
  CreateOutcomePlanInput,
  decodeOutcomeCursor,
  detectPlanningConflicts,
  encodeOutcomeCursor,
  hasBlockingConflict,
  isOutcomeEventTopic,
  OUTCOME_ERROR_CODES,
  OUTCOME_EVENT_TOPICS,
  OUTCOME_LIMITS,
  OUTCOME_STATUS_PRIORITY,
  OUTCOME_STATUSES,
  OutcomeError,
  parseListOutcomesQuery,
  planningOptionId,
  type PlanningDimensionView,
  RUN_SEGMENT_LIMIT,
  buildRunSegments,
  parseOutcomePlan,
  validatePlanSchedule,
  PLAN_ESTIMATE_MINUTES,
  DEFER_WORK_ITEM_TOOL,
  SetOutcomeDueInput,
  SetWorkItemScheduleInput,
  DeferWorkItemInput,
  OUTCOME_THREAD_TOOL_NAMES,
  requiredCriteriaSatisfied,
  resolvePlanningSelections,
  SubmitOutcomeReviewInput,
} from "../src/outcomes";

const BOT = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const CRITERION = "33333333-3333-4333-8333-333333333333";

const dimension = (options: PlanningDimensionView["options"]): PlanningDimensionView => ({
  options,
  selectedOptionIds: [],
  customEntries: [],
});

const draft = {
  goal: dimension([{ id: "goal-1", text: "形成可执行的选型建议", recommended: true, reason: "直接对应决策目标" }]),
  acceptance: dimension([
    { id: "acceptance-1", text: "比较两条可行路线", required: true },
    { id: "acceptance-2", text: "附来源", required: true },
    { id: "acceptance-3", text: "附一张对比表", required: false },
  ]),
  boundaries: dimension([
    { id: "boundaries-1", text: "只使用公开资料", kind: "included" },
    { id: "boundaries-2", text: "修改生产系统", kind: "excluded" },
  ]),
};

const select = (ids: Partial<Record<"goal" | "acceptance" | "boundaries", string[]>>, custom: Partial<Record<"goal" | "acceptance" | "boundaries", string[]>> = {}) => ({
  goal: { selectedOptionIds: ids.goal ?? [], customEntries: custom.goal ?? [] },
  acceptance: { selectedOptionIds: ids.acceptance ?? [], customEntries: custom.acceptance ?? [] },
  boundaries: { selectedOptionIds: ids.boundaries ?? [], customEntries: custom.boundaries ?? [] },
});

const expectOutcomeError = (run: () => unknown, code: keyof typeof OUTCOME_ERROR_CODES) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(OutcomeError);
    expect((error as OutcomeError).code).toBe(code);
    expect((error as OutcomeError).status).toBe(OUTCOME_ERROR_CODES[code]);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe("outcome states and events", () => {
  test("the derivation priority covers every Outcome status exactly once", () => {
    expect([...OUTCOME_STATUS_PRIORITY].sort()).toEqual([...OUTCOME_STATUSES].sort());
  });

  test("every Outcome event is prefixed so it cannot collide with runtime run.* topics", () => {
    for (const topic of OUTCOME_EVENT_TOPICS) expect(topic.startsWith("outcome.")).toBe(true);
    expect(isOutcomeEventTopic("outcome.accepted")).toBe(true);
    expect(isOutcomeEventTopic("run.completed")).toBe(false);
    expect(isOutcomeEventTopic("run.started")).toBe(false);
  });
});

describe("planning selections", () => {
  test("option IDs follow <dimension>-<n>", () => {
    expect(planningOptionId("goal", 0)).toBe("goal-1");
    expect(planningOptionId("acceptance", 3)).toBe("acceptance-4");
  });

  test("resolves selected options and custom entries into the confirmed contract text", () => {
    const contract = resolvePlanningSelections(
      draft,
      select({ goal: ["goal-1"], acceptance: ["acceptance-1", "acceptance-3"], boundaries: ["boundaries-1", "boundaries-2"] }, {
        acceptance: ["  给出推荐方案  "],
        boundaries: ["不访问客户数据"],
      })
    );
    expect(contract.goal).toEqual(["形成可执行的选型建议"]);
    expect(contract.acceptance).toEqual([
      { statement: "比较两条可行路线", required: true, verificationMethod: "human_review" },
      { statement: "附一张对比表", required: false, verificationMethod: "human_review" },
      { statement: "给出推荐方案", required: true, verificationMethod: "human_review" },
    ]);
    expect(contract.boundaries).toEqual({ included: ["只使用公开资料"], excluded: ["修改生产系统", "不访问客户数据"] });
    expect(contract.budget).toBeNull();
  });

  test("rejects option IDs that are not in the server snapshot", () => {
    expectOutcomeError(() => resolvePlanningSelections(draft, select({ goal: ["goal-9"] })), "planning_option_not_found");
  });

  test("rejects more than four selections or oversized custom text", () => {
    expectOutcomeError(
      () => resolvePlanningSelections(draft, select({ goal: ["goal-1", "goal-1", "goal-1", "goal-1", "goal-1"] })),
      "planning_option_limit_exceeded"
    );
    expectOutcomeError(
      () => resolvePlanningSelections(draft, select({}, { goal: ["x".repeat(OUTCOME_LIMITS.customEntryChars + 1)] })),
      "planning_input_too_large"
    );
  });

  test("blocks approval without a goal or a required criterion, and when a boundary is both included and excluded", () => {
    const empty = resolvePlanningSelections(draft, select({ acceptance: ["acceptance-3"] }));
    const codes = detectPlanningConflicts(empty).map((conflict) => conflict.code);
    expect(codes).toContain("ambiguous_scope");
    expect(codes).toContain("missing_acceptance");
    expect(hasBlockingConflict(detectPlanningConflicts(empty))).toBe(true);

    const clash = resolvePlanningSelections(draft, select({ goal: ["goal-1"], acceptance: ["acceptance-1"] }, { boundaries: ["公开资料", "不公开资料"] }));
    expect(hasBlockingConflict(detectPlanningConflicts({ ...clash, boundaries: { included: ["公开资料"], excluded: ["公开资料"] } }))).toBe(true);

    const ok = resolvePlanningSelections(draft, select({ goal: ["goal-1"], acceptance: ["acceptance-1"], boundaries: ["boundaries-2"] }));
    expect(hasBlockingConflict(detectPlanningConflicts(ok))).toBe(false);
  });

  test("a repeated custom entry is reported but does not block approval", () => {
    const contract = resolvePlanningSelections(draft, select({ goal: ["goal-1"], acceptance: ["acceptance-1"] }, { goal: ["形成可执行的选型建议"] }));
    const conflicts = detectPlanningConflicts(contract);
    expect(conflicts.map((conflict) => [conflict.code, conflict.severity])).toEqual([["duplicate_selection", "informational"]]);
  });
});

describe("acceptance", () => {
  const pass = { criterionId: "a", required: true, result: "PASS" as const, evidenceCredibility: ["human_confirmed" as const] };

  test("required PASS needs evidence beyond the agent's own report or an AI pre-review", () => {
    expect(requiredCriteriaSatisfied([pass])).toBe(true);
    expect(requiredCriteriaSatisfied([{ ...pass, evidenceCredibility: ["agent_report", "ai_prereview"] }])).toBe(false);
    expect(requiredCriteriaSatisfied([{ ...pass, evidenceCredibility: ["agent_report"], userConfirmed: true }])).toBe(true);
  });

  test("FAIL, UNVERIFIED, missing reviews and unapproved waivers keep the Outcome unaccepted", () => {
    for (const result of ["FAIL", "UNVERIFIED", null] as const)
      expect(requiredCriteriaSatisfied([pass, { ...pass, criterionId: "b", result }])).toBe(false);
    expect(requiredCriteriaSatisfied([{ ...pass, result: "WAIVED_BY_APPROVED_CHANGE", evidenceCredibility: [] }])).toBe(false);
    expect(requiredCriteriaSatisfied([{ ...pass, result: "WAIVED_BY_APPROVED_CHANGE", evidenceCredibility: [], waiverRevisionApproved: true }])).toBe(true);
  });

  test("optional criteria do not block, but at least one required criterion must exist", () => {
    expect(requiredCriteriaSatisfied([pass, { ...pass, criterionId: "b", required: false, result: "FAIL" }])).toBe(true);
    expect(requiredCriteriaSatisfied([{ ...pass, required: false }])).toBe(false);
  });
});

describe("request bodies", () => {
  const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) => Schema.decodeUnknownSync(schema)(value);

  test("plan and outcome creation accept the documented shape", () => {
    expect(decode(CreateOutcomePlanInput, { sourceText: "比较两个备份方案", context: { botId: BOT }, clientRequestId: "plan:pilot-1" }).context.botId).toBe(BOT);
    const outcome = decode(CreateOutcomeInput, {
      planId: PLAN,
      goal: { selectedOptionIds: ["goal-1"], customEntries: [] },
      acceptance: { selectedOptionIds: ["acceptance-1"], customEntries: [] },
      boundaries: { selectedOptionIds: [], customEntries: [] },
      title: "备份方案选型建议",
      clientRequestId: "outcome:pilot-1",
    });
    expect(outcome.title).toBe("备份方案选型建议");
  });

  test("rejects malformed IDs, empty source text and short request IDs", () => {
    expect(() => decode(CreateOutcomePlanInput, { sourceText: "", context: { botId: BOT }, clientRequestId: "plan:pilot-1" })).toThrow();
    expect(() => decode(CreateOutcomePlanInput, { sourceText: "x", context: { botId: "bot" }, clientRequestId: "plan:pilot-1" })).toThrow();
    expect(() => decode(ApproveContractRevisionInput, { expectedRevision: 1, confirmationText: "ok", clientRequestId: "short" })).toThrow();
    expect(() => decode(ApproveContractRevisionInput, { expectedRevision: 0, confirmationText: "ok", clientRequestId: "approve:x:1" })).toThrow();
  });

  test("approval carries only client intent, never an approver", () => {
    const approval = decode(ApproveContractRevisionInput, {
      expectedRevision: 1,
      confirmationText: "我确认",
      clientRequestId: "approve:x:1",
      approvedBy: "user:someone",
    });
    expect("approvedBy" in approval).toBe(false);
  });

  test("a new revision needs at least one goal and one criterion", () => {
    const body = (contract: Record<string, unknown>) => ({ baseRevision: 1, contract, clientRequestId: "revision:x:2" });
    const valid = { goal: ["g"], acceptance: [{ statement: "a", required: true }], boundaries: { included: [], excluded: [] }, budget: null };
    expect(decode(CreateContractRevisionInput, body(valid)).baseRevision).toBe(1);
    expect(() => decode(CreateContractRevisionInput, body({ ...valid, goal: [] }))).toThrow();
    expect(() => decode(CreateContractRevisionInput, body({ ...valid, acceptance: [] }))).toThrow();
  });

  test("review results use the four documented results", () => {
    const review = (result: string) => ({
      expectedRevision: 1,
      results: [{ criterionId: CRITERION, result, evidenceIds: [], comment: "" }],
      clientRequestId: "review:x:1",
    });
    expect(decode(SubmitOutcomeReviewInput, review("UNVERIFIED")).results[0]!.result).toBe("UNVERIFIED");
    expect(() => decode(SubmitOutcomeReviewInput, review("ACCEPTED"))).toThrow();
  });
});

describe("list query", () => {
  test("parses statuses, caps the limit and round-trips the cursor", () => {
    const cursor = encodeOutcomeCursor("2026-11-17T00:00:00.000Z", PLAN);
    const query = parseListOutcomesQuery(new URLSearchParams({ status: "running,review_pending", limit: "500", cursor }));
    expect(query.statuses).toEqual(["running", "review_pending"]);
    expect(query.limit).toBe(OUTCOME_LIMITS.listPageSizeMax);
    expect(query.cursor).toEqual({ updatedAt: "2026-11-17T00:00:00.000Z", id: PLAN });
    expect(parseListOutcomesQuery(new URLSearchParams()).limit).toBe(OUTCOME_LIMITS.listPageSize);
  });

  test("rejects unknown statuses and malformed cursors with a 400", () => {
    expectOutcomeError(() => parseListOutcomesQuery(new URLSearchParams({ status: "done" })), "invalid_outcome_query");
    expectOutcomeError(() => decodeOutcomeCursor("not-a-cursor"), "invalid_outcome_query");
    expectOutcomeError(() => parseListOutcomesQuery(new URLSearchParams({ limit: "0" })), "invalid_outcome_query");
  });
});

describe("run segments", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 0, minute, 0));
  const run = (id: string, startMinute: number | null, endMinute: number | null, status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted" = "completed") => ({
    id,
    status,
    startedAt: startMinute === null ? null : at(startMinute),
    completedAt: endMinute === null ? null : at(endMinute),
  });

  test("a task that never ran has no segments and nothing is invented from creation time", () => {
    expect(buildRunSegments([])).toEqual([]);
    // A queued run has not started: it is not a segment.
    expect(buildRunSegments([run("r1", null, null, "queued")])).toEqual([]);
  });

  test("segments are ordered by start time ascending and keep status and ISO times", () => {
    const segments = buildRunSegments([run("late", 30, 40), run("early", 0, 10, "failed")]);
    expect(segments.map((segment) => segment.id)).toEqual(["early", "late"]);
    expect(segments[0]).toEqual({
      id: "early",
      status: "failed",
      startedAt: "2026-11-24T00:00:00.000Z",
      completedAt: "2026-11-24T00:10:00.000Z",
    });
  });

  test("a running segment has no end and the gap between two segments is not part of either", () => {
    const segments = buildRunSegments([run("a", 0, 10), run("b", 50, null, "running")]);
    expect(segments[1]!.completedAt).toBeNull();
    expect(segments[0]!.completedAt).toBe("2026-11-24T00:10:00.000Z");
    expect(segments[1]!.startedAt).toBe("2026-11-24T00:50:00.000Z");
  });

  test("only the most recent segments are kept, still in ascending order", () => {
    expect(RUN_SEGMENT_LIMIT).toBe(20);
    const runs = Array.from({ length: RUN_SEGMENT_LIMIT + 5 }, (_, index) => run(`r${index}`, index, index));
    const segments = buildRunSegments(runs);
    expect(segments).toHaveLength(RUN_SEGMENT_LIMIT);
    expect(segments[0]!.id).toBe("r5");
    expect(segments.at(-1)!.id).toBe(`r${RUN_SEGMENT_LIMIT + 4}`);
  });

  test("segments with the same start time keep a deterministic order and the input is not mutated", () => {
    const input = [run("b", 5, 6), run("a", 5, 6)];
    const snapshot = input.map((entry) => entry.id);
    expect(buildRunSegments(input).map((segment) => segment.id)).toEqual(["a", "b"]);
    expect(input.map((entry) => entry.id)).toEqual(snapshot);
  });
});

describe("plan task schedule fields (specs/004.10 design §5.1)", () => {
  const base = { key: "a", title: "T", instructions: "Do it", botId: BOT, covers: [], nature: "deliverable" };
  const plan = (task: Record<string, unknown>) => parseOutcomePlan({ tasks: [{ ...base, ...task }] });

  test("a plan saved before these fields existed still parses, with none of them", () => {
    const parsed = plan({});
    expect(parsed).not.toBeNull();
    const task = parsed!.tasks[0]!;
    expect(task.startAt).toBeUndefined();
    expect(task.dueAt).toBeUndefined();
    expect(task.estimateMinutes).toBeUndefined();
  });

  test("the three fields are kept when present", () => {
    const task = plan({ startAt: "2026-12-01T09:00:00+08:00", dueAt: "2026-12-05T09:00:00+08:00", estimateMinutes: 90 })!.tasks[0]!;
    expect(task).toMatchObject({ startAt: "2026-12-01T09:00:00+08:00", dueAt: "2026-12-05T09:00:00+08:00", estimateMinutes: 90 });
  });

  test("a malformed value in stored data is dropped rather than failing the whole plan", () => {
    const task = plan({ startAt: "tomorrow", dueAt: 7, estimateMinutes: "long" })!.tasks[0]!;
    expect(task.startAt).toBeUndefined();
    expect(task.dueAt).toBeUndefined();
    expect(task.estimateMinutes).toBeUndefined();
  });

  test("nothing to check is valid", () => {
    expect(validatePlanSchedule({})).toEqual({ ok: true });
  });

  test("times must carry a UTC offset and be real dates", () => {
    for (const bad of ["2026-12-01", "2026-12-01T09:00:00", "2026-13-01T09:00:00Z", "2026-02-30T09:00:00Z", "soon", ""])
      expect(validatePlanSchedule({ startAt: bad }).ok).toBe(false);
    for (const good of ["2026-12-01T09:00:00Z", "2026-12-01T09:00:00+08:00", "2026-12-01T09:00:00.500-05:00"])
      expect(validatePlanSchedule({ startAt: good })).toEqual({ ok: true });
  });

  test("due may equal start but not precede it", () => {
    expect(validatePlanSchedule({ startAt: "2026-12-01T09:00:00Z", dueAt: "2026-12-01T09:00:00Z" }).ok).toBe(true);
    // The same instant written with different offsets is not earlier.
    expect(validatePlanSchedule({ startAt: "2026-12-01T09:00:00+08:00", dueAt: "2026-12-01T01:00:00Z" }).ok).toBe(true);
    const early = validatePlanSchedule({ startAt: "2026-12-01T09:00:00Z", dueAt: "2026-12-01T08:59:59Z" });
    expect(early.ok).toBe(false);
  });

  test("a start in the past is accepted: it means already due, so a replan can send it back unchanged", () => {
    expect(validatePlanSchedule({ startAt: "2001-01-01T00:00:00Z" })).toEqual({ ok: true });
  });

  test("the estimate is a whole number of minutes inside the allowed range", () => {
    expect(validatePlanSchedule({ estimateMinutes: PLAN_ESTIMATE_MINUTES.min }).ok).toBe(true);
    expect(validatePlanSchedule({ estimateMinutes: PLAN_ESTIMATE_MINUTES.max }).ok).toBe(true);
    for (const bad of [PLAN_ESTIMATE_MINUTES.min - 1, PLAN_ESTIMATE_MINUTES.max + 1, 1.5, Number.NaN])
      expect(validatePlanSchedule({ estimateMinutes: bad }).ok).toBe(false);
  });

  test("every problem is reported with a stable code, so the caller can answer invalid_schedule", () => {
    const result = validatePlanSchedule({ startAt: "nope", estimateMinutes: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields.sort()).toEqual(["estimateMinutes", "startAt"]);
  });
});

describe("DeferWorkItem (specs/004.10 design §5.4)", () => {
  const decode = (value: unknown) => Schema.decodeUnknownSync(DeferWorkItemInput)(value);

  test("is a thread tool, so it is only offered inside an Outcome work item turn", () => {
    expect(OUTCOME_THREAD_TOOL_NAMES).toContain("DeferWorkItem");
    expect(DEFER_WORK_ITEM_TOOL.name).toBe("DeferWorkItem");
  });

  test("takes a resume time and a note for the next turn, and an optional reason", () => {
    expect(decode({ resumeAt: "2026-12-01T09:00:00+08:00", note: "Continue from step three." })).toEqual({
      resumeAt: "2026-12-01T09:00:00+08:00", note: "Continue from step three.",
    });
    expect(decode({ resumeAt: "2026-12-01T09:00:00Z", note: "Go on", reason: "Waiting for an outside result" }).reason).toBe("Waiting for an outside result");
  });

  test("the note is required and bounded, the reason is bounded", () => {
    expect(() => decode({ resumeAt: "2026-12-01T09:00:00Z" })).toThrow();
    expect(() => decode({ resumeAt: "2026-12-01T09:00:00Z", note: "" })).toThrow();
    expect(() => decode({ resumeAt: "2026-12-01T09:00:00Z", note: "x".repeat(2001) })).toThrow();
    expect(() => decode({ resumeAt: "2026-12-01T09:00:00Z", note: "ok", reason: "x".repeat(301) })).toThrow();
    expect(decode({ resumeAt: "2026-12-01T09:00:00Z", note: "x".repeat(2000) }).note).toHaveLength(2000);
  });

  test("the schema checks shape only; whether the time is real and in range is decided by the server", () => {
    expect(() => decode({ resumeAt: 5, note: "ok" })).toThrow();
    expect(() => decode({ resumeAt: "x".repeat(65), note: "ok" })).toThrow();
  });

  test("the description tells the agent to stop after calling it, and states no numbers or scenarios", () => {
    const text = DEFER_WORK_ITEM_TOOL.description;
    expect(text).toMatch(/end(s)? (the|this) turn/i);
    expect(text).toMatch(/not .*complete/i);
    // "ISO 8601" names a format. Any other digit would be a business number, which belongs in the policy.
    expect(text.replace(/ISO 8601/g, "")).not.toMatch(/\d/);
    expect(text).not.toMatch(/mail|visit|inspect|customer|sender/i);
  });

  test("has its own error code and a schedule-change audit event", () => {
    expect(OUTCOME_ERROR_CODES.defer_limit_reached).toBe(409);
    expect(OUTCOME_EVENT_TOPICS).toContain("outcome.schedule.changed");
    expect(isOutcomeEventTopic("outcome.schedule.changed")).toBe(true);
  });
});

describe("owner rescheduling requests (specs/004.10 design §5.5)", () => {
  const rid = "request-0001";
  const schedule = (value: unknown) => Schema.decodeUnknownSync(SetWorkItemScheduleInput)(value);
  const due = (value: unknown) => Schema.decodeUnknownSync(SetOutcomeDueInput)(value);

  test("a field left out stays out, so it means unchanged; null is kept so it means clear", () => {
    expect(schedule({ clientRequestId: rid, estimateMinutes: 30 })).toEqual({ clientRequestId: rid, estimateMinutes: 30 });
    expect(schedule({ clientRequestId: rid, scheduledAt: null, dueAt: null, estimateMinutes: null })).toEqual({
      clientRequestId: rid, scheduledAt: null, dueAt: null, estimateMinutes: null,
    });
  });

  test("a request must carry an id long enough to be a retry key, and values of the wrong kind are refused", () => {
    expect(() => schedule({ scheduledAt: "2026-12-01T09:00:00Z" })).toThrow();
    expect(() => schedule({ clientRequestId: "short", scheduledAt: "2026-12-01T09:00:00Z" })).toThrow();
    expect(() => schedule({ clientRequestId: rid, scheduledAt: 5 })).toThrow();
    expect(() => schedule({ clientRequestId: rid, estimateMinutes: "30" })).toThrow();
    expect(() => schedule({ clientRequestId: rid, dueAt: "x".repeat(65) })).toThrow();
  });

  test("the deadline request needs a value or an explicit null", () => {
    expect(due({ clientRequestId: rid, dueAt: "2026-12-05T09:00:00Z" }).dueAt).toBe("2026-12-05T09:00:00Z");
    expect(due({ clientRequestId: rid, dueAt: null }).dueAt).toBeNull();
    expect(() => due({ clientRequestId: rid })).toThrow();
  });

  test("the two new refusals have their own codes", () => {
    expect(OUTCOME_ERROR_CODES.schedule_not_editable).toBe(409);
    expect(OUTCOME_ERROR_CODES.outcome_not_open).toBe(409);
  });
});
