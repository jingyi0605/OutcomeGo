import { JSONSchema, Schema } from "effect";
import { OUTCOME_CHAT_INPUTS } from "./outcome-chat";
import { CancelOutcomeInput, CreateContractRevisionInput, OUTCOME_LIMITS, OutcomeBudgetInput } from "./outcomes";

/**
 * A goal's own Agent thread (specs/004.8). The owner's words go to the bot as they are; the bot decides what
 * to do and writes facts through these tools. Nothing here can approve a contract or accept a result.
 */
export const OUTCOME_THREAD_PURPOSES = ["plan", "owner_message"] as const;
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
  clientRequestId: ClientRequestId,
});
export type CreateOutcomeThreadInput = typeof CreateOutcomeThreadInput.Type;

export interface OutcomeThreadTurnView {
  id: string;
  purpose: OutcomeThreadPurpose;
  /** The owner's words, as sent. */
  trigger: string;
  status: OutcomeThreadTurnStatus;
  /** The bot's final message for the turn. */
  reply: string | null;
  error: { code: string; message: string } | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface OutcomeThreadView {
  threadId: string | null;
  turns: OutcomeThreadTurnView[];
}

const contractFields = CreateContractRevisionInput.fields.contract.fields;
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
  GetOutcome: OUTCOME_CHAT_INPUTS.GetOutcome,
  ListOutcomes: OUTCOME_CHAT_INPUTS.ListOutcomes,
  CancelOutcome: OUTCOME_CHAT_INPUTS.CancelOutcome,
} as const;

export type SaveOutcomeContractInput = typeof GoalThreadInputs.SaveOutcomeContract.Type;
export type OutcomeThreadToolName = keyof typeof GoalThreadInputs;
export const OUTCOME_GOAL_THREAD_TOOL_NAMES = Object.keys(GoalThreadInputs) as OutcomeThreadToolName[];

const descriptions: Record<OutcomeThreadToolName, string> = {
  SaveOutcomeContract:
    "Write this goal's contract yourself and save it for the owner's approval: goal statements, acceptance criteria and scope boundaries, optional budget. The first call also needs a title. Later calls replace the pending contract with a new revision; unchanged content is refused. The owner approves in the app: never approve it, never ask them to approve it elsewhere. Write for the owner to read: concrete, no filler. Reuse clientRequestId for identical retries.",
  GetOutcome:
    "Read this goal's facts: current contract and revision, Work items, Outputs, Evidence and Reviews. Use it before changing anything.",
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
