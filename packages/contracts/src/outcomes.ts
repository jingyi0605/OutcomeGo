import { JSONSchema, Schema } from "effect";

/**
 * Outcome planning, contract, execution and review contracts (specs/004.2).
 * Agent work items run as Outcome sub-threads under the executing bot (specs/004 design §45).
 */

// ---------------------------------------------------------------------------
// Limits (004.2 design §16.2)
// ---------------------------------------------------------------------------

export const OUTCOME_PLANNING_DIMENSIONS = ["goal", "acceptance", "boundaries"] as const;
export type OutcomePlanningDimension = (typeof OUTCOME_PLANNING_DIMENSIONS)[number];

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
  /** Concurrent Outcome sub-threads per executing bot (D13). */
  threadsPerBot: 2,
} as const;

// ---------------------------------------------------------------------------
// States (specs/004 design §42)
// ---------------------------------------------------------------------------

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

/** Highest first; the server derives Outcome status from facts in this order (design §42.3). */
export const OUTCOME_STATUS_PRIORITY: readonly OutcomeStatus[] = [
  "cancelled",
  "accepted",
  "paused",
  "decision_pending",
  "human_action_pending",
  "review_pending",
  "failed",
  "running",
  "approved",
  "pending_approval",
  "planning",
  "draft",
];

export const OUTCOME_TERMINAL_STATUSES: readonly OutcomeStatus[] = ["accepted", "cancelled"];

export const CONTRACT_REVISION_STATUSES = ["draft", "pending_approval", "approved", "superseded", "closed"] as const;
export type ContractRevisionStatus = (typeof CONTRACT_REVISION_STATUSES)[number];

