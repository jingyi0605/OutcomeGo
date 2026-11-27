import { JSONSchema, Schema } from "effect";
import { ListOutcomesFilterInput, validateOutcomeDateRange } from "./outcome-input";
import {
  OUTCOME_LIMITS, PLAN_ESTIMATE_MINUTES, REVIEW_RESULTS, OutcomeBudgetInput, Uuid, parseOffsetTimestamp,
  type OutcomeSourceRef, type OutcomeStatus, type OutcomeStatusFor, type OutcomeSummary, type ReviewResult,
} from "./outcome-view";
import type { OutcomePlanAdvice } from "./outcome-plan";
import type { OutcomeThreadTurnView } from "./outcome-thread";
// Type-only: erased at build time, so it does not create a runtime cycle with index.ts (which re-exports this file).
import type { RunStatus } from "./index";

export * from "./outcome-view";
export * from "./outcome-input";

/**
 * Outcome planning, contract, execution and review contracts (specs/004.2).
 * Agent work items run as Outcome sub-threads under the executing bot (specs/004 design §45).
 */

// ---------------------------------------------------------------------------
// Limits (004.2 design §16.2)
// ---------------------------------------------------------------------------

export const OUTCOME_PLANNING_DIMENSIONS = ["goal", "acceptance", "boundaries"] as const;
export type OutcomePlanningDimension = (typeof OUTCOME_PLANNING_DIMENSIONS)[number];

// ---------------------------------------------------------------------------
// States (specs/004 design §42)
// ---------------------------------------------------------------------------

/** Highest first; the server derives Outcome status from facts in this order (design §42.3). */
export const OUTCOME_STATUS_PRIORITY: readonly OutcomeStatusFor<"standard">[] = [
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

export const OUTCOME_TERMINAL_STATUSES: readonly OutcomeStatus[] = ["accepted", "cancelled", "archived"];

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

export const VERIFICATION_METHODS = ["human_review", "deterministic_check"] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const EVIDENCE_CREDIBILITY = [
  "deterministic_check",
  "human_confirmed",
  "external_record",
  "agent_report",
  "ai_prereview",
] as const;
export type EvidenceCredibility = (typeof EVIDENCE_CREDIBILITY)[number];

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
  "outcome.plan.saved",
  "outcome.replan.requested",
  "outcome.work_item.created",
  "outcome.work_item.updated",
  "outcome.progress.updated",
  "outcome.output.recorded",
  "outcome.task_review.decided",
  "outcome.review.required",
  "outcome.prereview.submitted",
  "outcome.review.recorded",
  "outcome.decision.required",
  "outcome.decision.resolved",
  "outcome.decision.closed",
  "outcome.human_action.required",
  "outcome.human_receipt.submitted",
  "outcome.accepted",
  "outcome.recovered",
  "outcome.schedule.changed",
] as const;
export type OutcomeEventTopic = (typeof OUTCOME_EVENT_TOPICS)[number];
export const OUTCOME_EVENT_SCHEMA_VERSION = 1;

export const OUTCOME_THREAD_TOOL_NAMES = ["RequestOutcomeDecision", "RequestHumanAction", "ReportOutcomeProgress", "DeferWorkItem"] as const;
export type OutcomeThreadToolName = (typeof OUTCOME_THREAD_TOOL_NAMES)[number];

export const OUTCOME_TASK_STEP_STATUSES = ["pending", "in_progress", "completed", "blocked"] as const;
export type OutcomeTaskStepStatus = (typeof OUTCOME_TASK_STEP_STATUSES)[number];

export interface OutcomeTaskStep {
  id: string;
  title: string;
  status: OutcomeTaskStepStatus;
  summary?: string;
}

export const OUTCOME_PREREQUISITE_STATUSES = ["met", "unmet", "unknown"] as const;
export type OutcomePrerequisiteStatus = (typeof OUTCOME_PREREQUISITE_STATUSES)[number];

/** A prerequisite the executing agent checked while working; absent until the agent reports it. */
export interface OutcomePrerequisiteCheck {
  id: string;
  title: string;
  status: OutcomePrerequisiteStatus;
  summary?: string;
}

