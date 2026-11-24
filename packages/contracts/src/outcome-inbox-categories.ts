export const OUTCOME_INBOX_CATEGORIES = [
  "decision_pending",
  "acceptance_pending",
  "human_action_pending",
  "completed",
] as const;

export type OutcomeInboxCategory = (typeof OUTCOME_INBOX_CATEGORIES)[number];
export const CREDENTIAL_ACCESS_REASON_CODE = "credential_access_required";

/**
 * Specs/004.10: a task released later than planned (past the owner's grace time) that acts on the outside world is
 * not run on its own. The same word is the decision's reason code and the task's status reason while it waits.
 */
export const MISSED_SCHEDULE_REASON_CODE = "missed_schedule";
/** The task's status reason once the owner chose to run it late: it is then released without asking again. */
export const MISSED_SCHEDULE_CONFIRMED_REASON = "missed_schedule_confirmed";
export const MISSED_SCHEDULE_OPTION_IDS = { runNow: "run_now", waitForReschedule: "wait_for_reschedule" } as const;
