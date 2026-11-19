import type { Prisma, PrismaClient } from "@outcomego/db";
import type { AgentMessaging } from "./index";
import { pendingAutomationShells } from "./automation-results";
import { taskProgress } from "./task-progress";
import { appendOutcomeEvent, transitionWorkItem } from "./outcome-state";
import { dispatchQueuedOutcomeWorkItems, enqueueOutcomeTurn, settleOutcomeWorkItem, type OutcomeThreadRuntime } from "./outcome-threads";
import { outcomeDispatchEnabled } from "./outcome-availability";
import { createOutcomeDecision, isOutcomeDecisionRevisionActive } from "./outcome-decisions";

const actor = "system:outcome-recovery" as const;
const terminal = ["completed", "failed", "cancelled", "accepted"];
const ttl = () => new Date(Date.now() + 30 * 24 * 60 * 60_000);
export const OUTCOME_RECOVERY_BATCH_SIZE = 100;
export const OUTCOME_RECOVERY_PROMPT = "The previous turn was interrupted. Continue in this same Outcome thread. First inspect the transcript, existing outputs, delegated tasks and authoritative receipts to verify work already completed. Do not repeat sends, submissions or other external actions whose results are uncertain. Ask for a Decision if a result cannot be verified. Preserve the approved Contract and keep all work out of the main conversation.";

/** The thread is told about a task the runtime parked for its decision, because that task will never resume by itself. */
export function outcomeBlockedTaskPrompt(task: { description: string; id: string }, progress: { summary: string; remaining: readonly string[]; nextAction?: string }) {
  return `A delegated task in this Outcome thread is blocked and will not continue on its own.\nTask: ${task.description}\nTask ID: sand-subagent-${task.id}\nWhy it stopped: ${progress.summary}\nUnfinished: ${progress.remaining.join("; ") || "none recorded"}\n${progress.nextAction ? `Suggested next step: ${progress.nextAction}\n` : ""}First inspect the transcript, existing outputs and authoritative receipts to verify what already completed. Then either dispatch a fresh task for only the remaining work (stop the obsolete parked task so no duplicate goal remains), finish it yourself, or ask for a Decision if the result cannot be verified. Do not repeat sends, submissions or other external actions whose results are uncertain. Preserve the approved Contract and keep all work out of the main conversation.`;
}

export type OutcomeNextFact =
  | { type: "decision"; decisionId: string }
  | { type: "human"; workItemId: string }
  | { type: "completed"; workItemId: string }
  | { type: "interrupted"; workItemId: string; decisionId?: string }
  | { type: "unsupported"; actionType: string };

/** Routes durable workflow facts, never tool names or model-supplied permissions. */
export function routeOutcomeNextStep(fact: OutcomeNextFact) {
  switch (fact.type) {
    case "decision": return { kind: "NEEDS_USER_DECISION" as const, decisionId: fact.decisionId };
    case "human": return { kind: "MANUAL_ACTION" as const, workItemId: fact.workItemId };
    case "completed": return { kind: "ALLOW" as const, workItemId: fact.workItemId };
    case "interrupted": return fact.decisionId
      ? { kind: "NEEDS_USER_DECISION" as const, decisionId: fact.decisionId }
      : { kind: "NEEDS_USER_DECISION" as const, workItemId: fact.workItemId, reason: "external_result_unknown" };
    case "unsupported": return { kind: "UNSUPPORTED" as const, actionType: fact.actionType, reason: "No implemented workflow path" };
  }
}

export interface OutcomeRecoveryRuntime extends OutcomeThreadRuntime {
  /** Must confirm the exact old computer turn stopped before an expired owner can be replaced. */
  confirmedStoppedRunIds?: ReadonlySet<string>;
}
export type OutcomeRecoveryAction = "resettle" | "resume_queued" | "needs_review" | "cancelled";

