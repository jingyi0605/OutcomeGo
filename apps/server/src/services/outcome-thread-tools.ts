import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import { outcomeDeepLink } from "@outcomego/contracts/app-deep-links";
import {
  decodeOutcomeThreadInput,
  goalThreadToolsForPurpose,
  OUTCOME_GOAL_THREAD_TOOL_NAMES,
  type OutcomeThreadPurpose,
  type OutcomeThreadToolName,
} from "@outcomego/contracts/outcome-thread";
import { decodeOutcomeCursor, OUTCOME_LIMITS, type OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { PrismaClient } from "@outcomego/db";
import { outcomeReviewDecisionFilter, readOutcomesEnabled, type ToolContext } from "@outcomego/messaging";
import { Cause, Effect, Exit } from "effect";
import type { OutcomeClassificationService } from "./outcome-classification";
import type { OutcomePlanService } from "./outcome-plan-service";
import type { OutcomeReviewService } from "./outcome-review-service";
import type { OutcomeService } from "./outcome-service";
import type { OutcomeTaskReviewService } from "./outcome-task-review-service";
import { assertOutcomeRevision } from "./outcome-lifecycle";
import { lockOutcome, outcomeWrite } from "./outcome-write";

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

const inspectSavePlanPreDecodeError = (args: unknown): ApiError | null => {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const raw = args as Record<string, unknown>;
  if (typeof raw.notes === "string" && raw.notes.trim().length > 2_000) {
    return new ApiError(400, "invalid_request", "Plan notes must be <= 2000 characters", { field: "notes" });
  }
  if (!Array.isArray(raw.tasks)) return null;
  if (raw.tasks.length > 20) {
    return new ApiError(400, "invalid_request", "Plan cannot exceed 20 tasks", { field: "tasks", limit: 20 });
  }
  for (const task of raw.tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task)) continue;
    const row = task as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    if (row.nature !== "deliverable" && row.nature !== "action") {
      return new ApiError(
        400,
        "invalid_request",
        `Task "${key || "(unknown)"}" must specify nature ("deliverable" or "action")`,
        { field: "nature", key }
      );
    }
  }
  return null;
};

/**
 * Tools of a goal's own thread. The thread is bound to one goal: a tool can only touch that goal, and the
 * ones with consequences check who started the turn. Contract approval still stays in the app; owner-initiated
 * turns in review_pending may accept or request rework.
 */
