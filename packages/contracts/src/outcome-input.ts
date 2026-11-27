import { Schema } from "effect";
import { AssetRef } from "./asset-ref";
import { CLIENT_CAPABILITIES } from "./capabilities";
import {
  OUTCOME_LIMITS,
  OutcomeBudgetInput,
  OutcomeInstant,
  OutcomeKindSchema,
  OutcomeSourceRefSchema,
  OutcomeStatusSchema,
  OutcomeUrgencySchema,
  Uuid,
  outcomeKindRequiresBot,
  parseOffsetTimestamp,
} from "./outcome-view";

const Strict = { parseOptions: { onExcessProperty: "error" } } as const;
const ClientRequestId = Schema.Trim.pipe(Schema.minLength(8), Schema.maxLength(200));
const RevisionNumber = Schema.Number.pipe(Schema.int(), Schema.between(1, 2_147_483_647));
const Title = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.titleChars));
const Tag = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(40));
const Tags = Schema.Array(Tag).pipe(Schema.maxItems(50));
const Attachments = Schema.Array(AssetRef).pipe(Schema.maxItems(CLIENT_CAPABILITIES.uploads.maxAttachmentsPerMessage));
const optionalInstant = Schema.optional(Schema.NullOr(OutcomeInstant));

const editableFields = {
  description: Schema.optional(Schema.String),
  attachments: Schema.optional(Attachments),
  tags: Schema.optional(Tags),
  urgency: Schema.optional(OutcomeUrgencySchema),
  botId: Schema.optional(Schema.NullOr(Uuid)),
  dueAt: optionalInstant,
  scheduledAt: optionalInstant,
  prepareAt: optionalInstant,
  prepareInstruction: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(OUTCOME_LIMITS.sourceTextChars)))),
  followUpAt: optionalInstant,
  sourceRef: Schema.optional(Schema.NullOr(OutcomeSourceRefSchema)),
  syncToMemory: Schema.optional(Schema.Boolean),
  budget: Schema.optional(Schema.NullOr(OutcomeBudgetInput.annotations(Strict))),
};

export const validateOutcomePreparation = ({ prepareAt, scheduledAt }: { prepareAt?: string | null | undefined; scheduledAt?: string | null | undefined }) =>
  prepareAt && scheduledAt !== undefined && (!scheduledAt || Date.parse(prepareAt) >= Date.parse(scheduledAt))
    ? { path: ["prepareAt"], message: "prepareAt must be before scheduledAt" }
    : undefined;

export const CreateOutcomeFields = Schema.Struct({
  ...editableFields,
  kind: OutcomeKindSchema,
  title: Title,
  parentOutcomeId: Schema.optional(Schema.NullOr(Uuid)),
  autoPlan: Schema.optional(Schema.Boolean),
  clientRequestId: ClientRequestId,
}).annotations(Strict);

export function validateCreateOutcomeFields(input: typeof CreateOutcomeFields.Type, { requireBot = true } = {}) {
  if (requireBot && outcomeKindRequiresBot(input.kind) && !input.botId) {
    return { path: ["botId"], message: `botId is required for ${input.kind}` };
  }
  if (input.kind === "scheduled_once") {
    if (!input.scheduledAt) return { path: ["scheduledAt"], message: "scheduledAt is required for scheduled_once" };
    if (!input.description?.trim()) return { path: ["description"], message: "An execution instruction is required for scheduled_once" };
  } else if (input.prepareAt !== undefined || input.prepareInstruction !== undefined) {
    return { path: ["prepareAt"], message: "Preparation fields are only supported for scheduled_once" };
  }
  if (input.syncToMemory !== undefined && input.kind !== "note") {
    return { path: ["syncToMemory"], message: "Only notes can sync to memory" };
  }
  if (input.budget !== undefined && input.kind !== "explore_idea") {
    return { path: ["budget"], message: "Only explore ideas accept a budget at creation" };
  }
  return validateOutcomePreparation(input);
}

export const CreateOutcomeInput = CreateOutcomeFields.pipe(Schema.filter((input) => validateCreateOutcomeFields(input)));
export type CreateOutcomeInput = typeof CreateOutcomeInput.Type;

export const UpdateOutcomeFields = Schema.Struct({
  ...editableFields,
  title: Schema.optional(Title),
  snoozeUntil: optionalInstant,
  expectedRevision: RevisionNumber,
  clientRequestId: ClientRequestId,
}).annotations(Strict);

export const UpdateOutcomeInput = UpdateOutcomeFields.pipe(Schema.filter(({ expectedRevision, clientRequestId, ...changes }) =>
  Object.values(changes).some((value) => value !== undefined) ? validateOutcomePreparation(changes) : "At least one editable field is required",
));
export type UpdateOutcomeInput = typeof UpdateOutcomeInput.Type;

export const ConvertOutcomeInput = Schema.Struct({
  targetKind: OutcomeKindSchema,
  expectedRevision: RevisionNumber,
  botId: Schema.optional(Uuid),
  scheduledAt: Schema.optional(OutcomeInstant),
  autoPlan: Schema.optional(Schema.Boolean),
  clientRequestId: ClientRequestId,
}).annotations(Strict);
export type ConvertOutcomeInput = typeof ConvertOutcomeInput.Type;