export const AGENT_WORK_ITEM_STATUSES = [
  "queued",
  "running",
  "waiting_decision",
  "waiting_human",
  "retry_pending",
  "needs_review",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AgentWorkItemStatus = (typeof AGENT_WORK_ITEM_STATUSES)[number];

/** Human work item states (specs/004.4 design §16). */
export const HUMAN_WORK_ITEM_STATUSES = [
  "pending",
  "ready",
  "in_progress",
  "paused",
  "submitted",
  "review_pending",
  "accepted",
  "rejected",
  "cancelled",
] as const;
export type HumanWorkItemStatus = (typeof HUMAN_WORK_ITEM_STATUSES)[number];

export type WorkItemStatus = AgentWorkItemStatus | HumanWorkItemStatus;

export const AGENT_WORK_ITEM_ACTIVE_STATUSES: readonly AgentWorkItemStatus[] = [
  "queued",
  "running",
  "waiting_decision",
  "waiting_human",
  "retry_pending",
  "needs_review",
];

export const WORK_ITEM_EXECUTOR_TYPES = ["agent", "human"] as const;
export type WorkItemExecutorType = (typeof WORK_ITEM_EXECUTOR_TYPES)[number];

export const WORK_ITEM_KINDS = ["initial", "rework", "supplement", "human_action"] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

export const PLANNING_DRAFT_STATUSES = ["ready", "failed", "consumed", "expired"] as const;
export type PlanningDraftStatus = (typeof PLANNING_DRAFT_STATUSES)[number];

export const VERIFICATION_METHODS = ["human_review", "deterministic_check"] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const REVIEW_RESULTS = ["PASS", "FAIL", "UNVERIFIED", "WAIVED_BY_APPROVED_CHANGE"] as const;
export type ReviewResult = (typeof REVIEW_RESULTS)[number];

export const EVIDENCE_CREDIBILITY = [
  "deterministic_check",
  "human_confirmed",
  "external_record",
  "agent_report",
  "ai_prereview",
] as const;
export type EvidenceCredibility = (typeof EVIDENCE_CREDIBILITY)[number];

/** Evidence that cannot on its own support PASS on a required criterion (D07, 004.2 requirement 18). */
export const ADVISORY_EVIDENCE_CREDIBILITY: readonly EvidenceCredibility[] = ["agent_report", "ai_prereview"];

export const EVIDENCE_SOURCE_TYPES = ["output", "asset", "file", "message", "url", "receipt", "check", "prereview"] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const OUTPUT_KINDS = ["final_result", "file"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export const PLANNING_CONFLICT_CODES = [
  "goal_boundary_conflict",
  "acceptance_boundary_conflict",
  "duplicate_selection",
  "missing_acceptance",
  "ambiguous_scope",
] as const;
export type PlanningConflictCode = (typeof PLANNING_CONFLICT_CODES)[number];

// ---------------------------------------------------------------------------
// Events (specs/004 design §14) — the only Outcome event names.
// ---------------------------------------------------------------------------

export const OUTCOME_EVENT_TOPICS = [
  "outcome.created",
  "outcome.status_changed",
  "outcome.contract.revision_created",
  "outcome.contract.revision_approved",
  "outcome.work_item.created",
  "outcome.work_item.updated",
  "outcome.progress.updated",
  "outcome.output.recorded",
  "outcome.review.required",
  "outcome.review.recorded",
  "outcome.decision.required",
  "outcome.decision.resolved",
  "outcome.decision.closed",
  "outcome.human_action.required",
  "outcome.human_receipt.submitted",
  "outcome.accepted",
  "outcome.recovered",
] as const;
export type OutcomeEventTopic = (typeof OUTCOME_EVENT_TOPICS)[number];
export const OUTCOME_EVENT_SCHEMA_VERSION = 1;

export const OUTCOME_THREAD_TOOL_NAMES = ["RequestOutcomeDecision", "RequestHumanAction", "ReportOutcomeProgress"] as const;
export type OutcomeThreadToolName = (typeof OUTCOME_THREAD_TOOL_NAMES)[number];

export const OUTCOME_TASK_STEP_STATUSES = ["pending", "in_progress", "completed", "blocked"] as const;
export type OutcomeTaskStepStatus = (typeof OUTCOME_TASK_STEP_STATUSES)[number];

export interface OutcomeTaskStep {
  id: string;
  title: string;
  status: OutcomeTaskStepStatus;
  summary?: string;
}

export interface OutcomeWorkItemProgress {
  phase: string;
  summary?: string;
  tasks: OutcomeTaskStep[];
  updatedAt: string;
}

export const OutcomeTaskStepInput = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  status: Schema.Literal(...OUTCOME_TASK_STEP_STATUSES),
  summary: Schema.optional(Schema.String.pipe(Schema.maxLength(300))),
});

export const ReportOutcomeProgressInput = Schema.Struct({
  phase: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  summary: Schema.optional(Schema.String.pipe(Schema.maxLength(500))),
  tasks: Schema.Array(OutcomeTaskStepInput).pipe(Schema.minItems(1), Schema.maxItems(30)),
});
export type ReportOutcomeProgressInput = typeof ReportOutcomeProgressInput.Type;

export const REPORT_OUTCOME_PROGRESS_TOOL = {
  name: "ReportOutcomeProgress",
  description:
    "Update the current execution phase/stage and structured task list for this Outcome work item. Call this at the start of execution to publish your task breakdown, and update it promptly whenever the phase changes or a task starts, completes, or becomes blocked.",
  inputSchema: JSONSchema.make(ReportOutcomeProgressInput),
} as const;

export function parseOutcomeWorkItemProgress(value: unknown): OutcomeWorkItemProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.phase !== "string" || !raw.phase.trim() || !Array.isArray(raw.tasks) || typeof raw.updatedAt !== "string") {
    return null;
  }
  const tasks: OutcomeTaskStep[] = [];
  for (const item of raw.tasks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const step = item as Record<string, unknown>;
    if (
      typeof step.id !== "string" ||
      typeof step.title !== "string" ||
      !(OUTCOME_TASK_STEP_STATUSES as readonly unknown[]).includes(step.status)
    ) {
      return null;
    }
    tasks.push({
      id: step.id,
      title: step.title,
      status: step.status as OutcomeTaskStepStatus,
      ...(typeof step.summary === "string" && step.summary.trim() ? { summary: step.summary } : {}),
    });
  }
  return {
    phase: raw.phase,
    ...(typeof raw.summary === "string" && raw.summary.trim() ? { summary: raw.summary } : {}),
    tasks,
    updatedAt: raw.updatedAt,
  };
}

