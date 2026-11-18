import { ApiError } from "@outcomego/contracts";
import {
  requiredCriteriaSatisfied, passIsSupported,
  type SubmitOutcomeReviewInput, type OutcomeReworkInput, type CriterionReviewState,
} from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  appendOutcomeEvent, recomputeOutcomeStatus, transitionWorkItem, enqueueOutcomeTurn,
  type ActorRef, type AgentMessaging,
} from "@outcomego/messaging";
import { OutcomeService, outcomeApiError } from "./outcome-service";
import type { OutcomeInference } from "./outcome-inference";
import { lockOutcome, outcomeWrite } from "./outcome-write";
import { serviceEffect, toJson } from "./service-utils";
import type { HumanReviewPort } from "./human-receipt-service";
import { lockAssetReferences } from "./asset-retention";

type Tx = Prisma.TransactionClient;
type Enqueue = typeof enqueueOutcomeTurn;
const idsOf = (value: Prisma.JsonValue): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const closed = (status: string) => status === "accepted" || status === "cancelled";

export class OutcomeReviewService {
  private readonly outcomes: OutcomeService;
  constructor(private readonly prisma: PrismaClient, private readonly messaging: AgentMessaging,
    private readonly infer: OutcomeInference, private readonly enqueue: Enqueue = enqueueOutcomeTurn,
    private readonly humanReviews?: HumanReviewPort) {
    this.outcomes = new OutcomeService(prisma);
  }