export const OutcomeIntakeInput = Schema.Struct({
  text: Schema.optional(Schema.String),
  attachments: Schema.optional(Attachments),
  botId: Schema.optional(Uuid),
  clientRequestId: ClientRequestId,
}).annotations(Strict).pipe(Schema.filter(({ text, attachments }) =>
  (text?.trim() || attachments?.length) ? undefined : "Text or at least one attachment is required",
));
export type OutcomeIntakeInput = typeof OutcomeIntakeInput.Type;

const lifecycleActions = ["accept_todo", "restore", "pause", "resume", "archive", "unarchive", "cancel"] as const;
export const OUTCOME_ACTIONS = [...lifecycleActions, "snooze", "complete", "dismiss", "handoff_to_bot", "close_tracked"] as const;
export type OutcomeAction = (typeof OUTCOME_ACTIONS)[number];
const ActionNote = Schema.String.pipe(Schema.maxLength(OUTCOME_LIMITS.commentChars));

export function outcomeActionSchemas<Fields extends Schema.Struct.Fields>(extraFields: Fields) {
  const common = {
    ...extraFields,
    expectedRevision: Schema.optional(RevisionNumber),
    clientRequestId: ClientRequestId,
  };
  return Schema.Union(
    Schema.Struct({ ...common, action: Schema.Literal(...lifecycleActions) }).annotations(Strict),
    Schema.Struct({
      ...common,
      action: Schema.Literal("snooze"),
      payload: Schema.Struct({ snoozeUntil: OutcomeInstant }).annotations(Strict),
    }).annotations(Strict),
    Schema.Struct({
      ...common,
      action: Schema.Literal("complete"),
      payload: Schema.optional(Schema.Struct({ note: ActionNote }).annotations(Strict)),
    }).annotations(Strict),
    Schema.Struct({
      ...common,
      action: Schema.Literal("dismiss"),
      payload: Schema.optional(Schema.Struct({ reason: ActionNote }).annotations(Strict)),
    }).annotations(Strict),
    Schema.Struct({
      ...common,
      action: Schema.Literal("handoff_to_bot"),
      payload: Schema.Struct({ botId: Uuid, instruction: Schema.optional(ActionNote) }).annotations(Strict),
    }).annotations(Strict),
    Schema.Struct({
      ...common,
      action: Schema.Literal("close_tracked"),
      payload: Schema.Struct({
        resultSummary: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(OUTCOME_LIMITS.changeSummaryChars)),
      }).annotations(Strict),
    }).annotations(Strict),
  );
}

export const ActOnOutcomeInput = outcomeActionSchemas({});
export type ActOnOutcomeInput = typeof ActOnOutcomeInput.Type;

export const OutcomeListViewSchema = Schema.Literal("all", "needs_me", "suggestions", "history");
export type OutcomeListView = typeof OutcomeListViewSchema.Type;

export const ListOutcomesFilterInput = Schema.Struct({
  kinds: Schema.optional(Schema.Array(OutcomeKindSchema)),
  statuses: Schema.optional(Schema.Array(OutcomeStatusSchema)),
  view: Schema.optional(OutcomeListViewSchema),
  tag: Schema.optional(Tag),
  tags: Schema.optional(Tags),
  botId: Schema.optional(Uuid),
  query: Schema.optional(Schema.Trim.pipe(Schema.maxLength(200))),
  from: Schema.optional(OutcomeInstant),
  to: Schema.optional(OutcomeInstant),
  includeArchived: Schema.optional(Schema.Boolean),
  cursor: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, OUTCOME_LIMITS.listPageSizeMax))),
}).annotations(Strict);
export type ListOutcomesFilterInput = typeof ListOutcomesFilterInput.Type;

export const validateOutcomeDateRange = ({ from, to }: Pick<ListOutcomesFilterInput, "from" | "to">) =>
  from && to && parseOffsetTimestamp(from)!.getTime() >= parseOffsetTimestamp(to)!.getTime()
    ? { path: ["to"], message: "to must be after from" }
    : undefined;

const autoAcceptRuleFields = Schema.Struct({
  name: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(80)),
  routineId: Schema.optional(Schema.NullOr(Uuid)),
  botId: Schema.optional(Schema.NullOr(Uuid)),
  sourceKind: Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(40)))),
  enabled: Schema.optional(Schema.Boolean),
}).annotations(Strict);

export const CreateOutcomeAutoAcceptRuleInput = autoAcceptRuleFields.pipe(Schema.filter(({ routineId, botId }) =>
  routineId || botId ? undefined : "A routineId or botId must bind the rule",
));
export type CreateOutcomeAutoAcceptRuleInput = typeof CreateOutcomeAutoAcceptRuleInput.Type;

export const UpdateOutcomeAutoAcceptRuleInput = Schema.partial(autoAcceptRuleFields).annotations(Strict).pipe(Schema.filter((changes) => {
  if (!Object.values(changes).some((value) => value !== undefined)) return "At least one editable field is required";
  if (changes.routineId === null && changes.botId === null) return "A routineId or botId must bind the rule";
  return undefined;
}));
export type UpdateOutcomeAutoAcceptRuleInput = typeof UpdateOutcomeAutoAcceptRuleInput.Type;

export interface OutcomeAutoAcceptRuleView {
  id: string;
  name: string;
  routineId: string | null;
  botId: string | null;
  sourceKind: string | null;
  enabled: boolean;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