export type DecisionEffect = "plan_only" | "scope_change" | "acceptance_change" | "cancel_branch" | "manual_action";

/** Payloads live inside the existing Event envelope; identifiers common to all events stay in that envelope. */
export interface OutcomeEventPayloads {
  "outcome.created": { title: string; botId: string };
  "outcome.status_changed": { from: OutcomeStatus; to: OutcomeStatus };
  "outcome.contract.revision_created": {
    revisionId: string; status: ContractRevisionStatus; baseRevisionId: string | null; sourceDecisionId: string | null;
  };
  "outcome.contract.revision_approved": { revisionId: string; contentHash: string };
  "outcome.work_item.created": { workItemId: string; executorType: WorkItemExecutorType; kind: WorkItemKind };
  "outcome.work_item.updated": { from: WorkItemStatus; to: WorkItemStatus; reason: string };
  "outcome.progress.updated": { workItemId: string; phase: string; completedCount: number; totalCount: number };
  "outcome.output.recorded": { outputId: string; kind: OutputKind };
  "outcome.review.required": { criterionIds: string[]; workItemIds: string[] };
  "outcome.review.recorded": { reviewId: string; criterionId: string; result: ReviewResult; evidenceIds: string[] };
  "outcome.decision.required": { decisionId: string; reasonCode: string };
  "outcome.decision.resolved": { decisionId: string; resolutionEffect: DecisionEffect; optionId: string | null; customText: string | null };
  "outcome.decision.closed": { decisionId: string; reason: "expired" | "withdrawn" };
  "outcome.human_action.required": { workItemId: string; cardId: string; requestedByWorkItemId: string; decisionId: string | null };
  "outcome.human_receipt.submitted": { workItemId: string; receiptId: string; evidenceIds: string[] };
  "outcome.accepted": { revisionId: string; reviewIds: string[] };
  "outcome.recovered": { workItemId: string; action: "resettle" | "resume_queued" | "needs_review" | "cancelled"; reason: string };
}

export interface OutcomeEventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  eventType: OutcomeEventTopic;
  schemaVersion: number;
  occurredAt: string;
  outcomeId: string;
  contractRevision?: number;
  workItemId?: string;
  runId?: string;
  actorId: string;
  correlationId: string;
  idempotencyKey?: string;
  payload: T;
}

export const isOutcomeEventTopic = (topic: string): topic is OutcomeEventTopic =>
  (OUTCOME_EVENT_TOPICS as readonly string[]).includes(topic);

// ---------------------------------------------------------------------------
// Errors (specs/004 design §15, 004.2 design §20)
// ---------------------------------------------------------------------------

export const OUTCOME_ERROR_CODES = {
  outcome_not_found: 404,
  contract_revision_not_found: 404,
  work_item_not_found: 404,
  planning_draft_not_found: 404,
  planning_generation_failed: 502,
  planning_draft_expired: 409,
  planning_option_not_found: 409,
  planning_option_limit_exceeded: 400,
  planning_input_too_large: 400,
  planning_conflict: 409,
  superseded_revision: 409,
  contract_revision_conflict: 409,
  contract_revision_not_approved: 409,
  invalid_outcome_transition: 409,
  idempotency_conflict: 409,
  request_in_progress: 409,
  bot_not_runnable: 409,
  rework_not_allowed: 409,
  evidence_missing: 422,
  review_revision_conflict: 409,
  review_incomplete: 422,
  invalid_outcome_query: 400,
  manual_action_unavailable: 503,
} as const;
export type OutcomeErrorCode = keyof typeof OUTCOME_ERROR_CODES;

