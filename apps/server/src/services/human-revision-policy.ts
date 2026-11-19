import { ApiError } from "@outcomego/contracts";
import type { Prisma } from "@outcomego/db";
import { isOutcomeDecisionRevisionActive } from "@outcomego/messaging";

/** Human controls inherit the immutable requesting Agent snapshot, never the current draft. */
export async function humanRevisionActive(
  tx: Prisma.TransactionClient,
  item: { outcomeId: string; contractRevisionId: string },
  requesterId: string | null,
): Promise<boolean> {
  if (!requesterId) return false;
  const requester = await tx.outcomeWorkItem.findUnique({ where: { id: requesterId } });
  return !!requester && requester.executorType === "agent" && requester.outcomeId === item.outcomeId &&
    requester.contractRevisionId === item.contractRevisionId &&
    await isOutcomeDecisionRevisionActive(tx, item.outcomeId, item.contractRevisionId, requester.id);
}

export async function assertHumanRevisionActive(
  tx: Prisma.TransactionClient,
  item: { outcomeId: string; contractRevisionId: string },
  requesterId: string | null,
): Promise<void> {
  if (!await humanRevisionActive(tx, item, requesterId))
    throw new ApiError(409, "review_revision_conflict", "The human action's execution Contract is no longer active", { retryable: false });
}
