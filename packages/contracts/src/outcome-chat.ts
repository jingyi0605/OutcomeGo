import { JSONSchema, Schema } from "effect";
import {
  CancelOutcomeInput,
  CloseOutcomeInput,
  CreateContractRevisionInput,
  CreateOutcomeFromContractInput,
  OUTCOME_STATUSES,
  StartOutcomeRunInput,
  TrackOutcomeInput,
  Uuid,
} from "./outcomes";
import {
  CreateExploreIdeaInput,
  DiscardExploreIdeaInput,
  EXPLORE_STATUSES,
} from "./explore";
import { OUTCOME_INBOX_CATEGORIES } from "./outcome-inbox";

export const OUTCOME_CARD_STAGES = [
  "analyzing",
  "generating",
  "plan_ready",
  "draft",
  "ready",
  "running",
  "attention",
  "review",
  "accepted",
  "cancelled",
  "failed",
] as const;
export type OutcomeCardStage = (typeof OUTCOME_CARD_STAGES)[number];
export function outcomeCardStage(status: string): OutcomeCardStage {
  if (status === "accepted" || status === "cancelled" || status === "failed") return status;
  if (status === "review_pending") return "review";
  if (status === "approved") return "ready";
  if (status === "planning") return "generating";
  if (["decision_pending", "human_action_pending", "blocked", "paused"].includes(status))
    return "attention";
  if (["draft", "pending_approval"].includes(status)) return "draft";
  return status === "running" ? "running" : "attention";
}
/** A compact saved projection, never a substitute for the current Outcome or owner approval. */
export interface OutcomeChatCard {
  stage: OutcomeCardStage;
  title: string;
  summary?: string;
  outcomeId?: string;
  planId?: string;
  revision?: number;
  updatedAt: string;
  suggestions?: { goals: string[]; acceptance: string[]; boundaries: string[] };
}
/** Marks a goal card the platform posted as a user notice; it is not a Bot message. */
export const OUTCOME_UPDATE_CARD_SOURCE = "outcome-update";
export function isOutcomeUpdateCardMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.type === "outcome-card" && record.source === OUTCOME_UPDATE_CARD_SOURCE;
}
export function parseOutcomeChatCard(value: unknown): OutcomeChatCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const card = value as OutcomeChatCard;
  if (
    !(OUTCOME_CARD_STAGES as readonly unknown[]).includes(card.stage) ||
    typeof card.title !== "string" ||
    typeof card.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(card.updatedAt))
  )
    return null;
  if (card.outcomeId !== undefined && typeof card.outcomeId !== "string") return null;
  if (card.planId !== undefined && typeof card.planId !== "string") return null;
  if (card.summary !== undefined && typeof card.summary !== "string") return null;
  if (
    card.suggestions !== undefined &&
    !["goals", "acceptance", "boundaries"].every(
      (key) =>
        Array.isArray(
          card.suggestions?.[key as keyof NonNullable<OutcomeChatCard["suggestions"]>]
        ) &&
        card.suggestions![key as keyof NonNullable<OutcomeChatCard["suggestions"]>].every(
          (text) => typeof text === "string"
        )
    )
  )
    return null;
  return card;
}

const Id = Uuid;
const PageSize = Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 100)));
const Cursor = Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)));
const { botId: _botId, ...exploreFields } = CreateExploreIdeaInput.fields;

/** Ordinary conversation tools reuse the UI's inputs; actors and planning Bot come from the Run. */
export const OUTCOME_CHAT_INPUTS = {
  CreateOutcome: CreateOutcomeFromContractInput,
  ListOutcomes: Schema.Struct({
    query: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
    statuses: Schema.optional(Schema.Array(Schema.Literal(...OUTCOME_STATUSES))),
    cursor: Cursor,
    limit: PageSize,
  }),
  GetOutcome: Schema.Struct({
    outcomeId: Id,
    revision: Schema.optional(CreateContractRevisionInput.fields.baseRevision),
    workItemId: Schema.optional(Id),
    before: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
    limit: PageSize,
  }),
  ReviseOutcome: Schema.Struct({ outcomeId: Id, ...CreateContractRevisionInput.fields }),
  StartOutcome: Schema.Struct({ outcomeId: Id, ...StartOutcomeRunInput.fields }),
  CancelOutcome: Schema.Struct({ outcomeId: Id, ...CancelOutcomeInput.fields }),
  TrackOutcome: TrackOutcomeInput,
  CloseOutcome: Schema.Struct({ outcomeId: Id, ...CloseOutcomeInput.fields }),
  ListOutcomeInbox: Schema.Struct({
    outcomeId: Schema.optional(Id),
    status: Schema.optional(Schema.Literal("pending", "completed", "all")),
    category: Schema.optional(Schema.Literal(...OUTCOME_INBOX_CATEGORIES)),
    cursor: Cursor,
    limit: PageSize,
  }),
  ListExploreIdeas: Schema.Struct({
    statuses: Schema.optional(Schema.Array(Schema.Literal(...EXPLORE_STATUSES))),
    cursor: Cursor,
    limit: PageSize,
  }),
  GetExploreIdea: Schema.Struct({ ideaId: Id }),
  CreateExploreIdea: Schema.Struct(exploreFields),
  DiscardExploreIdea: Schema.Struct({ ideaId: Id, ...DiscardExploreIdeaInput.fields }),
} as const;

