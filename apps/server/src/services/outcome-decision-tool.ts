import { ApiError } from "@outcomego/contracts";
import { RequestOutcomeDecisionInput, type DecisionOption } from "@outcomego/contracts/outcome-inbox";
import type { PrismaClient } from "@outcomego/db";
import { isOutcomeDecisionRevisionActive, transitionWorkItem } from "@outcomego/messaging";
import { Schema } from "effect";
import type { DecisionService } from "./decision-service";
import type { OutcomeThreadToolHandler } from "./internal-tool-service";
import { mapOutcomeError } from "./outcome-write";

/** The persisted Run supplies every identity; proposals cannot select a different Outcome or actor. */
export const createOutcomeDecisionTool = (prisma: PrismaClient, decisions: DecisionService): OutcomeThreadToolHandler =>
  async (request, context) => {
    let input: RequestOutcomeDecisionInput;
    try { input = Schema.decodeUnknownSync(RequestOutcomeDecisionInput)(request.arguments); }
    catch { throw new ApiError(400, "invalid_request", "Invalid Outcome decision request"); }
    const options: DecisionOption[] = input.options.map((proposal, index) => ({
      id: `option-${index + 1}`, ...proposal, resolutionEffect: proposal.resolutionEffect ?? "plan_only", source: "runtime",
    }));
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
        const recommended = options.slice(0, 4).find(option => option.recommended);
        const decision = await decisions.createInTransaction(tx, {
          outcomeId: item.outcomeId, contractRevisionId: item.contractRevisionId, workItemId: item.id, runId: run.id,
          completedSummary: input.completedSummary, problemSummary: input.problemSummary, nextStepSummary: input.nextStepSummary,
          reasonCode: input.reasonCode, options, customEntryAllowed: true,
          ...(recommended ? { recommendation: { optionId: recommended.id, reason: recommended.reason! } } : {}),
        }, actor, input);
        if (decision.status === "open" || decision.status === "presented") {
          if (item.status !== "waiting_decision") await transitionWorkItem(tx, { workItemId: item.id, to: "waiting_decision", reason: "outcome_decision_requested", actor, idempotencyKey: `decision-request:${decision.id}` });
        }
        return { decisionId: decision.id, status: "waiting_for_user" as const };
      });
    } catch (error) { throw mapOutcomeError(error); }
  };
