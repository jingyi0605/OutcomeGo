import { JSONSchema, Schema } from "effect";
import type { OutcomeThreadTurnModelView } from "./inference";
import {
  ConcisePlanAdviceFields,
  OutcomePlanMode,
  OutcomeTriageChildKind,
  OutcomeTriageKind,
  OutcomeTriageMemoryFacts,
  PLAN_ADVICE_LIMITS,
  PlanSummary,
  type OutcomePlanAdvice,
  type OutcomeThreadPurpose,
  type OutcomeTriageResult,
} from "./outcome-plan";
import {
  CancelOutcomeInput,
  CreateContractRevisionInput,
  CreateOutcomeFields,
  ListOutcomesFilterInput,
  OUTCOME_LIMITS,
  OutcomeBudgetInput,
  PLAN_ESTIMATE_MINUTES,
  PLAN_LIMITS,
  PLAN_TASK_NATURES,
  PREREVIEW_SUGGESTIONS,
  Uuid,
  validateCreateOutcomeFields,
  validateOutcomeDateRange,
} from "./outcomes";

export { OUTCOME_THREAD_PURPOSES, OutcomeThreadPurposeSchema, type OutcomeThreadPurpose } from "./outcome-plan";

/**
 * A goal's own Agent thread (specs/004.8, 004.9). The owner's words go to the bot as they are; the bot decides what
 * to do and writes facts through these tools. Contracts are still never approved here; owner-initiated turns in
 * review_pending may accept or request rework on delivered results.
 */
export const OUTCOME_THREAD_ROLES = ["planner", "reviewer"] as const;
export type OutcomeThreadRole = (typeof OUTCOME_THREAD_ROLES)[number];
export const OUTCOME_THREAD_TURN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type OutcomeThreadTurnStatus = (typeof OUTCOME_THREAD_TURN_STATUSES)[number];

export const OUTCOME_THREAD_TEXT_CHARS = 8_000;
const ClientRequestId = CancelOutcomeInput.fields.clientRequestId;
const Text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_THREAD_TEXT_CHARS));
const RevisionNumber = Schema.Number.pipe(Schema.int(), Schema.positive());

/** The owner's words about a goal; they reach the bot unchanged. */
export const SendOutcomeThreadMessageInput = Schema.Struct({
  text: Text,
  mode: Schema.optional(OutcomePlanMode),
  clientRequestId: ClientRequestId,
});
export type SendOutcomeThreadMessageInput = typeof SendOutcomeThreadMessageInput.Type;

export const RequestOutcomePlanInput = Schema.Struct({
  mode: Schema.optional(OutcomePlanMode),
  prompt: Schema.optional(Text),
  expectedRevision: Schema.optional(RevisionNumber),
  workItemId: Schema.optional(Uuid),
  clientRequestId: ClientRequestId,
});
export type RequestOutcomePlanInput = typeof RequestOutcomePlanInput.Type;

interface OutcomeThreadTurnFields {
  id: string;
  purpose: OutcomeThreadPurpose;
  /** The owner's words, as sent, or system trigger description. */
  trigger: string;
  status: OutcomeThreadTurnStatus;
  /** The bot's final message for the turn. */
  reply: string | null;
  error: { code: string; message: string } | null;
  skipReason?: string | null;
  runId: string | null;
  model?: OutcomeThreadTurnModelView | null;
  workItemId?: string | null;
  outcomeRevision: number | null;
  createdAt: string;
  updatedAt: string;
}
export type OutcomeThreadTurnView = OutcomeThreadTurnFields & (
  | { planMode: "triage"; result?: OutcomeTriageResult | null }
  | { planMode: "advice"; result?: OutcomePlanAdvice | null }
  | { planMode: "contract_plan" | null; result?: unknown }
);
export interface OutcomeThreadView {
  threadId: string | null;
  turns: OutcomeThreadTurnView[];
  reviewerThreadId?: string | null;
  reviewTurns?: OutcomeThreadTurnView[];
}

const contractFields = CreateContractRevisionInput.fields.contract.fields;