export type OutcomeChatToolName = keyof typeof OUTCOME_CHAT_INPUTS;
export const OUTCOME_CHAT_TOOL_NAMES = Object.keys(OUTCOME_CHAT_INPUTS) as OutcomeChatToolName[];

const descriptions: Record<OutcomeChatToolName, string> = {
  CreateOutcome:
    "Save a native goal with a contract you wrote yourself (title, goal statements, acceptance criteria, scope boundaries, optional budget). It is saved unapproved: the owner reviews and approves it in the app, you never approve it. Write for the owner to read: concrete, no filler. Return the actual goal link and one short next step. Use native goals rather than Notion or TodoWrite unless the user asked for those. Reuse clientRequestId for identical retries.",
  ListOutcomes:
    "Find native goals by title/description, execution statuses and cursor. Omit filters to list all goals, including goals assigned to other Bots on this user's server. Read-only. Do not use Notion or todos as a substitute.",
  GetOutcome:
    "Read native Outcome facts: contract, WorkItems, Runs, Outputs, Evidence and Reviews. Optionally read an actual historical revision or a WorkItem transcript using before/limit pagination. Distinguish pending, running, awaiting review and accepted; an Agent report is not owner acceptance.",
  ReviseOutcome:
    "Propose a complete replacement contract for an existing native goal using the baseRevision just read. Creates a new unapproved revision and preserves prior execution/evidence. Explain the changes and return the link for owner approval. Never approve it yourself. Reuse clientRequestId for identical retries.",
  StartOutcome:
    "Start an existing native Outcome only when the user asks and its exact expectedRevision is already approved by the owner. Cannot approve a draft. Execution runs in a separate Outcome thread, leaving this conversation available. Reuse clientRequestId for identical retries.",
  CancelOutcome:
    "Cancel a native goal when the user asks to cancel it, preserving its history and stopping its unfinished work through the existing service. Read the actual goal first if the target is ambiguous. Reuse clientRequestId for identical retries.",
  TrackOutcome:
    "Register anything you cannot finish within this turn on the user's native goal board, no planning step needed. Check ListOutcomes first to avoid duplicates. ownerNeed: \"none\" = you will handle it yourself (tracked; close it later with CloseOutcome, no user acceptance needed); \"decision\" = the user must choose (give decision.problemSummary and 1-4 options; it appears in their inbox); \"approval\" = the user must approve a plan before you execute (saved as an unapproved draft; never approve it yourself). Never use \"none\" for payments, external sending, deletion, irreversible changes or anything the user must decide. Reuse clientRequestId for identical retries.",
  CloseOutcome:
    "Close a tracked goal you registered with TrackOutcome (ownerNeed none) and finished yourself, with a short result summary. The goal is marked auto-closed and does not wait for user acceptance. Fails for owner-approved goals and for goals with an unresolved user decision. Reuse clientRequestId for identical retries.",
  ListOutcomeInbox:
    "Read native Outcome decisions, acceptance reviews and human actions requiring the user's attention, optionally for one goal. Returns current server facts and a pagination cursor. Does not resolve decisions or mark acceptance.",
  ListExploreIdeas:
    "List native Explore ideas and their statuses with cursor pagination. These are ideas before approved delivery goals, not external notes.",
  GetExploreIdea:
    "Read one native Explore idea, its notes, provenance and planning/Outcome links. Read-only.",
  CreateExploreIdea:
    "Save an idea discussed with the user in native Explore, optionally linked to a source Outcome. Uses this conversation's Bot. Does not execute or approve anything. Reuse clientRequestId for identical retries.",
  DiscardExploreIdea:
    "Discard a native Explore idea when the user asks. Uses the existing terminal-state checks; never deletes an Outcome or its history. Reuse clientRequestId for identical retries.",
};

export const OUTCOME_CHAT_TOOLS = OUTCOME_CHAT_TOOL_NAMES.map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: JSONSchema.make(OUTCOME_CHAT_INPUTS[name] as Schema.Schema.AnyNoContext),
}));

export function decodeOutcomeChatInput<Name extends OutcomeChatToolName>(
  name: Name,
  value: unknown
): (typeof OUTCOME_CHAT_INPUTS)[Name]["Type"] {
  return Schema.decodeUnknownSync(OUTCOME_CHAT_INPUTS[name] as Schema.Schema.AnyNoContext)(value, {
    onExcessProperty: "error",
  });
}
