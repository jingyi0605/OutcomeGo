import { Schema } from "effect";
import { OutcomeBudgetInput, type OutcomeBudget, type PlanningDraftView } from "./outcomes";

export const EXPLORE_STATUSES = ["draft", "exploring", "proposed_for_delivery", "converted", "discarded"] as const;
export type ExploreStatus = (typeof EXPLORE_STATUSES)[number];
export const EXPLORE_ERROR_CODES = {
  explore_not_found: 404,
  explore_read_only: 409,
  explore_bot_required: 422,
} as const;

const Uuid = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i));
const RequestId = Schema.String.pipe(Schema.minLength(8), Schema.maxLength(200));
export const ExploreSourceReferenceInput = Schema.Struct({
  sourceRef: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  title: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  sourceType: Schema.optional(Schema.Literal("file", "message", "url", "fixture")),
  version: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
});
export type ExploreSourceReference = typeof ExploreSourceReferenceInput.Type;
export const CreateExploreIdeaInput = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  note: Schema.optional(Schema.String.pipe(Schema.maxLength(8000))),
  botId: Schema.optional(Schema.NullOr(Uuid)),
  sourceOutcomeId: Schema.optional(Schema.NullOr(Uuid)),
  sourceReferences: Schema.optional(Schema.Array(ExploreSourceReferenceInput).pipe(Schema.maxItems(50))),
  budget: Schema.optional(Schema.NullOr(OutcomeBudgetInput)),
  status: Schema.optional(Schema.Literal("draft", "exploring")),
  clientRequestId: RequestId,
});
export type CreateExploreIdeaInput = typeof CreateExploreIdeaInput.Type;
export const ProposeExploreIdeaInput = Schema.Struct({
  botId: Schema.optional(Uuid),
  clientRequestId: RequestId,
});
export type ProposeExploreIdeaInput = typeof ProposeExploreIdeaInput.Type;
export const DiscardExploreIdeaInput = Schema.Struct({ clientRequestId: RequestId });
export type DiscardExploreIdeaInput = typeof DiscardExploreIdeaInput.Type;

export interface ExploreIdeaView {
  id: string;
  botId: string | null;
  title: string;
  note: string;
  status: ExploreStatus;
  sourceOutcomeId: string | null;
  sourceReferences: ExploreSourceReference[];
  budget: OutcomeBudget | null;
  planningDraftId: string | null;
  proposedOutcomeId: string | null;
  createdAt: string;
  updatedAt: string;
  discardedAt: string | null;
}
export interface ExploreIdeaPage {
  items: ExploreIdeaView[];
  nextCursor: string | null;
}
export interface ExploreProposal {
  idea: ExploreIdeaView;
  plan: PlanningDraftView;
}
