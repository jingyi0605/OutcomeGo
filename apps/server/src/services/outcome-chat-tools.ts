import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import { outcomeDeepLink } from "@outcomego/contracts/app-deep-links";
import {
  decodeOutcomeChatInput,
  outcomeCardStage,
  type OutcomeChatToolName,
  type OutcomeChatCard,
} from "@outcomego/contracts/outcome-chat";
import { decodeOutcomeCursor } from "@outcomego/contracts/outcomes";
import { parseOutcomeInboxQuery } from "@outcomego/contracts/outcome-inbox";
import { Effect } from "effect";
import type { DecisionOption } from "@outcomego/contracts/outcome-inbox";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { createOutcomeDecision, hasActivePlannerRole, outcomeDispatchEnabled } from "@outcomego/messaging";
import type { DecisionService } from "./decision-service";
import type { OutcomeService } from "./outcome-service";
import type { OutcomeInboxService } from "./outcome-inbox-service";
import type { OutcomeThreadService } from "./outcome-thread-service";
import type { ExploreService } from "./explore-service";
import { mapOutcomeError } from "./outcome-write";
import type { ToolContext } from "@outcomego/messaging";
import type { OutcomeChatCards } from "./outcome-chat-cards";
import type { OutcomeDetail, PlanningDraftView } from "@outcomego/contracts/outcomes";
import { hashRequest } from "./service-utils";

const requireOutcomeDispatch = () => {
  if (!outcomeDispatchEnabled())
    throw new ApiError(
      503,
      "outcome_dispatch_disabled",
      "New Outcome execution is temporarily disabled",
      { retryable: true }
    );
};

const trackedNextStep = (outcome: OutcomeDetail): string =>
  outcome.status === "accepted"
    ? "This goal is auto-closed and needs no acceptance. Tell the user the result in one sentence."
    : outcome.status === "decision_pending"
      ? "The decision is in the owner's inbox. Do not proceed on it; read GetOutcome later for their choice."
      : "Registered on the goal board. Continue the work yourself and call CloseOutcome with a short result summary when it is done; never ask the user to accept it.";

/** Adapts ordinary chat calls to the same services as the authenticated UI. No approval entry point. */
export class OutcomeChatTools {
  constructor(
    private readonly outcomes: OutcomeService,
    private readonly inbox: OutcomeInboxService,
    private readonly explore: ExploreService,
    private readonly cards?: OutcomeChatCards,
    private readonly decisions?: Pick<DecisionService, "projectNotification">,
    private readonly threads?: Pick<OutcomeThreadService, "create">,
    private readonly prisma?: Pick<PrismaClient, "featureSettings" | "bot" | "channel">
  ) {}

  execute = async (
    request: DynamicToolCallRequest,
    context: ToolContext,
    signal?: AbortSignal
  ): Promise<unknown> => {
    if (request.tool === "CreateOutcome" && this.prisma && (await hasActivePlannerRole(this.prisma))) {
      throw new ApiError(
        409,
        "planner_role_active",
        "A planner role is configured for goals. Call SubmitOutcome with the user's exact original words instead of CreateOutcome."
      );
    }
    const cardTools = [
      "CreateOutcome",
      "SubmitOutcome",
      "ReviseOutcome",
      "StartOutcome",
      "CancelOutcome",
    ];
    // Silent task-board entries (ownerNeed none) stay out of the conversation; owner-facing ones get a card.
    const ownerFacingTrack =
      request.tool === "TrackOutcome" &&
      ((request.arguments as { ownerNeed?: unknown } | null)?.ownerNeed ?? "none") !== "none";
    if (!this.cards || !(cardTools.includes(request.tool) || ownerFacingTrack))
      return this.perform(request, context, signal);
    // Validate before publishing; invalid arguments never leave a spurious in-progress card.
    try {
      decodeOutcomeChatInput(request.tool as OutcomeChatToolName, request.arguments);
    } catch {
      throw new ApiError(400, "invalid_request", `Invalid ${request.tool} arguments`);
    }
    const args = request.arguments as Record<string, unknown>;
    const card: OutcomeChatCard = {
      stage: "analyzing",
      title: String(args.title ?? args.text ?? args.sourceText ?? "Goal")
        .split("\n")[0]!
        .slice(0, 120),
      updatedAt: new Date().toISOString(),
    };
    const id = await this.cards.begin(
      {
        ...context,
        callId: hashRequest({ tool: request.tool, arguments: request.arguments }),
      },
      card
    );
    const update = async (changes: Partial<OutcomeChatCard>) => {
      Object.assign(card, changes, { updatedAt: new Date().toISOString() });
      if (id) {
        try {
          await this.cards!.update(context, id, card);
        } catch {
          console.warn("Could not refresh Outcome card", { messageId: id });
        }
      }
    };
    try {
      await update({ stage: "analyzing" });
      const result = await this.perform(request, context, signal);
      {
        const { outcome } = result as { outcome: OutcomeDetail };
        await update({
          stage: outcomeCardStage(outcome.status),
          title: outcome.title,
          outcomeId: outcome.id,
          revision: outcome.currentRevision ?? undefined,
          summary: outcome.currentRevisionView?.goal[0]?.slice(0, 220) ?? outcome.description?.slice(0, 220),
        });
      }
      if (id) {
        return {
          ...(result as Record<string, unknown>),
          nextStep:
            "The app already shows the saved goal in a native card. Send only one short summary and the next owner action. Keep the full contract, background and breakdown in the card/details unless specifically requested. Approval and final acceptance still belong to the owner.",
        };
      }
      return result;
    } catch (error) {
      // Card errors must not mask the actual service error.
      try {
        await update({
          stage: "failed",
          summary:
            "The operation did not complete. Retry or open the goal to check its saved state.",
        });
      } catch {}
      throw error;
    }
  };

