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
  type OutcomeBudget,
  type OutcomeDetail,
  OutcomeError,
  type OutcomeErrorCode,
  type OutcomeEventTopic,
  type OutcomeEventPayloads,
  type OutcomeListPage,
  type OutcomeStatus,
  parseOutcomeWorkItemProgress,
  type PlanningConflict,
  type PlanningDraftView,
  type StartOutcomeRunInput,
  resolvePlanningSelections,
} from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { Effect } from "effect";
import type { RunService } from "./run-service";
import { hashRequest, serviceEffect, toJson } from "./service-utils";
import { lockExploreIdea } from "./explore-state";

import { appendOutcomeEvent, recomputeOutcomeStatus, transitionWorkItem, enqueueOutcomeTurn, readOutcomeTranscript, type AgentMessaging, type ActorRef } from "@outcomego/messaging";
export type { ActorRef } from "@outcomego/messaging";

type Tx = Prisma.TransactionClient;

const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60_000;
const ACTIVE_AGENT_STATES = ["queued", "running", "retry_pending", "needs_review"] as const;
const ACTIVE_HUMAN_STATES = ["pending", "ready", "in_progress", "paused", "submitted", "review_pending"] as const;

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
  revisions: { orderBy: { revision: "asc" }, select: { id: true, revision: true, status: true, changeSummary: true, baseRevisionId: true, sourceDecisionId: true, createdBy: true, createdAt: true } },
  workItems: { orderBy: { ordinal: "asc" }, include: { contractRevision: { select: { revision: true } }, runs: { select: { id: true }, orderBy: { createdAt: "asc" } } } },
  outputs: { orderBy: { createdAt: "asc" } },
  evidence: { orderBy: { capturedAt: "asc" }, include: { contractRevision: { select: { revision: true } } } },
  reviews: { orderBy: [{ criterionId: "asc" }, { sequence: "asc" }], include: { contractRevision: { select: { revision: true } } } },
} satisfies Prisma.OutcomeInclude;

type OutcomeRow = Prisma.OutcomeGetPayload<{ include: typeof detailInclude }>;

/**
 * Outcome, contract revision and status (specs/004.2 tasks 1.3). Every write runs in one transaction with its
 * events and its idempotency record. Runtime cancellation is delegated after those transactions commit.
 */