export interface OutcomeWorkItemProgress {
  phase: string;
  summary?: string;
  tasks: OutcomeTaskStep[];
  prerequisites?: OutcomePrerequisiteCheck[];
  updatedAt: string;
}

export const OutcomeTaskStepInput = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  status: Schema.Literal(...OUTCOME_TASK_STEP_STATUSES),
  summary: Schema.optional(Schema.String.pipe(Schema.maxLength(300))),
});

export const OutcomePrerequisiteInput = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  status: Schema.Literal(...OUTCOME_PREREQUISITE_STATUSES),
  summary: Schema.optional(Schema.String.pipe(Schema.maxLength(300))),
});

export const ReportOutcomeProgressInput = Schema.Struct({
  phase: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  summary: Schema.optional(Schema.String.pipe(Schema.maxLength(500))),
  tasks: Schema.Array(OutcomeTaskStepInput).pipe(Schema.minItems(1), Schema.maxItems(30)),
  prerequisites: Schema.optional(Schema.Array(OutcomePrerequisiteInput).pipe(Schema.maxItems(20))),
});
export type ReportOutcomeProgressInput = typeof ReportOutcomeProgressInput.Type;

export const REPORT_OUTCOME_PROGRESS_TOOL = {
  name: "ReportOutcomeProgress",
  description:
    "Update the current execution phase/stage and structured task list for this Outcome work item. Call this at the start of execution to publish your task breakdown, and update it promptly whenever the phase changes or a task starts, completes, or becomes blocked. When the saved goal states explicit prerequisites (access, credentials, approvals, environment conditions), also report each one in `prerequisites` with status met/unmet/unknown after you actually check it, and resend the full list whenever a status changes.",
  inputSchema: JSONSchema.make(ReportOutcomeProgressInput),
} as const;

/**
 * Shape only. Whether the time is a real timestamp with an offset, is in the future and is within the owner's limits
 * is decided by the server, which reads those limits from the task policy.
 */
export const DeferWorkItemInput = Schema.Struct({
  resumeAt: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
  note: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2_000)),
  reason: Schema.optional(Schema.String.pipe(Schema.maxLength(300))),
});
export type DeferWorkItemInput = typeof DeferWorkItemInput.Type;

export const DEFER_WORK_ITEM_TOOL = {
  name: "DeferWorkItem",
  description:
    "Use when this work item cannot be finished now and should continue at a later time. Give resumeAt (an ISO 8601 time with a UTC offset, in the future) and a note that tells the next turn where to continue: what is done, what remains and what to check first. This task then waits, uses none of the bot's capacity, and starts again at that time with your note as its instructions. The server may refuse a time that is too far away or a task that has been deferred too many times; the refusal says why. Calling this ends this turn and does not mean the task is complete, so stop right after it and do not report a result. It changes nothing about the contract, the dependencies or what this task may do.",
  inputSchema: JSONSchema.make(DeferWorkItemInput),
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
  const prerequisites: OutcomePrerequisiteCheck[] = [];
  if (Array.isArray(raw.prerequisites)) {
    for (const item of raw.prerequisites) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const check = item as Record<string, unknown>;
      if (
        typeof check.id !== "string" ||
        typeof check.title !== "string" ||
        !(OUTCOME_PREREQUISITE_STATUSES as readonly unknown[]).includes(check.status)
      ) {
        return null;
      }
      prerequisites.push({
        id: check.id,
        title: check.title,
        status: check.status as OutcomePrerequisiteStatus,
        ...(typeof check.summary === "string" && check.summary.trim() ? { summary: check.summary } : {}),
      });
    }
  }
  return {
    phase: raw.phase,
    ...(typeof raw.summary === "string" && raw.summary.trim() ? { summary: raw.summary } : {}),
    tasks,
    ...(prerequisites.length ? { prerequisites } : {}),
    updatedAt: raw.updatedAt,
  };
}

export type DecisionEffect = "plan_only" | "scope_change" | "acceptance_change" | "cancel_branch" | "manual_action";

export const PLAN_LIMITS = {
  maxTasks: 20,
  keyChars: 64,
  titleChars: 200,
  instructionsChars: 8_000,
  notesChars: 2_000,
  environmentNoteChars: 8_000,
  reasonChars: 1_000,
  noteChars: 2_000,
} as const;

