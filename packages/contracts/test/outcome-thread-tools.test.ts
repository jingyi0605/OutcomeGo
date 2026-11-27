import { expect, test } from "bun:test";
import {
  composeConclusion,
  decodeOutcomeThreadInput,
  goalThreadToolsForPurpose,
  OUTCOME_GOAL_THREAD_TOOLS,
  OUTCOME_THREAD_PURPOSES,
} from "../src/outcome-thread";
import { isOutcomeEventTopic, OUTCOME_EVENT_TOPICS } from "../src/outcomes";

test("goal thread tools enforce mode and purpose whitelists without changing review tools", () => {
  const research = ["GetOutcome", "ListOutcomes", "SavePlanAdvice"] as const;
  for (const purpose of ["plan", "replan"] as const) {
    expect(goalThreadToolsForPurpose(purpose, "contract_plan")).toEqual(["SaveOutcomeContract", "SavePlan", "CancelOutcome", ...research]);
  }
  expect(goalThreadToolsForPurpose("owner_message", "contract_plan")).toEqual([
    "SaveOutcomeContract",
    "SavePlan",
    "AcceptOutcome",
    "RequestOutcomeRework",
    "CancelOutcome",
    ...research,
  ]);
  for (const purpose of ["plan", "replan", "owner_message"] as const) {
    expect(goalThreadToolsForPurpose(purpose, "advice")).toEqual(research);
    expect(goalThreadToolsForPurpose(purpose, "triage")).toEqual([...research, "ClassifyOutcome"]);
  }
  expect(goalThreadToolsForPurpose("review", "triage")).toEqual(["GetOutcome", "SubmitPrereview"]);
  expect(goalThreadToolsForPurpose("review_task", "contract_plan")).toEqual(["GetOutcome", "ReviewTaskResult"]);
  expect(OUTCOME_THREAD_PURPOSES).toEqual(["plan", "owner_message", "replan", "review", "review_task"]);

  for (const tool of OUTCOME_GOAL_THREAD_TOOLS) {
    expect(tool.name).not.toMatch(/Approve|Decision|HumanAction|Bitwarden/i);
  }
});

test("AcceptOutcome and RequestOutcomeRework validate inputs", () => {
  const outcomeId = crypto.randomUUID();
  expect(
    decodeOutcomeThreadInput("AcceptOutcome", {
      outcomeId,
      expectedRevision: 2,
      clientRequestId: "accept:1",
    })
  ).toEqual({ outcomeId, expectedRevision: 2, clientRequestId: "accept:1" });

  expect(
    decodeOutcomeThreadInput("RequestOutcomeRework", {
      outcomeId,
      expectedRevision: 2,
      reason: "Please verify the latest backup file.",
      clientRequestId: "rework:1",
    })
  ).toEqual({
    outcomeId,
    expectedRevision: 2,
    reason: "Please verify the latest backup file.",
    clientRequestId: "rework:1",
  });

  expect(() =>
    decodeOutcomeThreadInput("RequestOutcomeRework", {
      outcomeId,
      expectedRevision: 2,
      reason: "   ",
      clientRequestId: "rework:blank",
    })
  ).toThrow();
});

test("SavePlan requires nature on every task with no default and enforces task limits", () => {
  const botId = crypto.randomUUID();
  const criterionId = crypto.randomUUID();
  expect(() =>
    decodeOutcomeThreadInput("SavePlan", {
      expectedRevision: 1,
      tasks: [{ key: "t1", title: "Write doc", instructions: "Write it", botId, covers: [criterionId] }],
      clientRequestId: "plan:missing-nature",
    })
  ).toThrow();

  const valid = decodeOutcomeThreadInput("SavePlan", {
    expectedRevision: 1,
    notes: "Assumes workspace path",
    tasks: [
      { key: "t1", title: "Write doc", instructions: "Write it", botId, covers: [criterionId], nature: "deliverable" },
      { key: "t2", title: "Deploy", instructions: "Deploy it", botId, dependsOn: ["t1"], covers: [], nature: "action" },
    ],
    clientRequestId: "plan:valid-1",
  });
  expect(valid.tasks).toHaveLength(2);

  expect(() =>
    decodeOutcomeThreadInput("SavePlan", {
      expectedRevision: 1,
      tasks: Array.from({ length: 21 }, (_, idx) => ({
        key: `t${idx}`,
        title: `Task ${idx}`,
        instructions: "Do work",
        botId,
        covers: [],
        nature: "action",
      })),
      clientRequestId: "plan:too-many",
    })
  ).toThrow();
});

