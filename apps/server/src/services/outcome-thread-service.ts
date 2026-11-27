import { ApiError, DEFAULT_PI_REASONING_LEVEL, parseOutcomePlanAdvice, type OutcomePlanMode, type OutcomeThreadTurnModelView, type OutcomeTriageResult } from "@outcomego/contracts";
import {
  type OutcomeThreadPurpose,
  type OutcomeThreadTurnView,
  type OutcomeThreadView,
  type RequestOutcomePlanInput,
  type SendOutcomeThreadMessageInput,
} from "@outcomego/contracts/outcome-thread";
import { OUTCOME_TERMINAL_STATUSES } from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  OUTCOME_THREAD_EVENT_TOPIC,
  OUTCOME_THREAD_PRIORITY,
  enqueueOutcomePlan,
  readOutcomesEnabled,
  recomputeOutcomeStatus,
  type ActorRef,
  type AgentMessaging,
} from "@outcomego/messaging";
import { outcomeApiError } from "./outcome-service";
import { assertOutcomeAccess, outcomePrincipal, type OutcomeActorContext } from "./outcome-lifecycle";
import { lockOutcome, mapOutcomeError, outcomeWrite } from "./outcome-write";

type Tx = Prisma.TransactionClient;
type TurnRow = {
  id: string;
  purpose: OutcomeThreadPurpose;
  trigger: string;
  planMode?: OutcomePlanMode | null;
  outcomeRevision?: number | null;
  skipReason?: string | null;
  status: OutcomeThreadTurnView["status"];
  reply: string | null;
  error: unknown;
  runId: string | null;
  model?: unknown;
  workItemId?: string | null;
  result?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export { OUTCOME_THREAD_PRIORITY, OUTCOME_THREAD_EVENT_TOPIC };

const parseTurnModel = (value: unknown): OutcomeThreadTurnModelView | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const obj = value as { providerId?: unknown; modelId?: unknown; reasoning?: unknown; fallback?: unknown };
  if (typeof obj.providerId !== "string" || typeof obj.modelId !== "string") return undefined;
  return {
    providerId: obj.providerId,
    modelId: obj.modelId,
    reasoning: (typeof obj.reasoning === "string" ? obj.reasoning : DEFAULT_PI_REASONING_LEVEL) as OutcomeThreadTurnModelView["reasoning"],
    ...(obj.fallback && typeof obj.fallback === "object" ? { fallback: obj.fallback as OutcomeThreadTurnModelView["fallback"] } : {}),
  };
};

export const outcomeThreadTurnView = (row: TurnRow): OutcomeThreadTurnView => {
  const error = row.error && typeof row.error === "object" ? (row.error as { code?: unknown; message?: unknown }) : null;
  const model = parseTurnModel(row.model);
  const fields = {
    id: row.id,
    purpose: row.purpose,
    trigger: row.trigger,
    status: row.status,
    reply: row.reply,
    error: error
      ? {
          code: typeof error.code === "string" ? error.code : "turn_failed",
          message: typeof error.message === "string" ? error.message : "The turn did not finish",
        }
      : null,
    runId: row.runId,
    outcomeRevision: row.outcomeRevision ?? null,
    ...(row.skipReason ? { skipReason: row.skipReason } : {}),
    ...(model ? { model } : {}),
    ...(row.workItemId ? { workItemId: row.workItemId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.planMode === "advice") return { ...fields, planMode: "advice", result: parseOutcomePlanAdvice(row.result) };
  if (row.planMode === "triage") return { ...fields, planMode: "triage", result: (row.result ?? null) as OutcomeTriageResult | null };
  return { ...fields, planMode: row.planMode ?? null, ...(row.result != null ? { result: row.result } : {}) };
};

/**
 * The goal's own Agent threads (specs/004.8, 004.9). This service records messages/role triggers and wakes the role bot;
 * everything that needs judgement happens in the bot's turn.
 */
export class OutcomeThreadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly messaging: AgentMessaging,
    private readonly recompute: (tx: Tx, outcomeId: string, actor: ActorRef) => Promise<unknown> = recomputeOutcomeStatus
  ) {}

  async plan(outcomeId: string, input: RequestOutcomePlanInput, actor: ActorRef, context: OutcomeActorContext = {}): Promise<OutcomeThreadTurnView> {
    await this.requireEnabled();
    return outcomeWrite(this.prisma, `outcome-thread-plan:${actor}:${outcomeId}`, input.clientRequestId, input,
      (tx) => this.planInTransaction(tx, outcomeId, input, actor, context));
  }

  async planInTransaction(
    tx: Tx,
    outcomeId: string,
    input: RequestOutcomePlanInput,
    actor: ActorRef,
    context: OutcomeActorContext = {},
  ): Promise<OutcomeThreadTurnView> {
    const outcome = await lockOutcome(tx, outcomeId);
    assertOutcomeAccess(outcome, outcomePrincipal(actor, context), true);
    try {
      const { turn, created } = await enqueueOutcomePlan(tx, this.messaging, { ...input, outcomeId, actor });
      if (created && turn.planMode === "contract_plan") await this.recompute(tx, outcomeId, actor);
      return outcomeThreadTurnView(turn);
    } catch (error) { throw mapOutcomeError(error); }
  }

  /** The owner's words, as sent, delivered to the goal's planner thread. Returns at once. */
  async send(outcomeId: string, input: SendOutcomeThreadMessageInput, actor: ActorRef, context: OutcomeActorContext = {}): Promise<OutcomeThreadTurnView> {
    await this.requireEnabled();
    if (!input.text.trim()) throw new ApiError(400, "invalid_request", "Write a message");
    return outcomeWrite(this.prisma, `outcome-thread-message:${actor}:${outcomeId}`, input.clientRequestId, input, async (tx) => {
      const outcome = await lockOutcome(tx, outcomeId);
      assertOutcomeAccess(outcome, outcomePrincipal(actor, context), true);
      if (OUTCOME_TERMINAL_STATUSES.includes(outcome.status))
        throw outcomeApiError("invalid_outcome_transition", `This goal is ${outcome.status}`, { currentStatus: outcome.status });
      const { turn, created } = await enqueueOutcomePlan(tx, this.messaging, {
        mode: input.mode, prompt: input.text, outcomeId, actor, clientRequestId: input.clientRequestId, followUp: true,
      });
      if (created && turn.planMode === "contract_plan") await this.recompute(tx, outcomeId, actor);
      return outcomeThreadTurnView(turn);
    });
  }

  async list(outcomeId: string): Promise<OutcomeThreadView> {
    if (!(await this.prisma.outcome.findUnique({ where: { id: outcomeId }, select: { id: true } })))
      throw outcomeApiError("outcome_not_found", "Outcome not found");
    const threads = await this.prisma.outcomeThread.findMany({
      where: { outcomeId },
      include: { turns: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 } },
    });
    const planner = threads.find((thread) => thread.role === "planner") ?? null;
    const reviewer = threads.find((thread) => thread.role === "reviewer") ?? null;
    return {
      threadId: planner?.id ?? null,
      turns: (planner?.turns ?? []).reverse().map(outcomeThreadTurnView),
      reviewerThreadId: reviewer?.id ?? null,
      reviewTurns: (reviewer?.turns ?? []).reverse().map(outcomeThreadTurnView),
    };
  }

  private async requireEnabled() {
    if (!(await readOutcomesEnabled(this.prisma)))
      throw new ApiError(403, "outcomes_disabled", "Goal management is turned off. The user can enable it in Settings → General");
  }
}
