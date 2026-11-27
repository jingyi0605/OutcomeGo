import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import { outcomeDeepLink } from "@outcomego/contracts/app-deep-links";
import {
  decodeOutcomeChatInput,
  outcomeCardStage,
  type OutcomeChatToolName,
  type OutcomeChatCard,
} from "@outcomego/contracts/outcome-chat";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import { decodeOutcomeCursor } from "@outcomego/contracts/outcomes";
import { Effect } from "effect";
import type { ToolContext } from "@outcomego/messaging";
import type { OutcomeChatCards } from "./outcome-chat-cards";
import type { OutcomeService } from "./outcome-service";
import type { OutcomeThreadService } from "./outcome-thread-service";
import { hashRequest } from "./service-utils";
import { mapOutcomeError } from "./outcome-write";

type OutcomeThreadPlanner = Pick<OutcomeThreadService, "plan">;

const outcomeResult = (value: unknown): OutcomeDetail | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outcome = (value as { outcome?: unknown }).outcome;
  return outcome && typeof outcome === "object" && !Array.isArray(outcome) ? outcome as OutcomeDetail : null;
};

const nextStep = (outcome: OutcomeDetail): string => {
  if (outcome.currentRevisionView?.status === "pending_approval")
    return "Ask the owner to review and approve this exact contract in the app. The draft has not started.";
  if (outcome.kind === "tracked" && outcome.status === "accepted")
    return "This tracked Outcome is closed. Report the result in one sentence.";
  if (outcome.kind === "tracked" && outcome.status === "decision_pending")
    return "The decision is in the owner's inbox. Read the Outcome again after the owner chooses.";
  if (outcome.kind === "tracked")
    return "Continue the tracked work and use ActOnOutcome with close_tracked when it is complete.";
  return "Report the saved Outcome status. Final acceptance remains an owner action.";
};

export class OutcomeChatTools {
  constructor(
    private readonly outcomes: OutcomeService,
    private readonly cards?: OutcomeChatCards,
    private readonly planner?: OutcomeThreadPlanner,
    private readonly authMode: "required" | "disabled" = "disabled",
  ) {}

  /** The owner whose Outcomes a Bot turn works with. */
  ownerId = () => this.outcomes.ownerForBotTurn(this.authMode);

  execute = async (
    request: DynamicToolCallRequest,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const cardTools = ["CreateOutcome", "UpdateOutcome", "ActOnOutcome"] as const;
    const useCard = Boolean(this.cards && cardTools.includes(request.tool as typeof cardTools[number]));
    if (!useCard) return this.perform(request, context, signal);

    try {
      decodeOutcomeChatInput(request.tool as OutcomeChatToolName, request.arguments);
    } catch {
      throw new ApiError(400, "invalid_request", `Invalid ${request.tool} arguments`);
    }
    const args = request.arguments as Record<string, unknown>;
    const card: OutcomeChatCard = {
      stage: "analyzing",
      title: String(args.title ?? args.description ?? "Outcome").split("\n")[0]!.slice(0, 120),
      updatedAt: new Date().toISOString(),
    };
    const id = await this.cards!.begin({
      ...context,
      callId: hashRequest({ tool: request.tool, arguments: request.arguments }),
    }, card);
    const update = async (changes: Partial<OutcomeChatCard>) => {
      Object.assign(card, changes, { updatedAt: new Date().toISOString() });
      if (!id) return;
      try {
        await this.cards!.update(context, id, card);
      } catch {
        console.warn("Could not refresh Outcome card", { messageId: id });
      }
    };
    try {
      const result = await this.perform(request, context, signal);
      const outcome = outcomeResult(result) ?? (result as OutcomeDetail);
      if (outcome && typeof outcome === "object" && "id" in outcome) {
        await update({
          stage: outcomeCardStage(outcome.status),
          title: outcome.title,
          outcomeId: outcome.id,
          revision: outcome.currentRevision ?? undefined,
          summary: outcome.currentRevisionView?.goal[0]?.slice(0, 220) ?? outcome.description?.slice(0, 220),
        });
      }
      return result;
    } catch (error) {
      await update({
        stage: "failed",
        summary: "The operation did not complete. Retry or open the Outcome to check its saved state.",
      });
      throw error;
    }
  };