  private perform = async (
    request: DynamicToolCallRequest,
    context: { botId: string },
    signal?: AbortSignal
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
    const detail = async (result: ReturnType<OutcomeService["get"]>) => {
      const outcome = await run(result);
      return {
        outcome,
        url: outcomeDeepLink(outcome.id),
        approvalRequired: outcome.currentRevisionView?.status === "pending_approval",
        nextStep:
          outcome.currentRevisionView?.status === "pending_approval"
            ? "Ask the owner to review and approve this exact contract on Desktop. This draft has not started."
            : outcome.trackingMode === "tracked"
              ? trackedNextStep(outcome)
              : "Report the saved server status. Final acceptance remains an owner Review.",
      };
    };
    try {
      switch (request.tool) {
        case "CreateOutcome": {
          if (this.prisma && (await hasActivePlannerRole(this.prisma))) {
            throw new ApiError(
              409,
              "planner_role_active",
              "A planner role is configured for goals. Call SubmitOutcome with the user's exact original words instead of CreateOutcome."
            );
          }
          return await detail(this.outcomes.createFromContract(input("CreateOutcome"), context.botId, actor));
        }
        case "SubmitOutcome": {
          requireOutcomeDispatch();
          const args = input("SubmitOutcome");
          if (!this.threads) {
            throw new ApiError(503, "outcome_thread_unavailable", "Goal thread creation is not available");
          }
          const created = await this.threads.create(
            {
              text: args.text,
              botId: context.botId,
              ...(args.exploreIdeaId ? { exploreIdeaId: args.exploreIdeaId } : {}),
              clientRequestId: args.clientRequestId,
            },
            actor
          );
          return {
            outcome: created.outcome,
            turn: created.turn,
            url: outcomeDeepLink(created.outcome.id),
            approvalRequired: false,
            nextStep:
              "Submitted the owner's exact words to the goal planner. Report briefly that goal planning has started.",
          };
        }
        case "ListOutcomes": {
          const args = input("ListOutcomes");
          return await run(
            this.outcomes.list({
              statuses: [...(args.statuses ?? [])],
              query: args.query?.trim(),
              limit: args.limit ?? 30,
              cursor: decodeOutcomeCursor(args.cursor ?? null),
            })
          );
        }
        case "GetOutcome": {
          const args = input("GetOutcome");
          const result = await detail(this.outcomes.get(args.outcomeId));
          return {
            ...result,
            ...(args.revision
              ? { revision: await run(this.outcomes.getRevision(args.outcomeId, args.revision)) }
              : {}),
            ...(args.workItemId
              ? {
                  transcript: await run(
                    this.outcomes.transcript(args.outcomeId, args.workItemId, {
                      before: args.before,
                      limit: args.limit,
                    })
                  ),
                }
              : {}),
          };
        }
        case "TrackOutcome": {
          const args = input("TrackOutcome");
          const need = args.ownerNeed ?? "none";
          // An approved plan is executed later, so it honours the same dispatch switch as StartOutcome.
          if (need === "approval") requireOutcomeDispatch();
          const spec = args.decision;
          const createDecision =
            need === "decision" && spec
              ? async (tx: Prisma.TransactionClient, ref: { outcomeId: string; contractRevisionId: string }) => {
                  const options: DecisionOption[] = spec.options.map((option, index) => ({
                    id: `option-${index + 1}`,
                    label: option.label,
                    consequence: option.consequence,
                    resolutionEffect: "plan_only",
                    source: "runtime",
                    ...(option.recommended ? { recommended: true } : {}),
                    ...(option.reason ? { reason: option.reason } : {}),
                  }));
                  const recommended = options.find((option) => option.recommended);
                  const decision = await createOutcomeDecision(
                    tx,
                    {
                      ...ref,
                      reasonCode: "missing_input",
                      completedSummary: "Registered on the goal board by the Bot.",
                      problemSummary: spec.problemSummary,
                      nextStepSummary: "The Bot continues after you choose.",
                      options,
                      customEntryAllowed: true,
                      ...(recommended ? { recommendation: { optionId: recommended.id, reason: recommended.reason ?? "" } } : {}),
                    },
                    actor,
                    { botId: context.botId, clientRequestId: args.clientRequestId }
                  );
                  return decision.id;
                }
              : undefined;
          const { outcome, decisionId } = await run(this.outcomes.track(args, context.botId, actor, createDecision));
          // Projection is retriable and must never undo the committed registration.
          if (decisionId) void this.decisions?.projectNotification(decisionId).catch(() => undefined);
          return {
            outcome,
            url: outcomeDeepLink(outcome.id),
            approvalRequired: outcome.currentRevisionView?.status === "pending_approval",
            decisionId,
            nextStep:
              need === "approval"
                ? "Ask the owner to review and approve this exact contract on Desktop. This draft has not started."
                : trackedNextStep(outcome),
          };
        }
        case "CloseOutcome": {
          const { outcomeId, ...args } = input("CloseOutcome");
          return await detail(this.outcomes.closeTracked(outcomeId, args, actor));
        }
        case "ReviseOutcome": {
          const { outcomeId, ...args } = input("ReviseOutcome");
          return await detail(this.outcomes.createRevision(outcomeId, args, actor));
        }
        case "StartOutcome": {
          requireOutcomeDispatch();
          const { outcomeId, ...args } = input("StartOutcome");
          return await detail(this.outcomes.startRun(outcomeId, args, actor));
        }
        case "CancelOutcome": {
          const { outcomeId, ...args } = input("CancelOutcome");
          return await detail(this.outcomes.cancel(outcomeId, args, actor));
        }
        case "ListOutcomeInbox": {
          const { outcomeId, ...args } = input("ListOutcomeInbox");
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(args))
            if (value !== undefined) params.set(key, String(value));
          let query;
          try {
            query = parseOutcomeInboxQuery(params);
          } catch {
            throw new ApiError(400, "invalid_request", "Invalid Outcome Inbox cursor");
          }
          return await run(this.inbox.list(query, outcomeId));
        }
        case "ListExploreIdeas": {
          const args = input("ListExploreIdeas");
          return await run(
            this.explore.list({
              statuses: [...(args.statuses ?? [])],
              limit: args.limit ?? 30,
              cursor: decodeOutcomeCursor(args.cursor ?? null),
            })
          );
        }
        case "GetExploreIdea":
          return await run(this.explore.get(input("GetExploreIdea").ideaId));
        case "CreateExploreIdea":
          return await run(
            this.explore.create(
              {
                ...input("CreateExploreIdea"),
                botId: context.botId,
              },
              actor
            )
          );
        case "DiscardExploreIdea": {
          const { ideaId, ...args } = input("DiscardExploreIdea");
          return await run(this.explore.discard(ideaId, args, actor));
        }
        default:
          throw new ApiError(400, "invalid_request", `Unknown Outcome tool ${request.tool}`);
      }
    } catch (error) {
      throw mapOutcomeError(error);
    }
  };
}
