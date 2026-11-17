import { ApiError } from "@outcomego/contracts";
import {
  type ApproveContractRevisionInput,
  type CancelOutcomeInput,
  type ConfirmedContract,
  type ContractRevisionView,
  type CreateContractRevisionInput,
  type CreateOutcomeInput,
  detectPlanningConflicts,
  encodeOutcomeCursor,
  hasBlockingConflict,
  type ListOutcomesQuery,
  OUTCOME_ERROR_CODES,
  OUTCOME_EVENT_SCHEMA_VERSION,
  OUTCOME_STATUS_PRIORITY,
  type OutcomeBudget,
  type OutcomeDetail,
  OutcomeError,
  type OutcomeErrorCode,
  type OutcomeEventTopic,
  type OutcomeListPage,
  type OutcomeStatus,
  type PlanningConflict,
  type PlanningDraftView,
  resolvePlanningSelections,
} from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { appendEvent, hashRequest, serviceEffect, toJson } from "./service-utils";

/** Who performed an action, derived from the request context, never from the body (specs/004 design §44). */
export type ActorRef = `user:${string}` | "owner:local" | `bot:${string}` | `system:${string}`;

type Tx = Prisma.TransactionClient;

const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60_000;
const ACTIVE_AGENT_STATES = ["queued", "running", "retry_pending", "needs_review"] as const;
const ACTIVE_HUMAN_STATES = ["pending", "ready", "in_progress", "paused", "submitted", "review_pending"] as const;
const SIDE_STATUSES: readonly OutcomeStatus[] = ["paused", "decision_pending", "human_action_pending"];

export const outcomeApiError = (code: OutcomeErrorCode, message: string, details: Record<string, unknown> = {}) =>
  new ApiError(OUTCOME_ERROR_CODES[code], code, message, { retryable: false, ...details });

const fromOutcomeError = (error: unknown) =>
  error instanceof OutcomeError ? outcomeApiError(error.code, error.message, error.details) : error;

const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === "P2002";

const revisionContentHash = (contract: ConfirmedContract, executionBotId: string) =>
  hashRequest({
    goal: contract.goal,
    acceptance: contract.acceptance.map(({ statement, required, verificationMethod }) => ({ statement, required, verificationMethod })),
    boundaries: contract.boundaries,
    budget: contract.budget,
    executionBotId,
  });

const asStringArray = (value: Prisma.JsonValue): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const asBoundaries = (value: Prisma.JsonValue) => {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Prisma.JsonValue>) : {};
  return { included: asStringArray(record.included ?? []), excluded: asStringArray(record.excluded ?? []) };
};

const detailInclude = {
  currentRevision: { include: { criteria: { orderBy: { ordinal: "asc" } } } },
  revisions: { orderBy: { revision: "asc" }, select: { id: true, revision: true, status: true, changeSummary: true, createdAt: true } },
  workItems: { orderBy: { ordinal: "asc" }, include: { contractRevision: { select: { revision: true } }, runs: { select: { id: true }, orderBy: { createdAt: "asc" } } } },
  outputs: { orderBy: { createdAt: "asc" } },
  evidence: { orderBy: { capturedAt: "asc" }, include: { contractRevision: { select: { revision: true } } } },
  reviews: { orderBy: [{ criterionId: "asc" }, { sequence: "asc" }], include: { contractRevision: { select: { revision: true } } } },
} satisfies Prisma.OutcomeInclude;

type OutcomeRow = Prisma.OutcomeGetPayload<{ include: typeof detailInclude }>;

/**
 * Outcome, contract revision and status (specs/004.2 tasks 1.3). Every write runs in one transaction with its
 * events and its idempotency record; nothing here calls the worker or the computer.
 */
export class OutcomeService {
  constructor(private readonly prisma: PrismaClient) {}

