import { ApiError } from "@outcomego/contracts";
import {
  humanReceiptSchema, HUMAN_WORK_ERROR_CODES, type HumanReceiptInput, type HumanReceiptView,
  type HumanActionCardView, type HumanEvidenceGap, type HumanMaterialKind,
} from "@outcomego/contracts/human-work";
import type { KnowledgeReference } from "@outcomego/contracts/knowledge";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { appendOutcomeEvent, enqueueOutcomeTurn, transitionWorkItem, type ActorRef, type AgentMessaging, type AssetStore } from "@outcomego/messaging";
import type { HumanKnowledgeResolver } from "./human-knowledge-service";
import { hashRequest, toJson } from "./service-utils";
import { mapOutcomeError } from "./outcome-write";
import { assertHumanRevisionActive, humanRevisionActive } from "./human-revision-policy";

type Tx = Prisma.TransactionClient;
type Receipt = Prisma.OutcomeHumanReceiptGetPayload<Record<string, never>>;
type Requirement = HumanActionCardView["evidenceRequirements"][number];
interface ReceiptMaterial {
  criterionId: string;
  kind: HumanMaterialKind;
  label: string;
  evidenceIds: string[];
}
interface StoredReceipt {
  input: HumanReceiptInput;
  evidenceIds: string[];
  materials: ReceiptMaterial[];
  missingRequirements: HumanEvidenceGap[];
  references: KnowledgeReference[];
  reviewBaseline: Record<string, number>;
}
export interface HumanReviewPort {
  activeReviewRevision(tx: Tx, input: {
    outcomeId: string; expectedRevision: number; criterionIds: readonly string[];
  }): Promise<string | null>;
  reviewInTransaction(tx: Tx, input: {
    outcomeId: string; revisionId: string; actor: ActorRef; reviewedCriterionIds: readonly string[];
  }): Promise<void>;
}
const fail = (code: keyof typeof HUMAN_WORK_ERROR_CODES, message: string) =>
  new ApiError(HUMAN_WORK_ERROR_CODES[code], code, message, { retryable: false });
const strings = (value: Prisma.JsonValue) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const humanReceiptView = (receipt: Receipt): HumanReceiptView => {
  const payload = receipt.payload as unknown as StoredReceipt;
  return {
    id: receipt.id, workItemId: receipt.workItemId, outcomeId: receipt.outcomeId, sequence: receipt.sequence,
    status: receipt.status, submittedBy: receipt.submittedBy, submittedAt: receipt.submittedAt.toISOString(),
    reviewComment: receipt.reviewComment, payload: payload.input,
    evidenceIds: payload.evidenceIds ?? [], missingRequirements: payload.missingRequirements ?? [],
  };
};

