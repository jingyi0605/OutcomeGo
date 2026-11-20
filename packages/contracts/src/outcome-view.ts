import type { CriterionReviewState, EvidenceCredibility, OutcomeDetail } from "./outcomes";

export const OUTCOME_LIMITS = {
  sourceTextChars: 8_000,
  optionsPerDimension: 4,
  optionTextChars: 500,
  optionReasonChars: 500,
  customEntryChars: 2_000,
  customEntriesPerDimension: 4,
  selectedPerDimension: 4,
  confirmedTextChars: 12_000,
  titleChars: 200,
  commentChars: 4_000,
  confirmationTextChars: 500,
  changeSummaryChars: 2_000,
  reviewResultsPerRequest: 100,
  evidencePerReview: 100,
  listPageSize: 20,
  listPageSizeMax: 100,
  threadsPerBot: 2,
} as const;

export const OUTCOME_STATUSES = [
  "draft",
  "planning",
  "pending_approval",
  "approved",
  "running",
  "review_pending",
  "accepted",
  "decision_pending",
  "human_action_pending",
  "paused",
  "failed",
  "cancelled",
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const REVIEW_RESULTS = ["PASS", "FAIL", "UNVERIFIED", "WAIVED_BY_APPROVED_CHANGE"] as const;
export type ReviewResult = (typeof REVIEW_RESULTS)[number];

export const ADVISORY_EVIDENCE_CREDIBILITY: readonly EvidenceCredibility[] = ["agent_report", "ai_prereview"];

export function outcomeBriefSource(outcome: OutcomeDetail): string {
  return JSON.stringify({
    id: outcome.id,
    title: outcome.title,
    description: outcome.description,
    revisionId: outcome.currentRevisionView?.id ?? null,
    goal: outcome.currentRevisionView?.goal ?? [],
    acceptance: outcome.currentRevisionView?.criteria.map(item => ({
      statement: item.statement, required: item.required,
    })) ?? [],
    boundaries: outcome.currentRevisionView?.boundaries ?? { included: [], excluded: [] },
    budget: outcome.currentRevisionView?.budget ?? null,
    conflicts: outcome.currentRevisionView?.conflicts ?? [],
  });
}

export const passIsSupported = (state: CriterionReviewState) =>
  state.userConfirmed === true ||
  state.evidenceCredibility.some((credibility) => !ADVISORY_EVIDENCE_CREDIBILITY.includes(credibility));

export function requiredCriteriaSatisfied(criteria: readonly CriterionReviewState[]): boolean {
  const required = criteria.filter((criterion) => criterion.required);
  return required.length > 0 && required.every((criterion) =>
    (criterion.result === "PASS" && passIsSupported(criterion)) ||
    (criterion.result === "WAIVED_BY_APPROVED_CHANGE" && criterion.waiverRevisionApproved === true));
}
