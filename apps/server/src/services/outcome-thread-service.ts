import { ApiError, DEFAULT_PI_REASONING_LEVEL, type OutcomeThreadTurnModelView } from "@outcomego/contracts";
import {
  OUTCOME_THREAD_TEXT_CHARS,
  type CreateOutcomeThreadInput,
  type OutcomeThreadPurpose,
  type OutcomeThreadTurnView,
  type OutcomeThreadView,
  type RequestOutcomeInspectionInput,
  type SendOutcomeThreadMessageInput,
} from "@outcomego/contracts/outcome-thread";
import { OutcomeError, type OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  AUTO_INSPECTION_ACTOR,
  OUTCOME_THREAD_EVENT_TOPIC,
  OUTCOME_THREAD_PRIORITY,
  enqueueOutcomeInspection,
  enqueueOutcomeThreadTurn,
  postOutcomeUpdateCard,
  readOutcomesEnabled,
  readInspectionTarget,
  recomputeOutcomeStatus,
  resolveOutcomeRole,
  type ActorRef,
  type AgentMessaging,
} from "@outcomego/messaging";
import { outcomeApiError, type OutcomeService } from "./outcome-service";
import { lockOutcome, outcomeWrite } from "./outcome-write";

type Tx = Prisma.TransactionClient;
type TurnRow = {
  id: string;
  purpose: OutcomeThreadPurpose;
  trigger: string;
  triggerBy?: string;
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
  return {
    id: row.id,
    purpose: row.purpose,
    trigger: row.trigger,
    ...(row.purpose === "inspection" ? { inspectionSource: row.triggerBy === AUTO_INSPECTION_ACTOR ? "automatic" as const : "manual" as const } : {}),
    status: row.status,
    reply: row.reply,
    error: error
      ? {
          code: typeof error.code === "string" ? error.code : "turn_failed",
          message: typeof error.message === "string" ? error.message : "The turn did not finish",
        }
      : null,
    runId: row.runId,
    ...(model ? { model } : {}),
    ...(row.workItemId ? { workItemId: row.workItemId } : {}),
    ...(row.result !== undefined && row.result !== null ? { result: row.result } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/** The title a goal has until its bot writes a real one with its first contract. */
const placeholderTitle = (text: string) => {
  const line = text.trim().split(/\r?\n/, 1)[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
};

/**
 * The goal's own Agent threads (specs/004.8, 004.9). This service records messages/role triggers and wakes the role bot;
 * everything that needs judgement happens in the bot's turn.
 */
export class OutcomeThreadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly messaging: AgentMessaging,
    private readonly outcomes: Pick<OutcomeService, "createPlanningOutcome" | "getInTransaction">,
    private readonly recompute: (tx: Tx, outcomeId: string, actor: ActorRef) => Promise<unknown> = recomputeOutcomeStatus
  ) {}

  /** A new goal described in the owner's words, planned by the resolved planner bot. Returns at once. */
  async create(input: CreateOutcomeThreadInput, actor: ActorRef): Promise<{ outcome: OutcomeDetail; turn: OutcomeThreadTurnView }> {
    await this.requireEnabled();
    const text = input.text;
    if (!text.trim() || text.length > OUTCOME_THREAD_TEXT_CHARS)
      throw new ApiError(400, "invalid_request", "Describe the goal in your own words");
    return outcomeWrite(this.prisma, "outcome-thread-create", input.clientRequestId, input, async (tx) =>
      this.createInTransaction(tx, input, actor)
    );
  }

  /** Creates a planning goal and enqueues its initial planner turn inside the caller's transaction. */
  async createInTransaction(
    tx: Tx,
    input: CreateOutcomeThreadInput & { titleText?: string },
    actor: ActorRef
  ): Promise<{ outcome: OutcomeDetail; turn: OutcomeThreadTurnView }> {
    const text = input.text;
    if (!text.trim() || text.length > OUTCOME_THREAD_TEXT_CHARS)
      throw new ApiError(400, "invalid_request", "Describe the goal in your own words");
    const bot = await tx.bot.findUnique({ where: { id: input.botId }, select: { id: true, status: true } });
    if (!bot || bot.status !== "active") throw outcomeApiError("bot_not_runnable", "Choose an existing, active Bot");
    let sourceExploreId: string | null = null;
    if (input.exploreIdeaId) {
      const idea = await tx.exploreIdea.findUnique({ where: { id: input.exploreIdeaId } });
      if (!idea) throw new ApiError(404, "explore_not_found", "Explore idea not found");
      if (idea.status === "converted" || idea.status === "discarded")
        throw new ApiError(409, "explore_read_only", "This idea can no longer be turned into a goal", { currentStatus: idea.status, retryable: false });
      sourceExploreId = idea.id;
    }
    const chat = input.postToChat ? await tx.channel.findFirst({
      where: { kind: "bot_dm", archivedAt: null, members: { some: { botId: bot.id } } },
      orderBy: { createdAt: "asc" }, select: { id: true },
    }) : null;
    if (input.postToChat && !chat) throw outcomeApiError("bot_not_runnable", "This Bot has no direct conversation");
    const titleSource = input.titleText?.trim() ? input.titleText : text;
    const outcomeId = await this.outcomes.createPlanningOutcome(
      tx,
      { botId: bot.id, title: placeholderTitle(titleSource), description: titleSource.trim(), sourceExploreId },
      actor,
      input.clientRequestId
    );
    if (sourceExploreId) await tx.exploreIdea.update({ where: { id: sourceExploreId }, data: { status: "converted", proposedOutcomeId: outcomeId } });
    const resolvedPlanner = await resolveOutcomeRole(tx, "planner", bot.id);
    const turn = await this.enqueue(
      tx,
      outcomeId,
      resolvedPlanner.botId ?? bot.id,
      "plan",
      text,
      actor,
      input.clientRequestId,
      resolvedPlanner.model
    );
    await this.recompute(tx, outcomeId, actor);
    if (chat) await postOutcomeUpdateCard(tx, {
      channelId: chat.id, outcomeId, factKey: `created:${outcomeId}`, contractRevision: 0, type: "outcome.created",
    });
    return { outcome: await this.detail(tx, outcomeId), turn };
  }

  /** The owner's words, as sent, delivered to the goal's planner thread. Returns at once. */
  async send(outcomeId: string, input: SendOutcomeThreadMessageInput, actor: ActorRef): Promise<OutcomeThreadTurnView> {
    await this.requireEnabled();
    if (!input.text.trim()) throw new ApiError(400, "invalid_request", "Write a message");
    return outcomeWrite(this.prisma, `outcome-thread-message:${outcomeId}`, input.clientRequestId, input, async (tx) => {
      const outcome = await lockOutcome(tx, outcomeId);
      if (outcome.status === "accepted" || outcome.status === "cancelled")
        throw outcomeApiError("invalid_outcome_transition", `This goal is ${outcome.status}`, { currentStatus: outcome.status });
      const resolvedPlanner = await resolveOutcomeRole(tx, "planner", outcome.botId);
      const turn = await this.enqueue(
        tx,
        outcomeId,
        resolvedPlanner.botId ?? outcome.botId,
        "owner_message",
        input.text,
        actor,
        input.clientRequestId,
        resolvedPlanner.model
      );
      await this.recompute(tx, outcomeId, actor);
      return turn;
    });
  }

  async inspect(
    outcomeId: string,
    workItemId: string | null,
    input: RequestOutcomeInspectionInput,
    actor: ActorRef
  ): Promise<OutcomeThreadTurnView> {
    await this.requireEnabled();
    return outcomeWrite(this.prisma, `outcome-inspection:${outcomeId}:${workItemId ?? "goal"}`, input.clientRequestId, { workItemId, ...input }, async (tx) => {
      await lockOutcome(tx, outcomeId);
      const target = await readInspectionTarget(tx, outcomeId, workItemId);
      if (!target) throw outcomeApiError("invalid_outcome_transition", "This goal or task is unavailable for analysis");
      return outcomeThreadTurnView(await enqueueOutcomeInspection(tx, this.messaging, target, actor, input.clientRequestId));
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

  /** Records the turn and wakes the bot in one transaction, so a turn is never recorded without a run. */
  private async enqueue(
    tx: Tx,
    outcomeId: string,
    botId: string,
    purpose: OutcomeThreadPurpose,
    text: string,
    actor: ActorRef,
    clientRequestId: string,
    model?: { providerId: string; modelId: string; reasoning?: string } | null
  ): Promise<OutcomeThreadTurnView> {
    try {
      const { turn } = await enqueueOutcomeThreadTurn(tx, this.messaging, {
        outcomeId,
        botId,
        purpose,
        text,
        actor,
        clientRequestId,
        model: model as Parameters<typeof enqueueOutcomeThreadTurn>[2]["model"],
      });
      return outcomeThreadTurnView(turn as TurnRow);
    } catch (error) {
      if (error instanceof OutcomeError) throw outcomeApiError(error.code, error.message, error.details);
      throw error;
    }
  }

  private detail(tx: Tx, outcomeId: string): Promise<OutcomeDetail> {
    return this.outcomes.getInTransaction(tx, outcomeId);
  }

  private async requireEnabled() {
    if (!(await readOutcomesEnabled(this.prisma)))
      throw new ApiError(403, "outcomes_disabled", "Goal management is turned off. The user can enable it in Settings → General");
  }
}
