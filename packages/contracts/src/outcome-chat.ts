import { JSONSchema, Schema } from "effect";
import { GetOutcomeInput, QueryOutcomesInput, RequestOutcomePlanInput } from "./outcome-thread";
import {
  CreateOutcomeFields,
  OutcomeKindSchema,
  UpdateOutcomeFields,
  Uuid,
  outcomeActionSchemas,
  validateCreateOutcomeFields,
  validateOutcomePreparation,
} from "./outcomes";

export * from "./outcome-chat-card";

/** Ordinary conversation tools reuse the UI's inputs; the authenticated actor comes from the Run. */
export const OUTCOME_CHAT_INPUTS = {
  CreateOutcome: Schema.Struct({
    ...CreateOutcomeFields.omit("autoPlan").fields,
    ownerMessageRef: Schema.optional(Uuid),
  }).pipe(Schema.filter((input) => validateCreateOutcomeFields(input, { requireBot: false }))),
  UpdateOutcome: Schema.Struct({
    outcomeId: Uuid,
    ...UpdateOutcomeFields.fields,
    targetKind: Schema.optional(OutcomeKindSchema),
  }).pipe(Schema.filter(({ outcomeId, expectedRevision, clientRequestId, ...changes }) =>
    Object.values(changes).some((value) => value !== undefined)
      ? validateOutcomePreparation(changes)
      : "At least one editable field or targetKind is required",
  )),
  QueryOutcomes: QueryOutcomesInput,
  GetOutcome: GetOutcomeInput,
  ActOnOutcome: outcomeActionSchemas({ outcomeId: Uuid }),
  PlanOutcome: Schema.Struct({
    outcomeId: Uuid,
    ...RequestOutcomePlanInput.fields,
    mode: Schema.optional(Schema.Literal("advice", "contract_plan")),
  }),
} as const;

export type OutcomeChatToolName = keyof typeof OUTCOME_CHAT_INPUTS;
export const OUTCOME_CHAT_TOOL_NAMES = Object.keys(OUTCOME_CHAT_INPUTS) as OutcomeChatToolName[];

const descriptions: Record<OutcomeChatToolName, string> = {
  CreateOutcome:
    "Create a native goal, tracked outcome, one-time schedule, to-do, idea, or note. A standard goal queues planning and still needs the owner's contract approval. A to-do stays suggested without an authorized ownerMessageRef or a matching auto-accept rule. Use description for Markdown notes or execution instructions, and scheduledAt for a one-time schedule. Use tracked only for explicitly requested self-managed tracking that needs neither owner approval nor acceptance. Reuse clientRequestId for identical retries.",
  UpdateOutcome:
    "Update an existing Outcome's title, description, tags, attachments, or timing using its current expectedRevision. To convert it in place, pass targetKind; this keeps its identity and history. This does not approve a contract or accept a standard goal. Reuse clientRequestId for identical retries.",
  QueryOutcomes:
    "Find native Outcomes across all kinds, including notes and to-dos. Filter by kinds, statuses, tags, search text, or date range; use the returned cursor for the next page. Read-only.",
  GetOutcome:
    "Read an Outcome's full content, attachments, latest advice and any contract, Work Items, Outputs, Evidence and Reviews. Optionally read a historical revision or a Work Item transcript with pagination. A report from a Bot is not owner acceptance.",
  ActOnOutcome:
    "Apply a lifecycle action the user requested, such as completing a to-do, postponing it, pausing a schedule, or archiving a note. Check the target first if ambiguous. Use close_tracked only for completed self-managed tracked work, with a result summary. Does not approve contracts or accept standard goals. Reuse clientRequestId for identical retries.",
  PlanOutcome:
    "Queue structured advice or a formal contract and task plan for an existing Outcome. The planner researches and prepares a result without running the actual work or granting approvals. If omitted, mode defaults to contract_plan for standard goals and advice for other kinds. Reuse clientRequestId for identical retries.",
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