  submit = (outcomeId: string, input: SubmitOutcomeReviewInput, actor: ActorRef) => serviceEffect(() =>
    outcomeWrite(this.prisma, `outcome-review:${outcomeId}`, input.clientRequestId, { input, actor }, async tx => {
      const outcome = await lockOutcome(tx, outcomeId);
      if (closed(outcome.status)) throw outcomeApiError("invalid_outcome_transition", `This Outcome is ${outcome.status}`, { currentStatus: outcome.status });
      let revision = await tx.outcomeContractRevision.findUnique({ where: { id: outcome.currentRevisionId ?? "00000000-0000-0000-0000-000000000000" }, include: { criteria: true } });
      if (revision?.revision !== input.expectedRevision && this.humanReviews) {
        const activeId = await this.humanReviews.activeReviewRevision(tx, {
          outcomeId, expectedRevision: input.expectedRevision, criterionIds: input.results.map(result => result.criterionId),
        });
        if (activeId) revision = await tx.outcomeContractRevision.findUnique({ where: { id: activeId }, include: { criteria: true } });
      }
      if (!revision || revision.revision !== input.expectedRevision)
        throw outcomeApiError("review_revision_conflict", "The contract changed; reload before reviewing", { currentRevision: revision?.revision ?? null });
      if (revision.status !== "approved") throw outcomeApiError("contract_revision_not_approved", "Approve the current contract before reviewing", { currentStatus: revision.status });
      const criteria = new Map(revision.criteria.map(c => [c.id, c]));
      if (new Set(input.results.map(r => r.criterionId)).size !== input.results.length)
        throw new ApiError(400, "invalid_request", "Each criterion can appear only once in a review");
      const assetIds = await lockAssetReferences(tx, (input.newEvidence ?? [])
        .filter(entry => entry.sourceType === "asset" || entry.sourceType === "file")
        .map(entry => entry.sourceRef));
      for (const assetId of assetIds) {
        try { await this.messaging.assets.metadata(assetId); }
        catch { throw outcomeApiError("evidence_missing", "A referenced attachment is no longer available"); }
      }
      const added = new Map<string, string[]>();
      for (const entry of input.newEvidence ?? []) {
        if (!criteria.has(entry.criterionId)) throw outcomeApiError("review_revision_conflict", "Evidence must refer to the current contract");
        if (!entry.sourceRef.trim()) throw outcomeApiError("evidence_missing", "Evidence needs a source reference");
        const evidence = await tx.outcomeEvidence.create({ data: { ...entry, outcomeId, contractRevisionId: revision.id, credibility: "human_confirmed", capturedBy: actor } });
        added.set(entry.criterionId, [...(added.get(entry.criterionId) ?? []), evidence.id]);
      }
      for (const entry of input.results) {
        const criterion = criteria.get(entry.criterionId);
        if (!criterion) throw outcomeApiError("review_revision_conflict", "Review must refer to a criterion in the current contract");
        const evidenceIds = [...new Set([...entry.evidenceIds, ...(added.get(entry.criterionId) ?? [])])];
        const evidence = await tx.outcomeEvidence.findMany({ where: { id: { in: evidenceIds }, outcomeId, contractRevisionId: revision.id, OR: [{ criterionId: criterion.id }, { criterionId: null }] } });
        if (evidence.length !== evidenceIds.length) throw outcomeApiError("evidence_missing", "Some evidence does not belong to this criterion and revision");
        const userConfirmed = entry.userConfirmed === true && criterion.verificationMethod === "human_review";
        if (entry.result === "PASS" && ((criterion.required && !passIsSupported({ criterionId: criterion.id, required: true, result: "PASS", evidenceCredibility: evidence.map(e => e.credibility), userConfirmed })) || (criterion.evidenceRequired && !evidence.length && !userConfirmed)))
          throw outcomeApiError("evidence_missing", "PASS requires evidence or an explicit human confirmation", { criterionId: criterion.id });
        if (entry.result === "WAIVED_BY_APPROVED_CHANGE") {
          const base = revision.baseRevisionId ? await tx.outcomeContractRevision.findUnique({ where: { id: revision.baseRevisionId }, include: { criteria: true } }) : null;
          // An approved successor can make a formerly required clause optional; it cannot silently waive a required clause.
          const original = base?.criteria.filter(c => c.statement === criterion.statement) ?? [];
          const current = revision.criteria.filter(c => c.statement === criterion.statement);
          if (criterion.required || !revision.approvedAt || !revision.changeSummary?.includes(criterion.statement) ||
            !base?.approvedAt || base.outcomeId !== outcomeId || base.revision >= revision.revision ||
            original.length !== 1 || current.length !== 1 || !original[0]?.required ||
            original[0].ordinal !== criterion.ordinal || original[0].verificationMethod !== criterion.verificationMethod)
            throw outcomeApiError("review_incomplete", "A waiver requires an approved contract change making this criterion optional", { criterionId: criterion.id });
        }
        const previous = await tx.outcomeReview.findFirst({ where: { criterionId: criterion.id }, orderBy: { sequence: "desc" } });
        const review = await tx.outcomeReview.create({ data: {
          outcomeId, contractRevisionId: revision.id, criterionId: criterion.id, sequence: (previous?.sequence ?? 0) + 1,
          result: entry.result, evidenceIds, comment: entry.comment, userConfirmed, reviewedBy: actor,
        } });
        await appendOutcomeEvent(tx, "outcome.review.recorded", outcomeId, { actor, contractRevision: revision.revision, idempotencyKey: input.clientRequestId,
          payload: { reviewId: review.id, criterionId: criterion.id, result: review.result, evidenceIds } });
      }
      const reviews = await tx.outcomeReview.findMany({ where: { contractRevisionId: revision.id }, orderBy: { sequence: "asc" } });
      const latest = new Map(reviews.map(r => [r.criterionId, r]));
      const evidence = await tx.outcomeEvidence.findMany({ where: { contractRevisionId: revision.id } });
      const evidenceById = new Map(evidence.map(e => [e.id, e]));
      const states: CriterionReviewState[] = revision.criteria.map(c => {
        const review = latest.get(c.id);
        return { criterionId: c.id, required: c.required, result: review?.result ?? null,
          evidenceCredibility: idsOf(review?.evidenceIds ?? []).flatMap(id => { const e = evidenceById.get(id); return e ? [e.credibility] : []; }),
          userConfirmed: review?.userConfirmed, waiverRevisionApproved: review?.result === "WAIVED_BY_APPROVED_CHANGE" && !!revision.approvedAt,
        };
      });
      const items = await tx.outcomeWorkItem.findMany({ where: { outcomeId, contractRevisionId: revision.id } });
      if (items.some(item => item.executorType === "human" && ["submitted", "review_pending"].includes(item.status))) {
        if (!this.humanReviews) throw new ApiError(503, "manual_action_unavailable", "Human receipt review has not been registered");
        await this.humanReviews.reviewInTransaction(tx, {
          outcomeId, revisionId: revision.id, actor, reviewedCriterionIds: input.results.map(result => result.criterionId),
        });
      }
      const remaining = await tx.outcomeWorkItem.findMany({ where: { outcomeId, contractRevisionId: revision.id } });
      const finished = remaining.some(item => item.status === "completed" || item.status === "accepted") &&
        remaining.every(item => item.executorType === "human" ? ["accepted", "cancelled"].includes(item.status) : ["completed", "failed", "cancelled"].includes(item.status));
      // Independent Decisions need not own a WorkItem, so completion alone cannot establish acceptance.
      const [openDecisions, openHumanActions] = await Promise.all([
        tx.outcomeDecision.count({ where: {
          outcomeId, contractRevisionId: revision.id, status: { in: ["open", "presented"] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        } }),
        tx.outcomeHumanActionCard.count({ where: { workItem: {
          outcomeId, contractRevisionId: revision.id, executorType: "human", status: { notIn: ["accepted", "cancelled"] },
        } } }),
      ]);
      if (revision.id === outcome.currentRevisionId && finished && !openDecisions && !openHumanActions && requiredCriteriaSatisfied(states)) {
        await tx.outcome.update({ where: { id: outcomeId }, data: { acceptedAt: new Date() } });
        await appendOutcomeEvent(tx, "outcome.accepted", outcomeId, { actor, contractRevision: revision.revision, idempotencyKey: input.clientRequestId,
          payload: { revisionId: revision.id, reviewIds: [...latest.values()].map(r => r.id) } });
      } else {
        await appendOutcomeEvent(tx, "outcome.review.required", outcomeId, { actor, contractRevision: revision.revision, idempotencyKey: input.clientRequestId,
          payload: { criterionIds: states.filter(s => s.required && !(s.result === "PASS" && passIsSupported(s))).map(s => s.criterionId), workItemIds: remaining.map(i => i.id) } });
      }
      await recomputeOutcomeStatus(tx, outcomeId, actor);
      return this.outcomes.getInTransaction(tx, outcomeId);
    }));

  rework = (outcomeId: string, input: OutcomeReworkInput, actor: ActorRef) => serviceEffect(() =>
    outcomeWrite(this.prisma, `outcome-rework:${outcomeId}`, input.clientRequestId, { input, actor }, async tx => {
      const outcome = await lockOutcome(tx, outcomeId);
      if (closed(outcome.status)) throw outcomeApiError("invalid_outcome_transition", `This Outcome is ${outcome.status}`, { currentStatus: outcome.status });
      const revision = await tx.outcomeContractRevision.findUnique({ where: { id: outcome.currentRevisionId ?? "00000000-0000-0000-0000-000000000000" }, include: { criteria: true } });
      if (!revision || revision.revision !== input.expectedRevision) throw outcomeApiError("review_revision_conflict", "The contract changed; reload before rework");
      if (revision.status !== "approved") throw outcomeApiError("contract_revision_not_approved", "Approve the contract before rework");
      const selected = revision.criteria.filter(c => input.criterionIds.includes(c.id));
      if (selected.length !== new Set(input.criterionIds).size || !selected.length) throw outcomeApiError("rework_not_allowed", "Choose failed or unverified criteria in this contract");
      for (const c of selected) {
        const latest = await tx.outcomeReview.findFirst({ where: { criterionId: c.id }, orderBy: { sequence: "desc" } });
        if (!latest || !["FAIL", "UNVERIFIED"].includes(latest.result)) throw outcomeApiError("rework_not_allowed", "Only FAIL or UNVERIFIED criteria can be reworked", { criterionId: c.id });
      }
      const original = await tx.outcomeWorkItem.findFirst({ where: { outcomeId, contractRevisionId: revision.id, executorType: "agent", status: { in: ["completed", "failed"] } }, orderBy: { ordinal: "desc" } });
      if (!original) throw outcomeApiError("rework_not_allowed", "No finished agent work item is available to rework");
      const last = await tx.outcomeWorkItem.aggregate({ where: { outcomeId }, _max: { ordinal: true } });
      const instructions = `Rework the following criteria under the unchanged approved contract. If the requested changes affect scope, goals, acceptance or boundaries, request a contract revision instead.\n${selected.map(c => `${c.id}: ${c.statement}`).join("\n")}\nOwner feedback: ${input.comment}`;
      const item = await tx.outcomeWorkItem.create({ data: {
        outcomeId, contractRevisionId: revision.id, botId: revision.executionBotId, executorType: "agent", kind: "rework", status: "queued",
        title: `Rework: ${original.title}`.slice(0, 200), instructions, ordinal: (last._max.ordinal ?? 0) + 1, reworkOfWorkItemId: original.id,
      } });
      await appendOutcomeEvent(tx, "outcome.work_item.created", outcomeId, { actor, contractRevision: revision.revision, workItemId: item.id, idempotencyKey: input.clientRequestId,
        payload: { workItemId: item.id, executorType: "agent", kind: "rework" } });
      await this.enqueue(tx, this.messaging, { workItemId: item.id, content: instructions, reason: "rework", clientId: input.clientRequestId });
      await recomputeOutcomeStatus(tx, outcomeId, actor);
      return this.outcomes.getInTransaction(tx, outcomeId);
    }));

  /** Idempotent Output -> advisory Evidence adapter; usable with fixture Outputs before runtime integration. */
  recordOutputEvidence = (outputId: string) => outcomeWrite(this.prisma, "outcome-output-evidence", outputId, { outputId }, async tx => {
    const output = await tx.outcomeOutput.findUnique({ where: { id: outputId }, include: { workItem: true } });
    if (!output) return { evidenceIds: [] as string[] };
    await lockOutcome(tx, output.outcomeId);
    const item = output.workItem;
    const criteria = await tx.outcomeAcceptanceCriterion.findMany({ where: { contractRevisionId: item.contractRevisionId } });
    const evidenceIds: string[] = [];
    for (const criterion of criteria) {
      const evidence = await tx.outcomeEvidence.create({ data: {
        outcomeId: output.outcomeId, contractRevisionId: item.contractRevisionId, criterionId: criterion.id,
        workItemId: item.id, outputId, runId: output.runId, sourceType: "output", sourceRef: output.contentRef ?? `output:${output.id}`,
        contentSummary: (output.content ?? output.title).slice(0, 4000), credibility: "agent_report", capturedBy: `bot:${item.botId}`,
      } });
      evidenceIds.push(evidence.id);
    }
    return { evidenceIds };
  });

  /** Inference happens outside every write transaction. Failure records an advisory absence and never blocks review. */
  async prereview(workItemId: string, signal?: AbortSignal): Promise<void> {
    const scope = "outcome-prereview";
    if (await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: workItemId } } })) return;
    const item = await this.prisma.outcomeWorkItem.findUnique({ where: { id: workItemId }, include: { contractRevision: { include: { criteria: true } }, outputs: true } });
    if (!item || item.executorType !== "agent" || item.status !== "completed") return;
    let suggestions: Array<{ criterionId: string; suggestion: string; reason: string }> = [];
    let failed = false;
    try {
      const response = await this.infer({ kind: "prereview", instructions: `Return only JSON {"results":[{"criterionId":"...","suggestion":"likely_pass|likely_fail|unclear","reason":"..."}]}. Assess the approved criteria against the output. This is advisory; do not produce final reviews.`,
        prompt: JSON.stringify({ criteria: item.contractRevision.criteria.map(c => ({ id: c.id, statement: c.statement })), outputs: item.outputs.map(o => ({ title: o.title, content: o.content?.slice(0, 12_000), reference: o.contentRef })) }) }, signal);
      const parsed = JSON.parse(response.text) as { results?: unknown };
      if (!Array.isArray(parsed.results)) throw new Error("Missing prereview results");
      const seen = new Set<string>();
      for (const result of parsed.results) {
        if (!result || typeof result !== "object" || typeof result.criterionId !== "string" || !item.contractRevision.criteria.some(c => c.id === result.criterionId) || seen.has(result.criterionId) || !["likely_pass", "likely_fail", "unclear"].includes(result.suggestion) || typeof result.reason !== "string") continue;
        seen.add(result.criterionId);
        suggestions.push({ criterionId: result.criterionId, suggestion: result.suggestion, reason: result.reason.slice(0, 2000) });
      }
      if (!suggestions.length) throw new Error("Empty prereview");
    } catch { failed = true; suggestions = []; }
    if (signal?.aborted) return;
    await outcomeWrite(this.prisma, scope, workItemId, { workItemId }, async tx => {
      await lockOutcome(tx, item.outcomeId);
      for (const suggestion of suggestions) await tx.outcomeEvidence.create({ data: {
        outcomeId: item.outcomeId, contractRevisionId: item.contractRevisionId, criterionId: suggestion.criterionId, workItemId,
        sourceType: "prereview", sourceRef: `prereview:${workItemId}:${suggestion.criterionId}`,
        contentSummary: `${suggestion.suggestion}: ${suggestion.reason}`, credibility: "ai_prereview", capturedBy: "system:outcome-prereview",
      } });
      return { failed, criterionIds: suggestions.map(s => s.criterionId) };
    });
  }
}