export const GetOutcomeInput = Schema.Struct({
  outcomeId: Uuid,
  revision: Schema.optional(CreateContractRevisionInput.fields.baseRevision),
  workItemId: Schema.optional(Uuid),
  before: Schema.optional(RevisionNumber),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, OUTCOME_LIMITS.listPageSizeMax))),
});

export const QueryOutcomesInput = ListOutcomesFilterInput.pipe(Schema.filter(validateOutcomeDateRange));

const classificationFields = CreateOutcomeFields.pick(
  "title", "description", "botId", "tags", "urgency", "dueAt", "scheduledAt", "prepareAt", "prepareInstruction", "followUpAt", "budget",
);
const classificationResultFields = {
  summary: PlanSummary,
  memoryFacts: Schema.optional(OutcomeTriageMemoryFacts),
  clientRequestId: ClientRequestId,
};
const SingleOutcomeClassification = Schema.Struct({
  ...classificationResultFields,
  strategy: Schema.Literal("single_convert"),
  outcome: Schema.Struct({ kind: OutcomeTriageKind, ...classificationFields.fields }),
});
const SplitOutcomeClassification = Schema.Struct({
  ...classificationResultFields,
  strategy: Schema.Literal("split_from_note"),
  sourceNote: Schema.optional(Schema.partial(classificationFields.pick("title", "description", "tags"))),
  children: Schema.Array(Schema.Struct({ kind: OutcomeTriageChildKind, ...classificationFields.fields })).pipe(Schema.minItems(1)),
});
export const ClassifyOutcomeInput = Schema.Union(SingleOutcomeClassification, SplitOutcomeClassification).pipe(
  Schema.filter((input) => {
    const items = input.strategy === "single_convert" ? [input.outcome] : input.children;
    for (const item of items) {
      const validation = validateCreateOutcomeFields({ ...item, clientRequestId: input.clientRequestId }, { requireBot: false });
      if (validation) return validation;
    }
    return true;
  }),
);
export type ClassifyOutcomeInput = typeof ClassifyOutcomeInput.Type;

export const SavePlanAdviceInput = Schema.Struct({ ...ConcisePlanAdviceFields.fields, clientRequestId: ClientRequestId });
export type SavePlanAdviceInput = typeof SavePlanAdviceInput.Type;

export const PlanTaskInputSchema = Schema.Struct({
  key: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(PLAN_LIMITS.keyChars)),
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(PLAN_LIMITS.titleChars)),
  instructions: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(PLAN_LIMITS.instructionsChars)),
  botId: Uuid,
  dependsOn: Schema.optional(
    Schema.Array(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(PLAN_LIMITS.keyChars))).pipe(
      Schema.maxItems(PLAN_LIMITS.maxTasks)
    )
  ),
  covers: Schema.Array(Uuid).pipe(Schema.maxItems(20)),
  nature: Schema.Literal(...PLAN_TASK_NATURES),
  // Shape only. Whether these are real offset timestamps, and due >= start, is validatePlanSchedule's job.
  startAt: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
  dueAt: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
  estimateMinutes: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(PLAN_ESTIMATE_MINUTES.min, PLAN_ESTIMATE_MINUTES.max))
  ),
});

export const TaskReviewFindingInputSchema = Schema.Struct({
  kind: Schema.Literal("error", "omission"),
  basis: Schema.Union(
    Schema.Struct({ criterionId: Uuid }),
    Schema.Struct({
      boundary: Schema.Struct({
        side: Schema.Literal("included", "excluded"),
        index: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      }),
    })
  ),
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(PLAN_LIMITS.reasonChars)),
});

export const CONCLUSION_SENTENCE_CHARS = 50;
export const CONCLUSION_ITEM_CHARS = 30;
export const CONCLUSION_MAX_ITEMS = 5;

/** One complete sentence (<=50 characters), or 2-5 complete items (<=30 characters each). Numbering is added by the server. */
const Conclusion = Schema.Array(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(CONCLUSION_SENTENCE_CHARS))).pipe(
  Schema.minItems(1),
  Schema.maxItems(CONCLUSION_MAX_ITEMS),
  Schema.filter((items) => items.length === 1 || items.every((item) => item.length <= CONCLUSION_ITEM_CHARS) ||
    `With more than one conclusion item, each item must be at most ${CONCLUSION_ITEM_CHARS} characters`),
);