  createFromDraft = (input: CreateOutcomeInput, actor: ActorRef) =>
    serviceEffect(() =>
      this.idempotent("outcome-create", input.clientRequestId, input, async (tx) => {
        const draft = await tx.outcomePlanningDraft.findUnique({ where: { id: input.planId } });
        if (!draft) throw outcomeApiError("planning_draft_not_found", "Planning draft not found");
        if (draft.status !== "ready" || draft.expiresAt <= new Date())
          throw outcomeApiError("planning_draft_expired", "This planning draft can no longer be used", { currentStatus: draft.status });
        const snapshot = draft.snapshot as unknown as Pick<PlanningDraftView, "goal" | "acceptance" | "boundaries">;
        const budget: OutcomeBudget | null = input.budget ?? null;
        const contract = resolvePlanningSelections(snapshot, input, budget);
        const outcome = await tx.outcome.create({
          data: { botId: draft.botId, planningDraftId: draft.id, title: input.title.trim(), description: draft.sourceText },
        });
        await tx.outcomePlanningDraft.update({ where: { id: draft.id }, data: { status: "consumed" } });
        await this.event(tx, "outcome.created", outcome.id, actor, input.clientRequestId, { title: outcome.title, botId: draft.botId });
        await this.insertRevision(tx, outcome.id, 1, contract, draft.botId, actor, input.clientRequestId, {});
        await this.recomputeStatus(tx, outcome.id, actor);
        return this.detail(tx, outcome.id);
      })
    );

  createRevision = (outcomeId: string, input: CreateContractRevisionInput, actor: ActorRef) =>
    serviceEffect(() =>
      this.idempotent(`outcome-revision:${outcomeId}`, input.clientRequestId, input, async (tx) => {
        const outcome = await this.lockOutcome(tx, outcomeId);
        this.assertOpen(outcome.status);
        const current = outcome.currentRevisionId
          ? await tx.outcomeContractRevision.findUniqueOrThrow({ where: { id: outcome.currentRevisionId } })
          : null;
        if (!current || current.revision !== input.baseRevision)
          throw outcomeApiError("contract_revision_conflict", "The contract changed; reload before editing", { currentRevision: current?.revision ?? null });
        const contract: ConfirmedContract = {
          goal: input.contract.goal.map((text) => text.trim()),
          acceptance: input.contract.acceptance.map(({ statement, required }) => ({ statement: statement.trim(), required, verificationMethod: "human_review" })),
          boundaries: {
            included: input.contract.boundaries.included.map((text) => text.trim()),
            excluded: input.contract.boundaries.excluded.map((text) => text.trim()),
          },
          budget: input.contract.budget,
        };
        // An unapproved revision is replaced outright; an approved one stays in force until its successor is approved.
        if (current.status !== "approved")
          await tx.outcomeContractRevision.update({ where: { id: current.id }, data: { status: "superseded" } });
        await this.insertRevision(tx, outcomeId, current.revision + 1, contract, current.executionBotId, actor, input.clientRequestId, {
          changeSummary: input.changeSummary?.trim() || null,
          baseRevisionId: current.id,
          sourceDecisionId: input.sourceDecisionId ?? null,
        });
        await this.recomputeStatus(tx, outcomeId, actor);
        return this.detail(tx, outcomeId);
      })
    );

  approve = (outcomeId: string, revisionNumber: number, input: ApproveContractRevisionInput, actor: ActorRef) =>
    serviceEffect(() =>
      this.idempotent(`outcome-approve:${outcomeId}`, input.clientRequestId, { revisionNumber, ...input }, async (tx) => {
        const outcome = await this.lockOutcome(tx, outcomeId);
        this.assertOpen(outcome.status);
        const revision = await tx.outcomeContractRevision.findUnique({
          where: { outcomeId_revision: { outcomeId, revision: revisionNumber } },
        });
        if (!revision) throw outcomeApiError("contract_revision_not_found", "Contract revision not found");
        if (input.expectedRevision !== revisionNumber || outcome.currentRevisionId !== revision.id)
          throw outcomeApiError("contract_revision_conflict", "Only the current revision can be approved", { currentStatus: revision.status });
        if (revision.status === "superseded") throw outcomeApiError("superseded_revision", "This revision was replaced", { currentStatus: revision.status });
        if (revision.status !== "pending_approval")
          throw outcomeApiError(
            hasBlockingConflict(revision.conflicts as unknown as PlanningConflict[]) ? "planning_conflict" : "invalid_outcome_transition",
            "This revision cannot be approved in its current state",
            { currentStatus: revision.status }
          );
        const approvedAt = new Date();
        await tx.outcomeContractRevision.updateMany({
          where: { outcomeId, status: "approved", id: { not: revision.id } },
          data: { status: "superseded" },
        });
        await tx.outcomeContractRevision.update({
          where: { id: revision.id },
          data: {
            status: "approved",
            approvedBy: actor,
            approvedAt,
            approvalProof: toJson({
              confirmationText: input.confirmationText,
              contentHash: revision.contentHash,
              actorRef: actor,
              approvedAt: approvedAt.toISOString(),
            }),
          },
        });
        await this.event(tx, "outcome.contract.revision_approved", outcomeId, actor, input.clientRequestId, {
          revisionId: revision.id,
          contentHash: revision.contentHash,
        }, revisionNumber);
        await this.recomputeStatus(tx, outcomeId, actor);
        return this.detail(tx, outcomeId);
      })
    );