export const PLAN_TASK_NATURES = ["deliverable", "action"] as const;
export type PlanTaskNature = (typeof PLAN_TASK_NATURES)[number];

/** Scale limit for a planner's duration estimate, in minutes (one minute to one week). */

export interface PlanTask {
  key: string;
  title: string;
  instructions: string;
  botId: string;
  dependsOn?: string[];
  covers: string[];
  nature: PlanTaskNature;
  /** ISO 8601 with a UTC offset: the task does not start earlier. May be in the past (already due). */
  startAt?: string;
  /** ISO 8601 with a UTC offset: desired finish. Display and overdue marking only. */
  dueAt?: string;
  /** Planner's estimate in minutes. Display only. */
  estimateMinutes?: number;
}

/**
 * The schedule columns a work item gets from its plan task. Both places that create tasks from a plan use this,
 * so the three fields are always copied the same way. Absent fields become null.
 */
export function workItemScheduleFromPlanTask(task: Pick<PlanTask, "startAt" | "dueAt" | "estimateMinutes">): {
  scheduledAt: Date | null;
  dueAt: Date | null;
  estimateMinutes: number | null;
} {
  return {
    scheduledAt: task.startAt ? parseOffsetTimestamp(task.startAt) : null,
    dueAt: task.dueAt ? parseOffsetTimestamp(task.dueAt) : null,
    estimateMinutes: task.estimateMinutes ?? null,
  };
}

export type PlanScheduleValidation = { ok: true } | { ok: false; fields: Array<"startAt" | "dueAt" | "estimateMinutes"> };

/**
 * Format and range checks for a task's schedule fields. A start in the past is allowed (it means "already due")
 * so a replan can send a task back unchanged. Due may equal start but not precede it.
 */
export function validatePlanSchedule(input: {
  startAt?: unknown;
  dueAt?: unknown;
  estimateMinutes?: unknown;
}): PlanScheduleValidation {
  const fields: Array<"startAt" | "dueAt" | "estimateMinutes"> = [];
  const start = input.startAt === undefined ? undefined : parseOffsetTimestamp(input.startAt);
  const due = input.dueAt === undefined ? undefined : parseOffsetTimestamp(input.dueAt);
  if (start === null) fields.push("startAt");
  if (due === null) fields.push("dueAt");
  if (start && due && due.getTime() < start.getTime()) fields.push("dueAt");
  if (input.estimateMinutes !== undefined) {
    const value = input.estimateMinutes;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < PLAN_ESTIMATE_MINUTES.min ||
      value > PLAN_ESTIMATE_MINUTES.max
    )
      fields.push("estimateMinutes");
  }
  return fields.length ? { ok: false, fields: [...new Set(fields)] } : { ok: true };
}

export interface OutcomePlanView {
  notes?: string | null;
  tasks: PlanTask[];
}

/** Validates and normalizes persisted revision plan JSON without throwing on legacy rows. */
export function parseOutcomePlan(raw: unknown): OutcomePlanView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.tasks)) return null;
  const tasks: PlanTask[] = [];
  for (const item of obj.tasks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const task = item as Record<string, unknown>;
    if (
      typeof task.key !== "string" ||
      typeof task.title !== "string" ||
      typeof task.instructions !== "string" ||
      typeof task.botId !== "string" ||
      !Array.isArray(task.covers) ||
      !(PLAN_TASK_NATURES as readonly unknown[]).includes(task.nature)
    ) {
      return null;
    }
    const dependsOn = Array.isArray(task.dependsOn)
      ? task.dependsOn.filter((dep): dep is string => typeof dep === "string")
      : [];
    const covers = task.covers.filter((id): id is string => typeof id === "string");
    tasks.push({
      key: task.key,
      title: task.title,
      instructions: task.instructions,
      botId: task.botId,
      ...(dependsOn.length ? { dependsOn } : {}),
      covers,
      nature: task.nature as PlanTaskNature,
      // Stored plans from before scheduling have none of these; a malformed one is dropped, not fatal.
      ...(typeof task.startAt === "string" && parseOffsetTimestamp(task.startAt) ? { startAt: task.startAt } : {}),
      ...(typeof task.dueAt === "string" && parseOffsetTimestamp(task.dueAt) ? { dueAt: task.dueAt } : {}),
      ...(validatePlanSchedule({ estimateMinutes: task.estimateMinutes }).ok && task.estimateMinutes !== undefined
        ? { estimateMinutes: task.estimateMinutes as number }
        : {}),
    });
  }
  const notes = typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : null;
  return {
    ...(notes ? { notes } : {}),
    tasks,
  };
}

