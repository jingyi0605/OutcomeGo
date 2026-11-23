import { expect, test } from "bun:test";
import {
  composeConclusion,
  decodeOutcomeThreadInput,
  goalThreadToolsForPurpose,
  OUTCOME_GOAL_THREAD_TOOLS,
} from "../src/outcome-thread";
import { isOutcomeEventTopic, OUTCOME_EVENT_TOPICS } from "../src/outcomes";

test("goal thread tools enforce purpose whitelists and exclude decision/credential/contract-approval tools", () => {
  for (const purpose of ["plan", "replan"] as const) {
    expect(goalThreadToolsForPurpose(purpose)).toEqual([
      "SaveOutcomeContract",
      "SavePlan",
      "CancelOutcome",
      "GetOutcome",
      "ListOutcomes",
    ]);
  }
  expect(goalThreadToolsForPurpose("owner_message")).toEqual([
    "SaveOutcomeContract",
    "SavePlan",
    "AcceptOutcome",
    "RequestOutcomeRework",
    "CancelOutcome",
    "GetOutcome",
    "ListOutcomes",
  ]);
  expect(goalThreadToolsForPurpose("review")).toEqual(["GetOutcome", "SubmitPrereview"]);
  expect(goalThreadToolsForPurpose("review_task")).toEqual(["GetOutcome", "ReviewTaskResult"]);

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
