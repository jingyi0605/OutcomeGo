import { JSONSchema, Schema } from "effect";
import { CreateContractRevisionInput, type DecisionEffect } from "./outcomes";
import { OUTCOME_INBOX_CATEGORIES, type OutcomeInboxCategory } from "./outcome-inbox-categories";

export const DECISION_STATUSES = ["open", "presented", "resolved", "expired", "withdrawn"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export { CREDENTIAL_ACCESS_REASON_CODE, OUTCOME_INBOX_CATEGORIES, type OutcomeInboxCategory } from "./outcome-inbox-categories";

export interface DecisionActionCard {
  title: string;
  purpose: string;
  steps: readonly string[];
  evidenceRequirements: ReadonlyArray<{ criterionOrdinal: number; label: string; kind: "text" | "asset" | "sourceReference" | "observation" }>;
  referenceIds?: readonly string[];
}

/** The entire server-authored option is retained, including its effect and source. */
export interface DecisionOption {
  id: string;
  label: string;
  consequence: string;
  resolutionEffect: DecisionEffect;
  createdAt?: string;
  source: "planner" | "runtime" | "reviewer";
  recommended?: boolean;
  reason?: string;
  contract?: CreateContractRevisionInput["contract"];
  manualAction?: DecisionActionCard;
  supplement?: { title: string; instructions: string };
  /**
   * Password-manager items the owner lets this Outcome read once this option is chosen. Only the server
   * writes it (the agent-facing tool schema has no such field), and the grant is the resolved option itself.
   */
  credentialGrant?: readonly CredentialGrantItem[];
}

export interface CredentialGrantItem {
  connectionId: string;
  itemId: string;
  title: string;
  hostname: string;
  instanceName: string;
}

/** Internal service input; never accepted directly from the public resolve route. */
export interface DecisionCreateInput {
  outcomeId: string;
  contractRevisionId: string;
  runId?: string;
  workItemId?: string;
  reasonCode: string;
  completedSummary: string;
  problemSummary: string;
  nextStepSummary: string;
  recommendation?: { optionId: string; reason: string };
  options: readonly DecisionOption[];
  customEntryAllowed?: boolean;
  expiresAt?: string;
}

export interface DecisionView {
  id: string;
  outcomeId: string;
  contractRevisionId: string;
  contractRevision: number;
  runId: string | null;
  workItemId: string | null;
  status: DecisionStatus;
  reasonCode: string;
  completedSummary: string;
  problemSummary: string;
  nextStepSummary: string;
  recommendation: { optionId: string; reason: string } | null;
  options: DecisionOption[];
  customEntryAllowed: boolean;
  expiresAt: string | null;
  resolvedOption: DecisionOption | null;
  customText: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  truncatedOptionCount: number;
  createdAt: string;
}

const RequestId = Schema.String.pipe(Schema.minLength(8), Schema.maxLength(200));
export const ResolveDecisionInput = Schema.Struct({
  optionId: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)))),
  customText: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4000)))),
  expectedContractRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  clientRequestId: RequestId,
});
export type ResolveDecisionInput = typeof ResolveDecisionInput.Type;
export const WithdrawDecisionInput = Schema.Struct({ clientRequestId: RequestId });
export type WithdrawDecisionInput = typeof WithdrawDecisionInput.Type;

export interface DecisionResolution {
  decisionId: string;
  status: "resolved";
  outcomeId: string;
  contractRevision: number;
  resolutionEffect: DecisionEffect;
  resume: { status: "enqueued" | "queued_for_capacity" | "pending_approval" | "cancelled" | "waiting_human" | "recorded"; workItemIds: string[]; revisionId?: string; cardId?: string };
}