export const PREREVIEW_SUGGESTIONS = ["likely_pass", "likely_fail", "unclear"] as const;
export type PrereviewSuggestion = (typeof PREREVIEW_SUGGESTIONS)[number];

export interface TaskReviewFinding {
  kind: "error" | "omission";
  basis: { criterionId: string } | { boundary: { side: "included" | "excluded"; index: number } };
  reason: string;
}

export interface WorkItemReviewView {
  state: "none" | "passed" | "rejected_once" | "unreviewed";
  findings: TaskReviewFinding[];
  reworkWorkItemId?: string | null;
}

export interface OutcomePrereviewView {
  turnId: string;
  revision: number;
  summary: string;
  attention: Array<{ criterionId?: string | null; question: string }>;
  results: Array<{
    criterionId: string;
    suggestion: PrereviewSuggestion;
    reason: string;
    evidenceIds: string[];
  }>;
  report?: OutcomeResultSummary;
  createdAt: string;
}

/** Payloads live inside the existing Event envelope; identifiers common to all events stay in that envelope. */
export interface OutcomeEventPayloads {
  "outcome.created": { title: string; botId: string };
  "outcome.status_changed": { from: OutcomeStatus; to: OutcomeStatus };
  "outcome.contract.revision_created": {
    revisionId: string; status: ContractRevisionStatus; baseRevisionId: string | null; sourceDecisionId: string | null;
  };
  "outcome.contract.revision_approved": { revisionId: string; contentHash: string };
  "outcome.plan.saved": { revision: number; taskKeys: string[] };
  "outcome.replan.requested": { workItemId: string; reason: string };
  "outcome.work_item.created": { workItemId: string; executorType: WorkItemExecutorType; kind: WorkItemKind };
  "outcome.work_item.updated": { from: WorkItemStatus; to: WorkItemStatus; reason: string };
  "outcome.progress.updated": { workItemId: string; phase: string; completedCount: number; totalCount: number };
  "outcome.output.recorded": { outputId: string; kind: OutputKind };
  "outcome.task_review.decided": {
    workItemId: string;
    verdict: "pass" | "reject" | "unreviewed";
    findings?: TaskReviewFinding[];
    reworkWorkItemId?: string | null;
  };
  "outcome.review.required": { criterionIds: string[]; workItemIds: string[] };
  "outcome.prereview.submitted": {
    revision: number;
    turnId: string;
    suggestions: Array<{ criterionId: string; suggestion: PrereviewSuggestion }>;
  };
  "outcome.review.recorded": { reviewId: string; criterionId: string; result: ReviewResult; evidenceIds: string[] };
  "outcome.decision.required": { decisionId: string; reasonCode: string };
  "outcome.decision.resolved": { decisionId: string; resolutionEffect: DecisionEffect; optionId: string | null; customText: string | null };
  "outcome.decision.closed": { decisionId: string; reason: "expired" | "withdrawn" };
  "outcome.human_action.required": { workItemId: string; cardId: string; requestedByWorkItemId: string; decisionId: string | null };
  "outcome.human_receipt.submitted": { workItemId: string; receiptId: string; evidenceIds: string[] };
  "outcome.accepted": { revisionId: string; reviewIds: string[]; autoClosed?: boolean; summary?: string };
  "outcome.recovered": { workItemId: string; action: "resettle" | "resume_queued" | "needs_review" | "cancelled"; reason: string };
  /** A task's schedule or the goal's deadline changed. `previous` holds the old values, so the change can be audited. */
  "outcome.schedule.changed": {
    target: "outcome" | "work_item";
    workItemId?: string;
    scheduledAt?: string | null;
    dueAt?: string | null;
    estimateMinutes?: number | null;
    previous?: { scheduledAt?: string | null; dueAt?: string | null; estimateMinutes?: number | null };
    reason?: string;
    source: "planner" | "owner" | "agent_defer" | "system";
  };
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
  planning_input_too_large: 400,
  planning_conflict: 409,
  superseded_revision: 409,
  contract_revision_conflict: 409,
  contract_revision_not_approved: 409,
  invalid_outcome_transition: 409,
  contract_unchanged: 409,
  contract_title_required: 400,
  idempotency_conflict: 409,
  request_in_progress: 409,
  bot_not_runnable: 409,
  rework_not_allowed: 409,
  evidence_missing: 422,
  review_revision_conflict: 409,
  review_incomplete: 422,
  invalid_outcome_query: 400,
  manual_action_unavailable: 503,
  plan_revision_conflict: 409,
  plan_cycle: 400,
  plan_uncovered_criteria: 400,
  plan_task_locked: 409,
  plan_unchanged: 409,
  outcome_terminal: 409,
  prereview_incomplete: 400,
  prereview_stale: 409,
  review_reject_exhausted: 409,
  review_not_rejectable: 400,
  review_task_stale: 409,
  outcome_thread_tool_forbidden: 403,
  model_unavailable: 400,
  invalid_schedule: 400,
  defer_limit_reached: 409,
  schedule_not_editable: 409,
  outcome_not_open: 409,
  invalid_outcome_kind: 400,
  outcome_bot_required: 400,
  outcome_revision_conflict: 409,
  outcome_conversion_invalid: 409,
  planner_unavailable: 409,
  readonly_mcp_tool_required: 403,
  readonly_action_forbidden: 403,
  todo_authorization_required: 403,
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

export interface PlanningConflict {
  code: PlanningConflictCode;
  severity: "blocking" | "informational";
  dimensions: OutcomePlanningDimension[];
  message: string;
  resolutionHint?: string;
}

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

/** Presentation for a specific contract revision. The report does not record a review. */
export interface OutcomeResultSummary {
  outcomeId: string;
  revisionId: string;
  summary: string;
  details: string;
  sources: { title: string; quote: string; evidenceId?: string; credibility?: EvidenceCredibility }[];
  reviewTurnId?: string;
  attention?: string[];
  charts?: OutcomeResultChart[];
}

export interface OutcomeResultChart {
  type: "metric" | "bar" | "line" | "pie" | "heatmap";
  title: string;
  unit: string;
  points: { label: string; row?: string; value: number; citation: number }[];
}

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

export const OUTCOME_WORK_THREAD_ARCHIVE_MS = 3 * 60 * 60 * 1000;

export interface OutcomeWorkThreadView {
  id: string;
  outcomeId: string;
  outcomeTitle: string;
  botId: string;
  title: string;
  status: WorkItemStatus;
  completedAt: string | null;
  /** Queued behind an earlier task of the same plan that has not completed: no run exists yet. */
  waitingOnDependency?: boolean;
}

export interface OutcomeWorkThreadPage {
  items: OutcomeWorkThreadView[];
  nextCursor: string | null;
}

/** One run of a task. Time between two segments is not run time (a deferred task resumes later). */
export interface RunSegmentView {
  id: string;
  status: RunStatus;
  startedAt: string;
  /** Null while the run is still going, or when the run ended without recording a completion time. */
  completedAt: string | null;
}

/** Scale limit on how many recent runs a work item view carries. */
export const RUN_SEGMENT_LIMIT = 20;

/**
 * Builds the run segments of a task from its run rows: only runs that actually started, oldest first,
 * the most recent {@link RUN_SEGMENT_LIMIT} kept. Creation time is never used in place of a start time.
 */
export function buildRunSegments(
  runs: ReadonlyArray<{ id: string; status: RunStatus; startedAt: Date | null; completedAt: Date | null }>,
  limit: number = RUN_SEGMENT_LIMIT
): RunSegmentView[] {
  const started = runs.flatMap((run) => (run.startedAt ? [{ ...run, startedAt: run.startedAt }] : []));
  started.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return started.slice(-limit).map((run) => ({
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  }));
}

export interface WorkItemView {
  id: string;
  contractRevision: number;
  botId?: string;
  executorType: WorkItemExecutorType;
  kind: WorkItemKind;
  title: string;
  status: WorkItemStatus;
  statusReason: string | null;
  progress?: OutcomeWorkItemProgress | null;
  ordinal: number;
  planKey?: string | null;
  nature?: PlanTaskNature | null;
  review?: WorkItemReviewView;
  dependsOn: string[];
  rootRunId: string | null;
  runIds: string[];
  reworkOfWorkItemId: string | null;
  /** First time the task started. Null when it never ran; absent on payloads from older servers. */
  startedAt?: string | null;
  /** When the task reached a terminal state. Null otherwise; absent on payloads from older servers. */
  completedAt?: string | null;
  /** Most recent runs, oldest first. Absent on payloads from older servers. */
  runSegments?: RunSegmentView[];
  /** Bot task: not before this time. Human task: the booked time. Null when none; absent on older servers. */
  scheduledAt?: string | null;
  /** Desired finish. Display and overdue marking only. Null when none; absent on older servers. */
  dueAt?: string | null;
  /** Planner's estimate in minutes. Display only. Null when none; absent on older servers. */
  estimateMinutes?: number | null;
  /** How many times the agent deferred this task. Absent on older servers. */
  deferCount?: number;
  inspectionEnabled?: boolean;
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

export type OutcomeDetail = OutcomeSummary & {
  description: string;
  resumeStatus: OutcomeStatus | null;
  sourceRef: OutcomeSourceRef | null;
  prepareAt: string | null;
  prepareInstruction: string | null;
  dedupeKey: string | null;
  createdBy: string;
  createdAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
  autoClosedAt: string | null;
  closeSummary: string | null;
  inspectionEnabled?: boolean;
  currentRevisionView: ContractRevisionView | null;
  revisions: Array<
    Pick<ContractRevisionView, "id" | "revision" | "status" | "changeSummary" | "createdAt"> &
    Partial<Pick<ContractRevisionView, "baseRevisionId" | "sourceDecisionId" | "createdBy">>
  >;
  workItems: WorkItemView[];
  outputs: OutputView[];
  evidence: EvidenceView[];
  reviews: ReviewView[];
  plan?: OutcomePlanView | null;
  latestAdvice?: OutcomePlanAdvice | null;
  planTurns?: OutcomeThreadTurnView[];
  reviewTurns?: OutcomeThreadTurnView[];
  runs?: RunSegmentView[];
  children?: OutcomeSummary[];
  prereview?: OutcomePrereviewView | null;
};

export interface OutcomeListPage {
  items: OutcomeSummary[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Request bodies (004.2 requirements “API 合同需求”, design §19)
// ---------------------------------------------------------------------------

const ClientRequestId = Schema.String.pipe(Schema.minLength(8), Schema.maxLength(200));
const RevisionNumber = Schema.Number.pipe(Schema.int(), Schema.positive());
const OptionalText = (max: number) => Schema.optional(Schema.String.pipe(Schema.maxLength(max)));

/**
 * The owner changes a task's schedule (specs/004.10 design §5.5). A field that is left out is unchanged; `null`
 * clears it. Shape only: real timestamps, ranges and ordering are decided by the server.
 */
export const SetWorkItemScheduleInput = Schema.Struct({
  scheduledAt: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(64)))),
  dueAt: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(64)))),
  estimateMinutes: Schema.optional(Schema.NullOr(Schema.Number)),
  clientRequestId: ClientRequestId,
});
export type SetWorkItemScheduleInput = typeof SetWorkItemScheduleInput.Type;