  /** Marks the Outcome and its unfinished work items cancelled. Stopping sub-thread runs is added with execution (task 3.2). */
  cancel = (outcomeId: string, input: CancelOutcomeInput, actor: ActorRef) =>
    serviceEffect(() =>
      this.idempotent(`outcome-cancel:${outcomeId}`, input.clientRequestId, input, async (tx) => {
        const outcome = await this.lockOutcome(tx, outcomeId);
        this.assertOpen(outcome.status);
        const now = new Date();
        await tx.outcome.update({ where: { id: outcomeId }, data: { cancelledAt: now } });
        const unfinished = await tx.outcomeWorkItem.findMany({
          where: { outcomeId, status: { in: [...ACTIVE_AGENT_STATES, "waiting_decision", "waiting_human", ...ACTIVE_HUMAN_STATES] } },
          select: { id: true, status: true },
        });
        for (const item of unfinished) {
          await tx.outcomeWorkItem.update({ where: { id: item.id }, data: { status: "cancelled", statusReason: "outcome_cancelled", completedAt: now } });
          await this.event(tx, "outcome.work_item.updated", outcomeId, actor, input.clientRequestId, { from: item.status, to: "cancelled", reason: "outcome_cancelled" }, undefined, item.id);
        }
        await this.recomputeStatus(tx, outcomeId, actor);
        return this.detail(tx, outcomeId);
      })
    );

  get = (outcomeId: string) =>
    serviceEffect(async () => {
      const row = await this.prisma.outcome.findUnique({ where: { id: outcomeId }, include: detailInclude });
      if (!row) throw outcomeApiError("outcome_not_found", "Outcome not found");
      return this.toDetail(row);
    });