export class OutcomeThreadTools {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outcomes: Pick<OutcomeService, "saveAgentContract" | "cancel" | "get" | "getRevision" | "list" | "transcript">,
    private readonly plans?: Pick<OutcomePlanService, "savePlan">,
    private readonly taskReviews?: Pick<OutcomeTaskReviewService, "submitPrereview" | "reviewTaskResult">,
    private readonly reviews?: Pick<OutcomeReviewService, "decide">,
    private readonly classifications?: Pick<OutcomeClassificationService, "classify">
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
      where: { runId: context.runId },
      include: { thread: { select: { outcomeId: true, botId: true, outcome: { select: { ownerId: true } } } } },
    });
    if (!turn || turn.thread.botId !== context.botId)
      throw new ApiError(403, "outcome_thread_required", "This tool belongs to a goal's own thread");
    const purpose = (turn.purpose ?? "owner_message") as OutcomeThreadPurpose;
    if (!goalThreadToolsForPurpose(purpose, turn.planMode).includes(request.tool))
      throw new ApiError(403, "outcome_thread_tool_forbidden", `${request.tool} is not available in ${purpose} turns`);
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
      case "ClassifyOutcome": {
        if (!this.classifications) throw new ApiError(503, "outcome_triage_unavailable", "Outcome classification is not available");
        return this.classifications.classify({ runId: context.runId, botId: context.botId }, decode("ClassifyOutcome"));
      }
      case "SavePlanAdvice": {
        const { clientRequestId, ...fields } = decode("SavePlanAdvice");
        return outcomeWrite(this.prisma, `outcome-plan-advice:${turn.id}:${outcomeId}`, clientRequestId, fields, async (tx) => {
          const outcome = await lockOutcome(tx, outcomeId);
          const current = await tx.outcomeThreadTurn.findUnique({ where: { runId: context.runId }, include: { run: true } });
          if (!current || current.id !== turn.id || current.status !== "running" || current.run?.status !== "running" ||
              current.run.botId !== context.botId || current.run.requestStoppedAt)
            throw new ApiError(403, "outcome_thread_required", "An active planner turn is required to save advice");
          assertOutcomeRevision(outcome, current.outcomeRevision ?? undefined);
          const advice = { schemaVersion: 1 as const, ...fields };
          await tx.outcomeThreadTurn.update({ where: { id: turn.id }, data: { result: advice } });
          await tx.event.create({ data: { topic: "goal.updated", entityId: outcomeId, payload: { outcomeId } } });
          return advice;
        });
      }
      case "SaveOutcomeContract": {
        const outcome = await run(this.outcomes.saveAgentContract(outcomeId, decode("SaveOutcomeContract"), actor), signal);
        return { outcome, approvalRequired: outcome.currentRevisionView?.status === "pending_approval", nextStep: nextStep(outcome) };
      }
      case "SavePlan": {
        if (!this.plans) throw new ApiError(503, "outcome_plan_unavailable", "Saving task plans is not available");
        const preError = inspectSavePlanPreDecodeError(request.arguments);
        if (preError) throw preError;
        const outcome = await this.plans.savePlan(outcomeId, decode("SavePlan"), actor);
        const approved = outcome.currentRevisionView?.status === "approved";
        return {
          outcome,
          approvalRequired: !approved,
          nextStep: approved
            ? "Task plan updated on the approved revision."
            : "Saved the task plan on the pending contract revision. Do not approve it yourself; tell the owner to review and approve in the app.",
        };
      }
      case "SubmitPrereview": {
        if (!this.taskReviews) {
          throw new ApiError(503, "outcome_review_unavailable", "Preliminary review recording is not available");
        }
        const outcome = await this.taskReviews.submitPrereview(outcomeId, turn.id, decode("SubmitPrereview"), actor);
        return {
          outcome,
          nextStep: "Preliminary review saved. The app uses your submitted conclusion in the report. Acknowledge briefly; do not write a second report, approve or accept.",
        };
      }
      case "ReviewTaskResult": {
        if (!this.taskReviews) {
          throw new ApiError(503, "outcome_review_unavailable", "Task review recording is not available");
        }
        const outcome = await this.taskReviews.reviewTaskResult(
          outcomeId,
          turn.id,
          turn.workItemId ?? null,
          decode("ReviewTaskResult"),
          actor
        );
        return {
          outcome,
          nextStep: "Task review verdict recorded. Summarize the verdict concisely in your final message.",
        };
      }
      case "AcceptOutcome": {
        const input = decode("AcceptOutcome");
        if (input.outcomeId !== outcomeId)
          throw new ApiError(403, "outcome_thread_scope", "A goal's thread can only accept its own goal");
        if (!triggeredByOwner(turn.triggerBy))
          throw new ApiError(403, "accept_requires_owner", "Only the owner's words in this thread can accept the goal");
        if (!this.reviews)
          throw new ApiError(503, "outcome_acceptance_unavailable", "Outcome acceptance is not available");
        const outcome = await run(
          this.reviews.decide(
            outcomeId,
            {
              decision: "approve",
              expectedRevision: input.expectedRevision,
              clientRequestId: input.clientRequestId,
            },
            actor
          ),
          signal
        );
        return {
          outcome,
          nextStep: "The goal is accepted and completed. Confirm this briefly to the owner in your final message.",
        };
      }
      case "RequestOutcomeRework": {
        const input = decode("RequestOutcomeRework");
        if (input.outcomeId !== outcomeId)
          throw new ApiError(403, "outcome_thread_scope", "A goal's thread can only request rework for its own goal");
        if (!triggeredByOwner(turn.triggerBy))
          throw new ApiError(403, "rework_requires_owner", "Only the owner's words in this thread can request rework from this turn");
        if (!this.reviews)
          throw new ApiError(503, "outcome_acceptance_unavailable", "Outcome rework is not available");
        const outcome = await run(
          this.reviews.decide(
            outcomeId,
            {
              decision: "reject",
              expectedRevision: input.expectedRevision,
              reason: input.reason.trim(),
              clientRequestId: input.clientRequestId,
            },
            actor
          ),
          signal
        );
        return {
          outcome,
          nextStep: "Rework has been queued under the current contract. Tell the owner what is being revised in your final message.",
        };
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
        const outcome = await run(this.outcomes.get(outcomeId, actor, { ownerId: turn.thread.outcome.ownerId }), signal);
        const detail = { outcome, url: outcomeDeepLink(outcomeId),
          ...(input.revision ? { revision: await run(this.outcomes.getRevision(outcomeId, input.revision), signal) } : {}),
          ...(input.workItemId ? { transcript: await run(this.outcomes.transcript(outcomeId, input.workItemId, input), signal) } : {}),
        };
        if (purpose !== "review") return detail;
        const revision = detail.outcome.currentRevisionView;
        const decisionRecords = revision ? await this.prisma.outcomeDecision.findMany({
          where: { outcomeId, contractRevisionId: revision.id, ...outcomeReviewDecisionFilter },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, createdAt: true, status: true, completedSummary: true, problemSummary: true, nextStepSummary: true },
          take: 10,
        }) : [];
        return { ...detail, decisionRecords };
      }
      case "ListOutcomes": {
        const { cursor, limit = OUTCOME_LIMITS.listPageSize, kinds = [], statuses = [], ...filters } = decode("ListOutcomes");
        return run(this.outcomes.list({ ...filters, kinds, statuses, limit, cursor: decodeOutcomeCursor(cursor ?? null) }, actor,
          { ownerId: turn.thread.outcome.ownerId }), signal);
      }
    }
  };
}
