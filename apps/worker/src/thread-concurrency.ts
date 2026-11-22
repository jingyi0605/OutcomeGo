import type { OutcomeThreadPurpose, OutcomeThreadRole } from "@outcomego/contracts/outcome-thread";
import { roleForThreadPurpose } from "@outcomego/messaging";

export const PLANNER_TURN_CONCURRENCY = 5;
export const REVIEWER_TURN_CONCURRENCY = 5;

export interface ThreadLeaseCounts {
  planner: number;
  reviewer: number;
}

/**
 * Counts active planner vs reviewer thread leases on a single bot.
 * Both caps (5 each) are tracked independently from work items (cap 2) and automations (cap 4).
 */
export function countThreadLeasesByRole(
  threadLeaseRunIds: readonly string[],
  turnPurposeByRunId: ReadonlyMap<string, OutcomeThreadPurpose>
): ThreadLeaseCounts {
  let planner = 0;
  let reviewer = 0;
  for (const runId of threadLeaseRunIds) {
    const purpose = turnPurposeByRunId.get(runId);
    const role: OutcomeThreadRole = purpose ? roleForThreadPurpose(purpose) : "planner";
    if (role === "reviewer") reviewer += 1;
    else planner += 1;
  }
  return { planner, reviewer };
}

export function canClaimThreadTurn(purpose: OutcomeThreadPurpose, counts: ThreadLeaseCounts): boolean {
  const role = roleForThreadPurpose(purpose);
  return role === "reviewer"
    ? counts.reviewer < REVIEWER_TURN_CONCURRENCY
    : counts.planner < PLANNER_TURN_CONCURRENCY;
}
