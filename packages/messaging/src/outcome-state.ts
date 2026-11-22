import { createHash } from "node:crypto";
import {
  OUTCOME_EVENT_SCHEMA_VERSION,
  OUTCOME_STATUS_PRIORITY,
  OutcomeError,
  isOutcomeEventTopic,
} from "@outcomego/contracts/outcomes";
import type {
  AgentWorkItemStatus, HumanWorkItemStatus, OutcomeEventPayloads, OutcomeEventTopic, OutcomeStatus, WorkItemStatus,
} from "@outcomego/contracts/outcomes";
import type { Prisma } from "@outcomego/db";
import type { AgentMessaging } from "./index";
import { enqueueOutcomeThreadTurn, hasActivePlannerRole, resolveOutcomeRole } from "./outcome-roles";

/** Derived by the server from request/worker context, never supplied by a client body. */
export type ActorRef = `user:${string}` | "owner:local" | `bot:${string}` | `system:${string}`;

const ACTIVE_AGENT_STATES = ["queued", "running", "retry_pending", "needs_review"] as const;
const ACTIVE_HUMAN_STATES = ["pending", "ready", "in_progress", "paused", "submitted", "review_pending"] as const;
const SIDE_STATUSES: readonly OutcomeStatus[] = ["paused", "decision_pending", "human_action_pending"];

