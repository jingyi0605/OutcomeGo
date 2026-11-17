import { humanActionInputSchema } from "@outcomego/contracts/human-work";
import { ApiError } from "@outcomego/contracts";
import { parseDecisionContractSnapshot, type DecisionCreateInput, type DecisionOption, type DecisionView } from "@outcomego/contracts/outcome-inbox";
import { Prisma } from "@outcomego/db";
import { createHash } from "node:crypto";
import { appendOutcomeEvent, type ActorRef } from "./outcome-state";

type Tx = Prisma.TransactionClient;
const include = { contractRevision: { select: { revision: true } } } satisfies Prisma.OutcomeDecisionInclude;
type Row = Prisma.OutcomeDecisionGetPayload<{ include: typeof include }>;
const activeStatuses = ["open", "presented"] as const;
const apiError = (code: string, message: string, _row?: unknown, status = 409) => new ApiError(status, code, message, { retryable: false });
const toJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const outcomeDecisionView = (row: Row): DecisionView => ({
  id: row.id, outcomeId: row.outcomeId, contractRevisionId: row.contractRevisionId, contractRevision: row.contractRevision.revision,
  runId: row.runId, workItemId: row.workItemId, status: row.status, reasonCode: row.reasonCode,
  completedSummary: row.completedSummary, problemSummary: row.problemSummary, nextStepSummary: row.nextStepSummary,
  recommendation: row.recommendation as DecisionView["recommendation"], options: row.options as unknown as DecisionOption[],
  customEntryAllowed: row.customEntryAllowed, expiresAt: row.expiresAt?.toISOString() ?? null,
  resolvedOption: row.resolvedOption as unknown as DecisionOption | null, customText: row.customText,
  resolvedBy: row.resolvedBy, resolvedAt: row.resolvedAt?.toISOString() ?? null, truncatedOptionCount: row.truncatedOptionCount,
  createdAt: row.createdAt.toISOString(),
});

/** A draft successor does not replace the latest approved, already-started execution snapshot. */
export const outcomeDecisionRevisionActiveSql = (outcomeId: Prisma.Sql, revisionId: Prisma.Sql, workItemId: Prisma.Sql): Prisma.Sql => Prisma.sql`
  EXISTS (SELECT 1 FROM "outcomego_outcome" execution_outcome
    WHERE execution_outcome.id = ${outcomeId} AND (
      execution_outcome."currentRevisionId" = ${revisionId}
      OR EXISTS (SELECT 1 FROM "outcomego_outcome_contract_revision" execution_revision
        JOIN "outcomego_outcome_work_item" execution_item ON execution_item."contractRevisionId" = execution_revision.id
        WHERE execution_revision.id = ${revisionId} AND execution_revision."outcomeId" = execution_outcome.id
          AND execution_revision.status IN ('approved', 'superseded') AND execution_revision."approvedAt" IS NOT NULL
          AND execution_item.id = ${workItemId} AND execution_item."outcomeId" = execution_outcome.id
          AND execution_item."executorType" = 'agent' AND execution_item."startedAt" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "outcomego_run" execution_run
            WHERE execution_run."outcomeWorkItemId" = execution_item.id AND execution_run."botId" = execution_item."botId"
              AND execution_run.origin = 'outcome' AND execution_run."startedAt" IS NOT NULL)
          AND EXISTS (SELECT 1 FROM "outcomego_outcome_contract_revision" pending_revision
            WHERE pending_revision.id = execution_outcome."currentRevisionId" AND pending_revision.status IN ('draft', 'pending_approval'))
          AND NOT EXISTS (SELECT 1 FROM "outcomego_outcome_contract_revision" successor
            WHERE successor."outcomeId" = execution_outcome.id AND successor.status IN ('approved', 'superseded')
              AND successor."approvedAt" IS NOT NULL AND successor.revision > execution_revision.revision)
      )
    ))
`;
export async function isOutcomeDecisionRevisionActive(tx: Tx, outcomeId: string, revisionId: string, workItemId?: string | null): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ active: boolean }>>(Prisma.sql`SELECT ${outcomeDecisionRevisionActiveSql(
    Prisma.sql`${outcomeId}::uuid`, Prisma.sql`${revisionId}::uuid`, Prisma.sql`${workItemId ?? null}::uuid`,
  )} AS active`);
  return row?.active === true;
}

