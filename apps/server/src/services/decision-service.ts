import { ApiError } from "@outcomego/contracts";
import type { DecisionCreateInput, DecisionOption, DecisionResolution, DecisionView, ResolveDecisionInput } from "@outcomego/contracts/outcome-inbox";
import { OutcomeError, type CreateContractRevisionInput, type OutcomeDetail } from "@outcomego/contracts/outcomes";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { createOutcomeDecision, isOutcomeDecisionRevisionActive, closeOutcomeDecision, appendOutcomeEvent, enqueueOutcomeTurn, transitionWorkItem, unavailableHumanActionPort, type ActorRef, type AgentMessaging, type HumanActionPort } from "@outcomego/messaging";
import { activeDecisionStatuses, revokeDecisionNotification, withdrawSupersededDecisions } from "./decision-lifecycle";
import { NotificationService } from "./notification-service";
import { Effect } from "effect";
import { hashRequest, serviceEffect, toJson } from "./service-utils";

type Tx = Prisma.TransactionClient;
export type DecisionRevisionWriter = (tx: Tx, outcomeId: string, input: CreateContractRevisionInput, actor: ActorRef) => Promise<OutcomeDetail>;
export interface DecisionServicePorts {
  messaging?: AgentMessaging;
  enqueueTurn?: typeof enqueueOutcomeTurn;
  createRevision?: DecisionRevisionWriter;
  humanActions?: HumanActionPort;
  /** Called after a decision resolution that created a new contract revision has committed. */
  onRevisionCreated?: (outcomeId: string) => void;
}
const include = { contractRevision: { select: { revision: true } } } satisfies Prisma.OutcomeDecisionInclude;
type Row = Prisma.OutcomeDecisionGetPayload<{ include: typeof include }>;
const active = (row: { status: string }) => (activeDecisionStatuses as readonly string[]).includes(row.status);
const apiError = (code: string, message: string, row?: Row, status = 409) => new ApiError(status, code, message, row ? { currentDecision: view(row), currentStatus: row.status, retryable: false } : { retryable: false });
const mapError = (error: unknown) => { if (error instanceof OutcomeError) throw new ApiError(error.status, error.code, error.message, error.details); throw error; };
const view = (row: Row): DecisionView => ({
  id: row.id, outcomeId: row.outcomeId, contractRevisionId: row.contractRevisionId, contractRevision: row.contractRevision.revision,
  runId: row.runId, workItemId: row.workItemId, status: row.status, reasonCode: row.reasonCode,
  completedSummary: row.completedSummary, problemSummary: row.problemSummary, nextStepSummary: row.nextStepSummary,
  recommendation: row.recommendation as DecisionView["recommendation"], options: row.options as unknown as DecisionOption[],
  customEntryAllowed: row.customEntryAllowed, expiresAt: row.expiresAt?.toISOString() ?? null,
  resolvedOption: row.resolvedOption as unknown as DecisionOption | null, customText: row.customText,
  resolvedBy: row.resolvedBy, resolvedAt: row.resolvedAt?.toISOString() ?? null, truncatedOptionCount: row.truncatedOptionCount,
  createdAt: row.createdAt.toISOString(),
});

/** All effects, the chosen snapshot, event and stored response share the caller's transaction. */
export class DecisionService {
  constructor(private readonly prisma: PrismaClient, private readonly ports: DecisionServicePorts = {}) {}

  create = (input: DecisionCreateInput, actor: ActorRef) => serviceEffect(async () => {
    const result = await this.prisma.$transaction(tx => this.createInTransaction(tx, input, actor)).catch(mapError);
    // Projection is retriable independently; provider/notification failures cannot undo the decision.
    await this.projectNotification(result.id).catch(() => undefined);
    return result;
  });

  /** Caller owns commit: tool pause and Decision fact must succeed or roll back together. */
  createInTransaction = createOutcomeDecision;

  /** Replayed creation retries an interrupted post-commit projection using the original fact. */
  private async projectNotification(decisionId: string) {
    const event = await this.prisma.event.findFirst({ where: { topic: "outcome.decision.required", payload: { path: ["payload", "decisionId"], equals: decisionId } }, orderBy: { sequence: "asc" } });
    if (event) await Effect.runPromise(new NotificationService(this.prisma).projectOutcomeEvent(event.sequence.toString()));
  }

  get = (id: string) => serviceEffect(() => this.prisma.$transaction(async tx => view(await this.current(tx, id, "system:decision-read"))));
  present = (id: string, actor: ActorRef) => serviceEffect(() => this.prisma.$transaction(async tx => {
    const row = await this.current(tx, id, actor);
    if (row.status === "open") await tx.outcomeDecision.updateMany({ where: { id, status: "open" }, data: { status: "presented" } });
    return view(await tx.outcomeDecision.findUniqueOrThrow({ where: { id }, include }));
  }));