/** The owner-facing report summary: one sentence as is, several items numbered for reading. */
export const composeConclusion = (items: readonly string[]): string =>
  items.length === 1 ? items[0]!.trim() : items.map((item, index) => `${index + 1}. ${item.trim()}`).join("\n");

const GoalThreadInputs = {
  ClassifyOutcome: ClassifyOutcomeInput,
  SavePlanAdvice: SavePlanAdviceInput,
  SaveOutcomeContract: Schema.Struct({
    /** Required for a goal's first contract; ignored afterwards. */
    title: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.titleChars))),
    goal: contractFields.goal,
    acceptance: contractFields.acceptance,
    boundaries: contractFields.boundaries,
    budget: Schema.optional(Schema.NullOr(OutcomeBudgetInput)),
    changeSummary: CreateContractRevisionInput.fields.changeSummary,
    clientRequestId: ClientRequestId,
  }),
  SavePlan: Schema.Struct({
    expectedRevision: RevisionNumber,
    notes: Schema.optional(Schema.String.pipe(Schema.maxLength(PLAN_LIMITS.notesChars))),
    tasks: Schema.Array(PlanTaskInputSchema).pipe(Schema.minItems(1), Schema.maxItems(PLAN_LIMITS.maxTasks)),
    clientRequestId: ClientRequestId,
  }),
  SubmitPrereview: Schema.Struct({
    expectedRevision: RevisionNumber,
    results: Schema.Array(
      Schema.Struct({
        criterionId: Uuid,
        suggestion: Schema.Literal(...PREREVIEW_SUGGESTIONS),
        reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2_000)),
        evidenceIds: Schema.optional(Schema.Array(Uuid).pipe(Schema.maxItems(20))),
      })
    ).pipe(Schema.minItems(1), Schema.maxItems(20)),
    conclusion: Conclusion,
    charts: Schema.optional(Schema.Array(
      Schema.Struct({
        type: Schema.Literal("metric", "bar", "line", "pie", "heatmap"),
        title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
        unit: Schema.String.pipe(Schema.maxLength(24)),
        points: Schema.Array(
          Schema.Struct({
            label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(72)),
            row: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(72))),
            value: Schema.Number,
            /** Cite a saved evidence record, or a saved output file under the goal's workspace folder. */
            evidenceId: Schema.optional(Uuid),
            file: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(400))),
            quote: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(600)),
          }).pipe(Schema.filter((point) => (point.evidenceId === undefined) !== (point.file === undefined) ||
            "A chart point must cite exactly one of evidenceId or file"))
        ).pipe(Schema.minItems(1), Schema.maxItems(24)),
      })
    ).pipe(Schema.maxItems(2))),
    attention: Schema.Array(
      Schema.Struct({
        criterionId: Schema.optional(Uuid),
        question: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
      })
    ).pipe(Schema.maxItems(20)),
    clientRequestId: ClientRequestId,
  }),
  ReviewTaskResult: Schema.Struct({
    workItemId: Uuid,
    verdict: Schema.Literal("pass", "reject"),
    findings: Schema.Array(TaskReviewFindingInputSchema).pipe(Schema.maxItems(20)),
    note: Schema.optional(Schema.String.pipe(Schema.maxLength(PLAN_LIMITS.noteChars))),
    clientRequestId: ClientRequestId,
  }),
  GetOutcome: GetOutcomeInput,
  ListOutcomes: QueryOutcomesInput,
  AcceptOutcome: Schema.Struct({
    outcomeId: Uuid,
    expectedRevision: RevisionNumber,
    clientRequestId: ClientRequestId,
  }),
  RequestOutcomeRework: Schema.Struct({
    outcomeId: Uuid,
    expectedRevision: RevisionNumber,
    reason: Schema.String.pipe(
      Schema.maxLength(OUTCOME_LIMITS.commentChars),
      Schema.filter((value) => value.trim().length > 0, {
        message: () => "Rework feedback cannot be empty",
      })
    ),
    clientRequestId: ClientRequestId,
  }),
  CancelOutcome: Schema.Struct({ outcomeId: Uuid, ...CancelOutcomeInput.fields }),
} as const;

