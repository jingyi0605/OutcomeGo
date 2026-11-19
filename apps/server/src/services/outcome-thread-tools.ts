import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import { decodeOutcomeThreadInput, OUTCOME_GOAL_THREAD_TOOL_NAMES, type OutcomeThreadToolName } from "@outcomego/contracts/outcome-thread";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { PrismaClient } from "@outcomego/db";
import { readOutcomesEnabled, type ToolContext } from "@outcomego/messaging";
import { Cause, Effect, Exit } from "effect";
import type { OutcomeChatTools } from "./outcome-chat-tools";
import type { OutcomeService } from "./outcome-service";

export const isOutcomeThreadTool = (name: string): name is OutcomeThreadToolName =>
  (OUTCOME_GOAL_THREAD_TOOL_NAMES as readonly string[]).includes(name);

/** A turn the owner started, as opposed to anything the system started. */
export const triggeredByOwner = (triggerBy: string) => triggerBy.startsWith("user:") || triggerBy.startsWith("owner:");

async function run<A>(effect: Effect.Effect<A, unknown>, signal?: AbortSignal): Promise<A> {
  const exit = await Effect.runPromiseExit(effect, { signal });
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

const nextStep = (outcome: OutcomeDetail) =>
  outcome.currentRevisionView?.status === "pending_approval"
    ? "Saved for the owner's approval in the app. The goal has not started and you cannot approve it. If you have a question or a reply for the owner, put it in your final message."
    : "Saved. Report the server's current status in your final message.";

/**
 * Tools of a goal's own thread. The thread is bound to one goal: a tool can only touch that goal, and the
 * ones with consequences check who started the turn. Approving and accepting are not tools at all.
 */
export class OutcomeThreadTools {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outcomes: Pick<OutcomeService, "saveAgentContract" | "cancel" | "get">,
    private readonly readTools?: Pick<OutcomeChatTools, "execute">
  ) {}

  execute = async (
    request: DynamicToolCallRequest,
    context: ToolContext,
    signal?: AbortSignal
  ): Promise<unknown> => {
    if (!isOutcomeThreadTool(request.tool))
      throw new ApiError(403, "outcome_thread_tool_forbidden", `${request.tool} is not available in a goal thread`);
    if (!(await readOutcomesEnabled(this.prisma)))
      throw new ApiError(403, "outcomes_disabled", "Goal management is turned off. The user can enable it in Settings → General");
    const turn = await this.prisma.outcomeThreadTurn.findUnique({
      where: { runId: context.runId }, include: { thread: { select: { outcomeId: true, botId: true } } },
    });
    if (!turn || turn.thread.botId !== context.botId)
      throw new ApiError(403, "outcome_thread_required", "This tool belongs to a goal's own thread");
    const outcomeId = turn.thread.outcomeId;
    const actor = `bot:${context.botId}` as const;
    const decode = <Name extends OutcomeThreadToolName>(name: Name) => {
      try {
        return decodeOutcomeThreadInput(name, request.arguments);
      } catch {
        throw new ApiError(400, "invalid_request", `Invalid ${name} arguments`);
      }
    };
    switch (request.tool) {
      case "SaveOutcomeContract": {
        const outcome = await run(this.outcomes.saveAgentContract(outcomeId, decode("SaveOutcomeContract"), actor), signal);
        return { outcome, approvalRequired: outcome.currentRevisionView?.status === "pending_approval", nextStep: nextStep(outcome) };
      }
      case "CancelOutcome": {
        const input = decode("CancelOutcome");
        if (input.outcomeId !== outcomeId)
          throw new ApiError(403, "outcome_thread_scope", "A goal's thread can only cancel its own goal");
        if (!triggeredByOwner(turn.triggerBy))
          throw new ApiError(403, "cancel_requires_owner", "Only the owner's words in this thread can cancel the goal");
        const { outcomeId: _outcomeId, ...rest } = input;
        const outcome = await run(this.outcomes.cancel(outcomeId, rest, actor), signal);
        return { outcome, nextStep: "The goal is cancelled and its history is kept. Tell the owner in your final message." };
      }
      case "GetOutcome": {
        const input = decode("GetOutcome");
        if (input.outcomeId !== outcomeId)
          throw new ApiError(403, "outcome_thread_scope", "A goal's thread can only read its own goal in detail");
        if (!this.readTools) throw new ApiError(503, "outcome_chat_unavailable", "Reading goals is not available");
        return this.readTools.execute(request, context, signal);
      }
      case "ListOutcomes": {
        if (!this.readTools) throw new ApiError(503, "outcome_chat_unavailable", "Reading goals is not available");
        return this.readTools.execute(request, context, signal);
      }
    }
  };
}
