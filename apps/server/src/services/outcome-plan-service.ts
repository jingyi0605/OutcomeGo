import { ApiError } from "@outcomego/contracts";
import type { SavePlanInput } from "@outcomego/contracts/outcome-thread";
import {
  PLAN_LIMITS,
  PLAN_TASK_NATURES,
  parseOutcomePlan,
  type OutcomeDetail,
  type OutcomePlanView,
  type PlanTask,
} from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  appendOutcomeEvent,
  enqueueOutcomeTurn,
  isBotRunnable,
  recomputeOutcomeStatus,
  transitionWorkItem,
  type ActorRef,
  type AgentMessaging,
} from "@outcomego/messaging";
import { outcomeApiError, type OutcomeService } from "./outcome-service";
import { lockOutcome, outcomeWrite } from "./outcome-write";
import { toJson } from "./service-utils";

type Tx = Prisma.TransactionClient;

const findCycleKeys = (tasks: readonly PlanTask[]): string[] => {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    const deps = task.dependsOn ?? [];
    indegree.set(task.key, deps.length);
    for (const dep of deps) {
      if (dep === task.key) return [task.key];
      const list = dependents.get(dep) ?? [];
      list.push(task.key);
      dependents.set(dep, list);
    }
  }
  const queue = tasks.filter((t) => (indegree.get(t.key) ?? 0) === 0).map((t) => t.key);
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    visited.add(current);
    for (const next of dependents.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (visited.size === byKey.size) return [];
  return tasks.filter((t) => !visited.has(t.key)).map((t) => t.key);
};

const normalizePlanTask = (task: SavePlanInput["tasks"][number]): PlanTask => {
  const deps = [...new Set((task.dependsOn ?? []).map((dep) => dep.trim()).filter(Boolean))];
  const covers = [...new Set(task.covers.map((id) => id.trim()).filter(Boolean))];
  return {
    key: task.key.trim(),
    title: task.title.trim(),
    instructions: task.instructions.trim(),
    botId: task.botId.trim(),
    ...(deps.length ? { dependsOn: deps } : {}),
    covers,
    nature: task.nature,
  };
};

