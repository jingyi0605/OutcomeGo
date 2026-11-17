import { ApiError } from "@outcomego/contracts";
import type { OutcomeAttentionInput, OutcomeMetrics, OutcomeRecoveryView, OutcomeRecoveryPage, ReconcileOutcomeInput } from "@outcomego/contracts/outcome-runtime";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { recoverOutcomeWorkItem, routeOutcomeNextStep, type ActorRef, type AgentMessaging } from "@outcomego/messaging";
import { lockOutcome, outcomeWrite } from "./outcome-write";
import { serviceEffect } from "./service-utils";

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;
type Tx = Prisma.TransactionClient;

export class OutcomeRecoveryService {
  constructor(private readonly prisma: PrismaClient, private readonly messaging: AgentMessaging) {}

  get = (outcomeId: string) => serviceEffect(() => this.prisma.$transaction(tx => this.views(tx, outcomeId)));

  reconcile = (outcomeId: string, input: ReconcileOutcomeInput, actor: ActorRef) => serviceEffect(() =>
    outcomeWrite(this.prisma, `outcome-reconcile:${outcomeId}`, input.clientRequestId, { input, actor }, async tx => {
      await lockOutcome(tx, outcomeId);
      const items = await tx.outcomeWorkItem.findMany({ where: { outcomeId, executorType: "agent" }, orderBy: { id: "asc" }, select: { id: true } });
      for (const item of items) await recoverOutcomeWorkItem(tx, item.id, { messaging: this.messaging });
      return this.views(tx, outcomeId);
    }));

