import type { Prisma } from "@outcomego/db";
import { appendOutcomeEvent, type ActorRef } from "@outcomego/messaging";

export const activeDecisionStatuses = ["open", "presented"] as const;

/** Keep historical alerts but retire pending pushes when a decision is no longer actionable. */
export async function revokeDecisionNotification(tx: Prisma.TransactionClient, decisionId: string): Promise<void> {
  await tx.channelNotification.updateMany({ where: { key: `decision.required:${decisionId}` }, data: { revoked: true } });
  await tx.outboxDelivery.updateMany({
    where: { topic: "push.notification", status: { in: ["pending", "failed"] }, payload: { path: ["decisionId"], equals: decisionId } },
    data: { status: "delivered", deliveredAt: new Date() },
  });
}

/** Caller holds the Outcome lock; safe inside revision creation, cancellation or a read refresh. */
export async function withdrawSupersededDecisions(tx: Prisma.TransactionClient, outcomeId: string, actor: ActorRef): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`;
  const outcome = await tx.outcome.findUnique({ where: { id: outcomeId }, select: { currentRevisionId: true, cancelledAt: true } });
  if (!outcome) return;
  const rows = await tx.outcomeDecision.findMany({
    where: { outcomeId, status: { in: [...activeDecisionStatuses] }, ...(outcome.cancelledAt ? {} : { contractRevisionId: { not: outcome.currentRevisionId ?? "00000000-0000-0000-0000-000000000000" } }) },
    include: { contractRevision: { select: { revision: true } } },
  });
  for (const row of rows) {
    const updated = await tx.outcomeDecision.updateMany({ where: { id: row.id, status: { in: [...activeDecisionStatuses] } }, data: { status: "withdrawn", openWorkItemId: null } });
    if (!updated.count) continue;
    await appendOutcomeEvent(tx, "outcome.decision.closed", outcomeId, { actor, contractRevision: row.contractRevision.revision, workItemId: row.workItemId ?? undefined, payload: { decisionId: row.id, reason: "withdrawn" } });
    await revokeDecisionNotification(tx, row.id);
  }
}
