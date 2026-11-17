import { ApiError } from "@outcomego/contracts";
import type { DecisionCreateInput, DecisionOption, DecisionView } from "@outcomego/contracts/outcome-inbox";
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
  if (!revision || revision.outcomeId !== outcome.id || outcome.currentRevisionId !== revision.id) throw apiError("decision_revision_conflict", "The decision revision is no longer current");
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
  const rows = await tx.outcomeDecision.findMany({ where: { outcomeId, status: { in: [...activeStatuses] }, ...(outcome.cancelledAt ? {} : { contractRevisionId: { not: outcome.currentRevisionId ?? "00000000-0000-0000-0000-000000000000" } }) }, include });
  for (const row of rows) await closeOutcomeDecision(tx, row, "withdrawn", actor);
}