// Submission failures and interrupted-run recovery come from the prose/table in parent design §42.2.
const AGENT_TRANSITIONS: Record<AgentWorkItemStatus, readonly AgentWorkItemStatus[]> = {
  queued: ["running", "retry_pending", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled", "waiting_decision", "waiting_human", "retry_pending", "needs_review", "queued"],
  waiting_decision: ["running", "cancelled"],
  waiting_human: ["running", "cancelled"],
  retry_pending: ["running", "failed", "cancelled"],
  needs_review: ["running", "cancelled", "completed"],
  completed: [],
  failed: [],
  cancelled: [],
};

// Outcome-wide cancellation also closes unfinished human work, preserving OutcomeService.cancel.
const HUMAN_TRANSITIONS: Record<HumanWorkItemStatus, readonly HumanWorkItemStatus[]> = {
  pending: ["ready", "in_progress", "cancelled"],
  ready: ["in_progress", "cancelled"],
  in_progress: ["submitted", "paused", "cancelled"],
  paused: ["in_progress", "cancelled"],
  submitted: ["review_pending", "rejected", "cancelled"],
  review_pending: ["accepted", "rejected", "cancelled"],
  accepted: [],
  rejected: ["in_progress", "cancelled"],
  cancelled: [],
};

export interface TransitionWorkItemInput {
  workItemId: string;
  to: WorkItemStatus;
  reason: string;
  actor: ActorRef;
  idempotencyKey?: string;
  /** Provided by runtime/worker callers so failed or needs_review work items can trigger planner replanning. */
  messaging?: AgentMessaging;
}

/** Validate, change state, append its event and recompute the Outcome atomically in the caller's transaction. */
export async function transitionWorkItem(tx: Prisma.TransactionClient, input: TransitionWorkItemInput): Promise<void> {
  const found = await tx.outcomeWorkItem.findUnique({ where: { id: input.workItemId }, select: { outcomeId: true } });
  if (!found) throw new OutcomeError("work_item_not_found", "Work item not found");
  // All mutations of one Outcome acquire its lock before a work-item lock, including cancellation.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-work-item:${input.workItemId}`}))`;
  const item = await tx.outcomeWorkItem.findUniqueOrThrow({ where: { id: input.workItemId } });
  const scope = `outcome-work-item:${item.id}`;
  const requestHash = createHash("sha256").update(JSON.stringify({ to: input.to, reason: input.reason, actor: input.actor })).digest("hex");
  if (input.idempotencyKey) {
    const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: input.idempotencyKey } } });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new OutcomeError("idempotency_conflict", "This work-item request ID was already used for another transition");
      return;
    }
  }
  const transitions: Partial<Record<WorkItemStatus, readonly WorkItemStatus[]>> =
    item.executorType === "agent" ? AGENT_TRANSITIONS : HUMAN_TRANSITIONS;
  if (!transitions[item.status]?.includes(input.to))
    throw new OutcomeError("invalid_outcome_transition", `Cannot transition ${item.executorType} work from ${item.status} to ${input.to}`, {
      currentStatus: item.status,
      requestedStatus: input.to,
    });
  const now = new Date();
  const previousStatus = item.status;
  await tx.outcomeWorkItem.update({
    where: { id: item.id },
    data: {
      status: input.to,
      statusReason: input.reason,
      startedAt: item.startedAt ?? (["running", "in_progress"].includes(input.to) ? now : null),
      completedAt: ["completed", "failed", "cancelled", "accepted"].includes(input.to) ? now : null,
    },
  });
  await appendOutcomeEvent(tx, "outcome.work_item.updated", item.outcomeId, {
    actor: input.actor,
    workItemId: item.id,
    idempotencyKey: input.idempotencyKey,
    payload: { from: previousStatus, to: input.to, reason: input.reason },
  });
  if (
    item.executorType === "agent" &&
    (input.to === "failed" || input.to === "needs_review") &&
    previousStatus !== input.to &&
    input.messaging
  ) {
    const outcome = await tx.outcome.findUnique({
      where: { id: item.outcomeId },
      select: { botId: true, cancelledAt: true, acceptedAt: true },
    });
    if (outcome && !outcome.cancelledAt && !outcome.acceptedAt && (await hasActivePlannerRole(tx))) {
      const existingOpen = await tx.outcomeThreadTurn.findFirst({
        where: { thread: { outcomeId: item.outcomeId }, purpose: "replan", workItemId: item.id, status: { in: ["queued", "running"] } },
        select: { id: true },
      });
      if (!existingOpen) {
        const resolved = await resolveOutcomeRole(tx, "planner", outcome.botId);
        const plannerBotId = resolved.botId ?? outcome.botId;
        const label = item.planKey ? `${item.title} (${item.planKey})` : item.title;
        const triggerText = `Task "${label}" (workItemId=${item.id}) transitioned to ${input.to}: ${input.reason}`;
        await enqueueOutcomeThreadTurn(tx, input.messaging, {
          outcomeId: item.outcomeId,
          botId: plannerBotId,
          purpose: "replan",
          text: triggerText,
          actor: "system:task_failed",
          clientRequestId: `replan:${item.id}:${input.to}:${input.idempotencyKey ?? now.getTime()}`,
          model: resolved.model,
          workItemId: item.id,
        });
        await appendOutcomeEvent(tx, "outcome.replan.requested", item.outcomeId, {
          actor: "system:task_failed",
          workItemId: item.id,
          idempotencyKey: input.idempotencyKey,
          payload: { workItemId: item.id, reason: input.reason },
        });
      }
    }
  }
  await recomputeOutcomeStatus(tx, item.outcomeId, input.actor);
  if (input.idempotencyKey)
    await tx.idempotencyRecord.create({ data: {
      scope, key: input.idempotencyKey, requestHash,
      response: { from: item.status, to: input.to, reason: input.reason },
      status: "completed",
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    } });
}

