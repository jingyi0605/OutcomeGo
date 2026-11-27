import { Schema } from "effect";
import { AssetRef } from "./asset-ref";
import type { CriterionReviewState, EvidenceCredibility, OutcomeDetail } from "./outcomes";
import { OUTCOME_KINDS, OUTCOME_LIMITS, OUTCOME_STATUSES, OUTCOME_STATUSES_BY_KIND, type OutcomeKind } from "./outcome-state";

export * from "./outcome-state";

export const OutcomeKindSchema = Schema.Literal(...OUTCOME_KINDS);
export const OutcomeStatusSchema = Schema.Literal(...OUTCOME_STATUSES);

export const OutcomeUrgencySchema = Schema.Literal("low", "normal", "high");
export type OutcomeUrgency = typeof OutcomeUrgencySchema.Type;
export const OutcomeExecutorSchema = Schema.Literal("owner", "bot");
export type OutcomeExecutor = typeof OutcomeExecutorSchema.Type;

export const Uuid = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i));

export const OutcomeBudgetInput = Schema.Struct({
  timeLimitMinutes: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.lessThanOrEqualTo(60 * 24 * 365))),
  costLimit: Schema.NullOr(Schema.Number.pipe(Schema.positive(), Schema.lessThanOrEqualTo(1_000_000_000))),
});

const OFFSET_TIMESTAMP = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseOffsetTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = OFFSET_TIMESTAMP.exec(value);
  if (!match) return null;
  const [, month, day, hour, minute, second] = match.map(Number) as number[];
  if (month! < 1 || month! > 12 || day! < 1 || hour! > 23 || minute! > 59 || second! > 59) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const daysInMonth = new Date(`${value.slice(0, 10)}T00:00:00Z`).getUTCDate();
  return daysInMonth === day ? parsed : null;
}

export const OutcomeInstant = Schema.String.pipe(
  Schema.maxLength(64),
  Schema.filter((value) => parseOffsetTimestamp(value) !== null, { message: () => "Expected an ISO 8601 timestamp with a UTC offset" }),
);

const SourceReference = Schema.Record({ key: Schema.String, value: Schema.Unknown });
export const OutcomeSourceRefSchema = Schema.Union(SourceReference, Schema.Array(SourceReference).pipe(Schema.maxItems(50)));
export type OutcomeSourceRef = typeof OutcomeSourceRefSchema.Type;

const Strict = { parseOptions: { onExcessProperty: "error" } } as const;
const CreatedVia = Schema.Literal("owner_ui", "owner_chat", "agent_turn", "owner_go_inbox");
const provenance = { createdVia: Schema.optional(CreatedVia) };
const nullableId = Schema.optional(Schema.NullOr(Uuid));
const nullableInstant = Schema.optional(Schema.NullOr(OutcomeInstant));

export const OUTCOME_KIND_META_SCHEMAS = {
  standard: Schema.Struct(provenance).annotations(Strict),
  tracked: Schema.Struct(provenance).annotations(Strict),
  scheduled_once: Schema.Struct({
    ...provenance,
    timezone: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100))),
    startedAt: nullableInstant,
    deliveredAt: nullableInstant,
    lastRunId: nullableId,
    resultSummary: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(OUTCOME_LIMITS.changeSummaryChars)))),
  }).annotations(Strict),
  todo: Schema.Struct({
    ...provenance,
    authorizedByMessageId: nullableId,
    autoAcceptRuleId: nullableId,
    autoAcceptRuleName: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(80)))),
    acceptedBy: Schema.optional(Schema.NullOr(Schema.Literal("owner", "rule"))),
    createdByRunId: nullableId,
    createdByRoutineId: nullableId,
    handoffBotId: nullableId,
    handoffMessageId: nullableId,
    expiresAt: nullableInstant,
    ownerMessagePreview: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(OUTCOME_LIMITS.commentChars)))),
    summary: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(300)))),
    dismissReason: Schema.optional(Schema.NullOr(Schema.Literal("owner", "expired"))),
  }).annotations(Strict),
  explore_idea: Schema.Struct({
    ...provenance,
    budget: Schema.optional(Schema.NullOr(OutcomeBudgetInput)),
  }).annotations(Strict),
  note: Schema.Struct({
    ...provenance,
    syncToMemory: Schema.optional(Schema.Boolean),
    triageStatus: Schema.optional(Schema.Literal("pending", "completed", "failed")),
    triageError: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(OUTCOME_LIMITS.commentChars)))),
    memorySummary: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)))),
  }).annotations(Strict),
} satisfies Record<OutcomeKind, Schema.Schema.AnyNoContext>;
export type OutcomeKindMeta<Kind extends OutcomeKind = OutcomeKind> = Schema.Schema.Type<(typeof OUTCOME_KIND_META_SCHEMAS)[Kind]>;

const summaryFields = {
  id: Uuid,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.titleChars)),
  revision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  currentRevision: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
  updatedAt: OutcomeInstant,
  parentOutcomeId: Schema.NullOr(Uuid),
  attachments: Schema.mutable(Schema.Array(AssetRef)),
  tags: Schema.mutable(Schema.Array(Schema.String)),
  urgency: OutcomeUrgencySchema,
  executor: OutcomeExecutorSchema,
  dueAt: Schema.NullOr(OutcomeInstant),
  followUpAt: Schema.NullOr(OutcomeInstant),
  snoozeUntil: Schema.NullOr(OutcomeInstant),
  prereviewStatus: Schema.optional(Schema.Literal("pending", "stale", "unreviewed")),
};

const outcomeSummary = <Kind extends OutcomeKind, BotId extends Schema.Schema.AnyNoContext, ScheduledAt extends Schema.Schema.AnyNoContext>(
  kind: Kind,
  botId: BotId,
  scheduledAt: ScheduledAt,
) => Schema.Struct({
  ...summaryFields,
  kind: Schema.Literal(kind),
  status: Schema.Literal(...OUTCOME_STATUSES_BY_KIND[kind]),
  kindMeta: OUTCOME_KIND_META_SCHEMAS[kind],
  botId,
  scheduledAt,
});

const nullableBotId = Schema.NullOr(Uuid);
const nullableScheduledAt = Schema.NullOr(OutcomeInstant);
export const OutcomeSummarySchema = Schema.Union(
  outcomeSummary("standard", Uuid, nullableScheduledAt),
  outcomeSummary("tracked", Uuid, nullableScheduledAt),
  outcomeSummary("scheduled_once", Uuid, OutcomeInstant),
  outcomeSummary("todo", nullableBotId, nullableScheduledAt),
  outcomeSummary("explore_idea", nullableBotId, nullableScheduledAt),
  outcomeSummary("note", nullableBotId, nullableScheduledAt),
);
export type OutcomeSummary = typeof OutcomeSummarySchema.Type;

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
