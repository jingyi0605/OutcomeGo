import {
  ApiError,
  DeferWorkItemInput,
  parseOffsetTimestamp,
  type DynamicToolCallRequest,
} from "@outcomego/contracts";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import type { PrismaClient } from "@outcomego/db";
import {
  appendOutcomeEvent,
  publishGoalScheduleChanged,
  enqueueOutcomeTurn,
  readFeatureSettings,
  transitionWorkItem,
  DEFERRED_BY_AGENT_REASON,
  type AgentMessaging,
} from "@outcomego/messaging";
import { Schema } from "effect";
import type { OutcomeThreadToolContext, OutcomeThreadToolHandler } from "./internal-tool-service";
import { mapOutcomeError } from "./outcome-write";

const DAY_MS = 86_400_000;

/**
 * The agent says it cannot finish this work item now and will continue later (specs/004.10 design §5.4). The task
 * goes back to the queue with a future time and its note held as the next turn's instructions; it uses none of the
 * bot's capacity while it waits. Nothing about the contract, the dependencies or what the task may do changes.
 *
 * How far ahead and how many times are the owner's policy. Every refusal changes nothing.
 */
export const createDeferWorkItemTool = (prisma: PrismaClient, messaging: AgentMessaging): OutcomeThreadToolHandler =>
  async (request: DynamicToolCallRequest, context: OutcomeThreadToolContext) => {
    let input: DeferWorkItemInput;
    try {
      input = Schema.decodeUnknownSync(DeferWorkItemInput)(request.arguments);
    } catch {
      throw new ApiError(400, "invalid_request", "Invalid DeferWorkItem arguments");
    }
    const note = input.note.trim();
    if (!note) throw new ApiError(400, "invalid_request", "The note for the next turn must not be empty");
    const resumeAt = parseOffsetTimestamp(input.resumeAt);
    if (!resumeAt) {
      throw new ApiError(400, "invalid_schedule", "resumeAt must be an ISO 8601 time with a UTC offset", { field: "resumeAt" });
    }
    const reason = input.reason?.trim() || undefined;

    try {
      return await prisma.$transaction(async (tx) => {
        const found = await tx.outcomeWorkItem.findUnique({ where: { id: context.workItemId }, select: { outcomeId: true } });
        if (!found) throw new ApiError(404, "work_item_not_found", "Outcome work item not found");
        // The goal's lock first, then the task's, as every other change to a task does.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`}))`;
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

        const policy = resolveTaskPolicy((await readFeatureSettings(tx)).taskPolicy);
        const now = Date.now();
        if (resumeAt.getTime() <= now) {
          throw new ApiError(400, "invalid_schedule", "resumeAt must be in the future", { field: "resumeAt" });
        }
        const maxDays = policy["schedule.deferMaxDays"] as number;
        if (resumeAt.getTime() - now > maxDays * DAY_MS) {
          throw new ApiError(400, "invalid_schedule", "resumeAt is further away than the owner allows", { field: "resumeAt", maxDays });
        }
        const maxCount = policy["schedule.deferMaxCount"] as number;
        if (item.deferCount >= maxCount) {
          throw new ApiError(409, "defer_limit_reached", "This task has been deferred as many times as the owner allows", {
            deferCount: item.deferCount,
            maxCount,
          });
        }

        const actor = `bot:${run.botId}` as const;
        const deferCount = item.deferCount + 1;
        await tx.outcomeWorkItem.update({
          where: { id: item.id },
          data: { scheduledAt: resumeAt, deferCount },
        });
        await transitionWorkItem(tx, {
          workItemId: item.id,
          to: "queued",
          reason: DEFERRED_BY_AGENT_REASON,
          actor,
        });
        // The pending start for the next turn. The task now waits for a future time, so this is held, not run.
        await enqueueOutcomeTurn(tx, messaging, {
          workItemId: item.id,
          content: note,
          reason: "resume_scheduled",
          clientId: `defer:${item.id}:${deferCount}`,
        });
        await publishGoalScheduleChanged(tx, item.outcomeId);
        await appendOutcomeEvent(tx, "outcome.schedule.changed", item.outcomeId, {
          actor,
          contractRevision: item.contractRevision.revision,
          workItemId: item.id,
          runId: run.id,
          idempotencyKey: `defer:${item.id}:${deferCount}`,
          payload: {
            target: "work_item",
            workItemId: item.id,
            scheduledAt: resumeAt.toISOString(),
            previous: { scheduledAt: item.scheduledAt?.toISOString() ?? null },
            ...(reason ? { reason } : {}),
            source: "agent_defer",
          },
        });

        return {
          deferred: true,
          workItemId: item.id,
          resumeAt: resumeAt.toISOString(),
          instruction: "Deferred. End this turn now without reporting a result: the task is not complete and will continue at that time.",
        };
      });
    } catch (error) {
      throw mapOutcomeError(error);
    }
  };