test("SubmitPrereview and ReviewTaskResult schemas validate findings and length caps", () => {
  const criterionId = crypto.randomUUID();
  const workItemId = crypto.randomUUID();
  const point = { label: "Used", value: 63, evidenceId: crypto.randomUUID(), quote: "Used 63%" };
  const chart = { type: "metric" as const, title: "Capacity", unit: "%", points: [point] };
  const input = {
    expectedRevision: 1,
    results: [{ criterionId, suggestion: "likely_pass", reason: "Evidence exists" }],
    conclusion: ["All required criteria look satisfied."],
    attention: [], charts: [chart],
    clientRequestId: "prereview:1",
  };
  const prereview = decodeOutcomeThreadInput("SubmitPrereview", input);
  expect(prereview.results).toHaveLength(1);
  expect(prereview.charts).toEqual([chart]);
  expect(() => decodeOutcomeThreadInput("SubmitPrereview", {
    ...input, charts: [{ ...chart, points: [{ ...point, evidenceId: "missing" }] }],
  })).toThrow();

  // A chart point cites a record or a saved file, never both and never neither.
  const { evidenceId: _evidenceId, ...unsourced } = point;
  expect(decodeOutcomeThreadInput("SubmitPrereview", {
    ...input, charts: [{ ...chart, points: [{ ...unsourced, file: "outcomes/o/w/report.md" }] }],
  }).charts).toHaveLength(1);
  expect(() => decodeOutcomeThreadInput("SubmitPrereview", { ...input, charts: [{ ...chart, points: [unsourced] }] })).toThrow();
  expect(() => decodeOutcomeThreadInput("SubmitPrereview", {
    ...input, charts: [{ ...chart, points: [{ ...point, file: "outcomes/o/w/report.md" }] }],
  })).toThrow();

  // The conclusion is one sentence of <=50 characters, or 2-5 items of <=30 characters.
  const conclusionOf = (conclusion: string[]) => () => decodeOutcomeThreadInput("SubmitPrereview", { ...input, conclusion });
  const sentence = "主缓存使用63%、第二缓存57%，均低于70%预警线，无需清理。";
  expect(conclusionOf([sentence])).not.toThrow();
  expect(conclusionOf(["字".repeat(51)])).toThrow();
  expect(conclusionOf(["缓存使用63%，低于70%线。", "阵列使用34%，低于80%线。"])).not.toThrow();
  expect(conclusionOf(["字".repeat(31), "阵列使用34%，低于80%线。"])).toThrow();
  expect(conclusionOf(["1", "2", "3", "4", "5", "6"])).toThrow();
  expect(conclusionOf([])).toThrow();
  expect(composeConclusion(["一句话。"])).toBe("一句话。");
  expect(composeConclusion(["甲。", "乙。"])).toBe("1. 甲。\n2. 乙。");

  const taskReview = decodeOutcomeThreadInput("ReviewTaskResult", {
    workItemId,
    verdict: "reject",
    findings: [
      {
        kind: "omission",
        basis: { criterionId },
        reason: "Required section B is missing from the output.",
      },
    ],
    note: "Formatting could be improved.",
    clientRequestId: "review-task:1",
  });
  expect(taskReview.findings).toHaveLength(1);

  expect(() =>
    decodeOutcomeThreadInput("ReviewTaskResult", {
      workItemId,
      verdict: "reject",
      findings: [{ kind: "omission", basis: { criterionId }, reason: "" }],
      clientRequestId: "review-task:empty-reason",
    })
  ).toThrow();
});

test("new outcome event topics are registered in OUTCOME_EVENT_TOPICS", () => {
  for (const topic of [
    "outcome.plan.saved",
    "outcome.replan.requested",
    "outcome.task_review.decided",
    "outcome.prereview.submitted",
  ]) {
    expect(OUTCOME_EVENT_TOPICS).toContain(topic as (typeof OUTCOME_EVENT_TOPICS)[number]);
    expect(isOutcomeEventTopic(topic)).toBe(true);
  }
});

test("SavePlan accepts optional schedule fields per task and keeps plans without them valid", () => {
  const botId = crypto.randomUUID();
  const task = { key: "t1", title: "Write doc", instructions: "Write it", botId, covers: [], nature: "deliverable" };
  const decode = (extra: Record<string, unknown>) =>
    decodeOutcomeThreadInput("SavePlan", {
      expectedRevision: 1,
      tasks: [{ ...task, ...extra }],
      clientRequestId: "plan:schedule-1",
    });

  // Plans written before scheduling still decode, and carry none of the new fields.
  expect(decode({}).tasks[0]).not.toHaveProperty("startAt");

  const scheduled = decode({ startAt: "2026-12-01T09:00:00+08:00", dueAt: "2026-12-05T09:00:00+08:00", estimateMinutes: 90 });
  expect(scheduled.tasks[0]).toMatchObject({
    startAt: "2026-12-01T09:00:00+08:00",
    dueAt: "2026-12-05T09:00:00+08:00",
    estimateMinutes: 90,
  });

  // The schema only checks shape. Whether a string is a real offset timestamp, and whether due precedes start,
  // is decided by validatePlanSchedule so the rule lives in one place (the server answers invalid_schedule).
  expect(() => decode({ startAt: 5 })).toThrow();
  expect(() => decode({ dueAt: ["x"] })).toThrow();
  expect(() => decode({ estimateMinutes: "90" })).toThrow();
  expect(() => decode({ estimateMinutes: 1.5 })).toThrow();
  expect(() => decode({ startAt: "x".repeat(200) })).toThrow();
});

test("the SavePlan tool the planner sees lists start, due and estimate as optional and says what they mean", () => {
  const tool = OUTCOME_GOAL_THREAD_TOOLS.find((entry) => entry.name === "SavePlan")!;
  const schema = JSON.stringify(tool.inputSchema);
  for (const field of ["startAt", "dueAt", "estimateMinutes"]) expect(schema).toContain(field);
  // Optional: not among a task's required fields.
  const taskRequired = JSON.stringify(tool.inputSchema).match(/"required":\[([^\]]*)\]/g)?.join(" ") ?? "";
  expect(taskRequired).not.toContain('"startAt"');
  expect(taskRequired).not.toContain('"estimateMinutes"');
  // The description carries the meaning, so the planner does not have to infer it from the field names.
  expect(tool.description).toMatch(/startAt/);
  expect(tool.description).toMatch(/not before|does not start earlier|earliest/i);
  expect(tool.description).toMatch(/estimateMinutes/);
  expect(tool.description.replace(/ISO 8601|UTC/g, "")).not.toMatch(/mail|visit|inspect|customer|sender/i);
});
