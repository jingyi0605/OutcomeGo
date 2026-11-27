import {
  OUTCOME_KINDS,
  OUTCOME_STATUSES_BY_KIND,
  type OutcomeKind,
  type OutcomeStatus,
} from "@outcomego/contracts/outcome-state";

export const OUTCOME_KIND_FILTERS = ["all", ...OUTCOME_KINDS] as const;
export type OutcomeKindFilter = (typeof OUTCOME_KIND_FILTERS)[number];
export const ALL_OUTCOME_KINDS = [...OUTCOME_KINDS] as const satisfies readonly OutcomeKind[];

/** The kinds that use the goal dashboard's execution-focused status strip. */
export const GOAL_OUTCOME_KINDS = ["standard", "tracked", "scheduled_once"] as const;

export const GOAL_OUTCOME_STATUSES: readonly OutcomeStatus[] = [
  ...new Set(GOAL_OUTCOME_KINDS.flatMap((kind): readonly OutcomeStatus[] => OUTCOME_STATUSES_BY_KIND[kind])),
];

export const ALL_OUTCOME_STATUSES: readonly OutcomeStatus[] = [
  ...new Set(ALL_OUTCOME_KINDS.flatMap((kind): readonly OutcomeStatus[] => OUTCOME_STATUSES_BY_KIND[kind])),
];