/** Shared-library error; the server maps it to `ApiError` with the same status and code. */
export class OutcomeError extends Error {
  readonly status: number;
  constructor(
    readonly code: OutcomeErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "OutcomeError";
    this.status = OUTCOME_ERROR_CODES[code];
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlanningOption {
  id: string;
  text: string;
  recommended?: boolean;
  reason?: string;
  /** Acceptance options: whether the model proposed the criterion as required. */
  required?: boolean;
  /** Boundary options: included or excluded scope. */
  kind?: "included" | "excluded";
}

export interface PlanningDimensionView {
  options: PlanningOption[];
  selectedOptionIds: string[];
  customEntries: string[];
}

export interface PlanningConflict {
  code: PlanningConflictCode;
  severity: "blocking" | "informational";
  dimensions: OutcomePlanningDimension[];
  message: string;
  resolutionHint?: string;
}

export interface PlanningDraftView {
  planId: string;
  status: PlanningDraftStatus;
  sourceText: string;
  botId: string;
  goal: PlanningDimensionView;
  acceptance: PlanningDimensionView;
  boundaries: PlanningDimensionView;
  conflicts: PlanningConflict[];
  generatedAt: string;
  expiresAt: string;
  error?: { code: string; retryable: boolean };
}

/** Stable option IDs within one draft snapshot: `goal-1`, `acceptance-2`, `boundaries-1`. */
export const planningOptionId = (dimension: OutcomePlanningDimension, index: number) => `${dimension}-${index + 1}`;

export interface ConfirmedAcceptanceCriterion {
  statement: string;
  required: boolean;
  verificationMethod: VerificationMethod;
}

export interface ConfirmedContract {
  goal: string[];
  acceptance: ConfirmedAcceptanceCriterion[];
  boundaries: { included: string[]; excluded: string[] };
  budget: OutcomeBudget | null;
}

export interface OutcomeBudget {
  timeLimitMinutes: number | null;
  costLimit: number | null;
}

/** Advisory presentation only. Status and mutations always come from business records. */
export interface OutcomeBriefItem {
  title: string;
  explanation: string;
  quote: string;
}
export interface OutcomeBrief {
  outcomeId: string;
  revisionId: string | null;
  sourceKey: string;
  background: OutcomeBriefItem;
  intent: OutcomeBriefItem;
  prerequisites: OutcomeBriefItem[];
  risks: OutcomeBriefItem[];
  proposedTasks: OutcomeBriefItem[];
}

/** Includes content, so a response for a prior revision or description cannot be reused. */
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

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();

const confirmedTextLength = (contract: ConfirmedContract) =>
  [
    ...contract.goal,
    ...contract.acceptance.map((criterion) => criterion.statement),
    ...contract.boundaries.included,
    ...contract.boundaries.excluded,
  ].reduce((total, text) => total + text.length, 0);

/**
 * Resolves a user's selections against the server-held draft snapshot (004.2 design §17).
 * Option IDs that are not in the snapshot are rejected; client-supplied option text is never read.
 */
export function resolvePlanningSelections(
  draft: Pick<PlanningDraftView, "goal" | "acceptance" | "boundaries">,
  selections: Record<OutcomePlanningDimension, { selectedOptionIds: readonly string[]; customEntries: readonly string[] }>,
  budget: OutcomeBudget | null = null
): ConfirmedContract {
  const picked = {} as Record<OutcomePlanningDimension, PlanningOption[]>;
  const custom = {} as Record<OutcomePlanningDimension, string[]>;
  for (const dimension of OUTCOME_PLANNING_DIMENSIONS) {
    const selection = selections[dimension];
    if (selection.selectedOptionIds.length > OUTCOME_LIMITS.selectedPerDimension)
      throw new OutcomeError("planning_option_limit_exceeded", `Select at most ${OUTCOME_LIMITS.selectedPerDimension} ${dimension} options`, { dimension });
    if (selection.customEntries.length > OUTCOME_LIMITS.customEntriesPerDimension)
      throw new OutcomeError("planning_option_limit_exceeded", `Add at most ${OUTCOME_LIMITS.customEntriesPerDimension} custom ${dimension} entries`, { dimension });
    const byId = new Map(draft[dimension].options.map((option) => [option.id, option]));
    picked[dimension] = [...new Set(selection.selectedOptionIds)].map((id) => {
      const option = byId.get(id);
      if (!option) throw new OutcomeError("planning_option_not_found", `Option ${id} is not part of this plan`, { dimension, optionId: id });
      return option;
    });
    custom[dimension] = selection.customEntries.map((entry) => {
      const text = normalizeText(entry);
      if (text.length > OUTCOME_LIMITS.customEntryChars)
        throw new OutcomeError("planning_input_too_large", `A custom ${dimension} entry exceeds ${OUTCOME_LIMITS.customEntryChars} characters`, { dimension });
      return text;
    }).filter(Boolean);
  }
  const contract: ConfirmedContract = {
    goal: [...picked.goal.map((option) => option.text), ...custom.goal],
    acceptance: [
      ...picked.acceptance.map((option) => ({ statement: option.text, required: option.required !== false, verificationMethod: "human_review" as const })),
      // A criterion the user wrote is one they want met.
      ...custom.acceptance.map((statement) => ({ statement, required: true, verificationMethod: "human_review" as const })),
    ],
    boundaries: {
      included: [
        ...picked.boundaries.filter((option) => option.kind !== "excluded").map((option) => option.text),
        ...custom.boundaries.filter((entry) => !isExclusion(entry)),
      ],
      excluded: [
        ...picked.boundaries.filter((option) => option.kind === "excluded").map((option) => option.text),
        ...custom.boundaries.filter(isExclusion).map(stripExclusion),
      ],
    },
    budget,
  };
  if (confirmedTextLength(contract) > OUTCOME_LIMITS.confirmedTextChars)
    throw new OutcomeError("planning_input_too_large", `The confirmed contract exceeds ${OUTCOME_LIMITS.confirmedTextChars} characters`);
  return contract;
}

// A custom boundary written as "不…/禁止…/do not…/no …" excludes scope.
const EXCLUSION = /^(?:不|禁止|不得|不要|排除|do not\b|don't\b|no\b|never\b|exclude\b)/i;
const isExclusion = (text: string) => EXCLUSION.test(text);
const stripExclusion = (text: string) => text.replace(/^(?:exclude\b:?\s*)/i, "").trim() || text;

/** Planning conflicts the server can detect without a model (004.2 design §16.3). */
export function detectPlanningConflicts(contract: ConfirmedContract): PlanningConflict[] {
  const conflicts: PlanningConflict[] = [];
  if (!contract.goal.length)
    conflicts.push({ code: "ambiguous_scope", severity: "blocking", dimensions: ["goal"], message: "Choose or write at least one goal." });
  if (!contract.acceptance.some((criterion) => criterion.required))
    conflicts.push({ code: "missing_acceptance", severity: "blocking", dimensions: ["acceptance"], message: "Add at least one required acceptance criterion." });
  for (const dimension of OUTCOME_PLANNING_DIMENSIONS) {
    const texts =
      dimension === "goal"
        ? contract.goal
        : dimension === "acceptance"
          ? contract.acceptance.map((criterion) => criterion.statement)
          : [...contract.boundaries.included, ...contract.boundaries.excluded];
    const seen = new Set<string>();
    for (const text of texts) {
      const key = text.toLowerCase();
      if (seen.has(key)) {
        conflicts.push({ code: "duplicate_selection", severity: "informational", dimensions: [dimension], message: `"${text}" appears more than once.` });
        break;
      }
      seen.add(key);
    }
  }
  const included = new Set(contract.boundaries.included.map((text) => text.toLowerCase()));
  const overlap = contract.boundaries.excluded.find((text) => included.has(text.toLowerCase()));
  if (overlap)
    conflicts.push({ code: "goal_boundary_conflict", severity: "blocking", dimensions: ["boundaries"], message: `"${overlap}" is both included and excluded.` });
  return conflicts;
}

export const hasBlockingConflict = (conflicts: readonly PlanningConflict[]) =>
  conflicts.some((conflict) => conflict.severity === "blocking");

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export interface CriterionReviewState {
  criterionId: string;
  required: boolean;
  result: ReviewResult | null;
  /** Credibility of the evidence attached to the latest review of this criterion. */
  evidenceCredibility: readonly EvidenceCredibility[];
  /** For WAIVED_BY_APPROVED_CHANGE: the waiving revision has been approved. */
  waiverRevisionApproved?: boolean;
  /** The user explicitly confirmed PASS without attachments (allowed for human_review). */
  userConfirmed?: boolean;
}

/** Whether a PASS on a required criterion is backed by non-advisory evidence or explicit user confirmation. */
export const passIsSupported = (state: CriterionReviewState) =>
  state.userConfirmed === true ||
  state.evidenceCredibility.some((credibility) => !ADVISORY_EVIDENCE_CREDIBILITY.includes(credibility));

/** All required criteria are satisfied (004.2 design §25). */
export function requiredCriteriaSatisfied(criteria: readonly CriterionReviewState[]): boolean {
  const required = criteria.filter((criterion) => criterion.required);
  return required.length > 0 && required.every((criterion) =>
    (criterion.result === "PASS" && passIsSupported(criterion)) ||
    (criterion.result === "WAIVED_BY_APPROVED_CHANGE" && criterion.waiverRevisionApproved === true));
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface AcceptanceCriterionView {
  id: string;
  ordinal: number;
  statement: string;
  required: boolean;
  verificationMethod: VerificationMethod;
  latestResult: ReviewResult | null;
}

export interface ContractRevisionView {
  id: string;
  revision: number;
  status: ContractRevisionStatus;
  goal: string[];
  boundaries: { included: string[]; excluded: string[] };
  budget: OutcomeBudget | null;
  executionBotId: string;
  changeSummary: string | null;
  /** Omitted by servers predating revision provenance in the detail response. */
  baseRevisionId?: string | null;
  sourceDecisionId: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  conflicts: PlanningConflict[];
  criteria: AcceptanceCriterionView[];
  createdAt: string;
}

export interface WorkItemView {
  id: string;
  contractRevision: number;
  executorType: WorkItemExecutorType;
  kind: WorkItemKind;
  title: string;
  status: WorkItemStatus;
  statusReason: string | null;
  progress?: OutcomeWorkItemProgress | null;
  ordinal: number;
  dependsOn: string[];
  rootRunId: string | null;
  runIds: string[];
  reworkOfWorkItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutputView {
  id: string;
  workItemId: string;
  runId: string | null;
  kind: OutputKind;
  title: string;
  content: string | null;
  contentRef: string | null;
  createdAt: string;
}

export interface EvidenceView {
  id: string;
  criterionId: string | null;
  contractRevision: number;
  workItemId: string | null;
  runId: string | null;
  sourceType: EvidenceSourceType;
  sourceRef: string;
  contentSummary: string;
  credibility: EvidenceCredibility;
  capturedBy: string;
  capturedAt: string;
}

export interface ReviewView {
  id: string;
  criterionId: string;
  contractRevision: number;
  sequence: number;
  result: ReviewResult;
  evidenceIds: string[];
  comment: string;
  reviewedBy: string;
  reviewedAt: string;
}

export interface OutcomeSummary {
  id: string;
  title: string;
  status: OutcomeStatus;
  botId: string;
  currentRevision: number | null;
  updatedAt: string;
}

export interface OutcomeDetail extends OutcomeSummary {
  /** Present when this independent delivery was created from an Explore planning draft. */
  sourceExploreId?: string | null;
  description: string;
  resumeStatus: OutcomeStatus | null;
  createdAt: string;
  acceptedAt: string | null;
  currentRevisionView: ContractRevisionView | null;
  revisions: Array<
    Pick<ContractRevisionView, "id" | "revision" | "status" | "changeSummary" | "createdAt"> &
    Partial<Pick<ContractRevisionView, "baseRevisionId" | "sourceDecisionId" | "createdBy">>
  >;
  workItems: WorkItemView[];
  outputs: OutputView[];
  evidence: EvidenceView[];
  reviews: ReviewView[];
}

export interface OutcomeListPage {
  items: OutcomeSummary[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Request bodies (004.2 requirements “API 合同需求”, design §19)
// ---------------------------------------------------------------------------

const ClientRequestId = Schema.String.pipe(Schema.minLength(8), Schema.maxLength(200));
const Uuid = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
const RevisionNumber = Schema.Number.pipe(Schema.int(), Schema.positive());
const OptionalText = (max: number) => Schema.optional(Schema.String.pipe(Schema.maxLength(max)));

const PlanningSelection = Schema.Struct({
  selectedOptionIds: Schema.Array(Schema.String.pipe(Schema.maxLength(40))).pipe(Schema.maxItems(OUTCOME_LIMITS.optionsPerDimension)),
  customEntries: Schema.Array(Schema.String.pipe(Schema.maxLength(OUTCOME_LIMITS.customEntryChars))).pipe(
    Schema.maxItems(OUTCOME_LIMITS.customEntriesPerDimension)
  ),
});

export const OutcomeBudgetInput = Schema.Struct({
  timeLimitMinutes: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.lessThanOrEqualTo(60 * 24 * 365))),
  costLimit: Schema.NullOr(Schema.Number.pipe(Schema.positive(), Schema.lessThanOrEqualTo(1_000_000_000))),
});

export const CreateOutcomePlanInput = Schema.Struct({
  sourceText: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.sourceTextChars)),
  context: Schema.Struct({ botId: Uuid }),
  clientRequestId: ClientRequestId,
});
export type CreateOutcomePlanInput = typeof CreateOutcomePlanInput.Type;

export const CreateOutcomeInput = Schema.Struct({
  planId: Uuid,
  goal: PlanningSelection,
  acceptance: PlanningSelection,
  boundaries: PlanningSelection,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.titleChars)),
  budget: Schema.optional(Schema.NullOr(OutcomeBudgetInput)),
  clientRequestId: ClientRequestId,
});
export type CreateOutcomeInput = typeof CreateOutcomeInput.Type;

const ContractText = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.customEntryChars));