  list = (query: ListOutcomesQuery) =>
    serviceEffect(async (): Promise<OutcomeListPage> => {
      const rows = await this.prisma.outcome.findMany({
        where: {
          ...(query.statuses.length ? { status: { in: query.statuses } } : {}),
          ...(query.cursor
            ? {
                OR: [
                  { updatedAt: { lt: new Date(query.cursor.updatedAt) } },
                  { updatedAt: new Date(query.cursor.updatedAt), id: { lt: query.cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        include: { currentRevision: { select: { revision: true } } },
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          botId: row.botId,
          currentRevision: row.currentRevision?.revision ?? null,
          updatedAt: row.updatedAt.toISOString(),
        })),
        nextCursor: rows.length > query.limit && last ? encodeOutcomeCursor(last.updatedAt.toISOString(), last.id) : null,
      };
    });

  /**
   * Derives the Outcome status from its facts in the priority order of specs/004 design §42.3 and records the
   * status a side state (decision, human action, pause) should return to.
   */
  async recomputeStatus(tx: Tx, outcomeId: string, actor: ActorRef): Promise<OutcomeStatus> {
    const outcome = await tx.outcome.findUniqueOrThrow({
      where: { id: outcomeId },
      include: {
        currentRevision: { select: { id: true, status: true } },
        workItems: { select: { executorType: true, status: true, contractRevisionId: true } },
      },
    });
    const current = outcome.currentRevision;
    const items = outcome.workItems.filter((item) => item.contractRevisionId === current?.id);
    const agent = items.filter((item) => item.executorType === "agent");
    const human = items.filter((item) => item.executorType === "human");
    const candidates = new Set<OutcomeStatus>();
    if (outcome.cancelledAt) candidates.add("cancelled");
    if (outcome.acceptedAt) candidates.add("accepted");
    if (agent.some((item) => item.status === "waiting_decision")) candidates.add("decision_pending");
    if (agent.some((item) => item.status === "waiting_human") || human.some((item) => (ACTIVE_HUMAN_STATES as readonly string[]).includes(item.status)))
      candidates.add("human_action_pending");
    const agentActive = agent.some((item) => (ACTIVE_AGENT_STATES as readonly string[]).includes(item.status));
    if (agentActive) candidates.add("running");
    else if (agent.some((item) => item.status === "completed") || human.some((item) => item.status === "accepted"))
      candidates.add("review_pending");
    else if (agent.length && agent.every((item) => ["failed", "cancelled"].includes(item.status)) && agent.some((item) => item.status === "failed"))
      candidates.add("failed");
    if (current?.status === "approved") candidates.add("approved");
    if (current?.status === "pending_approval") candidates.add("pending_approval");
    if (!current || current.status === "draft") candidates.add("draft");
    // A pending revision N+1 takes the Outcome back to approval even while revision N work is recorded.
    if (current?.status === "pending_approval") {
      for (const status of ["running", "review_pending", "failed", "approved"] as const) candidates.delete(status);
    }
    const status = OUTCOME_STATUS_PRIORITY.find((candidate) => candidates.has(candidate)) ?? "draft";
    const base = OUTCOME_STATUS_PRIORITY.find((candidate) => candidates.has(candidate) && !SIDE_STATUSES.includes(candidate)) ?? "draft";
    const resumeStatus = SIDE_STATUSES.includes(status) ? base : null;
    if (status !== outcome.status || resumeStatus !== outcome.resumeStatus) {
      await tx.outcome.update({ where: { id: outcomeId }, data: { status, resumeStatus } });
      if (status !== outcome.status)
        await this.event(tx, "outcome.status_changed", outcomeId, actor, undefined, { from: outcome.status, to: status });
    }
    return status;
  }

  private async insertRevision(
    tx: Tx,
    outcomeId: string,
    revision: number,
    contract: ConfirmedContract,
    executionBotId: string,
    actor: ActorRef,
    clientRequestId: string,
    extra: { changeSummary?: string | null; baseRevisionId?: string; sourceDecisionId?: string | null }
  ) {
    const conflicts = detectPlanningConflicts(contract);
    const created = await tx.outcomeContractRevision.create({
      data: {
        outcomeId,
        revision,
        status: hasBlockingConflict(conflicts) ? "draft" : "pending_approval",
        goal: toJson(contract.goal),
        boundaries: toJson(contract.boundaries),
        budget: contract.budget ? toJson(contract.budget) : undefined,
        executionBotId,
        conflicts: toJson(conflicts),
        contentHash: revisionContentHash(contract, executionBotId),
        changeSummary: extra.changeSummary ?? null,
        baseRevisionId: extra.baseRevisionId ?? null,
        sourceDecisionId: extra.sourceDecisionId ?? null,
        createdBy: actor,
        criteria: {
          create: contract.acceptance.map((criterion, index) => ({
            ordinal: index + 1,
            statement: criterion.statement,
            required: criterion.required,
            verificationMethod: criterion.verificationMethod,
          })),
        },
      },
    });
    await tx.outcome.update({ where: { id: outcomeId }, data: { currentRevisionId: created.id } });
    await this.event(tx, "outcome.contract.revision_created", outcomeId, actor, clientRequestId, {
      revisionId: created.id,
      status: created.status,
      baseRevisionId: extra.baseRevisionId ?? null,
      sourceDecisionId: extra.sourceDecisionId ?? null,
    }, revision);
    return created;
  }

  private async lockOutcome(tx: Tx, outcomeId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`;
    const outcome = await tx.outcome.findUnique({ where: { id: outcomeId } });
    if (!outcome) throw outcomeApiError("outcome_not_found", "Outcome not found");
    return outcome;
  }

  private assertOpen(status: OutcomeStatus) {
    if (status === "accepted" || status === "cancelled")
      throw outcomeApiError("invalid_outcome_transition", `This Outcome is ${status}`, { currentStatus: status });
  }

  private event(
    tx: Tx,
    topic: OutcomeEventTopic,
    outcomeId: string,
    actor: ActorRef,
    idempotencyKey: string | undefined,
    payload: Record<string, unknown>,
    contractRevision?: number,
    workItemId?: string
  ) {
    const eventId = crypto.randomUUID();
    return appendEvent(tx, topic, outcomeId, {
      eventId,
      schemaVersion: OUTCOME_EVENT_SCHEMA_VERSION,
      occurredAt: new Date().toISOString(),
      ...(contractRevision === undefined ? {} : { contractRevision }),
      ...(workItemId ? { workItemId } : {}),
      actorId: actor,
      correlationId: idempotencyKey ?? eventId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      payload,
    });
  }

  /**
   * Runs `write` once per (scope, clientRequestId). The record is written in the same transaction as the business
   * facts, so a retry either replays the stored response or, with a different body, fails with idempotency_conflict.
   */
  private async idempotent<T>(scope: string, key: string, request: unknown, write: (tx: Tx) => Promise<T>): Promise<T> {
    const requestHash = hashRequest(request);
    const replay = async () => {
      const previous = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
      if (!previous) return undefined;
      if (previous.requestHash !== requestHash)
        throw outcomeApiError("idempotency_conflict", "This request ID was already used for a different request");
      return previous.response as T;
    };
    const stored = await replay();
    if (stored !== undefined) return stored;
    try {
      return await this.prisma.$transaction(async (tx) => {
        let result: T;
        try {
          result = await write(tx);
        } catch (error) {
          throw fromOutcomeError(error);
        }
        await tx.idempotencyRecord.create({
          data: { scope, key, requestHash, response: toJson(result), status: "completed", expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) },
        });
        return result;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent request with the same ID committed first; replay its result.
      const winner = await replay();
      if (winner !== undefined) return winner;
      throw error;
    }
  }

  private async detail(tx: Tx, outcomeId: string): Promise<OutcomeDetail> {
    return this.toDetail(await tx.outcome.findUniqueOrThrow({ where: { id: outcomeId }, include: detailInclude }));
  }

  private toDetail(row: OutcomeRow): OutcomeDetail {
    const revision = row.currentRevision;
    const latestResult = new Map<string, OutcomeRow["reviews"][number]["result"]>();
    for (const review of row.reviews) latestResult.set(review.criterionId, review.result);
    const currentRevisionView: ContractRevisionView | null = revision
      ? {
          id: revision.id,
          revision: revision.revision,
          status: revision.status,
          goal: asStringArray(revision.goal),
          boundaries: asBoundaries(revision.boundaries),
          budget: (revision.budget as unknown as OutcomeBudget | null) ?? null,
          executionBotId: revision.executionBotId,
          changeSummary: revision.changeSummary,
          sourceDecisionId: revision.sourceDecisionId,
          createdBy: revision.createdBy,
          approvedBy: revision.approvedBy,
          approvedAt: revision.approvedAt?.toISOString() ?? null,
          conflicts: revision.conflicts as unknown as PlanningConflict[],
          criteria: revision.criteria.map((criterion) => ({
            id: criterion.id,
            ordinal: criterion.ordinal,
            statement: criterion.statement,
            required: criterion.required,
            verificationMethod: criterion.verificationMethod,
            latestResult: latestResult.get(criterion.id) ?? null,
          })),
          createdAt: revision.createdAt.toISOString(),
        }
      : null;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      botId: row.botId,
      currentRevision: revision?.revision ?? null,
      updatedAt: row.updatedAt.toISOString(),
      description: row.description,
      resumeStatus: row.resumeStatus,
      createdAt: row.createdAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      currentRevisionView,
      revisions: row.revisions.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
      workItems: row.workItems.map((item) => ({
        id: item.id,
        contractRevision: item.contractRevision.revision,
        executorType: item.executorType,
        kind: item.kind,
        title: item.title,
        status: item.status,
        statusReason: item.statusReason,
        ordinal: item.ordinal,
        dependsOn: asStringArray(item.dependsOn),
        rootRunId: item.rootRunId,
        runIds: item.runs.map((run) => run.id),
        reworkOfWorkItemId: item.reworkOfWorkItemId,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      outputs: row.outputs.map((output) => ({
        id: output.id,
        workItemId: output.workItemId,
        runId: output.runId,
        kind: output.kind,
        title: output.title,
        content: output.content,
        contentRef: output.contentRef,
        createdAt: output.createdAt.toISOString(),
      })),
      evidence: row.evidence.map((entry) => ({
        id: entry.id,
        criterionId: entry.criterionId,
        contractRevision: entry.contractRevision.revision,
        workItemId: entry.workItemId,
        runId: entry.runId,
        sourceType: entry.sourceType as OutcomeDetail["evidence"][number]["sourceType"],
        sourceRef: entry.sourceRef,
        contentSummary: entry.contentSummary,
        credibility: entry.credibility,
        capturedBy: entry.capturedBy,
        capturedAt: entry.capturedAt.toISOString(),
      })),
      reviews: row.reviews.map((review) => ({
        id: review.id,
        criterionId: review.criterionId,
        contractRevision: review.contractRevision.revision,
        sequence: review.sequence,
        result: review.result,
        evidenceIds: asStringArray(review.evidenceIds),
        comment: review.comment,
        reviewedBy: review.reviewedBy,
        reviewedAt: review.reviewedAt.toISOString(),
      })),
    };
  }
}
