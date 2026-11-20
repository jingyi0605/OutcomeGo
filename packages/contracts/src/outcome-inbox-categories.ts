export const OUTCOME_INBOX_CATEGORIES = [
  "decision_pending",
  "acceptance_pending",
  "human_action_pending",
  "completed",
] as const;

export type OutcomeInboxCategory = (typeof OUTCOME_INBOX_CATEGORIES)[number];
export const CREDENTIAL_ACCESS_REASON_CODE = "credential_access_required";