/** The owner sets or clears the goal's deadline. `null` clears it. */
export const SetOutcomeDueInput = Schema.Struct({
  dueAt: Schema.NullOr(Schema.String.pipe(Schema.maxLength(64))),
  clientRequestId: ClientRequestId,
});
export type SetOutcomeDueInput = typeof SetOutcomeDueInput.Type;

const ContractText = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.customEntryChars));

/** A goal whose contract its bot wrote itself, in a conversation; saved unapproved (specs/004.8). */
export const CreateOutcomeFromContractInput = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.titleChars)),
  goal: Schema.Array(ContractText).pipe(Schema.minItems(1), Schema.maxItems(8)),
  acceptance: Schema.Array(Schema.Struct({ statement: ContractText, required: Schema.Boolean })).pipe(
    Schema.minItems(1),
    Schema.maxItems(20)
  ),
  boundaries: Schema.Struct({
    included: Schema.Array(ContractText).pipe(Schema.maxItems(20)),
    excluded: Schema.Array(ContractText).pipe(Schema.maxItems(20)),
  }),
  budget: Schema.optional(Schema.NullOr(OutcomeBudgetInput)),
  clientRequestId: ClientRequestId,
});
export type CreateOutcomeFromContractInput = typeof CreateOutcomeFromContractInput.Type;

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