export type SaveOutcomeContractInput = typeof GoalThreadInputs.SaveOutcomeContract.Type;
export type SavePlanInput = typeof GoalThreadInputs.SavePlan.Type;
export type SubmitPrereviewInput = typeof GoalThreadInputs.SubmitPrereview.Type;
export type ReviewTaskResultInput = typeof GoalThreadInputs.ReviewTaskResult.Type;
export type AcceptOutcomeInput = typeof GoalThreadInputs.AcceptOutcome.Type;
export type RequestOutcomeReworkInput = typeof GoalThreadInputs.RequestOutcomeRework.Type;
export type OutcomeThreadToolName = keyof typeof GoalThreadInputs;
export const OUTCOME_GOAL_THREAD_TOOL_NAMES = Object.keys(GoalThreadInputs) as OutcomeThreadToolName[];

const researchTools = ["GetOutcome", "ListOutcomes", "SavePlanAdvice"] as const;

export const OUTCOME_THREAD_TOOLS_BY_PURPOSE: Record<OutcomeThreadPurpose, readonly OutcomeThreadToolName[]> = {
  plan: ["SaveOutcomeContract", "SavePlan", "CancelOutcome", ...researchTools],
  owner_message: [
    "SaveOutcomeContract",
    "SavePlan",
    "AcceptOutcome",
    "RequestOutcomeRework",
    "CancelOutcome",
    ...researchTools,
  ],
  replan: ["SaveOutcomeContract", "SavePlan", "CancelOutcome", ...researchTools],
  review: ["GetOutcome", "SubmitPrereview"],
  review_task: ["GetOutcome", "ReviewTaskResult"],
};

export function goalThreadToolsForPurpose(
  purpose: OutcomeThreadPurpose,
  mode?: OutcomePlanMode | null,
): readonly OutcomeThreadToolName[] {
  if (purpose === "review" || purpose === "review_task") return OUTCOME_THREAD_TOOLS_BY_PURPOSE[purpose];
  if (mode === "triage") return [...researchTools, "ClassifyOutcome"];
  if (mode === "advice") return researchTools;
  return OUTCOME_THREAD_TOOLS_BY_PURPOSE[purpose];
}