/** Receipt facts, material provenance, review and continuation use the existing Outcome transaction. */
export class HumanReceiptService implements HumanReviewPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly assets: Pick<AssetStore, "metadata">,
    private readonly knowledge: HumanKnowledgeResolver,
    private readonly messaging: AgentMessaging,
    private readonly enqueue: typeof enqueueOutcomeTurn = enqueueOutcomeTurn,
  ) {}

  async submit(workItemId: string, value: unknown, actor: ActorRef): Promise<HumanReceiptView> {
    const parsed = humanReceiptSchema.safeParse(value);
    if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid human receipt", parsed.error.flatten());
    const input = parsed.data;
    try {
      return await this.prisma.$transaction(async tx => {
        const found = await tx.outcomeWorkItem.findUnique({ where: { id: workItemId }, select: { outcomeId: true } });
        if (!found) throw new ApiError(404, "work_item_not_found", "WorkItem not found");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`}))`;
        const scope = `human-receipt:${workItemId}`;
        const requestHash = hashRequest({ input, actor });
        const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: input.clientRequestId } } });
        if (previous) {
          if (previous.requestHash !== requestHash) throw fail("receipt_idempotency_conflict", "This receipt request ID has different content");
          return previous.response as unknown as HumanReceiptView;
        }
        const item = await tx.outcomeWorkItem.findUniqueOrThrow({
          where: { id: workItemId }, include: { humanActionCard: true, contractRevision: true, outcome: true },
        });
        if (item.contractRevision.revision !== input.expectedContractRevision)
          throw fail("review_revision_conflict", "The Contract revision has changed");
        await assertHumanRevisionActive(tx, item, item.humanActionCard?.requestedByWorkItemId ?? null);
        if (item.executorType !== "human" || item.status !== "in_progress" || !item.humanActionCard ||
            item.outcome.acceptedAt || item.outcome.cancelledAt || item.contractRevision.status !== "approved")
          throw fail("human_work_item_not_active", "Start the current human action before submitting a receipt");
        const requirements = item.humanActionCard.evidenceRequirements as unknown as Requirement[];
        const criterionIds = [...new Set(requirements.map(requirement => requirement.criterionId))];
        if (input.observations.some(observation => !criterionIds.includes(observation.criterionId)))
          throw new ApiError(400, "invalid_request", "An observation does not belong to this action's criteria");
        const assetRefs = [...new Set(input.assetRefs)].sort();
        for (const assetRef of assetRefs) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`human-receipt-asset:${assetRef}`}))`;
          await this.asset(assetRef);
          if (await tx.outcomeHumanReceipt.findFirst({ where: { workItemId: { not: item.id }, assetRefs: { array_contains: [assetRef] } }, select: { id: true } }))
            throw fail("receipt_asset_conflict", "This asset is already associated with another human action");
        }
        const knowledgeIds = [...new Set(input.sourceRefs.filter(source => source.type === "knowledge").map(source => source.ref))];
        const references = knowledgeIds.length ? await this.knowledge.resolve({
          outcomeId: item.outcomeId, projectScope: `bot:${item.botId}`, contractRevision: item.contractRevision.revision,
        }, knowledgeIds) : [];
        const receiptId = crypto.randomUUID();
        const evidenceIds: string[] = [];
        const materialIds = new Map<string, string>();
        const materials: ReceiptMaterial[] = [];
        const missingRequirements: HumanEvidenceGap[] = [];
        for (const requirement of requirements) {
          for (const kind of requirement.acceptedTypes as HumanMaterialKind[]) {
            const candidates = this.materials(input, references, requirement.criterionId, kind, receiptId);
            const ids: string[] = [];
            for (const material of candidates) {
              const key = JSON.stringify([requirement.criterionId, kind, material.sourceRef]);
              let id = materialIds.get(key);
              if (!id) {
                const evidence = await tx.outcomeEvidence.create({ data: {
                  outcomeId: item.outcomeId, contractRevisionId: item.contractRevisionId, workItemId: item.id,
                  criterionId: requirement.criterionId, credibility: "human_confirmed", capturedBy: actor, ...material,
                } });
                id = evidence.id;
                evidenceIds.push(id);
                materialIds.set(key, id);
              }
              ids.push(id);
            }
            materials.push({ criterionId: requirement.criterionId, kind, label: requirement.label, evidenceIds: ids });
            if (requirement.required && !ids.length) missingRequirements.push({
              criterionId: requirement.criterionId, kind, label: requirement.label,
            });
          }
        }
        const reviews = await tx.outcomeReview.findMany({ where: { criterionId: { in: criterionIds } }, orderBy: { sequence: "asc" } });
        const reviewBaseline = Object.fromEntries(reviews.map(review => [review.criterionId, review.sequence]));
        const last = await tx.outcomeHumanReceipt.aggregate({ where: { workItemId }, _max: { sequence: true } });
        await tx.outcomeHumanReceipt.updateMany({
          where: { workItemId, status: "submitted" }, data: { status: "rejected", reviewComment: "Superseded by a newer receipt" },
        });
        const stored: StoredReceipt = { input, evidenceIds, materials, missingRequirements, references, reviewBaseline };
        const receipt = await tx.outcomeHumanReceipt.create({ data: {
          id: receiptId, workItemId, outcomeId: item.outcomeId, sequence: (last._max.sequence ?? 0) + 1,
          submittedBy: actor, payload: toJson(stored), assetRefs, sourceRefs: toJson(input.sourceRefs), observations: toJson(input.observations),
        } });
        await tx.outcomeHumanActionCard.update({ where: { workItemId }, data: { submittedAt: receipt.submittedAt } });
        await transitionWorkItem(tx, { workItemId, to: "submitted", reason: "human_receipt_submitted", actor });
        await transitionWorkItem(tx, { workItemId, to: "review_pending", reason: "human_receipt_review_required", actor });
        await appendOutcomeEvent(tx, "outcome.human_receipt.submitted", item.outcomeId, {
          actor, workItemId, contractRevision: item.contractRevision.revision, idempotencyKey: input.clientRequestId,
          payload: { workItemId, receiptId, evidenceIds },
        });
        await appendOutcomeEvent(tx, "outcome.review.required", item.outcomeId, {
          actor, workItemId, contractRevision: item.contractRevision.revision, idempotencyKey: input.clientRequestId,
          payload: { workItemIds: [workItemId], criterionIds },
        });
        const response = humanReceiptView(receipt);
        await tx.idempotencyRecord.create({ data: {
          scope, key: input.clientRequestId, requestHash, response: toJson(response), status: "completed",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        } });
        return response;
      }, { timeout: 30_000 });
    } catch (error) { throw mapOutcomeError(error); }
  }

  async activeReviewRevision(tx: Tx, input: Parameters<HumanReviewPort["activeReviewRevision"]>[1]): Promise<string | null> {
    const revision = await tx.outcomeContractRevision.findFirst({
      where: { outcomeId: input.outcomeId, revision: input.expectedRevision, status: "approved", approvedAt: { not: null } },
    });
    if (!revision || !input.criterionIds.length) return null;
    const items = await tx.outcomeWorkItem.findMany({
      where: { outcomeId: input.outcomeId, contractRevisionId: revision.id, executorType: "human",
        status: { in: ["submitted", "review_pending"] }, humanReceipts: { some: { status: "submitted" } } },
      include: { humanActionCard: true },
    });
    const targets = items.filter(item => (item.humanActionCard?.evidenceRequirements as unknown as Requirement[] | undefined)
      ?.some(requirement => input.criterionIds.includes(requirement.criterionId)));
    if (!targets.length) return null;
    for (const item of targets)
      if (!await humanRevisionActive(tx, item, item.humanActionCard?.requestedByWorkItemId ?? null)) return null;
    return revision.id;
  }

  async reviewInTransaction(tx: Tx, input: Parameters<HumanReviewPort["reviewInTransaction"]>[1]): Promise<void> {
    const items = await tx.outcomeWorkItem.findMany({
      where: { outcomeId: input.outcomeId, contractRevisionId: input.revisionId, executorType: "human", status: { in: ["submitted", "review_pending"] } },
      include: { humanActionCard: true, contractRevision: true },
    });
    for (const item of items) {
      const card = item.humanActionCard;
      if (!card) throw fail("human_evidence_missing", "Human work has no action-card snapshot");
      await assertHumanRevisionActive(tx, item, card.requestedByWorkItemId);
      const requirements = card.evidenceRequirements as unknown as Requirement[];
      const mandatory = requirements.filter(requirement => requirement.required);
      const actionRequirements = mandatory.length ? mandatory : requirements;
      const receipt = await tx.outcomeHumanReceipt.findFirst({ where: { workItemId: item.id }, orderBy: { sequence: "desc" } });
      const reviews = await tx.outcomeReview.findMany({
        where: { contractRevisionId: input.revisionId, criterionId: { in: actionRequirements.map(requirement => requirement.criterionId) } },
        orderBy: { sequence: "asc" },
      });
      const latest = new Map(reviews.map(review => [review.criterionId, review]));
      if (!receipt || receipt.status !== "submitted") {
        if (actionRequirements.some(requirement => input.reviewedCriterionIds.includes(requirement.criterionId) && latest.get(requirement.criterionId)?.result === "PASS"))
          throw fail("human_evidence_missing", "Human acceptance requires a submitted receipt");
        continue;
      }
      const stored = receipt.payload as unknown as StoredReceipt;
      const current = actionRequirements.map(requirement => {
        const review = latest.get(requirement.criterionId);
        return { requirement, review: review && review.sequence > (stored.reviewBaseline[requirement.criterionId] ?? 0) ? review : undefined };
      });
      const failed = current.filter(entry => entry.review?.result === "FAIL");
      if (failed.length) {
        if (failed.some(entry => !entry.review?.comment.trim())) throw new ApiError(400, "invalid_request", "A rejected receipt requires a reviewer comment");
        if (item.status === "submitted") await transitionWorkItem(tx, { workItemId: item.id, to: "review_pending", reason: "owner_review", actor: input.actor });
        await transitionWorkItem(tx, { workItemId: item.id, to: "rejected", reason: "human_receipt_rejected", actor: input.actor });
        await tx.outcomeHumanReceipt.update({ where: { id: receipt.id }, data: {
          status: "rejected", reviewComment: failed.map(entry => `${entry.requirement.criterionId}: ${entry.review!.comment}`).join("\n"),
        } });
        continue;
      }
      if (!current.length || current.some(entry => entry.review?.result !== "PASS" &&
          !(entry.review?.result === "WAIVED_BY_APPROVED_CHANGE" && !entry.requirement.required))) continue;
      const selectedEvidence = await tx.outcomeEvidence.findMany({ where: {
        id: { in: [...new Set(current.flatMap(entry => strings(entry.review!.evidenceIds)))] },
        outcomeId: input.outcomeId, contractRevisionId: input.revisionId, workItemId: item.id, credibility: "human_confirmed",
      } });
      for (const { requirement, review } of current) {
        if (review!.result === "WAIVED_BY_APPROVED_CHANGE") continue;
        for (const kind of requirement.acceptedTypes) {
          const material = stored.materials.find(candidate => candidate.criterionId === requirement.criterionId && candidate.kind === kind);
          if (!material?.evidenceIds.some(id => strings(review!.evidenceIds).includes(id) &&
            selectedEvidence.some(evidence => evidence.id === id && evidence.criterionId === requirement.criterionId)))
            throw fail("human_evidence_missing", `The latest receipt is missing reviewed ${kind} evidence for ${requirement.label}`);
        }
      }
      const usedIds = new Set(current.flatMap(entry => strings(entry.review!.evidenceIds)));
      for (const evidence of selectedEvidence.filter(evidence => usedIds.has(evidence.id) && evidence.sourceType === "asset"))
        await this.asset(evidence.sourceRef);
      const sourceIds = selectedEvidence.filter(evidence => usedIds.has(evidence.id) && evidence.sourceType === "knowledge").map(evidence => evidence.sourceRef);
      if (sourceIds.length) {
        const references = await this.knowledge.resolve({
          outcomeId: item.outcomeId, projectScope: `bot:${item.botId}`, contractRevision: item.contractRevision.revision,
        }, sourceIds);
        if (references.length !== new Set(sourceIds).size || references.some(reference => {
          const selected = stored.references.find(snapshot => snapshot.id === reference.id);
          return !selected || selected.version !== reference.version || selected.digest !== reference.digest || reference.stale;
        })) throw new ApiError(409, "knowledge_source_stale", "Receipt sources have changed; submit current evidence");
      }
      if (item.status === "submitted") await transitionWorkItem(tx, { workItemId: item.id, to: "review_pending", reason: "owner_review", actor: input.actor });
      await transitionWorkItem(tx, { workItemId: item.id, to: "accepted", reason: "human_receipt_accepted", actor: input.actor });
      await tx.outcomeHumanReceipt.update({ where: { id: receipt.id }, data: { status: "accepted", reviewComment: null } });
      await tx.outcomeHumanActionCard.update({ where: { workItemId: item.id }, data: { acceptedAt: new Date() } });
      if (card.requestedByWorkItemId) {
        const requester = await tx.outcomeWorkItem.findUnique({ where: { id: card.requestedByWorkItemId } });
        const pending = await tx.outcomeHumanActionCard.count({ where: {
          requestedByWorkItemId: card.requestedByWorkItemId,
          workItem: { contractRevisionId: input.revisionId, status: { notIn: ["accepted", "cancelled"] } },
        } });
        const decisions = await tx.outcomeDecision.count({ where: {
          workItemId: card.requestedByWorkItemId, contractRevisionId: input.revisionId,
          status: { in: ["open", "presented"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        } });
        if (requester && requester.outcomeId === input.outcomeId && requester.contractRevisionId === input.revisionId &&
            ["waiting_human", "waiting_decision"].includes(requester.status) && !pending && !decisions) {
          await this.enqueue(tx, this.messaging, {
            workItemId: requester.id, reason: "human_action_accepted", clientId: `human-action-accepted:${item.id}:${receipt.id}`,
            content: JSON.stringify({
              humanAction: { workItemId: item.id, receiptId: receipt.id, sequence: receipt.sequence, text: stored.input.text, comment: stored.input.comment, observations: stored.input.observations, assetRefs: stored.input.assetRefs },
              knowledge: (card.references as unknown as KnowledgeReference[]).map(reference => ({
                referenceId: reference.id, sourceRef: reference.sourceRef, version: reference.version, digest: reference.digest, excerpt: reference.excerpt?.slice(0, 500),
              })),
            }),
          });
        }
      }
    }
  }

  private async asset(reference: string) {
    try { return await this.assets.metadata(reference.slice("asset:".length)); }
    catch { throw fail("receipt_asset_not_found", "A receipt asset is unavailable or no longer valid"); }
  }

  private materials(input: HumanReceiptInput, references: KnowledgeReference[], criterionId: string, kind: HumanMaterialKind, receiptId: string) {
    if (kind === "text") {
      const text = [input.text, input.comment].filter(value => value.trim()).join("\n");
      return text ? [{ sourceType: "receipt_text", sourceRef: `human-receipt:${receiptId}:text`, contentSummary: text.slice(0, 4_000), contentHash: hashRequest(text) }] : [];
    }
    if (kind === "asset") return [...new Set(input.assetRefs)].map(ref => ({
      sourceType: "asset", sourceRef: ref, contentSummary: "Human-submitted receipt asset", contentHash: ref.slice("asset:".length),
    }));
    if (kind === "sourceReference") return references.map(reference => ({
      sourceType: "knowledge", sourceRef: reference.id, contentSummary: reference.excerpt ?? reference.title, contentHash: reference.digest ?? null,
    }));
    return input.observations.filter(observation => observation.criterionId === criterionId).map((observation, index) => ({
      sourceType: "observation", sourceRef: `human-receipt:${receiptId}:observation:${index}`, contentSummary: observation.value, contentHash: hashRequest(observation),
    }));
  }
}