/** The Outcome lock serializes classification with settlement, revision changes and continuation producers. */
export async function recoverOutcomeWorkItem(tx: Prisma.TransactionClient, workItemId: string, runtime: OutcomeRecoveryRuntime): Promise<OutcomeRecoveryAction | null> {
  const found = await tx.outcomeWorkItem.findUnique({ where: { id: workItemId }, select: { outcomeId: true } });
  if (!found) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-work-item:${workItemId}`}))`;
  const item = await tx.outcomeWorkItem.findUniqueOrThrow({ where: { id: workItemId }, include: { outcome: true, contractRevision: true } });
  if (item.executorType !== "agent") return null;
  const family = await tx.run.findMany({
    where: { outcomeWorkItemId: item.id, origin: "outcome" },
    orderBy: [{ startedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
  });
  if (item.status === "cancelled") {
    // Approval can cancel an unstarted item while its root mailbox is still pending.
    const queued = family.filter(run => run.status === "queued" && !run.startedAt).map(run => run.id);
    if (queued.length) {
      await tx.run.updateMany({ where: { id: { in: queued }, status: "queued", startedAt: null }, data: { status: "cancelled", completedAt: new Date(), error: { code: "contract_revision_superseded" } } });
      await tx.inboxEvent.updateMany({ where: { runId: { in: queued }, status: "pending" }, data: { status: "completed", completedAt: new Date() } });
    }
    return null;
  }
  if (["failed", "accepted"].includes(item.status) || item.outcome.acceptedAt) return null;
  const now = new Date();
  const active = family.filter(run => ["queued", "running"].includes(run.status));
  // A live owner, including one on an older approved snapshot, is never displaced.
  if (active.length && await tx.botRunLease.count({ where: { runId: { in: active.map(run => run.id) }, expiresAt: { gt: now } } })) return null;
  const stale = [];
  for (const run of active) {
    const inbox = await tx.inboxEvent.findFirst({ where: { runId: run.id }, select: { status: true } });
    if (run.status === "queued" && inbox?.status === "pending") continue;
    if (!runtime.confirmedStoppedRunIds?.has(run.id)) return null;
    stale.push(run.id);
  }
  if (stale.length) {
    await tx.run.updateMany({ where: { id: { in: stale }, status: { in: ["queued", "running"] } }, data: { status: "interrupted", completedAt: now, error: { code: "worker_disconnected" } } });
    await tx.inboxEvent.updateMany({ where: { runId: { in: stale }, status: { in: ["pending", "processing"] } }, data: { status: "completed", completedAt: now } });
    await tx.botRunLease.deleteMany({ where: { runId: { in: stale }, expiresAt: { lte: now } } });
    // Reload the authoritative family after fencing the old executor.
    return recoverOutcomeWorkItem(tx, item.id, runtime);
  }
  const latest = family[0];
  const revisionActive = Boolean(item.contractRevision.approvedAt) && await isOutcomeDecisionRevisionActive(tx, item.outcomeId, item.contractRevisionId, item.id);
  const key = `recovery:${item.id}:${latest?.id ?? "unsubmitted"}:${revisionActive ? "active" : "stale"}:${item.outcome.cancelledAt ? "cancelled" : "open"}`;
  const scope = `outcome-recovery:${item.outcomeId}`;
  const record = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
  const write = async (action: OutcomeRecoveryAction, reason: string, recordKey = key) => {
    await appendOutcomeEvent(tx, "outcome.recovered", item.outcomeId, {
      actor, workItemId: item.id, runId: latest?.id, contractRevision: item.contractRevision.revision,
      idempotencyKey: recordKey, payload: { workItemId: item.id, action, reason },
    });
    await tx.idempotencyRecord.create({ data: { scope, key: recordKey, requestHash: recordKey, status: "completed", response: { action, reason }, expiresAt: ttl() } });
    return action;
  };
  if (!terminal.includes(item.status) && (item.outcome.cancelledAt || !revisionActive)) {
    // Never cancel a physical executor merely because an expired lease disappeared.
    if (active.some(run => run.status === "running")) return null;
    await transitionWorkItem(tx, { workItemId: item.id, to: "cancelled", reason: "contract_revision_superseded", actor });
    const queued = active.map(run => run.id);
    await tx.run.updateMany({ where: { id: { in: queued }, status: "queued" }, data: { status: "cancelled", completedAt: now, error: { code: "contract_revision_superseded" } } });
    await tx.inboxEvent.updateMany({ where: { runId: { in: queued }, status: "pending" }, data: { status: "completed", completedAt: now } });
    return write("cancelled", "contract_revision_superseded");
  }
  if (active.length || ["waiting_decision", "waiting_human"].includes(item.status)) return null;
  // WakeParent deliberately parks this thread until the main conversation resolves
  // its platform blocker; a restart must not turn that handoff into an automatic retry.
  if (item.status === "needs_review" && item.statusReason === "platform_handoff") return null;
  if (record) {
    await dispatchQueuedOutcomeWorkItems(tx, runtime.messaging, item.botId);
    return null;
  }
  // The family includes Task/shell continuations; do not recover while background work still owns it.
  const allRuns = await tx.run.findMany({ where: { outcomeWorkItemId: item.id }, select: { id: true, status: true } });
  if (allRuns.some(run => ["queued", "running"].includes(run.status))) return null;
  const familyIds = allRuns.map(run => run.id);
  // A task parked as blocked has no scheduled check and no live worker, so it never reports again.
  // If its wake to this thread was lost (for example across a restart), nothing else would continue the goal.
  const parked = (await tx.subagent.findMany({
    where: { parentRunId: { in: familyIds }, status: "waiting", nextCheckAt: null },
    select: { id: true, description: true, progress: true, progressRevision: true },
  })).flatMap(task => {
    const progress = taskProgress(task.progress);
    return progress?.state === "blocked" ? [{ task, progress }] : [];
  });
  const stillWorking = await tx.subagent.count({
    where: { parentRunId: { in: familyIds }, status: { in: ["provisioning", "queued", "running", "waiting"] }, id: { notIn: parked.map(({ task }) => task.id) } },
  }) > 0 || await pendingAutomationShells(tx, item.botId, familyIds);
  if (stillWorking) return null;
  if (parked.length && item.status === "running" && outcomeDispatchEnabled()) {
    const { task, progress } = parked[0]!;
    // One dedicated resume per blocked state. When that resumed turn is itself cut off (another restart),
    // the ordinary interrupted-thread recovery below continues it; returning here would strand the goal.
    const blockedKey = `recovery-blocked:${item.id}:${task.id}:${task.progressRevision}`;
    if (!await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: blockedKey } } })) {
      await enqueueOutcomeTurn(tx, runtime.messaging, { workItemId: item.id, content: outcomeBlockedTaskPrompt(task, progress), reason: "recovery", clientId: blockedKey });
      return write("resume_queued", "blocked_task_recovery", blockedKey);
    }
  }
  if (latest?.status === "interrupted" && item.recoveryCount < 2 && !["external_result_unknown", "external_receipt_unknown", "state_inconsistent"].includes(item.statusReason ?? "")) {
    if (!outcomeDispatchEnabled()) return null;
    if (item.status === "queued" || item.status === "retry_pending") await transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "interrupted_thread_recovery", actor });
    await tx.outcomeWorkItem.update({ where: { id: item.id }, data: { recoveryCount: { increment: 1 }, retryCount: { increment: 1 } } });
    await enqueueOutcomeTurn(tx, runtime.messaging, { workItemId: item.id, content: OUTCOME_RECOVERY_PROMPT, reason: "recovery", clientId: key });
    return write("resume_queued", "interrupted_thread_recovery");
  }
  if (latest && ["completed", "failed", "cancelled"].includes(latest.status) && !["external_result_unknown", "external_receipt_unknown", "state_inconsistent"].includes(item.statusReason ?? "")) {
    await settleOutcomeWorkItem(tx, latest.id, runtime);
    const settled = await tx.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } });
    if (settled.status !== item.status) return write("resettle", `run_${latest.status}`);
    return null;
  }
  if (!latest && ["queued", "retry_pending"].includes(item.status)) {
    await dispatchQueuedOutcomeWorkItems(tx, runtime.messaging, item.botId);
    return null;
  }
  if (terminal.includes(item.status)) return null;
  const reason = latest?.status === "interrupted" || ["external_result_unknown", "external_receipt_unknown"].includes(item.statusReason ?? "") ? "external_result_unknown" : "state_inconsistent";
  // Shared transitions deliberately require queued/retry_pending -> running first.
  if (["queued", "retry_pending"].includes(item.status)) await transitionWorkItem(tx, { workItemId: item.id, to: "running", reason, actor });
  if (item.status !== "needs_review") await transitionWorkItem(tx, { workItemId: item.id, to: "needs_review", reason, actor });
  const existing = await tx.outcomeDecision.findUnique({ where: { openWorkItemId: item.id } });
  if (!existing) {
    await createOutcomeDecision(tx, {
      outcomeId: item.outcomeId, contractRevisionId: item.contractRevisionId, workItemId: item.id, runId: latest?.id,
      reasonCode: reason,
      completedSummary: "Existing outputs and receipts are preserved.",
      problemSummary: reason === "external_result_unknown" ? "Repeated interruptions left the external result unconfirmed." : "The stored work item and run states require reconciliation.",
      nextStepSummary: "Verify existing results, then choose whether to continue or cancel this branch.",
      options: [
        { id: "retry", label: "Verify and continue", consequence: "Continue in the same thread after verifying completed work.", resolutionEffect: "plan_only", source: "runtime" },
        { id: "cancel", label: "Cancel branch", consequence: "Cancel this work item and preserve its audit history.", resolutionEffect: "cancel_branch", source: "runtime" },
      ],
    }, actor);
  }
  console.error("Outcome recovery requires review", { outcomeId: item.outcomeId, workItemId: item.id, runId: latest?.id, contractRevision: item.contractRevision.revision, reasonCode: reason, correlationId: key });
  return write("needs_review", reason);
}

/** A bounded cursor pass; callers retain the cursor and repeat on the existing lifecycle timer. */
export async function recoverOutcomeWorkItems(prisma: PrismaClient, runtime: OutcomeRecoveryRuntime, after?: string | null, outcomeId?: string) {
  const items = await prisma.outcomeWorkItem.findMany({
    where: { executorType: "agent", status: { in: ["queued", "running", "retry_pending", "waiting_decision", "waiting_human", "needs_review", "completed", "cancelled"] }, ...(after ? { id: { gt: after } } : {}), ...(outcomeId ? { outcomeId } : {}) },
    orderBy: { id: "asc" }, take: OUTCOME_RECOVERY_BATCH_SIZE, select: { id: true, botId: true },
  });
  for (const item of items) await prisma.$transaction(tx => recoverOutcomeWorkItem(tx, item.id, runtime), { timeout: 30_000 });
  for (const botId of new Set(items.map(item => item.botId))) await prisma.$transaction(tx => dispatchQueuedOutcomeWorkItems(tx, runtime.messaging, botId));
  return { nextCursor: items.length === OUTCOME_RECOVERY_BATCH_SIZE ? items.at(-1)!.id : null, scanned: items.length };
}