/** One shared constructor for Server tools and Worker recovery; the caller owns the transaction. */
export async function createOutcomeDecision(tx: Tx, input: DecisionCreateInput, actor: ActorRef, requestSnapshot: unknown = input): Promise<DecisionView> {
  const inputHash = createHash("sha256").update(JSON.stringify(requestSnapshot)).digest("hex");
  const idempotencyKey = `decision-request:${input.runId ?? input.workItemId ?? input.outcomeId}:${inputHash}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${input.outcomeId}`}))`;
  const previous = await tx.outcomeDecision.findUnique({ where: { idempotencyKey }, include });
  if (previous) return outcomeDecisionView(previous);
  await withdrawSupersededOutcomeDecisions(tx, input.outcomeId, actor);
  const outcome = await tx.outcome.findUnique({ where: { id: input.outcomeId } });
  const revision = await tx.outcomeContractRevision.findUnique({ where: { id: input.contractRevisionId } });
  if (!outcome) throw apiError("outcome_not_found", "Outcome not found", undefined, 404);
  if (!revision || revision.outcomeId !== outcome.id || !await isOutcomeDecisionRevisionActive(tx, outcome.id, revision.id, input.workItemId)) throw apiError("decision_revision_conflict", "The decision revision is no longer current");
  if (outcome.cancelledAt || outcome.acceptedAt) throw apiError("invalid_outcome_transition", "This Outcome is closed");
  if (input.workItemId) {
    const item = await tx.outcomeWorkItem.findUnique({ where: { id: input.workItemId } });
    if (!item || item.outcomeId !== outcome.id || item.contractRevisionId !== revision.id) throw apiError("work_item_not_found", "The work item does not belong to this revision", undefined, 404);
    const open = await tx.outcomeDecision.findUnique({ where: { openWorkItemId: item.id } });
    if (open?.expiresAt && open.expiresAt <= new Date()) {
      const expired = await tx.outcomeDecision.findUniqueOrThrow({ where: { id: open.id }, include });
      await closeOutcomeDecision(tx, expired, "expired", "system:decision-expiry");
    } else if (open) throw apiError("decision_already_open", "This work item already has an open decision");
  }
  if (input.runId) {
    const run = await tx.run.findUnique({ where: { id: input.runId } });
    if (!run || !input.workItemId || run.outcomeWorkItemId !== input.workItemId) throw apiError("invalid_decision_source", "The run does not belong to the requesting work item", undefined, 422);
  }
  const options = input.options.slice(0, 4);
  if (!options.length || new Set(options.map(option => option.id)).size !== options.length || options.some(option => !option.id || !option.label.trim() || !option.consequence.trim() || !["plan_only", "scope_change", "acceptance_change", "cancel_branch", "manual_action"].includes(option.resolutionEffect))) throw apiError("invalid_decision_options", "Provide one to four distinct options with a server-defined effect", undefined, 422);
  for (const option of options) {
    if ((option.resolutionEffect === "scope_change" || option.resolutionEffect === "acceptance_change") && !option.contract)
      throw apiError("invalid_decision_effect", "A revision effect requires a complete contract snapshot", undefined, 422);
    if (option.contract) {
      try { parseDecisionContractSnapshot(option.contract); }
      catch { throw apiError("invalid_decision_effect", "The contract snapshot is invalid", undefined, 422); }
    }
    if (option.resolutionEffect === "manual_action" && (!option.manualAction || !humanActionInputSchema.safeParse(option.manualAction).success))
      throw apiError("invalid_decision_effect", "A manual-action option requires a valid complete action card", undefined, 422);
    if (option.supplement && (option.resolutionEffect !== "plan_only" || !option.supplement.title.trim() || !option.supplement.instructions.trim()))
      throw apiError("invalid_decision_effect", "Supplementary work must preserve the contract and include instructions", undefined, 422);
    if (option.recommended && !option.reason?.trim())
      throw apiError("invalid_decision_options", "A recommended option requires its reason", undefined, 422);
  }
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw apiError("invalid_decision_expiry", "expiresAt must be an ISO timestamp", undefined, 422);
  const now = new Date();
  const row = await tx.outcomeDecision.create({ data: {
    outcomeId: outcome.id, contractRevisionId: revision.id, workItemId: input.workItemId, runId: input.runId,
    reasonCode: input.reasonCode, completedSummary: input.completedSummary, problemSummary: input.problemSummary.trim() || "No unresolved issue.", nextStepSummary: input.nextStepSummary,
    recommendation: input.recommendation ? toJson(input.recommendation) : undefined,
    options: toJson(options.map(option => ({ ...option, createdAt: option.createdAt ?? now.toISOString() }))),
    customEntryAllowed: input.customEntryAllowed !== false, expiresAt, idempotencyKey, openWorkItemId: input.workItemId,
    truncatedOptionCount: Math.max(0, input.options.length - 4),
  }, include });
  await appendOutcomeEvent(tx, "outcome.decision.required", row.outcomeId, { actor, contractRevision: revision.revision, workItemId: input.workItemId, runId: input.runId, idempotencyKey, payload: { decisionId: row.id, reasonCode: row.reasonCode } });
  return outcomeDecisionView(row);
}

export async function revokeOutcomeDecisionNotification(tx: Tx, decisionId: string): Promise<void> {
  await tx.channelNotification.updateMany({ where: { key: `decision.required:${decisionId}` }, data: { revoked: true } });
  await tx.outboxDelivery.updateMany({ where: { topic: "push.notification", status: { in: ["pending", "failed"] }, payload: { path: ["decisionId"], equals: decisionId } }, data: { status: "delivered", deliveredAt: new Date() } });
}

export async function closeOutcomeDecision(tx: Tx, row: Row, status: "expired" | "withdrawn", actor: ActorRef): Promise<void> {
  const changed = await tx.outcomeDecision.updateMany({ where: { id: row.id, status: { in: [...activeStatuses] } }, data: { status, openWorkItemId: null } });
  if (!changed.count) return;
  await appendOutcomeEvent(tx, "outcome.decision.closed", row.outcomeId, { actor, contractRevision: row.contractRevision.revision, workItemId: row.workItemId ?? undefined, payload: { decisionId: row.id, reason: status } });
  await revokeOutcomeDecisionNotification(tx, row.id);
}

export async function withdrawSupersededOutcomeDecisions(tx: Tx, outcomeId: string, actor: ActorRef): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`;
  const outcome = await tx.outcome.findUnique({ where: { id: outcomeId }, select: { currentRevisionId: true, cancelledAt: true } });
  if (!outcome) return;
  const rows = await tx.outcomeDecision.findMany({ where: { outcomeId, status: { in: [...activeStatuses] } }, include });
  for (const row of rows) if (outcome.cancelledAt || !await isOutcomeDecisionRevisionActive(tx, outcomeId, row.contractRevisionId, row.workItemId))
    await closeOutcomeDecision(tx, row, "withdrawn", actor);
}
