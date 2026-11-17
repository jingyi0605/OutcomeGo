import { Schema } from "effect";

export interface OutcomeRecoveryView {
  id: string;
  outcomeId: string;
  contractRevision: number;
  workItemId: string;
  runId?: string;
  sequence: number;
  status: "running" | "waiting_decision" | "waiting_human" | "retrying" | "needs_review" | "completed" | "failed" | "cancelled";
  reasonCode: string | null;
  retryCount: number;
  recoveryCount: number;
  completedItems: string[];
  nextAction?: { type: string; summary: string; idempotencyKey?: string };
  outputRefs: string[];
  evidenceRefs: string[];
  decisionId?: string;
  createdAt: string;
}

export const ReconcileOutcomeInput = Schema.Struct({
  clientRequestId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
});
export type ReconcileOutcomeInput = typeof ReconcileOutcomeInput.Type;

/** Each sample is a foreground duration delta; replay uses the same sample ID. */
export const OutcomeAttentionInput = Schema.Struct({
  clientRequestId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  surface: Schema.Literal("planning", "decision", "review"),
  seconds: Schema.Number.pipe(Schema.finite(), Schema.positive(), Schema.lessThanOrEqualTo(300)),
});
export type OutcomeAttentionInput = typeof OutcomeAttentionInput.Type;

export interface OutcomeRecoveryPage {
  outcomeId: string;
  items: OutcomeRecoveryView[];
  notificationFailures: Array<{ id: string; status: string; attempts: number; errorCode: string | null }>;
}

export interface OutcomeMetrics {
  outcomeId: string;
  planningStartedAt: string | null;
  approvalAt: string | null;
  firstRunAt: string | null;
  acceptedAt: string | null;
  humanInterventionCount: number;
  decisionCount: number;
  reviewCount: number;
  retryCount: number;
  recoveryCount: number;
  duplicateEventCount: number | null;
  notificationCount: number;
  actionableNotificationCount: number;
  attentionSeconds: number | null;
  firstPassAccepted: boolean | null;
  failedCriterionCount: number;
  unverifiedCriterionCount: number;
  contractRevisionCount: number;
  approvedRevisionCount: number;
  unnecessaryNotificationRatio: number | null;
  contractTraceabilityRate: number | null;
}