export const CreateContractRevisionInput = Schema.Struct({
  baseRevision: RevisionNumber,
  contract: Schema.Struct({
    goal: Schema.Array(ContractText).pipe(Schema.minItems(1), Schema.maxItems(8)),
    acceptance: Schema.Array(Schema.Struct({ statement: ContractText, required: Schema.Boolean })).pipe(
      Schema.minItems(1),
      Schema.maxItems(20)
    ),
    boundaries: Schema.Struct({
      included: Schema.Array(ContractText).pipe(Schema.maxItems(20)),
      excluded: Schema.Array(ContractText).pipe(Schema.maxItems(20)),
    }),
    budget: Schema.NullOr(OutcomeBudgetInput),
  }),
  changeSummary: OptionalText(OUTCOME_LIMITS.changeSummaryChars),
  sourceDecisionId: Schema.optional(Schema.NullOr(Uuid)),
  clientRequestId: ClientRequestId,
});
export type CreateContractRevisionInput = typeof CreateContractRevisionInput.Type;

export const ApproveContractRevisionInput = Schema.Struct({
  expectedRevision: RevisionNumber,
  confirmationText: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.confirmationTextChars)),
  clientRequestId: ClientRequestId,
});
export type ApproveContractRevisionInput = typeof ApproveContractRevisionInput.Type;