/** Append an Outcome envelope in the caller's transaction; topic/entityId keep the existing Event layout. */
export function appendOutcomeEvent<T extends OutcomeEventTopic>(
  tx: Prisma.TransactionClient,
  topic: T,
  outcomeId: string,
  input: {
    actor: ActorRef;
    payload: OutcomeEventPayloads[T];
    contractRevision?: number;
    workItemId?: string;
    runId?: string;
    idempotencyKey?: string;
  }
) {
  if (!isOutcomeEventTopic(topic)) throw new TypeError(`Unknown Outcome event topic: ${topic}`);
  const eventId = crypto.randomUUID();
  return tx.event.create({ data: {
    topic,
    entityId: outcomeId,
    payload: JSON.parse(JSON.stringify({
      eventId,
      schemaVersion: OUTCOME_EVENT_SCHEMA_VERSION,
      occurredAt: new Date().toISOString(),
      ...(input.contractRevision === undefined ? {} : { contractRevision: input.contractRevision }),
      ...(input.workItemId ? { workItemId: input.workItemId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      actorId: input.actor,
      correlationId: input.idempotencyKey ?? eventId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      payload: input.payload,
    })),
  } });
}

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/**
 * Computes agent work items that are waiting (`queued` with no Run started) and blocked by a failed or cancelled
 * upstream dependency (directly or transitively), so they do not keep the Outcome artificially `running`.
 */
function blockedByFailedDependencies(
  agent: ReadonlyArray<{
    id: string;
    status: string;
    dependsOn?: unknown;
    reworkOfWorkItemId?: string | null;
    rootRunId?: string | null;
  }>
): Set<string> {
  const byId = new Map(agent.map((item) => [item.id, item]));
  const latestReworkByParent = new Map<string, { status: string }>();
  for (const item of agent) {
    if (item.reworkOfWorkItemId) latestReworkByParent.set(item.reworkOfWorkItemId, item);
  }
  const blocked = new Set<string>();
  const visiting = new Set<string>();
  const isBlocked = (id: string): boolean => {
    if (blocked.has(id)) return true;
    const item = byId.get(id);
    if (!item || visiting.has(id)) return false;
    if (item.status !== "queued" || item.rootRunId) return false;
    visiting.add(id);
    for (const depId of asStringList(item.dependsOn)) {
      const dep = byId.get(depId);
      if (!dep) continue;
      const rework = latestReworkByParent.get(dep.id);
      if (
        dep.status === "failed" ||
        dep.status === "cancelled" ||
        rework?.status === "failed" ||
        rework?.status === "cancelled" ||
        isBlocked(dep.id)
      ) {
        blocked.add(id);
        visiting.delete(id);
        return true;
      }
    }
    visiting.delete(id);
    return false;
  };
  for (const item of agent) isBlocked(item.id);
  return blocked;
}

/**
 * Derives the Outcome status from its facts in the priority order of specs/004 design §42.3 and 004.9 §4.2.
 */
export async function recomputeOutcomeStatus(tx: Prisma.TransactionClient, outcomeId: string, actor: ActorRef): Promise<OutcomeStatus> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`;
  const outcome = await tx.outcome.findUniqueOrThrow({
    where: { id: outcomeId },
    include: {
      currentRevision: { select: { id: true, status: true, revision: true } },
      workItems: {
        select: {
          id: true,
          executorType: true,
          status: true,
          statusReason: true,
          contractRevisionId: true,
          ordinal: true,
          dependsOn: true,
          reworkOfWorkItemId: true,
          rootRunId: true,
        },
      },
    },
  });
  const current = outcome.currentRevision;
  const items = outcome.workItems.filter((item) => item.contractRevisionId === current?.id);
  const agent = items.filter((item) => item.executorType === "agent");
  const human = items.filter((item) => item.executorType === "human");
  const candidates = new Set<OutcomeStatus>();
  if (outcome.cancelledAt) candidates.add("cancelled");
  if (outcome.acceptedAt) candidates.add("accepted");
  if (agent.some((item) => item.status === "waiting_decision")) candidates.add("decision_pending");
  // A tracked task has no work item to wait on, so its own owner decision (specs/004.7) marks it pending.
  if (outcome.trackingMode === "tracked" && current && await tx.outcomeDecision.count({ where: {
    outcomeId, contractRevisionId: current.id, workItemId: null, status: { in: ["open", "presented"] },
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  } })) candidates.add("decision_pending");
  if (agent.some((item) => item.status === "waiting_human") || human.some((item) => (ACTIVE_HUMAN_STATES as readonly string[]).includes(item.status)))
    candidates.add("human_action_pending");
  const blockedQueued = blockedByFailedDependencies(agent);
  const agentActive = agent.some(
    (item) => (ACTIVE_AGENT_STATES as readonly string[]).includes(item.status) && !blockedQueued.has(item.id)
  );
  const hasFailureOrReview = agent.some((item) => item.status === "failed" || item.status === "needs_review");
  const replanActive =
    current?.status === "approved" &&
    hasFailureOrReview &&
    (await tx.outcomeThreadTurn.count({
      where: { thread: { outcomeId }, purpose: "replan", status: { in: ["queued", "running"] } },
    })) > 0;
  const reviewTaskPending =
    current?.status === "approved" &&
    agent.some((item) => item.status === "completed") &&
    (await tx.outcomeThreadTurn.count({
      where: { thread: { outcomeId }, purpose: "review_task", status: { in: ["queued", "running"] } },
    })) > 0;
  const unsupersededFailed = agent.some(
    (failed) =>
      (failed.status === "failed" || (failed.status === "cancelled" && failed.statusReason === "outcome_stopped")) &&
      !agent.some(
        (later) =>
          (later.ordinal ?? 0) > (failed.ordinal ?? 0) &&
          !blockedQueued.has(later.id) &&
          !["failed", "cancelled"].includes(later.status)
      )
  );
  if (agentActive || replanActive || reviewTaskPending) candidates.add("running");
  else if (unsupersededFailed) candidates.add("failed");
  else if (agent.some((item) => item.status === "completed") || human.some((item) => item.status === "accepted"))
    candidates.add("review_pending");
  else if (agent.length && agent.every((item) => ["failed", "cancelled"].includes(item.status)) && agent.some((item) => item.status === "failed"))
    candidates.add("failed");
  if (current?.status === "approved") candidates.add("approved");
  if (current?.status === "pending_approval") candidates.add("pending_approval");
  if (!current || current.status === "draft") candidates.add("draft");
  // A pending revision N+1 takes the Outcome back to approval even while revision N work is recorded.
  if (current?.status === "pending_approval") {
    for (const status of ["running", "review_pending", "failed", "approved"] as const) candidates.delete(status);
  }
  // While the goal's planning thread is working on the plan (a new goal, or the owner's words about a pending or
  // unsaved plan) the goal is in planning. When that turn ends, the facts alone decide again.
  if ((!current || current.status === "draft" || current.status === "pending_approval") && await tx.outcomeThreadTurn.count({
    where: { thread: { outcomeId }, purpose: { in: ["plan", "owner_message"] }, status: { in: ["queued", "running"] } },
  })) {
    candidates.delete("pending_approval");
    candidates.delete("draft");
    candidates.add("planning");
  }
  const status = OUTCOME_STATUS_PRIORITY.find((candidate) => candidates.has(candidate)) ?? "draft";
  const base = OUTCOME_STATUS_PRIORITY.find((candidate) => candidates.has(candidate) && !SIDE_STATUSES.includes(candidate)) ?? "draft";
  const resumeStatus = SIDE_STATUSES.includes(status) ? base : null;
  if (status !== outcome.status || resumeStatus !== outcome.resumeStatus) {
    await tx.outcome.update({ where: { id: outcomeId }, data: { status, resumeStatus } });
    if (status !== outcome.status) {
      await appendOutcomeEvent(tx, "outcome.status_changed", outcomeId, { actor, payload: { from: outcome.status, to: status } });
      // Clients never receive `outcome.*` events, so goal lists and badges follow this signal instead.
      await tx.event.create({ data: { topic: "goal.status.changed", entityId: outcomeId, payload: { outcomeId, from: outcome.status, to: status } } });
    }
  }
  return status;
}
