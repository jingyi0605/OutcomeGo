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
import { outcomeDispatchEnabled } from "@outcomego/messaging";
import type { OutcomePlanningService } from "./outcome-planning-service";
import type { OutcomeService } from "./outcome-service";
import type { OutcomeInboxService } from "./outcome-inbox-service";
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

/** Adapts ordinary chat calls to the same services as the authenticated UI. No approval entry point. */
export class OutcomeChatTools {
  constructor(
    private readonly planning: OutcomePlanningService,
    private readonly outcomes: OutcomeService,
    private readonly inbox: OutcomeInboxService,
    private readonly explore: ExploreService,
    private readonly cards?: OutcomeChatCards
  ) {}

  execute = async (
    request: DynamicToolCallRequest,
    context: ToolContext,
    signal?: AbortSignal
  ): Promise<unknown> => {
    const cardTools = [
      "PlanOutcome",
      "CreateOutcome",
      "ReviseOutcome",
      "StartOutcome",
      "CancelOutcome",
    ];
    if (!this.cards || !cardTools.includes(request.tool))
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
      title: String(args.title ?? args.sourceText ?? "Goal")
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
      await update({ stage: request.tool === "PlanOutcome" ? "generating" : "analyzing" });
      const result = await this.perform(request, context, signal);
      if (request.tool === "PlanOutcome") {
        const plan = result as PlanningDraftView;
        await update({
          stage: "plan_ready",
          planId: plan.planId,
          summary: "Planning suggestions are ready. No goal has been created or started.",
          suggestions: {
            goals: plan.goal.options.map((o) => o.text),
            acceptance: plan.acceptance.options.map((o) => o.text),
            boundaries: plan.boundaries.options.map((o) => o.text),
          },
        });
      } else {
        const { outcome } = result as { outcome: OutcomeDetail };
        await update({
          stage: outcomeCardStage(outcome.status),
          title: outcome.title,
          outcomeId: outcome.id,
          revision: outcome.currentRevision ?? undefined,
          summary: outcome.currentRevisionView?.goal[0]?.slice(0, 220),
        });
      }
      if (id && request.tool !== "PlanOutcome") {
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
            : "Report the saved server status. Final acceptance remains an owner Review.",
      };
    };
    try {
      switch (request.tool) {
        case "PlanOutcome": {
          requireOutcomeDispatch();
          const args = input("PlanOutcome");
          return await run(this.planning.create({ ...args, context: { botId: context.botId } }));
        }
        case "GetOutcomePlan":
          return await run(this.planning.get(input("GetOutcomePlan").planId));
        case "CreateOutcome":
          return await detail(this.outcomes.createFromDraft(input("CreateOutcome"), actor));
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
        case "ProposeExploreIdea": {
          requireOutcomeDispatch();
          const { ideaId, ...args } = input("ProposeExploreIdea");
          return await run(this.explore.propose(ideaId, { ...args, botId: context.botId }, actor));
        }
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
