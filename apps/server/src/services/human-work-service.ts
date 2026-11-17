import { ApiError } from "@outcomego/contracts";
import {
  HUMAN_WORK_ERROR_CODES, humanActionInputSchema, humanWorkMutationSchema, humanWorkPauseSchema,
  type HumanActionCardView, type HumanWorkItemDetail, type HumanWorkItemView, type HumanWorkMutation,
  type HumanWorkPause,
} from "@outcomego/contracts/human-work";
import type { KnowledgeReference } from "@outcomego/contracts/knowledge";
import { OutcomeError, OUTCOME_ERROR_CODES, type WorkItemExecutorType, type WorkItemStatus } from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  appendOutcomeEvent, transitionWorkItem,
  type ActorRef, type HumanActionInput, type HumanActionResult,
} from "@outcomego/messaging";
import { hashRequest, toJson } from "./service-utils";

const include = {
  contractRevision: { select: { revision: true } },
  humanActionCard: true,
  _count: { select: { evidence: true } },
} satisfies Prisma.OutcomeWorkItemInclude;
type Item = Prisma.OutcomeWorkItemGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;
const error = (code: keyof typeof HUMAN_WORK_ERROR_CODES, message: string, details: Record<string, unknown> = {}) =>
  new ApiError(HUMAN_WORK_ERROR_CODES[code], code, message, { retryable: false, ...details });
const nextAction = (status: WorkItemStatus) => {
  if (["pending", "ready", "paused", "rejected"].includes(status)) return "start";
  if (status === "in_progress") return "submit_receipt";
  if (["submitted", "review_pending"].includes(status)) return "review";
  return undefined;
};