export const DecideOutcomeAcceptanceInput = Schema.Union(
  Schema.Struct({
    decision: Schema.Literal("approve"),
    expectedRevision: RevisionNumber,
    clientRequestId: ClientRequestId,
  }),
  Schema.Struct({
    decision: Schema.Literal("reject"),
    reason: Schema.String.pipe(
      Schema.maxLength(OUTCOME_LIMITS.commentChars),
      Schema.filter((value) => value.trim().length > 0, { message: () => "A rejection reason is required" }),
    ),
    expectedRevision: RevisionNumber,
    clientRequestId: ClientRequestId,
  })
);
export type DecideOutcomeAcceptanceInput = typeof DecideOutcomeAcceptanceInput.Type;

export const OutcomeReworkInput = Schema.Struct({
  criterionIds: Schema.Array(Uuid).pipe(Schema.minItems(1), Schema.maxItems(20)),
  comment: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.commentChars)),
  expectedRevision: RevisionNumber,
  clientRequestId: ClientRequestId,
});
export type OutcomeReworkInput = typeof OutcomeReworkInput.Type;

export const AdoptPrereviewInput = Schema.Struct({
  expectedRevision: RevisionNumber,
  turnId: Uuid,
  clientRequestId: ClientRequestId,
});
export type AdoptPrereviewInput = typeof AdoptPrereviewInput.Type;