export class OutcomeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly messaging?: AgentMessaging,
    private readonly runService?: Pick<RunService, "cancel"> & Partial<Pick<RunService, "cancelOutcomeWorkItems">>,
    private readonly onRevisionCreated?: (tx: Tx, outcomeId: string, actor: ActorRef) => Promise<void>,
  ) {}

  createFromDraft = (input: CreateOutcomeInput, actor: ActorRef) =>
    serviceEffect(() =>
      this.idempotent("outcome-create", input.clientRequestId, input, async (tx) => {
        const draft = await tx.outcomePlanningDraft.findUnique({ where: { id: input.planId } });
        if (!draft) throw outcomeApiError("planning_draft_not_found", "Planning draft not found");
        const source = await tx.exploreIdea.findUnique({ where: { planningDraftId: draft.id } });
        const explore = source ? await lockExploreIdea(tx, source.id) : null;
        if (explore && (explore.status !== "proposed_for_delivery" || explore.planningDraftId !== draft.id))
          throw new ApiError(409, "explore_read_only", "This Explore proposal is no longer available for conversion", { currentStatus: explore.status, retryable: false });
        if (draft.status !== "ready" || draft.expiresAt <= new Date())
          throw outcomeApiError("planning_draft_expired", "This planning draft can no longer be used", { currentStatus: draft.status });
        const snapshot = draft.snapshot as unknown as Pick<PlanningDraftView, "goal" | "acceptance" | "boundaries">;
        const budget: OutcomeBudget | null = input.budget ?? null;
        const contract = resolvePlanningSelections(snapshot, input, budget);
        const outcome = await tx.outcome.create({
          data: { botId: draft.botId, planningDraftId: draft.id, title: input.title.trim(), description: draft.sourceText, sourceExploreId: explore?.id ?? null },
        });
        await tx.outcomePlanningDraft.update({ where: { id: draft.id }, data: { status: "consumed" } });
        await this.event(tx, "outcome.created", outcome.id, actor, input.clientRequestId, { title: outcome.title, botId: draft.botId });
        await this.insertRevision(tx, outcome.id, 1, contract, draft.botId, actor, input.clientRequestId, {});
        if (explore) await tx.exploreIdea.update({ where: { id: explore.id }, data: { status: "converted", proposedOutcomeId: outcome.id } });
        await this.recomputeStatus(tx, outcome.id, actor);
        return this.detail(tx, outcome.id);
      })
    );

  createRevision = (outcomeId: string, input: CreateContractRevisionInput, actor: ActorRef) =>
    serviceEffect(() =>
      this.idempotent(`outcome-revision:${outcomeId}`, input.clientRequestId, input, async (tx) => {
        return this.createRevisionInTransaction(tx, outcomeId, input, actor);
      })
    );

  /** The caller owns the transaction and request idempotency (Decision resolution uses this entry point). */
  createRevisionInTransaction = async (tx: Tx, outcomeId: string, input: CreateContractRevisionInput, actor: ActorRef): Promise<OutcomeDetail> => {
    const outcome = await this.lockOutcome(tx, outcomeId);
    this.assertOpen(outcome.status);
    const current = outcome.currentRevisionId
      ? await tx.outcomeContractRevision.findUniqueOrThrow({ where: { id: outcome.currentRevisionId } })
      : null;
    if (!current || current.revision !== input.baseRevision)
      throw outcomeApiError("contract_revision_conflict", "The contract changed; reload before editing", { currentRevision: current?.revision ?? null });
    if (input.sourceDecisionId) {
      const source = await tx.outcomeDecision.findUnique({ where: { id: input.sourceDecisionId }, select: { outcomeId: true, contractRevisionId: true } });
      if (!source || source.outcomeId !== outcomeId ||
        (source.contractRevisionId !== current.id && input.sourceDecisionId !== current.sourceDecisionId))
        throw outcomeApiError("contract_revision_conflict", "The source decision does not belong to this contract", { currentRevision: current.revision });
    }
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
      changeSummary: input.changeSummary?.trim() || `Contract updated from revision ${current.revision}`,
      baseRevisionId: current.id,
      sourceDecisionId: input.sourceDecisionId ?? null,
    });
    await this.onRevisionCreated?.(tx, outcomeId, actor);
    await this.recomputeStatus(tx, outcomeId, actor);
    return this.detail(tx, outcomeId);
  }

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
        await this.onRevisionCreated?.(tx, outcomeId, actor);
        // Keep running snapshots intact; only work that has never started is replaced by the approved successor.
        const notStarted = await tx.outcomeWorkItem.findMany({
          where: {
            outcomeId, contractRevisionId: { not: revision.id }, startedAt: null,
            OR: [
              { executorType: "agent", status: { in: ["queued", "retry_pending"] } },
              { executorType: "human", status: { in: ["pending", "ready"] } },
            ],
          },
          orderBy: { ordinal: "asc" },
          select: { id: true },
        });
        for (const item of notStarted) await transitionWorkItem(tx, {
          workItemId: item.id, to: "cancelled", reason: "contract_revision_superseded", actor,
          idempotencyKey: `revision-approved:${revision.id}`,
        });
        await this.event(tx, "outcome.contract.revision_approved", outcomeId, actor, input.clientRequestId, {
          revisionId: revision.id,
          contentHash: revision.contentHash,
        }, revisionNumber);
        const status = await this.recomputeStatus(tx, outcomeId, actor);
        // Same condition the Start button used: nothing older is still running or waiting, so this revision is next.
        if (status === "approved") await this.startApprovedRevision(tx, outcome, revision, actor, input.clientRequestId);
        return this.detail(tx, outcomeId);
      })
    );

  startRun = (outcomeId: string, input: StartOutcomeRunInput, actor: ActorRef) =>
    serviceEffect(() => this.idempotent(`outcome-run:${outcomeId}`, input.clientRequestId, input, async tx => {
      const outcome = await this.lockOutcome(tx, outcomeId);
      this.assertOpen(outcome.status);
      const revision = outcome.currentRevisionId
        ? await tx.outcomeContractRevision.findUnique({ where: { id: outcome.currentRevisionId } }) : null;
      if (!revision || revision.revision !== input.expectedRevision)
        throw outcomeApiError("contract_revision_conflict", "The contract changed; reload before execution");
      if (revision.status !== "approved" || !revision.approvedAt)
        throw outcomeApiError("contract_revision_not_approved", "Approve the contract before execution", { currentStatus: revision.status });
      if (!this.messaging) throw outcomeApiError("bot_not_runnable", "Outcome execution messaging is not configured", { retryable: true });
      await this.startApprovedRevision(tx, outcome, revision, actor, input.clientRequestId);
      return this.detail(tx, outcomeId);
    }));

  /**
   * Creates the first work item of an approved revision and queues its turn. Approval calls this directly, so
   * an approved Outcome is either executing or waiting on a step approval, never idle waiting for a start click.
   * D11: a repeated start never creates a second initial work item in the same revision.
   */
  private async startApprovedRevision(
    tx: Tx,
    outcome: { id: string; title: string },
    revision: { id: string; revision: number; executionBotId: string },
    actor: ActorRef,
    clientRequestId: string,
  ) {
    if (!this.messaging) return;
    const outcomeId = outcome.id;
    const existing = await tx.outcomeWorkItem.findFirst({ where: { outcomeId, contractRevisionId: revision.id, executorType: "agent", kind: "initial" } });
    if (existing) return;
    const last = await tx.outcomeWorkItem.findFirst({ where: { outcomeId }, orderBy: { ordinal: "desc" }, select: { ordinal: true } });
    const item = await tx.outcomeWorkItem.create({ data: {
      outcomeId, contractRevisionId: revision.id, botId: revision.executionBotId, executorType: "agent", kind: "initial",
      title: outcome.title, instructions: "Execute the approved Outcome contract. Return a complete final result and write deliverable files to the assigned Outcome output directory.",
      status: "queued", ordinal: (last?.ordinal ?? 0) + 1,
    } });
    await appendOutcomeEvent(tx, "outcome.work_item.created", outcomeId, {
      actor, contractRevision: revision.revision, workItemId: item.id, idempotencyKey: clientRequestId,
      payload: { workItemId: item.id, executorType: "agent", kind: "initial" },
    });
    await enqueueOutcomeTurn(tx, this.messaging, { workItemId: item.id, content: item.instructions, reason: "start",
      clientId: `outcome-run:${outcomeId}:${revision.revision}:${item.id}` });
    await this.recomputeStatus(tx, outcomeId, actor);
  }

  /** Cancel facts atomically; stop only this Outcome's run groups outside the transaction. Retries reattempt incomplete stops. */
  cancel = (outcomeId: string, input: CancelOutcomeInput, actor: ActorRef) =>
    serviceEffect(async () => {
      const result = await this.idempotent(`outcome-cancel:${outcomeId}`, input.clientRequestId, input, async tx => {
        const outcome = await this.lockOutcome(tx, outcomeId);
        this.assertOpen(outcome.status);
        await tx.outcome.update({ where: { id: outcomeId }, data: { cancelledAt: new Date() } });
        if (this.onRevisionCreated) await this.onRevisionCreated(tx, outcomeId, actor);
        const unfinished = await tx.outcomeWorkItem.findMany({
          where: { outcomeId, status: { in: [...ACTIVE_AGENT_STATES, "waiting_decision", "waiting_human", ...ACTIVE_HUMAN_STATES] } }, select: { id: true },
        });
        for (const item of unfinished) await transitionWorkItem(tx, {
          workItemId: item.id, to: "cancelled", reason: "outcome_cancelled", actor, idempotencyKey: input.clientRequestId,
        });
        await this.recomputeStatus(tx, outcomeId, actor);
        return this.detail(tx, outcomeId);
      });
      const items = await this.prisma.outcomeWorkItem.findMany({ where: { outcomeId, executorType: "agent", rootRunId: { not: null } }, select: { id: true } });
      if (items.length) {
        if (!this.runService?.cancelOutcomeWorkItems)
          throw new ApiError(503, "outcome_stop_incomplete", "Outcome run-group cancellation is not configured", { retryable: true });
        const stop = await Effect.runPromise(Effect.either(this.runService.cancelOutcomeWorkItems(items.map(item => item.id))));
        if (stop._tag === "Left") throw stop.left;
      }
      return result;
    });

  transcript = (outcomeId: string, workItemId: string, query: { before?: number; limit?: number } = {}) =>
    serviceEffect(() => this.prisma.$transaction(async tx => {
      const outcome = await tx.outcome.findUnique({ where: { id: outcomeId }, select: { id: true } });
      if (!outcome) throw outcomeApiError("outcome_not_found", "Outcome not found");
      const item = await tx.outcomeWorkItem.findFirst({ where: { id: workItemId, outcomeId, executorType: "agent" }, select: { id: true } });
      if (!item) throw outcomeApiError("work_item_not_found", "Outcome work item not found");
      return readOutcomeTranscript(tx, item.id, query);
    }, { isolationLevel: "RepeatableRead" }));

  get = (outcomeId: string) =>
    serviceEffect(async () => {
      const row = await this.prisma.outcome.findUnique({ where: { id: outcomeId }, include: detailInclude });
      if (!row) throw outcomeApiError("outcome_not_found", "Outcome not found");
      return this.toDetail(row);
    });

  getRevision = (outcomeId: string, revisionNumber: number) => serviceEffect(() =>
    this.prisma.$transaction(async tx => {
      if (!await tx.outcome.findUnique({ where: { id: outcomeId }, select: { id: true } }))
        throw outcomeApiError("outcome_not_found", "Outcome not found");
      const revision = await tx.outcomeContractRevision.findUnique({
        where: { outcomeId_revision: { outcomeId, revision: revisionNumber } },
        include: { criteria: { orderBy: { ordinal: "asc" } }, reviews: { orderBy: { sequence: "asc" } } },
      });
      if (!revision) throw outcomeApiError("contract_revision_not_found", "Contract revision not found");
      return this.revisionView(revision, revision.reviews);
    }, { isolationLevel: "RepeatableRead" }));

  list = (query: ListOutcomesQuery) =>
    serviceEffect(async (): Promise<OutcomeListPage> => {
      const rows = await this.prisma.outcome.findMany({
        where: {
          ...(query.statuses.length ? { status: { in: query.statuses } } : {}),
          ...(query.query ? {
            AND: [{ OR: [
              { title: { contains: query.query, mode: "insensitive" } },
              { description: { contains: query.query, mode: "insensitive" } },
            ] }],
          } : {}),
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

  /** Compatibility entry point for callers of the original server service. */
  recomputeStatus = recomputeOutcomeStatus;

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

  private event<T extends OutcomeEventTopic>(
    tx: Tx,
    topic: T,
    outcomeId: string,
    actor: ActorRef,
    idempotencyKey: string | undefined,
    payload: OutcomeEventPayloads[T],
    contractRevision?: number,
    workItemId?: string
  ) {
    return appendOutcomeEvent(tx, topic, outcomeId, { actor, idempotencyKey, payload, contractRevision, workItemId });
  }

  /**
   * Runs `write` once per (scope, clientRequestId). The record is written in the same transaction as the business
   * facts, so a retry either replays the stored response or, with a different body, fails with idempotency_conflict.
   */
  private async idempotent<T>(scope: string, key: string, request: unknown, write: (tx: Tx) => Promise<T>): Promise<T> {
    const requestHash = hashRequest(request);
    const replay = async (client: Pick<Tx, "idempotencyRecord"> = this.prisma) => {
      const previous = await client.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
      if (!previous) return undefined;
      if (previous.requestHash !== requestHash)
        throw outcomeApiError("idempotency_conflict", "This request ID was already used for a different request");
      return previous.response as T;
    };
    const stored = await replay();
    if (stored !== undefined) return stored;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope}:${key}`}))`;
        // Recheck after waiting: an earlier identical request may have changed the business state.
        const committed = await replay(tx);
        if (committed !== undefined) return committed;
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

  getInTransaction = (tx: Tx, outcomeId: string) => this.detail(tx, outcomeId);

  private async detail(tx: Tx, outcomeId: string): Promise<OutcomeDetail> {
    return this.toDetail(await tx.outcome.findUniqueOrThrow({ where: { id: outcomeId }, include: detailInclude }));
  }

  private revisionView(
    revision: NonNullable<OutcomeRow["currentRevision"]>,
    reviews: Array<Pick<OutcomeRow["reviews"][number], "criterionId" | "result">>,
  ): ContractRevisionView {
    const latestResult = new Map<string, OutcomeRow["reviews"][number]["result"]>();
    for (const review of reviews) latestResult.set(review.criterionId, review.result);
    return {
          id: revision.id,
          revision: revision.revision,
          status: revision.status,
          goal: asStringArray(revision.goal),
          boundaries: asBoundaries(revision.boundaries),
          budget: (revision.budget as unknown as OutcomeBudget | null) ?? null,
          executionBotId: revision.executionBotId,
          changeSummary: revision.changeSummary,
          baseRevisionId: revision.baseRevisionId,
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
        };
  }

  private toDetail(row: OutcomeRow): OutcomeDetail {
    const revision = row.currentRevision;
    const currentRevisionView = revision ? this.revisionView(revision, row.reviews) : null;
    return {
      id: row.id,
      sourceExploreId: row.sourceExploreId,
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
        progress: parseOutcomeWorkItemProgress(item.progress),
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