export interface OutcomeInboxItemView {
  id: string;
  outcomeId: string;
  contractRevision: number;
  decisionId?: string;
  workItemId?: string;
  criterionIds?: string[];
  category: OutcomeInboxCategory;
  priority: number;
  title: string;
  completed: string;
  problem: string;
  next: string;
  requiresAction: boolean;
  availableAt: string;
  createdAt: string;
  read: boolean;
}
export interface OutcomeInboxPage { items: OutcomeInboxItemView[]; nextCursor: string | null }
export interface OutcomeInboxCursor { priority: number; availableAt: string; createdAt?: string; id: string; snapshotAt: string }
export interface OutcomeInboxQuery {
  status: "pending" | "completed" | "all";
  category?: OutcomeInboxCategory;
  limit: number;
  cursor: OutcomeInboxCursor | null;
}
export const encodeOutcomeInboxCursor = (value: OutcomeInboxCursor): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const parseOutcomeInboxQuery = (params: URLSearchParams): OutcomeInboxQuery => {
  const status = params.get("status") ?? "pending";
  const category = params.get("category") ?? undefined;
  const limit = params.has("limit") ? Number(params.get("limit")) : 30;
  if (!["pending", "completed", "all"].includes(status) || (category && !(OUTCOME_INBOX_CATEGORIES as readonly string[]).includes(category)) || !Number.isInteger(limit) || limit < 1)
    throw new Error("Invalid inbox query");
  let cursor: OutcomeInboxCursor | null = null;
  if (params.has("cursor")) {
    try {
      const raw = params.get("cursor")!;
      if (raw.length > 1000) throw new Error();
      cursor = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
      if (!cursor || !Number.isInteger(cursor.priority) || cursor.priority < 0 || cursor.priority > 4 || typeof cursor.id !== "string" || !/^[a-z_]+:[0-9a-f-]{36}$/i.test(cursor.id) || !Number.isFinite(Date.parse(cursor.availableAt)) || !Number.isFinite(Date.parse(cursor.snapshotAt)) || (cursor.createdAt !== undefined && !Number.isFinite(Date.parse(cursor.createdAt)))) throw new Error();
    } catch { throw new Error("Invalid inbox cursor"); }
  }
  return { status: status as OutcomeInboxQuery["status"], category: category as OutcomeInboxCategory | undefined, limit: Math.min(limit, 100), cursor };
};


const DecisionToolText = (max: number) => Schema.String.pipe(Schema.minLength(1), Schema.maxLength(max));
const DecisionManualAction = Schema.Struct({
  title: DecisionToolText(200), purpose: DecisionToolText(4000),
  steps: Schema.Array(DecisionToolText(2000)).pipe(Schema.minItems(1), Schema.maxItems(20)),
  evidenceRequirements: Schema.Array(Schema.Struct({
    criterionOrdinal: Schema.Number.pipe(Schema.int(), Schema.positive()), label: DecisionToolText(500),
    kind: Schema.Literal("text", "asset", "sourceReference", "observation"),
  })).pipe(Schema.minItems(1), Schema.maxItems(100)),
  referenceIds: Schema.optional(Schema.Array(DecisionToolText(500)).pipe(Schema.maxItems(100))),
});

/** Agent proposals become immutable server-validated options; owner resolve never accepts effects. */
export const RequestOutcomeDecisionInput = Schema.Struct({
  completedSummary: DecisionToolText(4000), problemSummary: DecisionToolText(4000), nextStepSummary: DecisionToolText(4000),
  reasonCode: Schema.Literal("scope_change_required", "missing_input", "acceptance_failed", "external_result_unknown", "manual_action_required", "budget_or_time_decision"),
  options: Schema.Array(Schema.Struct({
    label: DecisionToolText(200), consequence: DecisionToolText(4000),
    recommended: Schema.optional(Schema.Boolean), reason: Schema.optional(DecisionToolText(2000)),
    resolutionEffect: Schema.optional(Schema.Literal("plan_only", "scope_change", "acceptance_change", "cancel_branch", "manual_action")),
    contract: Schema.optional(CreateContractRevisionInput.fields.contract),
    manualAction: Schema.optional(DecisionManualAction),
    supplement: Schema.optional(Schema.Struct({ title: DecisionToolText(200), instructions: DecisionToolText(4000) })),
  })).pipe(Schema.minItems(1), Schema.maxItems(100)),
});
export type RequestOutcomeDecisionInput = typeof RequestOutcomeDecisionInput.Type;
export interface RequestOutcomeDecisionResult { decisionId: string; status: "waiting_for_user" }
export const REQUEST_OUTCOME_DECISION_TOOL = {
  name: "RequestOutcomeDecision",
  description: "Ask the Outcome owner for a decision. Explain what is complete, the problem (or no unresolved issue), and the next step. Provide 1-4 options; extra options are truncated. Effects require their complete snapshots. This ends the current Outcome turn; wait for a new turn after the owner decides. Never poll or send the question to the Bot's main conversation.",
  inputSchema: JSONSchema.make(RequestOutcomeDecisionInput),
} as const;


/** Additive field on authenticated GET /notification-state; unknown fields remain safe for older clients. */
export interface OutcomeNotificationState {
  outcomeNotifications: import("./notification-content").OutcomeNotificationPayload[];
}

/** The shared Decision constructor validates revisions without adding a second schema. */
export const parseDecisionContractSnapshot = Schema.decodeUnknownSync(CreateContractRevisionInput.fields.contract);