export const CancelOutcomeInput = Schema.Struct({ clientRequestId: ClientRequestId });
export type CancelOutcomeInput = typeof CancelOutcomeInput.Type;

export interface ListOutcomesQuery extends Omit<ListOutcomesFilterInput, "kinds" | "statuses" | "cursor" | "limit"> {
  kinds: NonNullable<ListOutcomesFilterInput["kinds"]>;
  statuses: NonNullable<ListOutcomesFilterInput["statuses"]>;
  cursor: { updatedAt: string; id: string } | null;
  limit: number;
}

/** Parses `GET /api/v0/outcomes` query parameters; the cursor is `<updatedAt ISO>|<id>` in base64url. */
export function parseListOutcomesQuery(params: URLSearchParams): ListOutcomesQuery {
  const list = (field: string) => [...new Set(params.getAll(field).flatMap((value) => value.split(",").map((item) => item.trim())).filter(Boolean))];
  const parseBoolean = (value: string) => value === "true" ? true : value === "false" ? false : value;
  const filters: Record<string, unknown> = Object.fromEntries(params);
  for (const field of ["kinds", "statuses", "tags"]) {
    if (params.has(field)) filters[field] = list(field);
  }
  if (params.has("includeArchived")) filters.includeArchived = parseBoolean(params.get("includeArchived")!);
  if (params.has("limit")) {
    const limit = Number(params.get("limit"));
    filters.limit = Number.isInteger(limit) ? Math.min(limit, OUTCOME_LIMITS.listPageSizeMax) : limit;
  }
  const result = Schema.decodeUnknownEither(ListOutcomesFilterInput)(filters);
  if (result._tag === "Left") throw new OutcomeError("invalid_outcome_query", result.left.message);
  const { kinds = [], statuses = [], limit = OUTCOME_LIMITS.listPageSize, cursor, ...options } = result.right;
  const rangeError = validateOutcomeDateRange(options);
  if (rangeError) throw new OutcomeError("invalid_outcome_query", rangeError.message, { field: "to" });
  return { ...options, kinds, statuses, cursor: decodeOutcomeCursor(cursor ?? null), limit };
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
  if (extra !== undefined || !updatedAt || !parseOffsetTimestamp(updatedAt) || !id || !Schema.is(Uuid)(id))
    throw new OutcomeError("invalid_outcome_query", "cursor is invalid", { field: "cursor" });
  return { updatedAt, id };
}