export const StartOutcomeRunInput = Schema.Struct({
  expectedRevision: RevisionNumber,
  clientRequestId: ClientRequestId,
});
export type StartOutcomeRunInput = typeof StartOutcomeRunInput.Type;

export const SubmitOutcomeReviewInput = Schema.Struct({
  expectedRevision: RevisionNumber,
  results: Schema.Array(
    Schema.Struct({
      criterionId: Uuid,
      result: Schema.Literal(...REVIEW_RESULTS),
      evidenceIds: Schema.Array(Uuid).pipe(Schema.maxItems(OUTCOME_LIMITS.evidencePerReview)),
      comment: Schema.String.pipe(Schema.maxLength(OUTCOME_LIMITS.commentChars)),
      userConfirmed: Schema.optional(Schema.Boolean),
    })
  ).pipe(Schema.minItems(1), Schema.maxItems(OUTCOME_LIMITS.reviewResultsPerRequest)),
  newEvidence: Schema.optional(
    Schema.Array(
      Schema.Struct({
        criterionId: Uuid,
        sourceType: Schema.Literal("asset", "file", "message", "url", "check"),
        sourceRef: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2_000)),
        contentSummary: Schema.String.pipe(Schema.maxLength(OUTCOME_LIMITS.commentChars)),
      })
    ).pipe(Schema.maxItems(OUTCOME_LIMITS.evidencePerReview))
  ),
  clientRequestId: ClientRequestId,
});
export type SubmitOutcomeReviewInput = typeof SubmitOutcomeReviewInput.Type;

