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
