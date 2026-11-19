import { ApiError } from "@outcomego/contracts";
import {
  OUTCOME_THREAD_TEXT_CHARS,
  type CreateOutcomeThreadInput,
  type OutcomeThreadPurpose,
  type OutcomeThreadTurnView,
  type OutcomeThreadView,
  type SendOutcomeThreadMessageInput,
} from "@outcomego/contracts/outcome-thread";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { readOutcomesEnabled, recomputeOutcomeStatus, type ActorRef, type AgentMessaging } from "@outcomego/messaging";
import { outcomeApiError, type OutcomeService } from "./outcome-service";
import { lockOutcome, outcomeWrite } from "./outcome-write";
import { appendEvent } from "./service-utils";

type Tx = Prisma.TransactionClient;
type TurnRow = {
  id: string; purpose: OutcomeThreadPurpose; trigger: string; status: OutcomeThreadTurnView["status"];
  reply: string | null; error: unknown; runId: string | null; createdAt: Date; updatedAt: Date;
};

/** Above work-item execution turns (280): the owner is waiting for an answer. */
export const OUTCOME_THREAD_PRIORITY = 290;
export const OUTCOME_THREAD_EVENT_TOPIC = "goal.thread.updated";

export const outcomeThreadTurnView = (row: TurnRow): OutcomeThreadTurnView => {
  const error = row.error && typeof row.error === "object" ? row.error as { code?: unknown; message?: unknown } : null;
  return {
    id: row.id,
    purpose: row.purpose,
    trigger: row.trigger,
    status: row.status,
    reply: row.reply,
    error: error ? { code: typeof error.code === "string" ? error.code : "turn_failed", message: typeof error.message === "string" ? error.message : "The turn did not finish" } : null,
    runId: row.runId,
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
 * The goal's own Agent thread (specs/004.8). This service only records the owner's words and wakes the bot;
 * everything that needs judgement happens in the bot's turn.
 */
export class OutcomeThreadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly messaging: AgentMessaging,
    private readonly outcomes: Pick<OutcomeService, "createPlanningOutcome" | "getInTransaction">,
    private readonly recompute: (tx: Tx, outcomeId: string, actor: ActorRef) => Promise<unknown> = recomputeOutcomeStatus
  ) {}

  /** A new goal described in the owner's words, planned by the chosen bot. Returns at once. */
  async create(input: CreateOutcomeThreadInput, actor: ActorRef): Promise<{ outcome: OutcomeDetail; turn: OutcomeThreadTurnView }> {
    await this.requireEnabled();
    const text = input.text;
    if (!text.trim() || text.length > OUTCOME_THREAD_TEXT_CHARS)
      throw new ApiError(400, "invalid_request", "Describe the goal in your own words");
    return outcomeWrite(this.prisma, "outcome-thread-create", input.clientRequestId, input, async (tx) => {
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
      const outcomeId = await this.outcomes.createPlanningOutcome(
        tx, { botId: bot.id, title: placeholderTitle(text), description: text.trim(), sourceExploreId }, actor, input.clientRequestId);
      if (sourceExploreId) await tx.exploreIdea.update({ where: { id: sourceExploreId }, data: { status: "converted", proposedOutcomeId: outcomeId } });
      const turn = await this.enqueue(tx, outcomeId, bot.id, "plan", text, actor, input.clientRequestId);
      await this.recompute(tx, outcomeId, actor);
      return { outcome: await this.detail(tx, outcomeId), turn };
    });
  }

  /** The owner's words, as sent, delivered to the goal's thread. Returns at once. */
  async send(outcomeId: string, input: SendOutcomeThreadMessageInput, actor: ActorRef): Promise<OutcomeThreadTurnView> {
    await this.requireEnabled();
    if (!input.text.trim()) throw new ApiError(400, "invalid_request", "Write a message");
    return outcomeWrite(this.prisma, `outcome-thread-message:${outcomeId}`, input.clientRequestId, input, async (tx) => {
      const outcome = await lockOutcome(tx, outcomeId);
      if (outcome.status === "accepted" || outcome.status === "cancelled")
        throw outcomeApiError("invalid_outcome_transition", `This goal is ${outcome.status}`, { currentStatus: outcome.status });
      const turn = await this.enqueue(tx, outcomeId, outcome.botId, "owner_message", input.text, actor, input.clientRequestId);
      await this.recompute(tx, outcomeId, actor);
      return turn;
    });
  }

  async list(outcomeId: string): Promise<OutcomeThreadView> {
    if (!await this.prisma.outcome.findUnique({ where: { id: outcomeId }, select: { id: true } }))
      throw outcomeApiError("outcome_not_found", "Outcome not found");
    const thread = await this.prisma.outcomeThread.findUnique({
      where: { outcomeId },
      include: { turns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200 } },
    });
    return { threadId: thread?.id ?? null, turns: (thread?.turns ?? []).map(outcomeThreadTurnView) };
  }

  /** Records the turn and wakes the bot in one transaction, so a turn is never recorded without a run. */
  private async enqueue(tx: Tx, outcomeId: string, botId: string, purpose: OutcomeThreadPurpose, text: string, actor: ActorRef, clientRequestId: string): Promise<OutcomeThreadTurnView> {
    const thread = await tx.outcomeThread.upsert({
      where: { outcomeId }, update: {}, create: { outcomeId, botId },
    });
    const channel = await tx.channel.findFirst({
      where: { kind: "bot_dm", archivedAt: null, members: { some: { botId: thread.botId } } }, orderBy: { createdAt: "asc" },
    });
    if (!channel) throw outcomeApiError("bot_not_runnable", "This Bot has no conversation to work in");
    const turn = await tx.outcomeThreadTurn.create({
      data: { threadId: thread.id, purpose, trigger: text, triggerBy: actor, clientRequestId },
    });
    // The words go to the bot exactly as written: no wrapper, no timestamp, no rewording.
    const wake = await this.messaging.enqueueWake(tx, {
      botId: thread.botId, channelId: channel.id, origin: "outcome_thread", outcomeThreadId: thread.id,
      type: "outcome.thread_turn", content: text, clientId: `outcome-thread:${turn.id}`, priority: OUTCOME_THREAD_PRIORITY,
      includeAttachmentPaths: false, wrapUserContent: false,
    });
    const linked = await tx.outcomeThreadTurn.update({ where: { id: turn.id }, data: { runId: wake.run.id } });
    const outcome = await tx.outcome.findUnique({ where: { id: outcomeId }, select: { title: true } });
    await appendEvent(tx, OUTCOME_THREAD_EVENT_TOPIC, outcomeId, { outcomeId, turnId: turn.id, status: "queued", title: outcome?.title ?? "" });
    return outcomeThreadTurnView(linked);
  }

  private detail(tx: Tx, outcomeId: string): Promise<OutcomeDetail> {
    return this.outcomes.getInTransaction(tx, outcomeId);
  }

  private async requireEnabled() {
    if (!(await readOutcomesEnabled(this.prisma)))
      throw new ApiError(403, "outcomes_disabled", "Goal management is turned off. The user can enable it in Settings → General");
  }
}
