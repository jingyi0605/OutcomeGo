export const OUTCOME_LIMITS = {
  sourceTextChars: 8_000,
  optionTextChars: 500,
  optionReasonChars: 500,
  customEntryChars: 2_000,
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

export const PLAN_ESTIMATE_MINUTES = { min: 1, max: 10_080 } as const;

const STANDARD_OUTCOME_STATUSES = [
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

export const OUTCOME_KINDS = ["standard", "tracked", "scheduled_once", "todo", "explore_idea", "note"] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export const OUTCOME_STATUSES = [
  ...STANDARD_OUTCOME_STATUSES,
  "scheduled", "preparing", "suggested", "open", "waiting", "exploring", "active", "archived",
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const OUTCOME_STATUSES_BY_KIND = {
  standard: STANDARD_OUTCOME_STATUSES,
  tracked: ["running", "decision_pending", "accepted", "cancelled"],
  scheduled_once: ["scheduled", "preparing", "running", "paused", "failed", "accepted", "cancelled"],
  todo: ["suggested", "open", "waiting", "accepted", "cancelled"],
  explore_idea: ["draft", "exploring", "cancelled"],
  note: ["active", "archived", "cancelled"],
} as const satisfies Record<OutcomeKind, readonly OutcomeStatus[]>;
export type OutcomeStatusFor<Kind extends OutcomeKind> = (typeof OUTCOME_STATUSES_BY_KIND)[Kind][number];

export const isOutcomeStatusForKind = <Kind extends OutcomeKind>(kind: Kind, status: OutcomeStatus): status is OutcomeStatusFor<Kind> =>
  (OUTCOME_STATUSES_BY_KIND[kind] as readonly OutcomeStatus[]).includes(status);

export const OUTCOME_KINDS_REQUIRING_BOT = ["standard", "tracked", "scheduled_once"] as const;
export const outcomeKindRequiresBot = (kind: OutcomeKind): kind is (typeof OUTCOME_KINDS_REQUIRING_BOT)[number] =>
  (OUTCOME_KINDS_REQUIRING_BOT as readonly OutcomeKind[]).includes(kind);
import type { OutcomeWorkThreadView, WorkItemStatus } from "./outcomes";


export const workThreadIsFinished = (status: WorkItemStatus) =>
  status === "completed" || status === "accepted" || status === "failed" || status === "cancelled";

export const workThreadCanStop = (thread: Pick<OutcomeWorkThreadView, "status" | "waitingOnDependency">) =>
  !workThreadIsFinished(thread.status) && !thread.waitingOnDependency;