export const topologicalPlanOrder = (tasks: readonly PlanTask[]): PlanTask[] => {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    const deps = task.dependsOn ?? [];
    indegree.set(task.key, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(task.key);
      dependents.set(dep, list);
    }
  }
  const queue = tasks.filter((t) => (indegree.get(t.key) ?? 0) === 0).map((t) => t.key);
  const ordered: PlanTask[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    const task = byKey.get(current);
    if (task) ordered.push(task);
    for (const next of dependents.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return ordered;
};

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const sameStringArray = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((val, index) => val === b[index]);

const plansEqual = (a: OutcomePlanView | null, b: OutcomePlanView): boolean => {
  if (!a) return false;
  const norm = (p: OutcomePlanView) => ({
    notes: p.notes?.trim() ? p.notes.trim() : null,
    tasks: p.tasks.map((task) => ({
      key: task.key,
      title: task.title,
      instructions: task.instructions,
      botId: task.botId,
      dependsOn: task.dependsOn ?? [],
      covers: task.covers,
      nature: task.nature,
    })),
  });
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};

/**
 * Validates and saves structured task plans on a Contract Revision (specs/004.9).
 */
export class OutcomePlanService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outcomes: Pick<OutcomeService, "getInTransaction">,
    private readonly messaging?: AgentMessaging
  ) {}

  async savePlan(outcomeId: string, input: SavePlanInput, actor: ActorRef): Promise<OutcomeDetail> {
    return outcomeWrite(this.prisma, `outcome-plan:${outcomeId}`, input.clientRequestId, input, async (tx) => {
      const outcome = await lockOutcome(tx, outcomeId);
      if (outcome.status === "accepted" || outcome.status === "cancelled") {
        throw outcomeApiError("outcome_terminal", `This goal is ${outcome.status}`, {
          currentStatus: outcome.status,
        });
      }
      const revision = outcome.currentRevisionId
        ? await tx.outcomeContractRevision.findUnique({
            where: { id: outcome.currentRevisionId },
            include: { criteria: { orderBy: { ordinal: "asc" } } },
          })
        : null;
      if (!revision || revision.revision !== input.expectedRevision || revision.status === "superseded") {
        throw outcomeApiError("plan_revision_conflict", "The contract revision changed; reload before saving plan", {
          currentRevision: revision?.revision ?? null,
        });
      }

      const rawNotes = input.notes === undefined ? null : input.notes.trim() || null;
      if (rawNotes && rawNotes.length > PLAN_LIMITS.notesChars) {
        throw new ApiError(400, "invalid_request", `Plan notes must be <= ${PLAN_LIMITS.notesChars} characters`, {
          field: "notes",
        });
      }
      if (!input.tasks.length || input.tasks.length > PLAN_LIMITS.maxTasks) {
        throw new ApiError(
          400,
          "invalid_request",
          `Plan must contain between 1 and ${PLAN_LIMITS.maxTasks} tasks`,
          { field: "tasks", limit: PLAN_LIMITS.maxTasks }
        );
      }

      const normalizedTasks: PlanTask[] = [];
      const seenKeys = new Set<string>();
      const checkedBots = new Map<string, boolean>();
      for (const rawTask of input.tasks) {
        const key = typeof rawTask.key === "string" ? rawTask.key.trim() : "";
        if (!key || key.length > PLAN_LIMITS.keyChars) {
          throw new ApiError(400, "invalid_request", "Each task requires a valid key", { field: "key", key });
        }
        if (seenKeys.has(key)) {
          throw new ApiError(400, "invalid_request", `Duplicate task key "${key}"`, { field: "key", key });
        }
        seenKeys.add(key);

        if (!(PLAN_TASK_NATURES as readonly unknown[]).includes(rawTask.nature)) {
          throw new ApiError(400, "invalid_request", `Task "${key}" must specify nature ("deliverable" or "action")`, {
            field: "nature",
            key,
          });
        }
        const title = rawTask.title.trim();
        if (!title || title.length > PLAN_LIMITS.titleChars) {
          throw new ApiError(400, "invalid_request", `Task "${key}" has an invalid title`, { field: "title", key });
        }
        const instructions = rawTask.instructions.trim();
        if (!instructions || instructions.length > PLAN_LIMITS.instructionsChars) {
          throw new ApiError(400, "invalid_request", `Task "${key}" has invalid instructions`, {
            field: "instructions",
            key,
          });
        }
        const botId = rawTask.botId.trim();
        let runnable = checkedBots.get(botId);
        if (runnable === undefined) {
          runnable = await isBotRunnable(tx, botId);
          checkedBots.set(botId, runnable);
        }
        if (!runnable) {
          throw new ApiError(400, "invalid_request", `Assigned Bot ${botId} for task "${key}" is not active or runnable`, {
            field: "botId",
            key,
            botId,
          });
        }
        normalizedTasks.push(normalizePlanTask(rawTask));
      }

      for (const task of normalizedTasks) {
        for (const dep of task.dependsOn ?? []) {
          if (!seenKeys.has(dep)) {
            throw new ApiError(400, "invalid_request", `Task "${task.key}" depends on unknown key "${dep}"`, {
              field: "dependsOn",
              key: task.key,
              missingDependency: dep,
            });
          }
        }
      }

      const cycleKeys = findCycleKeys(normalizedTasks);
      if (cycleKeys.length) {
        throw outcomeApiError(
          "plan_cycle",
          `Task dependencies form a cycle involving: ${cycleKeys.join(", ")}`,
          { keys: cycleKeys }
        );
      }

      const criterionById = new Map(revision.criteria.map((criterion) => [criterion.id, criterion]));
      const coveredRequiredIds = new Set<string>();
      for (const task of normalizedTasks) {
        for (const criterionId of task.covers) {
          const found = criterionById.get(criterionId);
          if (!found) {
            throw new ApiError(400, "invalid_request", `Task "${task.key}" covers unknown criterion ${criterionId}`, {
              field: "covers",
              key: task.key,
              criterionId,
            });
          }
          if (found.required) coveredRequiredIds.add(criterionId);
        }
      }
      const uncoveredCriterionIds = revision.criteria
        .filter((criterion) => criterion.required && !coveredRequiredIds.has(criterion.id))
        .map((criterion) => criterion.id);
      if (uncoveredCriterionIds.length) {
        throw outcomeApiError(
          "plan_uncovered_criteria",
          `Plan must cover all required acceptance criteria (${uncoveredCriterionIds.join(", ")})`,
          { uncoveredCriterionIds }
        );
      }

      const nextPlan: OutcomePlanView = {
        ...(rawNotes ? { notes: rawNotes } : {}),
        tasks: normalizedTasks,
      };
      const existingPlan = parseOutcomePlan(revision.plan);
      if (plansEqual(existingPlan, nextPlan)) {
        throw outcomeApiError("plan_unchanged", "Plan matches the currently saved plan");
      }

      if (revision.status !== "draft" && revision.status !== "pending_approval") {
        if (revision.status !== "approved") {
          throw outcomeApiError("invalid_outcome_transition", `Cannot save plan for revision in status ${revision.status}`, {
            currentStatus: revision.status,
          });
        }
        await this.applyApprovedPlanChanges(
          tx,
          outcomeId,
          revision.id,
          revision.revision,
          existingPlan,
          nextPlan,
          actor,
          input.clientRequestId
        );
        await recomputeOutcomeStatus(tx, outcomeId, actor);
      } else {
        await tx.outcomeContractRevision.update({
          where: { id: revision.id },
          data: { plan: toJson(nextPlan) },
        });
      }
      await appendOutcomeEvent(tx, "outcome.plan.saved", outcomeId, {
        actor,
        idempotencyKey: input.clientRequestId,
        contractRevision: revision.revision,
        payload: { revision: revision.revision, taskKeys: normalizedTasks.map((task) => task.key) },
      });
      return this.outcomes.getInTransaction(tx, outcomeId);
    });
  }

  private async applyApprovedPlanChanges(
    tx: Tx,
    outcomeId: string,
    revisionId: string,
    revisionNumber: number,
    existingPlan: OutcomePlanView | null,
    nextPlan: OutcomePlanView,
    actor: ActorRef,
    clientRequestId: string
  ) {
    const workItems = await tx.outcomeWorkItem.findMany({
      where: { outcomeId, contractRevisionId: revisionId },
      orderBy: { ordinal: "asc" },
    });
    const lastOutcomeItem = await tx.outcomeWorkItem.findFirst({
      where: { outcomeId },
      orderBy: { ordinal: "desc" },
      select: { ordinal: true },
    });
    let nextOrdinal = lastOutcomeItem?.ordinal ?? 0;

    const existingPlanTaskByKey = new Map((existingPlan?.tasks ?? []).map((task) => [task.key, task]));
    const existingItemByKey = new Map(
      workItems.filter((item) => item.planKey).map((item) => [item.planKey!, item])
    );
    const keyByItemId = new Map(
      workItems.filter((item) => item.planKey).map((item) => [item.id, item.planKey!])
    );
    const nextTaskByKey = new Map(nextPlan.tasks.map((task) => [task.key, task]));

    const isUnlocked = (item: typeof workItems[number]) =>
      item.executorType === "agent" && item.status === "queued" && item.rootRunId === null;

    // 1. Verify all started/finished/enqueued tasks appear verbatim without modification.
    for (const [planKey, item] of existingItemByKey) {
      if (isUnlocked(item)) continue;
      const candidate = nextTaskByKey.get(planKey);
      if (!candidate) {
        throw outcomeApiError("plan_task_locked", `Task "${planKey}" is already ${item.status} and cannot be removed`, {
          key: planKey,
        });
      }
      const prevTask = existingPlanTaskByKey.get(planKey);
      const currentDepKeys = asStringList(item.dependsOn).map((depId) => keyByItemId.get(depId) ?? depId);
      const nextDepKeys = candidate.dependsOn ?? [];
      const natureDiffers = prevTask ? prevTask.nature !== candidate.nature : false;
      const coversDiffers = prevTask ? !sameStringArray(prevTask.covers, candidate.covers) : false;
      if (
        item.title !== candidate.title ||
        item.instructions !== candidate.instructions ||
        item.botId !== candidate.botId ||
        !sameStringArray(currentDepKeys, nextDepKeys) ||
        natureDiffers ||
        coversDiffers
      ) {
        throw outcomeApiError(
          "plan_task_locked",
          `Task "${planKey}" has already started or finished and cannot be modified`,
          { key: planKey }
        );
      }
    }

    // 2. Remove unstarted tasks dropped from the updated plan.
    for (const [planKey, item] of existingItemByKey) {
      if (nextTaskByKey.has(planKey) || !isUnlocked(item)) continue;
      await tx.idempotencyRecord.deleteMany({
        where: { scope: `outcome-turn:${item.id}`, status: "processing" },
      });
      await transitionWorkItem(tx, {
        workItemId: item.id,
        to: "cancelled",
        reason: "plan_task_removed",
        actor,
        idempotencyKey: `save-plan:${clientRequestId}:remove:${item.id}`,
      });
    }

    // 3. Materialize new tasks and update modified unstarted tasks in topological order.
    const itemIdByKey = new Map<string, string>(
      [...existingItemByKey.entries()]
        .filter(([planKey]) => nextTaskByKey.has(planKey))
        .map(([planKey, item]) => [planKey, item.id])
    );

    for (const task of topologicalPlanOrder(nextPlan.tasks)) {
      const existing = existingItemByKey.get(task.key);
      const depIds = (task.dependsOn ?? []).map((depKey) => {
        const depId = itemIdByKey.get(depKey);
        if (!depId) {
          throw new ApiError(400, "invalid_request", `Dependency "${depKey}" for task "${task.key}" could not be resolved`, {
            field: "dependsOn",
            key: task.key,
          });
        }
        return depId;
      });

      if (!existing) {
        nextOrdinal += 1;
        const created = await tx.outcomeWorkItem.create({
          data: {
            outcomeId,
            contractRevisionId: revisionId,
            botId: task.botId,
            executorType: "agent",
            kind: "initial",
            title: task.title,
            instructions: task.instructions,
            planKey: task.key,
            dependsOn: depIds,
            status: "queued",
            ordinal: nextOrdinal,
          },
        });
        itemIdByKey.set(task.key, created.id);
        await appendOutcomeEvent(tx, "outcome.work_item.created", outcomeId, {
          actor,
          contractRevision: revisionNumber,
          workItemId: created.id,
          idempotencyKey: `${clientRequestId}:${task.key}`,
          payload: { workItemId: created.id, executorType: "agent", kind: "initial" },
        });
        if (this.messaging) {
          await enqueueOutcomeTurn(tx, this.messaging, {
            workItemId: created.id,
            content: created.instructions,
            reason: "start",
            clientId: `outcome-plan:${outcomeId}:${revisionNumber}:${created.id}:${clientRequestId}`,
          });
        }
        continue;
      }

      if (!isUnlocked(existing)) continue;

      const currentDeps = asStringList(existing.dependsOn);
      const changed =
        existing.title !== task.title ||
        existing.instructions !== task.instructions ||
        existing.botId !== task.botId ||
        !sameStringArray(currentDeps, depIds);
      if (changed) {
        await tx.outcomeWorkItem.update({
          where: { id: existing.id },
          data: {
            title: task.title,
            instructions: task.instructions,
            botId: task.botId,
            dependsOn: depIds,
          },
        });
        if (this.messaging) {
          // Delete old processing record so enqueueOutcomeTurn does not hit idempotency_conflict on updated payload.
          await tx.idempotencyRecord.deleteMany({
            where: { scope: `outcome-turn:${existing.id}`, status: "processing" },
          });
          await enqueueOutcomeTurn(tx, this.messaging, {
            workItemId: existing.id,
            content: task.instructions,
            reason: "start",
            clientId: `outcome-plan:${outcomeId}:${revisionNumber}:${existing.id}:${clientRequestId}`,
          });
        }
      }
    }

    await tx.outcomeContractRevision.update({
      where: { id: revisionId },
      data: { plan: toJson(nextPlan) },
    });
  }
}
