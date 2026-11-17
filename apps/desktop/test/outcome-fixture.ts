import type { OutcomeDetail, PlanningDraftView } from "@outcomego/contracts/outcomes";

export const planFixture: PlanningDraftView = {
  planId: "00000000-0000-4000-8000-000000000001", status: "ready", sourceText: "Compare backup plans", botId: "00000000-0000-4000-8000-000000000002",
  goal: { options: [{ id: "goal-1", text: "Recommend a plan", recommended: true, reason: "The request asks for a decision" }, { id: "goal-2", text: "Explain tradeoffs" }], selectedOptionIds: [], customEntries: [] },
  acceptance: { options: [{ id: "acceptance-1", text: "Compare costs", required: true }], selectedOptionIds: [], customEntries: [] },
  boundaries: { options: [{ id: "boundaries-1", text: "Modify production", kind: "excluded" }], selectedOptionIds: [], customEntries: [] },
  conflicts: [{ code: "ambiguous_scope", severity: "informational", dimensions: ["goal"], message: "Which backup plans?" }],
  generatedAt: "2026-11-17T00:00:00.000Z", expiresAt: "2026-11-18T00:00:00.000Z",
};
export const outcomeFixture: OutcomeDetail = {
  id: "outcome-1", title: "Backup comparison", status: "review_pending", botId: planFixture.botId, currentRevision: 1,
  updatedAt: planFixture.generatedAt, description: planFixture.sourceText, resumeStatus: null, createdAt: planFixture.generatedAt, acceptedAt: null,
  currentRevisionView: { id: "revision-1", revision: 1, status: "approved", goal: ["Recommend a plan"], boundaries: { included: ["Public sources"], excluded: ["Modify production"] }, budget: null, executionBotId: planFixture.botId, changeSummary: null, sourceDecisionId: null, createdBy: "owner:local", approvedBy: "owner:local", approvedAt: planFixture.generatedAt, conflicts: [], criteria: [{ id: "criterion-1", ordinal: 1, statement: "Compare costs", required: true, verificationMethod: "human_review", latestResult: "FAIL" }], createdAt: planFixture.generatedAt },
  revisions: [{ id: "revision-1", revision: 1, status: "approved", changeSummary: null, createdAt: planFixture.generatedAt }],
  workItems: [{ id: "item-1", contractRevision: 1, executorType: "agent", kind: "initial", title: "Research backups", status: "completed", statusReason: null, ordinal: 1, dependsOn: [], rootRunId: "run-1", runIds: ["run-1"], reworkOfWorkItemId: null, createdAt: planFixture.generatedAt, updatedAt: planFixture.generatedAt }],
  outputs: [{ id: "output-1", workItemId: "item-1", runId: "run-1", kind: "final_result", title: "Comparison report", content: "Plan A restores faster", contentRef: null, createdAt: planFixture.generatedAt }],
  evidence: [{ id: "evidence-1", criterionId: "criterion-1", contractRevision: 1, workItemId: "item-1", runId: "run-1", sourceType: "output", sourceRef: "output:output-1", contentSummary: "Costs were not compared", credibility: "agent_report", capturedBy: "bot:test", capturedAt: planFixture.generatedAt }],
  reviews: [{ id: "review-1", criterionId: "criterion-1", contractRevision: 1, sequence: 1, result: "FAIL", evidenceIds: ["evidence-1"], comment: "Missing costs", reviewedBy: "owner:local", reviewedAt: planFixture.generatedAt }],
};