  resolve = (id: string, input: ResolveDecisionInput, actor: ActorRef) => serviceEffect(async () => {
    const result = await this.prisma.$transaction(async tx => {
      const row = await this.current(tx, id, actor);
      const scope = `decision-resolve:${id}`;
      const requestHash = hashRequest(input);
      const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: input.clientRequestId } } });
      if (previous) {
        if (previous.requestHash !== requestHash) return apiError("idempotency_conflict", "This request ID was already used for another choice", row);
        return previous.response as unknown as DecisionResolution;
      }
      if (row.contractRevision.revision !== input.expectedContractRevision) return apiError("decision_revision_conflict", "The revision number changed; reload the decision", row);
      const outcome = await tx.outcome.findUniqueOrThrow({ where: { id: row.outcomeId } });
      if (!await isOutcomeDecisionRevisionActive(tx, row.outcomeId, row.contractRevisionId, row.workItemId)) return apiError("decision_revision_conflict", "The Outcome revision changed; reload the decision", row);
      if (!active(row)) return apiError(row.status === "resolved" ? "decision_already_resolved" : `decision_${row.status}`, `This decision is ${row.status}`, row, row.status === "expired" ? 410 : 409);
      if (outcome.cancelledAt || outcome.acceptedAt) return apiError("decision_revision_conflict", "The Outcome changed; reload the decision", row);
      const options = row.options as unknown as DecisionOption[];
      const option = input.optionId ? options.find(option => option.id === input.optionId) : undefined;
      const customText = input.customText?.trim() ? input.customText : null;
      if ((input.optionId && !option) || (!option && !customText) || (customText && !row.customEntryAllowed)) return apiError("invalid_decision_choice", "Choose an option from the snapshot or supply permitted custom text", row, 422);
      const effect = option?.resolutionEffect ?? "plan_only";
      const updated = await tx.outcomeDecision.updateMany({ where: { id, status: { in: [...activeDecisionStatuses] }, contractRevisionId: row.contractRevisionId }, data: {
        status: "resolved", openWorkItemId: null, resolvedOption: option ? toJson(option) : Prisma.DbNull, customText, resolvedBy: actor, resolvedAt: new Date(),
      } });
      if (!updated.count) return apiError("decision_already_resolved", "Another client resolved this decision", row);
      const resume = await this.applyEffect(tx, row, option, customText, input.clientRequestId, actor);
      await appendOutcomeEvent(tx, "outcome.decision.resolved", row.outcomeId, { actor, contractRevision: row.contractRevision.revision, workItemId: row.workItemId ?? undefined, runId: row.runId ?? undefined, idempotencyKey: input.clientRequestId, payload: { decisionId: id, resolutionEffect: effect, optionId: option?.id ?? null, customText } });
      await revokeDecisionNotification(tx, id);
      const response: DecisionResolution = { decisionId: id, status: "resolved", outcomeId: row.outcomeId, contractRevision: row.contractRevision.revision, resolutionEffect: effect, resume };
      await tx.idempotencyRecord.create({ data: { scope, key: input.clientRequestId, requestHash, response: toJson(response), status: "completed", expiresAt: new Date(Date.now() + 30 * 86400_000) } });
      return response;
    }).catch(mapError);
    // Expected stale/expired errors commit their automatic closure before reaching the HTTP boundary.
    if (result instanceof ApiError) throw result;
    if (result.resume?.revisionId) {
      try {
        this.ports.onRevisionCreated?.(result.outcomeId);
      } catch {
        /* The overview is generated on first read instead. */
      }
    }
    return result;
  });

  withdraw = (id: string, actor: ActorRef) => serviceEffect(async () => {
    const result = await this.prisma.$transaction(async tx => {
      const row = await this.current(tx, id, actor);
      if (row.status === "withdrawn") return view(row);
      if (!active(row)) return apiError(`decision_${row.status}`, `This decision is ${row.status}`, row);
      await this.close(tx, row, "withdrawn", actor);
      return view(await tx.outcomeDecision.findUniqueOrThrow({ where: { id }, include }));
    });
    if (result instanceof ApiError) throw result;
    return result;
  });

  expire = (now = new Date()) => serviceEffect(async () => {
    const candidates = await this.prisma.outcomeDecision.findMany({ where: { status: { in: [...activeDecisionStatuses] }, expiresAt: { lte: now } }, select: { id: true }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: 100 });
    let count = 0;
    for (const item of candidates) await this.prisma.$transaction(async tx => {
      const row = await this.lockDecision(tx, item.id);
      if (active(row) && row.expiresAt && row.expiresAt <= now) { await this.close(tx, row, "expired", "system:decision-expiry"); count++; }
    });
    return { expiredCount: count };
  });

  private async applyEffect(tx: Tx, row: Row, option: DecisionOption | undefined, customText: string | null, requestId: string, actor: ActorRef): Promise<DecisionResolution["resume"]> {
    const effect = option?.resolutionEffect ?? "plan_only";
    if (effect === "scope_change" || effect === "acceptance_change") {
      const outcome = await tx.outcome.findUniqueOrThrow({ where: { id: row.outcomeId }, select: { currentRevisionId: true } });
      if (outcome.currentRevisionId !== row.contractRevisionId) throw apiError("decision_revision_conflict", "Edit the pending contract revision before applying another scope change", row);
      if (!option?.contract) throw apiError("invalid_decision_effect", "The option has no contract snapshot", row, 422);
      if (!this.ports.createRevision) throw apiError("decision_effect_unavailable", "The revision writer has not been registered", row, 503);
      const revision = await this.ports.createRevision(tx, row.outcomeId, { baseRevision: row.contractRevision.revision, contract: option.contract, sourceDecisionId: row.id, changeSummary: option.consequence, clientRequestId: `decision:${row.id}:${requestId}` }, actor);
      if (row.workItemId) await transitionWorkItem(tx, { workItemId: row.workItemId, to: "cancelled", reason: "decision_revision_replaced", actor, idempotencyKey: `decision:${row.id}` });
      await withdrawSupersededDecisions(tx, row.outcomeId, actor);
      return { status: "pending_approval", workItemIds: [], revisionId: revision.currentRevisionView?.id };
    }
    if (!row.workItemId) throw apiError("invalid_decision_source", "This effect requires a requesting work item", row, 422);
    if (effect === "cancel_branch") {
      await transitionWorkItem(tx, { workItemId: row.workItemId, to: "cancelled", reason: "decision_cancel_branch", actor, idempotencyKey: `decision:${row.id}` });
      return { status: "cancelled", workItemIds: [row.workItemId] };
    }
    if (effect === "manual_action") {
      if (!option?.manualAction) throw apiError("invalid_decision_effect", "The option has no manual-action snapshot", row, 422);
      const result = await (this.ports.humanActions ?? unavailableHumanActionPort).createFromDecision(tx, { outcomeId: row.outcomeId, decisionId: row.id, requestedByWorkItemId: row.workItemId, card: option.manualAction });
      return { status: "waiting_human", workItemIds: [result.workItemId], cardId: result.cardId };
    }
    if (!this.ports.messaging) throw apiError("decision_effect_unavailable", "Outcome messaging has not been registered", row, 503);
    let supplementId: string | undefined;
    if (option?.supplement) {
      const requester = await tx.outcomeWorkItem.findUniqueOrThrow({ where: { id: row.workItemId } });
      const ordinal = await tx.outcomeWorkItem.aggregate({ where: { outcomeId: row.outcomeId }, _max: { ordinal: true } });
      const supplement = await tx.outcomeWorkItem.create({ data: {
        outcomeId: row.outcomeId, contractRevisionId: row.contractRevisionId, botId: requester.botId,
        executorType: "agent", kind: "supplement", status: "queued", title: option.supplement.title,
        instructions: option.supplement.instructions, ordinal: (ordinal._max.ordinal ?? 0) + 1,
        sourceDecisionId: row.id, dependsOn: [requester.id],
      } });
      supplementId = supplement.id;
      await appendOutcomeEvent(tx, "outcome.work_item.created", row.outcomeId, { actor, contractRevision: row.contractRevision.revision,
        workItemId: supplement.id, idempotencyKey: `decision-supplement:${row.id}`,
        payload: { workItemId: supplement.id, executorType: "agent", kind: "supplement" } });
      await (this.ports.enqueueTurn ?? enqueueOutcomeTurn)(tx, this.ports.messaging, {
        workItemId: supplement.id, content: option.supplement.instructions, reason: "start",
        clientId: `outcome-run:${row.outcomeId}:${row.contractRevision.revision}:${supplement.id}`,
      });
    }
    const result = await (this.ports.enqueueTurn ?? enqueueOutcomeTurn)(tx, this.ports.messaging, { workItemId: row.workItemId, content: JSON.stringify({ decisionId: row.id, optionId: option?.id ?? null, choice: option?.label ?? null, customText }), reason: "decision_resolved", clientId: `decision:${row.id}` });
    return { status: result.status, workItemIds: [row.workItemId, ...(supplementId ? [supplementId] : [])] };
  }
  private lock(tx: Tx, outcomeId: string) { return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`; }
  private async lockDecision(tx: Tx, id: string): Promise<Row> {
    const found = await tx.outcomeDecision.findUnique({ where: { id }, select: { outcomeId: true } });
    if (!found) throw apiError("decision_not_found", "Decision not found", undefined, 404);
    await this.lock(tx, found.outcomeId);
    return tx.outcomeDecision.findUniqueOrThrow({ where: { id }, include });
  }
  private async current(tx: Tx, id: string, actor: ActorRef): Promise<Row> {
    let row = await this.lockDecision(tx, id);
    await withdrawSupersededDecisions(tx, row.outcomeId, actor);
    row = await tx.outcomeDecision.findUniqueOrThrow({ where: { id }, include });
    if (active(row) && row.expiresAt && row.expiresAt <= new Date()) {
      await this.close(tx, row, "expired", actor);
      row = await tx.outcomeDecision.findUniqueOrThrow({ where: { id }, include });
    }
    return row;
  }
  private close = closeOutcomeDecision;
}