const descriptions: Record<OutcomeThreadToolName, string> = {
  ClassifyOutcome:
    "Classify the current intake without changing its identity. Use single_convert with one outcome, or split_from_note with one or more children and optional sourceNote edits. Preserve the original content and attachments; the server links children to the source note. Include scheduledAt and execution instructions in description for scheduled_once. Give a short summary and optional memoryFacts, each at most 500 characters. Reuse clientRequestId for identical retries.",
  SavePlanAdvice:
    `Save the current Outcome's progressive-disclosure brief. Layer 1 (shown first to the owner): \`summary\` (1-2 plain-language sentences, <=${PLAN_ADVICE_LIMITS.summaryChars} chars, no file paths, code expressions, IDs or tool names) and \`recommendations\` (up to ${PLAN_ADVICE_LIMITS.maxRecommendations}; each \`action\` <=${PLAN_ADVICE_LIMITS.recommendationActionChars} chars, set \`needsOwnerConfirm\` when the owner must decide). Layer 2 (collapsed until expanded): \`facts\` (only decision-driving verified facts, up to ${PLAN_ADVICE_LIMITS.maxFacts}, \`statement\` <=${PLAN_ADVICE_LIMITS.factStatementChars} chars, put paths/commits/IDs/tool provenance in \`source\` <=${PLAN_ADVICE_LIMITS.factSourceChars} chars), \`gaps\` (up to ${PLAN_ADVICE_LIMITS.maxGaps}, <=${PLAN_ADVICE_LIMITS.gapChars} chars each), and \`recommendations[].reason\` (<=${PLAN_ADVICE_LIMITS.recommendationReasonChars} chars). Optionally suggest a different Outcome kind without converting or executing. Reuse clientRequestId for identical retries.`,
  SaveOutcomeContract:
    "Write this goal's contract yourself and save it for the owner's approval: goal statements, acceptance criteria and scope boundaries, optional budget. The first call also needs a title. Later calls replace the pending contract with a new revision; unchanged content is refused. The owner approves in the app: never approve it, never ask them to approve it elsewhere. Write for the owner to read: concrete, no filler. Reuse clientRequestId for identical retries.",
  SavePlan:
    "Save the executable task plan for the current contract revision. Each task requires a unique key, title, self-contained instructions, assigned botId, covered acceptance criterion ids, and nature (deliverable or action; never omit nature). A task may also carry optional scheduling: startAt (ISO 8601 with a UTC offset; the task does not start earlier, and a time already in the past simply means it is due), dueAt (when it should be done; display only, it never stops anything) and estimateMinutes (your estimate, display only). Leave these out unless you are sure. Before approval, replaces the plan on the pending revision; after approval, may only add tasks or modify/remove unstarted queued tasks without touching started or finished tasks. Reuse clientRequestId for identical retries.",
  SubmitPrereview:
    "Record your holistic preliminary review for every acceptance criterion of the current revision using progressive disclosure. Inspect the saved outputs however you need (GetOutcome, Read, read-only Shell). Layer 1 (shown first to the owner): `conclusion` (one complete sentence <=50 characters, or 2-5 complete items <=30 characters each; the app numbers them; every item names its subject, concrete recorded fact with figure, and decision impact, with no fragments, paths, IDs or process detail) and `attention` (one short concrete question per `likely_fail` or `unclear` required criterion that needs owner input). Layer 2 (collapsed until expanded): detailed per-criterion rationale in `results[].reason` with `evidenceIds`. Include up to two optional `charts` when comparable figures help; each point cites either `evidenceId` or a saved output `file` path plus the exact excerpt containing its label, value and unit. Advisory only: never approves or accepts the goal. Reuse clientRequestId for identical retries.",
  ReviewTaskResult:
    "Record your task-level review verdict (pass or reject) for one completed deliverable work item. Default to pass. Reject only for serious errors or omissions backed by a required criterion covered by the task or an explicit contract boundary, with a clear reason. Each task can be rejected at most once. Notes are for holistic review only and are never sent to the executing bot. Reuse clientRequestId for identical retries.",
  GetOutcome:
    "Read the Outcome's original content and attachments, latest advice, and any contract, Work Items, Outputs, Evidence and Reviews. Output contentRef paths point into /workspace. Use Read or a read-only Shell command to inspect referenced files before judging their contents. Use it before changing anything.",
  ListOutcomes:
    "Find related Outcomes by kind, text, tag, status, or date range. Read-only.",
  AcceptOutcome:
    "Accept and complete this goal (status -> accepted) when it is in review_pending and the owner's words in this turn confirm acceptance or completion. Pass expectedRevision of the current approved contract. Only allowed in owner-initiated turns; refuses if required work, decisions, or human receipts remain open. Reuse clientRequestId for identical retries.",
  RequestOutcomeRework:
    "Send the delivered result back for rework under the unchanged approved contract when the goal is in review_pending and the owner's words in this turn ask to revise or fix the delivered result within existing scope. Pass expectedRevision and concrete rework instructions in reason. Only allowed in owner-initiated turns. Reuse clientRequestId for identical retries.",
  CancelOutcome:
    "Cancel this goal, keeping its history and stopping unfinished work. Only when the owner's words in this turn ask to cancel, stop or drop it; the server refuses otherwise. Reuse clientRequestId for identical retries.",
};

export const OUTCOME_GOAL_THREAD_TOOLS = OUTCOME_GOAL_THREAD_TOOL_NAMES.map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: JSONSchema.make(GoalThreadInputs[name] as Schema.Schema.AnyNoContext),
}));

export function decodeOutcomeThreadInput<Name extends OutcomeThreadToolName>(
  name: Name,
  value: unknown
): (typeof GoalThreadInputs)[Name]["Type"] {
  return Schema.decodeUnknownSync(GoalThreadInputs[name] as Schema.Schema.AnyNoContext)(value, {
    onExcessProperty: "error",
  });
}