export class HumanWorkService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Internal snapshot builder for HumanActionPort implementations. Source validation,
   * tool registration and Agent waiting/continuation are supplied in wave 2.
   */
  async createCard(tx: Tx, input: {
    outcomeId: string;
    expectedContractRevision: number;
    card: HumanActionInput;
    references: readonly KnowledgeReference[];
    requestedByWorkItemId: string;
    sourceDecisionId?: string;
  }, actor: ActorRef): Promise<HumanActionResult> {
    const parsed = humanActionInputSchema.safeParse(input.card);
    if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid human action card", parsed.error.flatten());
    const card = parsed.data;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${input.outcomeId}`}))`;
    const outcome = await tx.outcome.findUnique({
      where: { id: input.outcomeId }, include: { currentRevision: { include: { criteria: true } } },
    });
    if (!outcome?.currentRevision) throw new ApiError(404, "outcome_not_found", "Outcome not found");
    const revision = outcome.currentRevision;
    if (revision.revision !== input.expectedContractRevision)
      throw error("review_revision_conflict", "The Contract revision has changed");
    if (revision.status !== "approved" || ["cancelled", "accepted"].includes(outcome.status))
      throw error("human_work_item_not_active", "Human work requires an active approved Contract", { currentStatus: outcome.status });
    const requester = await tx.outcomeWorkItem.findUnique({ where: { id: input.requestedByWorkItemId } });
    if (!requester || requester.outcomeId !== outcome.id || requester.contractRevisionId !== revision.id || requester.executorType !== "agent")
      throw error("human_work_item_not_active", "The requesting Agent WorkItem does not belong to this Contract");
    const references = input.references.map((reference) => ({ ...reference }));
    const ids = new Set(card.referenceIds ?? []);
    if (references.length !== ids.size || references.some((reference) =>
      !ids.has(reference.id) || reference.projectScope !== `bot:${outcome.botId}` || reference.stale
    )) throw error("human_evidence_missing", "Every requested reference requires a current scoped snapshot");
    const requirements = card.evidenceRequirements.map((requirement) => {
      const criterion = revision.criteria.find((candidate) => candidate.ordinal === requirement.criterionOrdinal);
      if (!criterion) throw error("human_evidence_missing", "An evidence requirement refers to an unknown criterion");
      return { criterionId: criterion.id, label: requirement.label, acceptedTypes: [requirement.kind], required: criterion.required };
    });
    const last = await tx.outcomeWorkItem.aggregate({ where: { outcomeId: outcome.id }, _max: { ordinal: true } });
    const item = await tx.outcomeWorkItem.create({
      data: {
        outcomeId: outcome.id, contractRevisionId: revision.id, botId: outcome.botId,
        executorType: "human", kind: "human_action", status: "pending", title: card.title,
        ordinal: (last._max.ordinal ?? 0) + 1, dependsOn: [], sourceDecisionId: input.sourceDecisionId,
      },
    });
    await tx.outcomeHumanActionCard.create({
      data: {
        workItemId: item.id, purpose: card.purpose,
        steps: card.steps.map((text, index) => ({ id: `step-${index + 1}`, ordinal: index + 1, text, optional: false })),
        evidenceRequirements: requirements, references: toJson(references),
        requestedByWorkItemId: requester.id, sourceDecisionId: input.sourceDecisionId,
      },
    });
    await appendOutcomeEvent(tx, "outcome.work_item.created", outcome.id, {
      actor, contractRevision: revision.revision, workItemId: item.id,
      payload: { workItemId: item.id, executorType: "human", kind: "human_action" },
    });
    await appendOutcomeEvent(tx, "outcome.human_action.required", outcome.id, {
      actor, contractRevision: revision.revision, workItemId: item.id,
      payload: { workItemId: item.id, cardId: item.id, requestedByWorkItemId: requester.id, decisionId: input.sourceDecisionId ?? null },
    });
    await transitionWorkItem(tx, { workItemId: item.id, to: "ready", reason: "Human action references resolved", actor });
    return { workItemId: item.id, cardId: item.id };
  }

  async list(outcomeId: string, filter: { status?: WorkItemStatus; executorType?: WorkItemExecutorType } = {}): Promise<HumanWorkItemView[]> {
    if (!await this.prisma.outcome.findUnique({ where: { id: outcomeId }, select: { id: true } }))
      throw new ApiError(404, "outcome_not_found", "Outcome not found");
    const rows = await this.prisma.outcomeWorkItem.findMany({
      where: { outcomeId, ...filter }, include, orderBy: { ordinal: "asc" },
    });
    return rows.map((item) => this.view(item));
  }

  async detail(workItemId: string): Promise<HumanWorkItemDetail> {
    return this.detailIn(this.prisma, workItemId);
  }

  start(workItemId: string, input: HumanWorkMutation, actor: ActorRef) {
    const parsed = humanWorkMutationSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid human work start request");
    return this.mutate(workItemId, parsed.data, "start", actor);
  }

  pause(workItemId: string, input: HumanWorkPause, actor: ActorRef) {
    const parsed = humanWorkPauseSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid human work pause request");
    return this.mutate(workItemId, parsed.data, "pause", actor);
  }

  private async mutate(workItemId: string, input: HumanWorkMutation | HumanWorkPause, action: "start" | "pause", actor: ActorRef) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const found = await tx.outcomeWorkItem.findUnique({ where: { id: workItemId }, select: { outcomeId: true } });
        if (!found) throw new ApiError(404, "work_item_not_found", "WorkItem not found");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`}))`;
        const item = await tx.outcomeWorkItem.findUniqueOrThrow({
          where: { id: workItemId }, include: { ...include, outcome: { include: { currentRevision: true } } },
        });
        if (item.executorType !== "human" || !item.humanActionCard)
          throw error("human_work_item_not_active", "This WorkItem is not a human action");
        const scope = `human-work:${workItemId}`;
        const requestHash = hashRequest({ action, input, actor });
        const previous = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key: input.clientRequestId } },
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw error("receipt_idempotency_conflict", "This request ID was used for different human work content");
          return previous.response as unknown as HumanWorkItemDetail;
        }
        if (item.contractRevisionId !== item.outcome.currentRevisionId ||
            item.outcome.currentRevision?.revision !== input.expectedContractRevision)
          throw error("review_revision_conflict", "The Contract revision has changed", { currentStatus: item.status });
        if (["accepted", "cancelled"].includes(item.outcome.status))
          throw error("human_work_item_not_active", "The Outcome is no longer active", { currentStatus: item.status });
        const allowed = action === "start" ? ["pending", "ready", "paused", "rejected"] : ["in_progress"];
        if (!allowed.includes(item.status))
          throw error("human_work_item_not_active", "The WorkItem cannot perform this action", { currentStatus: item.status });
        if (action === "pause") {
          const pause = input as HumanWorkPause;
          const steps = item.humanActionCard.steps as unknown as HumanActionCardView["steps"];
          const references = item.humanActionCard.references as unknown as KnowledgeReference[];
          if ((pause.currentStepId !== null && !steps.some((step) => step.id === pause.currentStepId)) ||
              pause.readReferenceIds.some((id) => !references.some((reference) => reference.id === id)))
            throw new ApiError(400, "invalid_request", "The saved step or reference is not part of this card");
          await tx.outcomeHumanActionCard.update({
            where: { workItemId },
            data: { draft: { currentStepId: pause.currentStepId, draftSummary: pause.draftSummary, readReferenceIds: pause.readReferenceIds, reason: pause.reason } },
          });
        }
        await transitionWorkItem(tx, {
          workItemId, to: action === "start" ? "in_progress" : "paused",
          actor, reason: action === "start" ? "Human action started" : (input as HumanWorkPause).reason,
        });
        if (action === "start" && !item.humanActionCard.startedAt) {
          const started = await tx.outcomeWorkItem.findUniqueOrThrow({ where: { id: workItemId }, select: { startedAt: true } });
          await tx.outcomeHumanActionCard.update({
            where: { workItemId }, data: { startedAt: started.startedAt, startedBy: actor },
          });
        }
        const response = await this.detailIn(tx, workItemId);
        await tx.idempotencyRecord.create({ data: {
          scope, key: input.clientRequestId, requestHash, response: toJson(response), status: "completed",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        } });
        return response;
      });
    } catch (failure) {
      if (failure instanceof OutcomeError)
        throw new ApiError(OUTCOME_ERROR_CODES[failure.code], failure.code, failure.message, { retryable: false, ...failure.details });
      throw failure;
    }
  }

  private view(item: Item): HumanWorkItemView {
    return {
      id: item.id, outcomeId: item.outcomeId, executorType: item.executorType, kind: item.kind,
      status: item.status, title: item.title, contractRevision: item.contractRevision.revision,
      runId: item.rootRunId ?? undefined, humanActionCardId: item.humanActionCard?.workItemId,
      evidenceCount: item._count.evidence,
      nextAction: item.executorType === "human" ? nextAction(item.status) : undefined,
      startedAt: item.startedAt?.toISOString() ?? null,
    };
  }

  private async detailIn(tx: Tx | PrismaClient, workItemId: string): Promise<HumanWorkItemDetail> {
    const item = await tx.outcomeWorkItem.findUnique({ where: { id: workItemId }, include });
    if (!item) throw new ApiError(404, "work_item_not_found", "WorkItem not found");
    const snapshot = item.humanActionCard;
    const card: HumanActionCardView | null = snapshot ? {
      id: snapshot.workItemId, workItemId: item.id, outcomeId: item.outcomeId,
      contractRevision: item.contractRevision.revision, title: item.title, purpose: snapshot.purpose,
      prerequisites: snapshot.prerequisites as unknown as HumanActionCardView["prerequisites"],
      steps: snapshot.steps as unknown as HumanActionCardView["steps"],
      inputFields: snapshot.inputFields as unknown as HumanActionCardView["inputFields"],
      evidenceRequirements: snapshot.evidenceRequirements as unknown as HumanActionCardView["evidenceRequirements"],
      references: snapshot.references as unknown as KnowledgeReference[],
      status: item.status as HumanActionCardView["status"],
      draft: snapshot.draft as unknown as HumanActionCardView["draft"],
      startedBy: snapshot.startedBy, startedAt: snapshot.startedAt?.toISOString() ?? null,
      submittedAt: snapshot.submittedAt?.toISOString() ?? null, acceptedAt: snapshot.acceptedAt?.toISOString() ?? null,
    } : null;
    return { ...this.view(item), card };
  }
}