export const OutcomeReworkInput = Schema.Struct({
  criterionIds: Schema.Array(Uuid).pipe(Schema.minItems(1), Schema.maxItems(20)),
  comment: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.commentChars)),
  expectedRevision: RevisionNumber,
  clientRequestId: ClientRequestId,
});
export type OutcomeReworkInput = typeof OutcomeReworkInput.Type;

export const CancelOutcomeInput = Schema.Struct({ clientRequestId: ClientRequestId });
export type CancelOutcomeInput = typeof CancelOutcomeInput.Type;

export interface ListOutcomesQuery {
  statuses: OutcomeStatus[];
  query?: string;
  cursor: { updatedAt: string; id: string } | null;
  limit: number;
}

/** Parses `GET /api/v0/outcomes` query parameters; the cursor is `<updatedAt ISO>|<id>` in base64url. */
export function parseListOutcomesQuery(params: URLSearchParams): ListOutcomesQuery {
  const statuses = params.getAll("status").flatMap((value) => value.split(",")).filter(Boolean);
  for (const status of statuses)
    if (!(OUTCOME_STATUSES as readonly string[]).includes(status))
      throw new OutcomeError("invalid_outcome_query", `Unknown status ${status}`, { field: "status" });
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? OUTCOME_LIMITS.listPageSize : Number(rawLimit);
  const query = params.get("query")?.trim();
  if (query && query.length > 200)
    throw new OutcomeError("invalid_outcome_query", "query must be at most 200 characters", { field: "query" });
  if (!Number.isInteger(limit) || limit < 1) throw new OutcomeError("invalid_outcome_query", "limit must be a positive integer", { field: "limit" });
  return {
    statuses: statuses as OutcomeStatus[],
    ...(query ? { query } : {}),
    cursor: decodeOutcomeCursor(params.get("cursor")),
    limit: Math.min(limit, OUTCOME_LIMITS.listPageSizeMax),
  };
}

// Cursor parts are ASCII (ISO time and UUID), so btoa/atob work in Bun and browsers alike.
const toBase64Url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => {
  try {
    return atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
};

export const encodeOutcomeCursor = (updatedAt: string, id: string) => toBase64Url(`${updatedAt}|${id}`);

export function decodeOutcomeCursor(value: string | null): ListOutcomesQuery["cursor"] {
  if (!value) return null;
  const [updatedAt, id, extra] = fromBase64Url(value).split("|");
  if (extra !== undefined || !updatedAt || !id || Number.isNaN(Date.parse(updatedAt)) || !/^[0-9a-f-]{36}$/i.test(id))
    throw new OutcomeError("invalid_outcome_query", "cursor is invalid", { field: "cursor" });
  return { updatedAt, id };
}