  private perform = async (
    request: DynamicToolCallRequest,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const actor = `bot:${context.botId}` as const;
    const run = async <A>(effect: Effect.Effect<A, Error>): Promise<A> => {
      const result = await Effect.runPromise(Effect.either(effect), { signal });
      if (result._tag === "Left") throw result.left;
      return result.right;
    };
    const input = <Name extends OutcomeChatToolName>(name: Name) => {
      try {
        return decodeOutcomeChatInput(name, request.arguments);
      } catch {
        throw new ApiError(400, "invalid_request", `Invalid ${name} arguments`);
      }
    };
    const detail = async (effect: Effect.Effect<OutcomeDetail | { outcome: OutcomeDetail; turn: unknown }, Error>) => {
      const result = await run(effect);
      const outcome = "outcome" in result ? result.outcome : result;
      return {
        ...(typeof result === "object" && "outcome" in result ? result : {}),
        outcome,
        url: outcomeDeepLink(outcome.id),
        approvalRequired: outcome.currentRevisionView?.status === "pending_approval",
        nextStep: nextStep(outcome),
      };
    };

    try {
      const ownerId = await this.ownerId();
      const ownerContext = { ownerId };
      switch (request.tool) {
        case "CreateOutcome": {
          const args = input("CreateOutcome");
          const { ownerMessageRef, ...fields } = args;
          const createInput = ownerMessageRef
            ? { ...fields, sourceRef: { kind: "owner_message_ref", id: ownerMessageRef } }
            : fields;
          return await detail(this.outcomes.create(createInput, actor, { ownerId, runId: context.runId }));
        }
        case "UpdateOutcome": {
          const { outcomeId, targetKind, ...args } = input("UpdateOutcome");
          if (targetKind) {
            const { botId, scheduledAt, clientRequestId, expectedRevision } = args;
            return await detail(this.outcomes.convert(outcomeId, {
              targetKind,
              ...(botId !== undefined ? { botId: botId ?? undefined } : {}),
              ...(scheduledAt !== undefined ? { scheduledAt: scheduledAt ?? undefined } : {}),
              expectedRevision,
              clientRequestId,
            }, actor, ownerContext));
          }
          return await detail(this.outcomes.update(outcomeId, args, actor, ownerContext));
        }
        case "QueryOutcomes": {
          const args = input("QueryOutcomes");
          return await run(this.outcomes.list({
            ...args,
            kinds: [...(args.kinds ?? [])],
            statuses: [...(args.statuses ?? [])],
            limit: args.limit ?? 20,
            cursor: decodeOutcomeCursor(args.cursor ?? null),
          }, actor, ownerContext));
        }
        case "GetOutcome": {
          const args = input("GetOutcome");
          const result = await detail(this.outcomes.get(args.outcomeId, actor, ownerContext));
          return {
            ...result,
            ...(args.revision ? { revision: await run(this.outcomes.getRevision(args.outcomeId, args.revision)) } : {}),
            ...(args.workItemId
              ? { transcript: await run(this.outcomes.transcript(args.outcomeId, args.workItemId, { before: args.before, limit: args.limit })) }
              : {}),
          };
        }
        case "ActOnOutcome": {
          const { outcomeId, ...args } = input("ActOnOutcome");
          return await detail(this.outcomes.act(outcomeId, args, actor, { ownerId, runId: context.runId }));
        }
        case "PlanOutcome": {
          if (!this.planner) throw new ApiError(503, "planner_unavailable", "Outcome planning is not configured", { retryable: true });
          const args = input("PlanOutcome");
          const { outcomeId, mode, ...planInput } = args;
          const turn = await this.planner.plan(outcomeId, { ...planInput, ...(mode ? { mode } : {}) }, actor, ownerContext);
          const outcome = await run(this.outcomes.get(outcomeId, actor, ownerContext));
          return { outcome, turn, url: outcomeDeepLink(outcome.id), nextStep: nextStep(outcome) };
        }
        default:
          throw new ApiError(400, "invalid_request", `Unknown Outcome tool ${request.tool}`);
      }
    } catch (error) {
      throw mapOutcomeError(error);
    }
  };
}
