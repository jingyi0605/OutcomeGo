import type { Prisma } from "@outcomego/db";
import type { AgentMessaging } from "./index";

export interface EnqueueOutcomeTurnInput {
  workItemId: string;
  content: string;
  reason: "start" | "decision_resolved" | "human_action_accepted" | "recovery" | "rework";
  clientId: string;
}

export type EnqueueOutcomeTurnResult =
  | { status: "enqueued"; runId: string }
  | { status: "queued_for_capacity" };

/**
 * Enqueue a turn in the work item's existing sub-thread, inside the caller's transaction.
 * Line 1 owns capacity, deduplication, root-run linkage and preserving the main conversation.
 */
export async function enqueueOutcomeTurn(
  _tx: Prisma.TransactionClient,
  _messaging: AgentMessaging,
  _input: EnqueueOutcomeTurnInput
): Promise<EnqueueOutcomeTurnResult> {
  throw new Error("not implemented: owned by line 1 (004.2 task 3.2/3.4)");
}

/**
 * Settle the whole Outcome run group inside the caller's transaction.
 * Line 1 must leave ordinary runs and unresolved decisions/human actions unchanged.
 */
export async function settleOutcomeWorkItem(_tx: Prisma.TransactionClient, _runId: string): Promise<void> {
  throw new Error("not implemented: owned by line 1 (004.2 task 3.2/3.4)");
}