  private async views(tx: Tx, outcomeId: string): Promise<OutcomeRecoveryPage> {
    if (!await tx.outcome.findUnique({ where: { id: outcomeId }, select: { id: true } })) throw new ApiError(404, "outcome_not_found", "Outcome not found");
    const items = await tx.outcomeWorkItem.findMany({
      where: { outcomeId, executorType: "agent" }, orderBy: { ordinal: "asc" },
      include: {
        contractRevision: { select: { revision: true } },
        runs: { orderBy: [{ startedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true } },
        outputs: { select: { id: true } }, evidence: { select: { id: true } },
        decisions: { where: { status: { in: ["open", "presented"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
      },
    });
    const events = await tx.event.findMany({ where: { entityId: outcomeId, topic: "outcome.work_item.updated" }, orderBy: { sequence: "desc" }, select: { sequence: true, payload: true } });
    const sequences = new Map<string, number>();
    for (const event of events) {
      const workItemId = (event.payload as { workItemId?: string })?.workItemId;
      if (workItemId && !sequences.has(workItemId)) sequences.set(workItemId, Number(event.sequence));
    }
    const completedItems = items.filter(item => item.status === "completed").map(item => item.id);
    const failures = await tx.outboxDelivery.findMany({
      where: { status: "failed", payload: { path: ["outcomeId"], equals: outcomeId } },
      orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, attempts: true, error: true },
    });
    return { outcomeId, notificationFailures: failures.map(failure => {
      // Outbox errors can contain provider responses; derive a fixed code without reading them.
      return { id: failure.id, status: failure.status, attempts: failure.attempts, errorCode: failure.attempts >= 5 ? "notification_retry_exhausted" : "notification_delivery_failed" };
    }), items: items.map(item => {
      const decision = item.decisions[0];
      const status: OutcomeRecoveryView["status"] = item.status === "retry_pending" || item.status === "queued" ? "retrying"
        : ["running", "waiting_decision", "waiting_human", "needs_review", "completed", "failed", "cancelled"].includes(item.status) ? item.status as OutcomeRecoveryView["status"] : "needs_review";
      const route = decision ? routeOutcomeNextStep({ type: "decision", decisionId: decision.id })
        : status === "waiting_human" ? routeOutcomeNextStep({ type: "human", workItemId: item.id })
        : !["initial", "rework", "supplement"].includes(item.kind) ? routeOutcomeNextStep({ type: "unsupported", actionType: item.kind })
        : status === "completed" ? routeOutcomeNextStep({ type: "completed", workItemId: item.id })
        : status === "needs_review" ? routeOutcomeNextStep({ type: "interrupted", workItemId: item.id }) : null;
      const nextAction = route?.kind === "NEEDS_USER_DECISION" && decision ? { type: "decision", summary: "Review the pending decision." }
        : route?.kind === "MANUAL_ACTION" ? { type: "human_action", summary: "Complete and review the requested human action." }
        : route?.kind === "UNSUPPORTED" ? { type: "unsupported", summary: "This work item has no implemented execution path." }
        : route?.kind === "ALLOW" ? { type: "review", summary: "Review the completed work against its acceptance criteria." }
        : ["running", "retrying"].includes(status) ? { type: "resume", summary: "Wait for the isolated Outcome thread." }
        : status === "needs_review" ? { type: "reconcile", summary: "Reconcile the persisted work and run facts." }
        : { type: "none", summary: "No recovery action is required." };
      return {
        id: item.id, outcomeId, workItemId: item.id, contractRevision: item.contractRevision.revision,
        ...(item.runs[0] ? { runId: item.runs[0].id } : {}), sequence: sequences.get(item.id) ?? 0,
        status, reasonCode: item.statusReason, retryCount: item.retryCount, recoveryCount: item.recoveryCount,
        completedItems, nextAction, outputRefs: item.outputs.map(output => output.id), evidenceRefs: item.evidence.map(evidence => evidence.id),
        ...(decision ? { decisionId: decision.id } : {}), createdAt: item.createdAt.toISOString(),
      };
    }) };
  }

  /** Advisory samples are isolated from every business transaction; retries retain one delta. */
  recordAttention = (outcomeId: string, input: OutcomeAttentionInput, actor: ActorRef) => serviceEffect(() =>
    outcomeWrite(this.prisma, `outcome-attention:${outcomeId}`, input.clientRequestId, { input, actor }, async tx => {
      if (!await tx.outcome.findUnique({ where: { id: outcomeId }, select: { id: true } })) throw new ApiError(404, "outcome_not_found", "Outcome not found");
      return { recorded: true as const, seconds: input.seconds, surface: input.surface };
    }));

  metrics = (outcomeId: string) => serviceEffect(() => this.prisma.$transaction(async (tx: Tx): Promise<OutcomeMetrics> => {
    const outcome = await tx.outcome.findUnique({ where: { id: outcomeId }, select: { id: true, createdAt: true, acceptedAt: true, cancelledAt: true, planningDraft: { select: { createdAt: true } } } });
    if (!outcome) throw new ApiError(404, "outcome_not_found", "Outcome not found");
    const [revisions, items, decisions, reviews, receipts, notifications, attention, reviewRequests] = await Promise.all([
      tx.outcomeContractRevision.findMany({ where: { outcomeId }, orderBy: { revision: "asc" }, select: { id: true, revision: true, approvedAt: true } }),
      tx.outcomeWorkItem.findMany({ where: { outcomeId }, select: { startedAt: true, retryCount: true, recoveryCount: true } }),
      tx.outcomeDecision.findMany({ where: { outcomeId }, select: { id: true, resolvedAt: true } }),
      tx.outcomeReview.findMany({ where: { outcomeId }, orderBy: { sequence: "asc" }, select: { criterionId: true, sequence: true, result: true, reviewedAt: true, reviewedBy: true, contractRevisionId: true } }),
      tx.outcomeHumanReceipt.findMany({ where: { outcomeId }, select: { workItemId: true, submittedAt: true } }),
      tx.channelNotification.findMany({ where: { kind: "outcome", payload: { path: ["outcomeId"], equals: outcomeId } }, select: { key: true, payload: true, createdAt: true } }),
      tx.idempotencyRecord.findMany({ where: { scope: `outcome-attention:${outcomeId}`, status: "completed" }, select: { response: true } }),
      tx.idempotencyRecord.count({ where: { scope: `outcome-review:${outcomeId}`, status: "completed" } }),
    ]);
    const latest = new Map<string, typeof reviews[number]>();
    for (const review of reviews) latest.set(review.criterionId, review);
    const reviewCount = reviewRequests || new Set(reviews.map(review => `${review.reviewedBy}:${review.reviewedAt.toISOString()}:${review.contractRevisionId}`)).size;
    const approvedRevisionCount = revisions.filter(revision => revision.approvedAt).length;
    const actionable = notifications.filter(notification => {
      const payload = notification.payload as { decisionId?: string; workItemId?: string; category?: string; contractRevision?: number };
      if (payload.decisionId) return decisions.some(decision => decision.id === payload.decisionId && decision.resolvedAt && decision.resolvedAt >= notification.createdAt);
      if (payload.category === "human_action_pending") {
        const workItemId = payload.workItemId ?? (notification.key.startsWith("human_action.required:") ? notification.key.slice("human_action.required:".length) : null);
        return !!workItemId && receipts.some(receipt => receipt.workItemId === workItemId && receipt.submittedAt >= notification.createdAt);
      }
      if (payload.category === "acceptance_pending") return reviews.some(review => review.reviewedAt >= notification.createdAt && (!payload.contractRevision || revisions.some(revision => revision.id === review.contractRevisionId && revision.revision === payload.contractRevision)));
      return false;
    }).length;
    const attentionSamples = attention.flatMap(row => {
      const seconds = (row.response as { seconds?: unknown })?.seconds;
      return typeof seconds === "number" && Number.isFinite(seconds) ? [seconds] : [];
    });
    const firstRun = items.flatMap(item => item.startedAt ? [item.startedAt] : []).sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      outcomeId, planningStartedAt: iso(outcome.planningDraft?.createdAt ?? outcome.createdAt), approvalAt: iso(revisions.find(revision => revision.approvedAt)?.approvedAt),
      firstRunAt: iso(firstRun), acceptedAt: iso(outcome.acceptedAt),
      humanInterventionCount: approvedRevisionCount + decisions.filter(decision => decision.resolvedAt).length + reviewCount + receipts.length,
      decisionCount: decisions.length, reviewCount,
      retryCount: items.reduce((sum, item) => sum + item.retryCount, 0), recoveryCount: items.reduce((sum, item) => sum + item.recoveryCount, 0),
      // Duplicate deliveries are logged by their consumers; an absent durable count is unknown.
      duplicateEventCount: null, notificationCount: notifications.length, actionableNotificationCount: actionable,
      attentionSeconds: attentionSamples.length ? attentionSamples.reduce((sum, seconds) => sum + seconds, 0) : null,
      firstPassAccepted: outcome.acceptedAt ? reviews.length > 0 && reviews.every(review => review.result === "PASS" && review.sequence === 1) : null,
      failedCriterionCount: [...latest.values()].filter(review => review.result === "FAIL").length,
      unverifiedCriterionCount: [...latest.values()].filter(review => review.result === "UNVERIFIED").length,
      contractRevisionCount: revisions.length, approvedRevisionCount,
      unnecessaryNotificationRatio: notifications.length ? 1 - actionable / notifications.length : null,
      contractTraceabilityRate: outcome.acceptedAt || outcome.cancelledAt ? revisions.length ? approvedRevisionCount / revisions.length : null : null,
    };
  }));
}
