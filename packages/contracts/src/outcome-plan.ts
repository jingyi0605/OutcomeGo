import { Schema } from "effect";
import { OUTCOME_LIMITS, OutcomeKindSchema, Uuid } from "./outcome-view";

export const OUTCOME_PLAN_MODES = ["triage", "advice", "contract_plan"] as const;
export const OutcomePlanMode = Schema.Literal(...OUTCOME_PLAN_MODES);
export type OutcomePlanMode = typeof OutcomePlanMode.Type;

export const OUTCOME_THREAD_PURPOSES = ["plan", "owner_message", "replan", "review", "review_task"] as const;
export const OutcomeThreadPurposeSchema = Schema.Literal(...OUTCOME_THREAD_PURPOSES);
export type OutcomeThreadPurpose = typeof OutcomeThreadPurposeSchema.Type;

export const TURN_ACCESS_MODES = ["full", "research_readonly", "readonly_strict"] as const;
export const TurnAccessMode = Schema.Literal(...TURN_ACCESS_MODES);
export type TurnAccessMode = typeof TurnAccessMode.Type;

export function isOutcomeResearchTurn(turn: { purpose: string; planMode?: string | null }): boolean {
  return turn.planMode != null || turn.purpose === "plan" || turn.purpose === "replan" || turn.purpose === "owner_message";
}

export const OutcomeTriageChildKind = Schema.Literal("standard", "scheduled_once", "todo", "explore_idea");
export const OutcomeTriageKind = Schema.Literal(...OutcomeTriageChildKind.literals, "note");

const NonBlank = Schema.String.pipe(Schema.pattern(/\S/));
export const PlanSummary = NonBlank.pipe(Schema.maxLength(2_000));
export const OutcomeTriageMemoryFacts = Schema.Array(NonBlank.pipe(Schema.maxLength(500)));

/** Progressive-disclosure bounds enforced on new SavePlanAdvice writes while stored records remain readable. */
export const PLAN_ADVICE_LIMITS = {
  summaryChars: 160,
  maxFacts: 6,
  factStatementChars: 160,
  factSourceChars: 200,
  maxGaps: 5,
  gapChars: 140,
  maxRecommendations: 5,
  recommendationActionChars: 120,
  recommendationReasonChars: 200,
} as const;

export const PlanAdviceFields = Schema.Struct({
  summary: PlanSummary,
  facts: Schema.Array(Schema.Struct({
    statement: NonBlank,
    source: NonBlank,
    verifiedAt: Schema.optional(NonBlank),
  })),
  gaps: Schema.Array(NonBlank),
  recommendations: Schema.Array(Schema.Struct({
    action: NonBlank,
    needsOwnerConfirm: Schema.Boolean,
    reason: Schema.optional(NonBlank),
  })),
  suggestedKind: Schema.optional(OutcomeTriageKind),
});

export const ConcisePlanAdviceFields = Schema.Struct({
  summary: NonBlank.pipe(Schema.maxLength(PLAN_ADVICE_LIMITS.summaryChars)),
  facts: Schema.Array(Schema.Struct({
    statement: NonBlank.pipe(Schema.maxLength(PLAN_ADVICE_LIMITS.factStatementChars)),
    source: NonBlank.pipe(Schema.maxLength(PLAN_ADVICE_LIMITS.factSourceChars)),
    verifiedAt: Schema.optional(NonBlank),
  })).pipe(Schema.maxItems(PLAN_ADVICE_LIMITS.maxFacts)),
  gaps: Schema.Array(NonBlank.pipe(Schema.maxLength(PLAN_ADVICE_LIMITS.gapChars)))
    .pipe(Schema.maxItems(PLAN_ADVICE_LIMITS.maxGaps)),
  recommendations: Schema.Array(Schema.Struct({
    action: NonBlank.pipe(Schema.maxLength(PLAN_ADVICE_LIMITS.recommendationActionChars)),
    needsOwnerConfirm: Schema.Boolean,
    reason: Schema.optional(NonBlank.pipe(Schema.maxLength(PLAN_ADVICE_LIMITS.recommendationReasonChars))),
  })).pipe(Schema.maxItems(PLAN_ADVICE_LIMITS.maxRecommendations)),
  suggestedKind: Schema.optional(OutcomeTriageKind),
});

export const OutcomePlanAdvice = Schema.Struct({ schemaVersion: Schema.Literal(1), ...PlanAdviceFields.fields });
export type OutcomePlanAdvice = typeof OutcomePlanAdvice.Type;

const decodePlanAdvice = Schema.decodeUnknownOption(OutcomePlanAdvice, { onExcessProperty: "error" });

export function parseOutcomePlanAdvice(input: unknown): OutcomePlanAdvice | null {
  const parsed = decodePlanAdvice(input);
  return parsed._tag === "Some" ? parsed.value : null;
}

const TriageChild = Schema.Struct({
  outcomeId: Uuid,
  kind: OutcomeTriageChildKind,
  title: NonBlank.pipe(Schema.maxLength(OUTCOME_LIMITS.titleChars)),
});

const triageResultFields = {
  schemaVersion: Schema.Literal(1),
  sourceOutcomeId: Uuid,
  memoryFacts: Schema.optional(OutcomeTriageMemoryFacts),
  summary: PlanSummary,
};

export const OutcomeTriageResult = Schema.Union(
  Schema.Struct({
    ...triageResultFields,
    strategy: Schema.Literal("single_convert"),
    sourceKind: OutcomeKindSchema,
    createdChildren: Schema.Tuple(),
  }),
  Schema.Struct({
    ...triageResultFields,
    strategy: Schema.Literal("split_from_note"),
    sourceKind: Schema.Literal("note"),
    createdChildren: Schema.Array(TriageChild).pipe(Schema.minItems(1)),
  }),
);
export type OutcomeTriageResult = typeof OutcomeTriageResult.Type;
