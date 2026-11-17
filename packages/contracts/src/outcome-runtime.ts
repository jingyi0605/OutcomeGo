import { z } from "zod";

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

export const ReconcileOutcomeInput = z.object({
  clientRequestId: z.string().min(1).max(200),
}).strict();
export type ReconcileOutcomeInput = z.infer<typeof ReconcileOutcomeInput>;

/** Each sample is a foreground duration delta; replay uses the same sample ID. */
export const OutcomeAttentionInput = z.object({
  clientRequestId: z.string().min(1).max(200),
  surface: z.enum(["planning", "decision", "review"]),
  seconds: z.number().finite().positive().max(300),
}).strict();
export type OutcomeAttentionInput = z.infer<typeof OutcomeAttentionInput>;

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
