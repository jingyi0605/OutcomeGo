import { Schema } from "effect";
import type { CreateContractRevisionInput, DecisionEffect } from "./outcomes";

export const DECISION_STATUSES = ["open", "presented", "resolved", "expired", "withdrawn"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const OUTCOME_INBOX_CATEGORIES = ["decision_pending", "acceptance_pending", "human_action_pending", "completed"] as const;
export type OutcomeInboxCategory = (typeof OUTCOME_INBOX_CATEGORIES)[number];

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
  resume: { status: "enqueued" | "queued_for_capacity" | "pending_approval" | "cancelled" | "waiting_human"; workItemIds: string[]; revisionId?: string; cardId?: string };
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
