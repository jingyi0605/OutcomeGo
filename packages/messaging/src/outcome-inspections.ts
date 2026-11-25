import { OUTCOME_TERMINAL_STATUSES, workThreadIsFinished } from "@outcomego/contracts/outcomes";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { readFeatureSettings } from "./feature-settings";
import type { AgentMessaging } from "./index";
import { outcomeDispatchEnabled } from "./outcome-availability";
import { enqueueOutcomeThreadTurn, resolveOutcomeRole } from "./outcome-roles";

export const AUTO_INSPECTION_ACTOR = "system:auto-inspection";
const BATCH_SIZE = 100;

export async function readInspectionTarget(tx: Prisma.TransactionClient, outcomeId: string, workItemId: string | null) {
  const outcome = await tx.outcome.findUnique({ where: { id: outcomeId }, include: { currentRevision: { select: { status: true } } } });
  if (!outcome?.currentRevisionId || outcome.currentRevision?.status !== "approved" || outcome.acceptedAt ||
      outcome.cancelledAt || outcome.autoClosedAt || OUTCOME_TERMINAL_STATUSES.includes(outcome.status)) return null;
  const item = workItemId ? await tx.outcomeWorkItem.findFirst({ where: { id: workItemId, outcomeId } }) : null;
  if (workItemId && (!item || item.contractRevisionId !== outcome.currentRevisionId || workThreadIsFinished(item.status))) return null;
  const target = item ?? outcome;
  if (!target.inspectionEnabled) return null;
  return {
    outcomeId, workItemId, botId: outcome.botId, revisionId: outcome.currentRevisionId,
    inspected: target.inspectionRevisionId === outcome.currentRevisionId,
    dueAt: target.dueAt, scheduledAt: item?.scheduledAt ?? null,
  };
}

export function inspectionSnapshot(target: NonNullable<Awaited<ReturnType<typeof readInspectionTarget>>>) {
  return {
    revisionId: target.revisionId,
    dueAt: target.dueAt?.toISOString() ?? null,
    scheduledAt: target.scheduledAt?.toISOString() ?? null,
  };
}

export async function enqueueOutcomeInspection(
  tx: Prisma.TransactionClient, messaging: AgentMessaging,
  target: NonNullable<Awaited<ReturnType<typeof readInspectionTarget>>>, actor: string, requestId: string,
) {
  const { outcomeId, workItemId, botId, revisionId } = target;
  const reviewer = await resolveOutcomeRole(tx, "reviewer", botId);
  const subject = workItemId ? `task ${workItemId}` : "this goal";
  const { turn } = await enqueueOutcomeThreadTurn(tx, messaging, {
    outcomeId, workItemId, purpose: "inspection", botId: reviewer.botId ?? botId, model: reviewer.model,
    actor, clientRequestId: `inspection:${workItemId ?? "goal"}:${requestId}`,
    text: actor === AUTO_INSPECTION_ACTOR ? `Analyze ${subject} before its deadline.` : `The owner requested an analysis of ${subject}.`,
    result: inspectionSnapshot(target),
  });
  const data = { inspectionRevisionId: revisionId };
  if (workItemId) await tx.outcomeWorkItem.update({ where: { id: workItemId }, data });
  else await tx.outcome.update({ where: { id: outcomeId }, data });
  return turn;
}

export async function dispatchDueOutcomeInspections(prisma: PrismaClient, messaging: AgentMessaging, now = new Date()): Promise<number> {
  if (!outcomeDispatchEnabled()) return 0;
  const settings = await readFeatureSettings(prisma);
  const policy = resolveTaskPolicy(settings.taskPolicy);
  if (!settings.outcomesEnabled || policy["inspection.enabled"] !== true) return 0;
  const until = new Date(now.getTime() + Number(policy["inspection.leadHours"]) * 3_600_000);
  const candidates = await prisma.$queryRaw<Array<{ outcomeId: string; workItemId: string | null }>>`
    SELECT candidate."outcomeId", candidate."workItemId" FROM (
      SELECT id AS "outcomeId", null::uuid AS "workItemId", "dueAt" FROM "outcomego_outcome"
      WHERE "inspectionEnabled" AND "dueAt" > ${now} AND "dueAt" <= ${until}
        AND "inspectionRevisionId" IS DISTINCT FROM "currentRevisionId"
      UNION ALL
      SELECT w."outcomeId", w.id, w."dueAt" FROM "outcomego_outcome_work_item" w
      JOIN "outcomego_outcome" o ON o.id = w."outcomeId" AND o."currentRevisionId" = w."contractRevisionId"
      WHERE w."inspectionEnabled" AND w."dueAt" > ${now} AND w."dueAt" <= ${until}
        AND w."inspectionRevisionId" IS DISTINCT FROM w."contractRevisionId"
        AND w.status NOT IN ('completed', 'accepted', 'failed', 'cancelled')
    ) candidate
    JOIN "outcomego_outcome" o ON o.id = candidate."outcomeId"
    JOIN "outcomego_outcome_contract_revision" r ON r.id = o."currentRevisionId" AND r.status = 'approved'
    WHERE o."acceptedAt" IS NULL AND o."cancelledAt" IS NULL AND o."autoClosedAt" IS NULL
      AND o.status NOT IN ('accepted', 'cancelled')
    ORDER BY candidate."dueAt", candidate."outcomeId", candidate."workItemId" LIMIT ${BATCH_SIZE}`;
  let dispatched = 0;
  for (const { outcomeId, workItemId } of candidates) {
    try {
      const queued = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`;
        const target = await readInspectionTarget(tx, outcomeId, workItemId);
        if (!target || target.inspected || !target.dueAt || target.dueAt <= now || target.dueAt > until) return false;
        await enqueueOutcomeInspection(tx, messaging, target, AUTO_INSPECTION_ACTOR, crypto.randomUUID());
        return true;
      });
      if (queued) dispatched++;
    } catch (error) {
      console.warn("Outcome inspection dispatch failed", outcomeId, workItemId, error);
    }
  }
  return dispatched;
}
