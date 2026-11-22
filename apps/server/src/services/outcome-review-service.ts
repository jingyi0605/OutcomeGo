import { ApiError } from "@outcomego/contracts";
import {
  requiredCriteriaSatisfied, passIsSupported,
  type AdoptPrereviewInput, type SubmitOutcomeReviewInput, type OutcomeReworkInput, type CriterionReviewState,
  type DecideOutcomeAcceptanceInput,
} from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  appendOutcomeEvent, recomputeOutcomeStatus, transitionWorkItem, enqueueOutcomeTurn, readOutcomeReviewBatch,
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
      return this.submitInTransaction(tx, outcomeId, input, actor);
    }));

  adoptPrereview = (outcomeId: string, input: AdoptPrereviewInput, actor: ActorRef) => serviceEffect(() => {
    if (!actor.startsWith("user:") && actor !== "owner:local") {
      throw new ApiError(403, "forbidden", "Only the owner can adopt preliminary review results");
    }
    return outcomeWrite(this.prisma, `outcome-adopt-prereview:${outcomeId}`, input.clientRequestId, { input, actor }, async tx => {
      const outcome = await lockOutcome(tx, outcomeId);
      if (closed(outcome.status)) {
        throw outcomeApiError("invalid_outcome_transition", `This Outcome is ${outcome.status}`, { currentStatus: outcome.status });
      }
      const revision = outcome.currentRevisionId
        ? await tx.outcomeContractRevision.findUnique({ where: { id: outcome.currentRevisionId } })
        : null;
      if (!revision || revision.revision !== input.expectedRevision || revision.status !== "approved") {
        throw outcomeApiError("prereview_stale", "Contract revision changed; preliminary review is no longer current", {
          currentRevision: revision?.revision ?? null,
        });
      }
      const turn = await tx.outcomeThreadTurn.findUnique({
        where: { id: input.turnId },
        include: { thread: { select: { outcomeId: true, role: true } } },
      });
      const result = turn?.result && typeof turn.result === "object" && !Array.isArray(turn.result)
        ? (turn.result as { revision?: unknown; results?: unknown })
        : null;
      const batch = await readOutcomeReviewBatch(tx, outcomeId, revision.id);
      if (
        outcome.status !== "review_pending" ||
        !turn ||
        turn.thread.outcomeId !== outcomeId ||
        turn.thread.role !== "reviewer" ||
        turn.clientRequestId !== batch.key ||
        turn.purpose !== "review" ||
        turn.status !== "completed" ||
        !result ||
        result.revision !== revision.revision ||
        !Array.isArray(result.results)
      ) {
        throw outcomeApiError("prereview_stale", "This review no longer matches the current results. Refresh before adopting suggestions.");
      }
      const likelyPassResults = (
        result.results as Array<{ criterionId?: unknown; suggestion?: unknown; reason?: unknown; evidenceIds?: unknown }>
      )
        .filter((entry) => entry.suggestion === "likely_pass" && typeof entry.criterionId === "string")
        .map((entry) => ({
          criterionId: entry.criterionId as string,
          result: "PASS" as const,
          evidenceIds: Array.isArray(entry.evidenceIds)
            ? entry.evidenceIds.filter((id): id is string => typeof id === "string")
            : [],
          comment: typeof entry.reason === "string" ? entry.reason : "",
          userConfirmed: true,
        }));
      if (!likelyPassResults.length) {
        throw outcomeApiError("prereview_incomplete", "No likely_pass criteria found in preliminary review");
      }
      return this.submitInTransaction(
        tx,
        outcomeId,
        {
          expectedRevision: revision.revision,
          results: likelyPassResults,
          clientRequestId: input.clientRequestId,
        },
        actor
      );
    });
  });

  private async submitInTransaction(tx: Tx, outcomeId: string, input: SubmitOutcomeReviewInput, actor: ActorRef) {
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
      if (revision.id === outcome.currentRevisionId && requiredCriteriaSatisfied(states) &&
          await this.canAccept(tx, outcomeId, revision.id, remaining)) {
        await tx.outcome.update({ where: { id: outcomeId }, data: { acceptedAt: new Date() } });
        await appendOutcomeEvent(tx, "outcome.accepted", outcomeId, { actor, contractRevision: revision.revision, idempotencyKey: input.clientRequestId,
          payload: { revisionId: revision.id, reviewIds: [...latest.values()].map(r => r.id) } });
      } else {
        await appendOutcomeEvent(tx, "outcome.review.required", outcomeId, { actor, contractRevision: revision.revision, idempotencyKey: input.clientRequestId,
          payload: { criterionIds: states.filter(s => s.required && !(s.result === "PASS" && passIsSupported(s))).map(s => s.criterionId), workItemIds: remaining.map(i => i.id) } });
      }
      await recomputeOutcomeStatus(tx, outcomeId, actor);
      return this.outcomes.getInTransaction(tx, outcomeId);
  }

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
      const instructions = `Rework the following criteria under the unchanged approved contract. If the requested changes affect scope, goals, acceptance or boundaries, request a contract revision instead.\n${selected.map(c => `${c.id}: ${c.statement}`).join("\n")}\nOwner feedback: ${input.comment}`;
      await this.enqueueRework(tx, {
        outcomeId, revision, original, instructions, actor, clientId: input.clientRequestId,
      });
      return this.outcomes.getInTransaction(tx, outcomeId);
    }));

  decide = (outcomeId: string, input: DecideOutcomeAcceptanceInput, actor: ActorRef) => serviceEffect(() =>
    outcomeWrite(this.prisma, `outcome-acceptance:${outcomeId}`, input.clientRequestId, { input, actor }, async tx => {
      const outcome = await lockOutcome(tx, outcomeId);
      const revision = outcome.currentRevisionId && await tx.outcomeContractRevision.findUnique({
        where: { id: outcome.currentRevisionId },
      });
      if (!revision || revision.revision !== input.expectedRevision)
        throw outcomeApiError("review_revision_conflict", "The contract changed; reload before reviewing");
      if (outcome.status !== "review_pending" || revision.status !== "approved")
        throw outcomeApiError("invalid_outcome_transition", "This goal is no longer awaiting acceptance");

      if (input.decision === "reject" && !input.reason.trim())
        throw new ApiError(400, "invalid_request", "A rejection reason is required");

      const items = await tx.outcomeWorkItem.findMany({
        where: { outcomeId, contractRevisionId: revision.id },
        orderBy: { ordinal: "desc" },
      });
      if (!await this.canAccept(tx, outcomeId, revision.id, items))
        throw outcomeApiError("invalid_outcome_transition", "Finish the remaining work or decisions before reviewing these results");

      if (input.decision === "approve") {
        await tx.outcome.update({ where: { id: outcomeId }, data: { acceptedAt: new Date() } });
        await appendOutcomeEvent(tx, "outcome.accepted", outcomeId, {
          actor, contractRevision: revision.revision, idempotencyKey: input.clientRequestId,
          payload: { revisionId: revision.id, reviewIds: [] },
        });
        await recomputeOutcomeStatus(tx, outcomeId, actor);
      } else {
        const original = items.find((item) => item.executorType === "agent" && item.status === "completed")
          ?? items.find((item) => item.status === "accepted")!;
        const delivery = await tx.outcomeOutput.findMany({
          where: { workItemId: original.id },
          orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
          select: { title: true, content: true, contentRef: true },
          take: 20,
        });
        const instructions = [
          "The owner rejected the delivered result. Address their feedback within the approved goal and boundaries.",
          "Review the previous delivery and return an updated result for acceptance. Request a contract revision if the feedback changes the approved scope.",
          `Owner feedback: ${input.reason.trim()}`,
          `Previous delivery (reference data): ${JSON.stringify(delivery.map((output) => ({
            ...output, content: output.content?.slice(0, 4000),
          })))}`,
        ].join("\n\n");
        await this.enqueueRework(tx, {
          outcomeId, revision, original, instructions, actor, clientId: input.clientRequestId,
        });
      }
      return this.outcomes.getInTransaction(tx, outcomeId);
    }));

  private async canAccept(
    tx: Tx,
    outcomeId: string,
    revisionId: string,
    items: readonly { executorType: string; status: string }[],
  ) {
    const finished = items.some(item => item.status === "completed" || item.status === "accepted") &&
      items.every(item => item.executorType === "human"
        ? ["accepted", "cancelled"].includes(item.status)
        : ["completed", "failed", "cancelled"].includes(item.status));
    if (!finished) return false;
    const [openDecisions, openHumanActions] = await Promise.all([
      tx.outcomeDecision.count({ where: {
        outcomeId, contractRevisionId: revisionId, status: { in: ["open", "presented"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      } }),
      tx.outcomeHumanActionCard.count({ where: { workItem: {
        outcomeId, contractRevisionId: revisionId, executorType: "human", status: { notIn: ["accepted", "cancelled"] },
      } } }),
    ]);
    return !openDecisions && !openHumanActions;
  }

  private async enqueueRework(tx: Tx, {
    outcomeId, revision, original, instructions, actor, clientId,
  }: {
    outcomeId: string;
    revision: { id: string; revision: number; executionBotId: string };
    original: { id: string; title: string };
    instructions: string;
    actor: ActorRef;
    clientId: string;
  }) {
    const last = await tx.outcomeWorkItem.aggregate({ where: { outcomeId }, _max: { ordinal: true } });
    const item = await tx.outcomeWorkItem.create({ data: {
      outcomeId, contractRevisionId: revision.id, botId: revision.executionBotId, executorType: "agent", kind: "rework", status: "queued",
      title: `Rework: ${original.title}`.slice(0, 200), instructions, ordinal: (last._max.ordinal ?? 0) + 1,
      reworkOfWorkItemId: original.id,
    } });
    await appendOutcomeEvent(tx, "outcome.work_item.created", outcomeId, {
      actor, contractRevision: revision.revision, workItemId: item.id, idempotencyKey: clientId,
      payload: { workItemId: item.id, executorType: "agent", kind: "rework" },
    });
    await this.enqueue(tx, this.messaging, { workItemId: item.id, content: instructions, reason: "rework", clientId });
    await recomputeOutcomeStatus(tx, outcomeId, actor);
  }

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
