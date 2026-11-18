import {
  ApiError,
  parseOutcomeWorkItemProgress,
  ReportOutcomeProgressInput,
  type DynamicToolCallRequest,
  type OutcomeWorkItemProgress,
} from "@outcomego/contracts";
import type { PrismaClient } from "@outcomego/db";
import { appendOutcomeEvent } from "@outcomego/messaging";
import { Schema } from "effect";
import type { OutcomeThreadToolContext, OutcomeThreadToolHandler } from "./internal-tool-service";
import { mapOutcomeError } from "./outcome-write";
import { toJson } from "./service-utils";

/**
 * Updates the executing work item's structured task list and current phase/stage,
 * appends an outcome progress event, and emits a lightweight SSE refresh signal.
 */
export const createOutcomeProgressTool = (prisma: PrismaClient): OutcomeThreadToolHandler =>
  async (request: DynamicToolCallRequest, context: OutcomeThreadToolContext) => {
    let input: ReportOutcomeProgressInput;
    try {
      input = Schema.decodeUnknownSync(ReportOutcomeProgressInput)(request.arguments);
    } catch {
      throw new ApiError(400, "invalid_request", "Invalid ReportOutcomeProgress arguments");
    }

    const phase = input.phase.trim();
    const summary = input.summary?.trim();
    const tasks = input.tasks.map((step) => ({
      id: step.id.trim(),
      title: step.title.trim(),
      status: step.status,
      ...(step.summary?.trim() ? { summary: step.summary.trim() } : {}),
    }));
    if (!phase || tasks.some((step) => !step.id || !step.title)) {
      throw new ApiError(400, "invalid_request", "Phase and task id/title must be non-empty");
    }

    const progress: OutcomeWorkItemProgress = {
      phase,
      ...(summary ? { summary } : {}),
      tasks,
      updatedAt: new Date().toISOString(),
    };

    try {
      return await prisma.$transaction(async (tx) => {
        const found = await tx.outcomeWorkItem.findUnique({
          where: { id: context.workItemId },
          select: { outcomeId: true },
        });
        if (!found) throw new ApiError(404, "work_item_not_found", "Outcome work item not found");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-work-item:${context.workItemId}`}))`;

        const [run, item] = await Promise.all([
          tx.run.findUnique({ where: { id: context.runId } }),
          tx.outcomeWorkItem.findUniqueOrThrow({
            where: { id: context.workItemId },
            include: { contractRevision: true, outcome: true },
          }),
        ]);

        if (
          !run ||
          run.status !== "running" ||
          run.origin !== "outcome" ||
          run.outcomeWorkItemId !== item.id ||
          run.botId !== context.botId ||
          run.id !== request.runId ||
          item.botId !== context.botId ||
          item.executorType !== "agent"
        ) {
          throw new ApiError(409, "tool_context_invalid", "The requesting Outcome turn is no longer active");
        }
        if (item.outcome.cancelledAt || item.outcome.acceptedAt || item.status !== "running") {
          throw new ApiError(409, "invalid_outcome_transition", "The work item is not actively running");
        }

        await tx.outcomeWorkItem.update({
          where: { id: item.id },
          data: { progress: toJson(progress) },
        });

        const actor = `bot:${run.botId}` as const;
        const completedCount = tasks.filter((t) => t.status === "completed").length;

        await appendOutcomeEvent(tx, "outcome.progress.updated", item.outcomeId, {
          actor,
          contractRevision: item.contractRevision.revision,
          workItemId: item.id,
          runId: run.id,
          payload: {
            workItemId: item.id,
            phase: progress.phase,
            completedCount,
            totalCount: tasks.length,
          },
        });

        await tx.event.create({
          data: {
            topic: "goal.progress.updated",
            entityId: item.outcomeId,
            payload: toJson({
              outcomeId: item.outcomeId,
              workItemId: item.id,
              phase: progress.phase,
            }),
          },
        });

        return {
          updated: true,
          workItemId: item.id,
          progress: parseOutcomeWorkItemProgress(progress) ?? progress,
        };
      });
    } catch (error) {
      mapOutcomeError(error);
    }
  };
