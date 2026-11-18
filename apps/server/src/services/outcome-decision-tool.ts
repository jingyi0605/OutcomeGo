import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import { RequestOutcomeDecisionInput, type DecisionCreateInput, type DecisionOption } from "@outcomego/contracts/outcome-inbox";
import type { PrismaClient } from "@outcomego/db";
import { isOutcomeDecisionRevisionActive, transitionWorkItem } from "@outcomego/messaging";
import { Schema } from "effect";
import type { DecisionService } from "./decision-service";
import type { OutcomeThreadToolContext, OutcomeThreadToolHandler } from "./internal-tool-service";
import { mapOutcomeError } from "./outcome-write";

/** What a caller decides; the persisted Run supplies every identity around it. */
export type RunDecisionDraft = Pick<
  DecisionCreateInput,
  "completedSummary" | "problemSummary" | "nextStepSummary" | "reasonCode" | "options" | "customEntryAllowed"
>;

/**
 * Creates a Decision for the running Outcome turn and pauses its work item, in one transaction.
 * `requestSnapshot` feeds the replay identity, so a repeated call of the same turn returns the same Decision.
 */
export const requestDecisionFromRun = async (
  prisma: PrismaClient,
  decisions: DecisionService,
  request: DynamicToolCallRequest,
  context: OutcomeThreadToolContext,
  draft: RunDecisionDraft,
  requestSnapshot: unknown,
): Promise<{ decisionId: string; status: "waiting_for_user" }> => {
  try {
    return await prisma.$transaction(async tx => {
      const found = await tx.outcomeWorkItem.findUnique({ where: { id: context.workItemId }, select: { outcomeId: true } });
      if (!found) throw new ApiError(404, "work_item_not_found", "Outcome work item not found");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-work-item:${context.workItemId}`}))`;
      const [run, item] = await Promise.all([
        tx.run.findUnique({ where: { id: context.runId } }),
        tx.outcomeWorkItem.findUniqueOrThrow({ where: { id: context.workItemId }, include: { contractRevision: true, outcome: true } }),
      ]);
      if (!run || run.status !== "running" || run.origin !== "outcome" || run.outcomeWorkItemId !== item.id || run.botId !== context.botId ||
          run.id !== request.runId || item.botId !== context.botId || item.executorType !== "agent")
        throw new ApiError(409, "tool_context_invalid", "The requesting Outcome turn is no longer active");
      if (!await isOutcomeDecisionRevisionActive(tx, item.outcomeId, item.contractRevisionId, item.id) || item.contractRevision.status !== "approved" || !item.contractRevision.approvedAt)
        throw new ApiError(409, "decision_revision_conflict", "The requesting contract is no longer current and approved");
      if (item.outcome.cancelledAt || item.outcome.acceptedAt || !["running", "waiting_decision"].includes(item.status))
        throw new ApiError(409, "invalid_outcome_transition", "The requesting work item cannot request a decision");
      const actor = `bot:${run.botId}` as const;
      const recommended = draft.options.slice(0, 4).find(option => option.recommended);
      const decision = await decisions.createInTransaction(tx, {
        outcomeId: item.outcomeId, contractRevisionId: item.contractRevisionId, workItemId: item.id, runId: run.id,
        ...draft, customEntryAllowed: draft.customEntryAllowed ?? true,
        ...(recommended ? { recommendation: { optionId: recommended.id, reason: recommended.reason! } } : {}),
      }, actor, requestSnapshot);
      if (decision.status === "open" || decision.status === "presented") {
        if (item.status !== "waiting_decision") await transitionWorkItem(tx, { workItemId: item.id, to: "waiting_decision", reason: "outcome_decision_requested", actor, idempotencyKey: `decision-request:${decision.id}` });
      }
      return { decisionId: decision.id, status: "waiting_for_user" as const };
    });
  } catch (error) { throw mapOutcomeError(error); }
};

/** The persisted Run supplies every identity; proposals cannot select a different Outcome or actor. */
export const createOutcomeDecisionTool = (prisma: PrismaClient, decisions: DecisionService): OutcomeThreadToolHandler =>
  async (request, context) => {
    let input: RequestOutcomeDecisionInput;
    try { input = Schema.decodeUnknownSync(RequestOutcomeDecisionInput)(request.arguments); }
    catch { throw new ApiError(400, "invalid_request", "Invalid Outcome decision request"); }
    const options: DecisionOption[] = input.options.map((proposal, index) => ({
      id: `option-${index + 1}`, ...proposal, resolutionEffect: proposal.resolutionEffect ?? "plan_only", source: "runtime",
    }));
    return requestDecisionFromRun(prisma, decisions, request, context, {
      completedSummary: input.completedSummary, problemSummary: input.problemSummary, nextStepSummary: input.nextStepSummary,
      reasonCode: input.reasonCode, options, customEntryAllowed: true,
    }, input);
  };
