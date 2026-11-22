import { JSONSchema, Schema } from "effect";
import type { OutcomeThreadTurnModelView } from "./inference";
import { OUTCOME_CHAT_INPUTS } from "./outcome-chat";
import {
  CancelOutcomeInput,
  CreateContractRevisionInput,
  OUTCOME_LIMITS,
  OutcomeBudgetInput,
  PLAN_LIMITS,
  PLAN_TASK_NATURES,
  PREREVIEW_SUGGESTIONS,
  Uuid,
} from "./outcomes";

/**
 * A goal's own Agent thread (specs/004.8, 004.9). The owner's words go to the bot as they are; the bot decides what
 * to do and writes facts through these tools. Nothing here can approve a contract or accept a result.
 */
export const OUTCOME_THREAD_ROLES = ["planner", "reviewer"] as const;
export type OutcomeThreadRole = (typeof OUTCOME_THREAD_ROLES)[number];
export const OUTCOME_THREAD_PURPOSES = ["plan", "owner_message", "replan", "review", "review_task"] as const;
export type OutcomeThreadPurpose = (typeof OUTCOME_THREAD_PURPOSES)[number];
export const OUTCOME_THREAD_TURN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type OutcomeThreadTurnStatus = (typeof OUTCOME_THREAD_TURN_STATUSES)[number];

export const OUTCOME_THREAD_TEXT_CHARS = 8_000;
const ClientRequestId = CancelOutcomeInput.fields.clientRequestId;
const Text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_THREAD_TEXT_CHARS));

/** The owner's words about a goal; they reach the bot unchanged. */
export const SendOutcomeThreadMessageInput = Schema.Struct({ text: Text, clientRequestId: ClientRequestId });
export type SendOutcomeThreadMessageInput = typeof SendOutcomeThreadMessageInput.Type;

/** A new goal described in the owner's own words; the chosen bot plans it. */
export const CreateOutcomeThreadInput = Schema.Struct({
  text: Text,
  botId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  exploreIdeaId: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100))),
  postToChat: Schema.optional(Schema.Boolean),
  clientRequestId: ClientRequestId,
});
export type CreateOutcomeThreadInput = typeof CreateOutcomeThreadInput.Type;

export interface OutcomeThreadTurnView {
  id: string;
  purpose: OutcomeThreadPurpose;
  /** The owner's words, as sent, or system trigger description. */
  trigger: string;
  status: OutcomeThreadTurnStatus;
  /** The bot's final message for the turn. */
  reply: string | null;
  error: { code: string; message: string } | null;
  runId: string | null;
  model?: OutcomeThreadTurnModelView | null;
  workItemId?: string | null;
  result?: unknown | null;
  createdAt: string;
  updatedAt: string;
}
export interface OutcomeThreadView {
  threadId: string | null;
  turns: OutcomeThreadTurnView[];
  reviewerThreadId?: string | null;
  reviewTurns?: OutcomeThreadTurnView[];
}

const contractFields = CreateContractRevisionInput.fields.contract.fields;
const RevisionNumber = Schema.Number.pipe(Schema.int(), Schema.positive());

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
  GetOutcome: OUTCOME_CHAT_INPUTS.GetOutcome,
  ListOutcomes: OUTCOME_CHAT_INPUTS.ListOutcomes,
  CancelOutcome: OUTCOME_CHAT_INPUTS.CancelOutcome,
} as const;

export type SaveOutcomeContractInput = typeof GoalThreadInputs.SaveOutcomeContract.Type;
export type SavePlanInput = typeof GoalThreadInputs.SavePlan.Type;
export type SubmitPrereviewInput = typeof GoalThreadInputs.SubmitPrereview.Type;
export type ReviewTaskResultInput = typeof GoalThreadInputs.ReviewTaskResult.Type;
export type OutcomeThreadToolName = keyof typeof GoalThreadInputs;
export const OUTCOME_GOAL_THREAD_TOOL_NAMES = Object.keys(GoalThreadInputs) as OutcomeThreadToolName[];

export const OUTCOME_THREAD_TOOLS_BY_PURPOSE: Record<OutcomeThreadPurpose, readonly OutcomeThreadToolName[]> = {
  plan: ["SaveOutcomeContract", "SavePlan", "CancelOutcome", "GetOutcome", "ListOutcomes"],
  owner_message: ["SaveOutcomeContract", "SavePlan", "CancelOutcome", "GetOutcome", "ListOutcomes"],
  replan: ["SaveOutcomeContract", "SavePlan", "CancelOutcome", "GetOutcome", "ListOutcomes"],
  review: ["GetOutcome", "SubmitPrereview"],
  review_task: ["GetOutcome", "ReviewTaskResult"],
};

export const goalThreadToolsForPurpose = (purpose: OutcomeThreadPurpose): readonly OutcomeThreadToolName[] =>
  OUTCOME_THREAD_TOOLS_BY_PURPOSE[purpose];

const descriptions: Record<OutcomeThreadToolName, string> = {
  SaveOutcomeContract:
    "Write this goal's contract yourself and save it for the owner's approval: goal statements, acceptance criteria and scope boundaries, optional budget. The first call also needs a title. Later calls replace the pending contract with a new revision; unchanged content is refused. The owner approves in the app: never approve it, never ask them to approve it elsewhere. Write for the owner to read: concrete, no filler. Reuse clientRequestId for identical retries.",
  SavePlan:
    "Save the executable task plan for the current contract revision. Each task requires a unique key, title, self-contained instructions, assigned botId, covered acceptance criterion ids, and nature (deliverable or action; never omit nature). Before approval, replaces the plan on the pending revision; after approval, may only add tasks or modify/remove unstarted queued tasks without touching started or finished tasks. Reuse clientRequestId for identical retries.",
  SubmitPrereview:
    "Record your holistic preliminary review for every acceptance criterion of the current revision. Inspect the saved outputs however you need (GetOutcome, Read, read-only Shell). `conclusion` is what the owner reads first: either one complete sentence of at most 50 characters, or 2-5 complete items of at most 30 characters each (the app numbers them). Every sentence or item states a subject, a concrete recorded fact with its figure, and what it means for the decision; no fragments, no process detail. Put reasons per criterion in `results`, owner questions in `attention` (only for likely_fail or unclear required criteria), and optional charts in `charts`. A chart point cites either an `evidenceId` or a saved output `file` path, plus the exact excerpt that contains its label, value and unit; the app checks the excerpt exists and shows where it came from. Advisory only: never approves or accepts the goal. Reuse clientRequestId for identical retries.",
  ReviewTaskResult:
    "Record your task-level review verdict (pass or reject) for one completed deliverable work item. Default to pass. Reject only for serious errors or omissions backed by a required criterion covered by the task or an explicit contract boundary, with a clear reason. Each task can be rejected at most once. Notes are for holistic review only and are never sent to the executing bot. Reuse clientRequestId for identical retries.",
  GetOutcome:
    "Read this goal's facts: current contract and revision, Work items, Outputs, Evidence and Reviews. Output contentRef paths point into /workspace. Use Read or a read-only Shell command to inspect referenced files before judging their contents. Use it before changing anything.",
  ListOutcomes:
    "Find native goals by text or status. Read-only.",
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
