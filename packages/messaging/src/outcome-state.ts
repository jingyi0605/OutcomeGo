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
    payload: { from: item.status, to: input.to, reason: input.reason },
  });
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

/**
 * Derives the Outcome status from its facts in the priority order of specs/004 design §42.3 and records the
 * status a side state (decision, human action, pause) should return to.
 */
export async function recomputeOutcomeStatus(tx: Prisma.TransactionClient, outcomeId: string, actor: ActorRef): Promise<OutcomeStatus> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`;
  const outcome = await tx.outcome.findUniqueOrThrow({
    where: { id: outcomeId },
    include: {
      currentRevision: { select: { id: true, status: true } },
      workItems: { select: { executorType: true, status: true, contractRevisionId: true } },
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
  if (agent.some((item) => item.status === "waiting_human") || human.some((item) => (ACTIVE_HUMAN_STATES as readonly string[]).includes(item.status)))
    candidates.add("human_action_pending");
  const agentActive = agent.some((item) => (ACTIVE_AGENT_STATES as readonly string[]).includes(item.status));
  if (agentActive) candidates.add("running");
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
  const status = OUTCOME_STATUS_PRIORITY.find((candidate) => candidates.has(candidate)) ?? "draft";
  const base = OUTCOME_STATUS_PRIORITY.find((candidate) => candidates.has(candidate) && !SIDE_STATUSES.includes(candidate)) ?? "draft";
  const resumeStatus = SIDE_STATUSES.includes(status) ? base : null;
  if (status !== outcome.status || resumeStatus !== outcome.resumeStatus) {
    await tx.outcome.update({ where: { id: outcomeId }, data: { status, resumeStatus } });
    if (status !== outcome.status)
      await appendOutcomeEvent(tx, "outcome.status_changed", outcomeId, { actor, payload: { from: outcome.status, to: status } });
  }
  return status;
}

