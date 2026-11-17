import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { OutcomeError } from "@outcomego/contracts/outcomes";
import type { Prisma } from "@outcomego/db";
import type { AgentMessaging } from "./index";
import { finalRunMessage, runGroupBackgroundWorkRunning } from "./automation-results";
import { appendOutcomeEvent, recomputeOutcomeStatus, transitionWorkItem } from "./outcome-state";

export interface EnqueueOutcomeTurnInput {
  workItemId: string;
  content: string;
  reason: "start" | "decision_resolved" | "human_action_accepted" | "recovery" | "rework";
  clientId: string;
}
export type EnqueueOutcomeTurnResult =
  | { status: "enqueued"; runId: string }
  | { status: "queued_for_capacity" };
export interface OutcomeThreadRuntime {
  messaging: AgentMessaging;
  workspaceRoot?: string;
}
const actor = "system:outcome-runtime" as const;
const terminal = ["completed", "failed", "cancelled", "accepted"];
const activeRuns = ["queued", "running"] as const;
const scopeFor = (id: string) => `outcome-turn:${id}`;
const ttl = () => new Date(Date.now() + 30 * 24 * 60 * 60_000);

async function lockWorkItem(tx: Prisma.TransactionClient, workItemId: string) {
  const found = await tx.outcomeWorkItem.findUnique({ where: { id: workItemId }, select: { outcomeId: true } });
  if (!found) throw new OutcomeError("work_item_not_found", "Work item not found");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-work-item:${workItemId}`}))`;
  return tx.outcomeWorkItem.findUniqueOrThrow({
    where: { id: workItemId }, include: { outcome: true, contractRevision: true },
  });
}

/** Reserve capacity and enqueue only through the existing transactional mailbox. */
export async function enqueueOutcomeTurn(
  tx: Prisma.TransactionClient, messaging: AgentMessaging, input: EnqueueOutcomeTurnInput
): Promise<EnqueueOutcomeTurnResult> {
  const item = await lockWorkItem(tx, input.workItemId);
  const scope = scopeFor(item.id);
  const requestHash = createHash("sha256").update(JSON.stringify({ workItemId: input.workItemId, content: input.content, reason: input.reason, clientId: input.clientId })).digest("hex");
  const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: input.clientId } } });
  if (previous && previous.requestHash !== requestHash)
    throw new OutcomeError("idempotency_conflict", "This outcome turn ID was already used for different input");
  if (previous?.status === "completed") return previous.response as unknown as EnqueueOutcomeTurnResult;
  if (item.executorType !== "agent" || terminal.includes(item.status) || item.outcome.cancelledAt || item.outcome.acceptedAt)
    throw new OutcomeError("invalid_outcome_transition", "This work item cannot run", { currentStatus: item.status });
  if (!item.contractRevision.approvedAt || !["approved", "superseded"].includes(item.contractRevision.status))
    throw new OutcomeError("contract_revision_not_approved", "The work item's contract must be approved");
  // A capacity wait must never lose the content of a resolved decision or human receipt.
  if (!previous) await tx.idempotencyRecord.create({ data: {
    scope, key: input.clientId, requestHash, response: JSON.parse(JSON.stringify({ input })), status: "processing", expiresAt: ttl(),
  } });
  const dependencies = Array.isArray(item.dependsOn) ? item.dependsOn.filter((id): id is string => typeof id === "string") : [];
  if (dependencies.length && await tx.outcomeWorkItem.count({
    where: { id: { in: dependencies }, outcomeId: item.outcomeId, status: { in: ["completed", "accepted"] } },
  }) !== dependencies.length) return { status: "queued_for_capacity" };
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-capacity:${item.botId}`}))`;
  const reserved = await tx.outcomeWorkItem.count({
    where: { botId: item.botId, executorType: "agent", id: { not: item.id },
      OR: [{ status: "running" }, { runs: { some: { status: { in: [...activeRuns] } } } }],
    },
  });
  if (reserved >= 2) return { status: "queued_for_capacity" };
  const bot = await tx.bot.findUnique({ where: { id: item.botId }, include: { conversation: true } });
  if (bot?.status !== "active" || !bot.conversation) {
    const to = bot && bot.status === "provisioning" ? "retry_pending" : "failed";
    if (item.status !== to && ["queued", "running", "retry_pending"].includes(item.status))
      await transitionWorkItem(tx, { workItemId: item.id, to, reason: "bot_not_runnable", actor });
    return { status: "queued_for_capacity" };
  }
  const channel = await tx.channel.findFirst({
    where: { kind: "bot_dm", archivedAt: null, members: { some: { botId: item.botId } } }, orderBy: { createdAt: "asc" },
  });
  if (!channel) {
    if (["queued", "running"].includes(item.status)) await transitionWorkItem(tx, { workItemId: item.id, to: "retry_pending", reason: "bot_conversation_unavailable", actor });
    return { status: "queued_for_capacity" };
  }
  const wake = await messaging.enqueueWake(tx, {
    botId: item.botId, channelId: channel.id, origin: "outcome", outcomeWorkItemId: item.id,
    type: "outcome.work_item", content: input.content, clientId: input.clientId, priority: 280, includeAttachmentPaths: false,
  });
  if (!item.rootRunId) await tx.outcomeWorkItem.update({ where: { id: item.id }, data: { rootRunId: wake.run.id } });
  // Initial work becomes running only when the worker takes its lease.
  if (item.status !== "queued" && item.status !== "running")
    await transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: input.reason, actor });
  const result = { status: "enqueued" as const, runId: wake.run.id };
  await tx.idempotencyRecord.update({
    where: { scope_key: { scope, key: input.clientId } }, data: { status: "completed", response: result },
  });
  return result;
}

/** Try-lock other Outcomes so a drain cannot reverse Outcome -> WorkItem lock order. */
export async function dispatchQueuedOutcomeWorkItems(tx: Prisma.TransactionClient, messaging: AgentMessaging, botId: string) {
  const items = await tx.$queryRaw<Array<{ id: string; outcomeId: string }>>`
    SELECT w.id, w."outcomeId" FROM "outcomego_outcome_work_item" w
    JOIN "outcomego_outcome" o ON o.id = w."outcomeId"
    WHERE w."botId" = ${botId}::uuid AND w."executorType" = 'agent'
      AND w.status NOT IN ('completed', 'failed', 'cancelled')
      AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "outcomego_idempotency_record" r
        WHERE r.scope = 'outcome-turn:' || w.id::text AND r.status = 'processing')
    ORDER BY w."createdAt", w.id LIMIT 100`;
  for (const item of items) {
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${`outcome:${item.outcomeId}`})) AS locked`;
    if (!lock?.locked) continue;
    const pending = await tx.idempotencyRecord.findFirst({
      where: { scope: scopeFor(item.id), status: "processing" }, orderBy: { createdAt: "asc" },
    });
    const input = (pending?.response as { input?: EnqueueOutcomeTurnInput } | null)?.input;
    if (input) await enqueueOutcomeTurn(tx, messaging, input);
  }
}

async function outputFiles(workspaceRoot: string, directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(join(workspaceRoot, directory), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await outputFiles(workspaceRoot, path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}

/**
 * Two arguments settle persisted facts. Production callers also pass runtime to
 * inventory files and drain capacity in the same transaction. Periodic worker
 * reconciliation repeats with runtime after a facts-only call or missed wake.
 */
export async function settleOutcomeWorkItem(tx: Prisma.TransactionClient, runId: string, runtime?: OutcomeThreadRuntime): Promise<void> {
  const run = await tx.run.findUnique({ where: { id: runId }, select: { outcomeWorkItemId: true } });
  if (!run?.outcomeWorkItemId) return;
  const item = await lockWorkItem(tx, run.outcomeWorkItemId);
  if (item.executorType !== "agent" || ["waiting_decision", "waiting_human", "failed", "cancelled", "needs_review"].includes(item.status)) return;
  const family = await tx.run.findMany({ where: { outcomeWorkItemId: item.id }, orderBy: [{ startedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }] });
  if (!family.length || family.some((entry) => activeRuns.includes(entry.status as typeof activeRuns[number]))) return;
  const ids = family.map((entry) => entry.id);
  if (await runGroupBackgroundWorkRunning(tx, item.botId, ids)) return;
  const folded = await tx.event.findMany({
    where: { topic: "inbox.completed", OR: ids.map((id) => ({ payload: { path: ["runId"], equals: id } })) }, select: { payload: true },
  });
  const receipts = new Set(folded.flatMap((event) => {
    const payload = event.payload as { runId?: string; batchedIntoRunId?: string };
    return payload.batchedIntoRunId && payload.runId ? [payload.runId] : [];
  }));
  const final = family.find((entry) => !receipts.has(entry.id));
  if (!final) return;
  const to = final.status === "completed" ? "completed" : final.status === "cancelled" ? "cancelled"
    : final.status === "failed" ? "failed" : "needs_review";
  if (to === "completed") {
    const message = await finalRunMessage(tx, final.id);
    const outputs: Array<{ dedupeKey: string; kind: "final_result" | "file"; content?: string; contentRef?: string; title: string }> = [];
    if (message) outputs.push({ dedupeKey: `final:${item.id}`, kind: "final_result", content: message, title: item.title });
    if (runtime) {
      const directory = `outcomes/${item.outcomeId}/${item.id}`;
      for (const path of await outputFiles(runtime.workspaceRoot ?? runtime.messaging.agentData.workspaceRoot, directory))
        outputs.push({ dedupeKey: `file:${item.id}:${path}`, kind: "file", contentRef: path, title: posix.basename(path) });
    }
    for (const output of outputs) {
      if (await tx.outcomeOutput.findUnique({ where: { dedupeKey: output.dedupeKey } })) continue;
      const created = await tx.outcomeOutput.create({ data: { outcomeId: item.outcomeId, workItemId: item.id, runId: final.id, ...output } });
      await appendOutcomeEvent(tx, "outcome.output.recorded", item.outcomeId, {
        actor, workItemId: item.id, runId: final.id, contractRevision: item.contractRevision.revision,
        idempotencyKey: output.dedupeKey, payload: { outputId: created.id, kind: output.kind },
      });
    }
  }
  if (item.status !== to) {
    // Terminal runs recovered before claim bookkeeping still follow the shared state machine.
    if (item.status === "queued") await transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "reconciled_run", actor });
    await transitionWorkItem(tx, { workItemId: item.id, to, reason: `run_${final.status}`, actor, idempotencyKey: `settle:${final.id}` });
  }
  const status = await recomputeOutcomeStatus(tx, item.outcomeId, actor);
  if (status === "review_pending" && await tx.outcomeOutput.count({ where: { outcomeId: item.outcomeId, workItem: { contractRevisionId: item.contractRevisionId } } })) {
    const key = `review-required:${item.contractRevisionId}`;
    const existing = await tx.event.findFirst({ where: { topic: "outcome.review.required", entityId: item.outcomeId, payload: { path: ["idempotencyKey"], equals: key } } });
    if (!existing) {
      const [criteria, items] = await Promise.all([
        tx.outcomeAcceptanceCriterion.findMany({ where: { contractRevisionId: item.contractRevisionId }, select: { id: true } }),
        tx.outcomeWorkItem.findMany({ where: { outcomeId: item.outcomeId, contractRevisionId: item.contractRevisionId, status: "completed" }, select: { id: true } }),
      ]);
      await appendOutcomeEvent(tx, "outcome.review.required", item.outcomeId, {
        actor, contractRevision: item.contractRevision.revision, idempotencyKey: key,
        payload: { criterionIds: criteria.map((entry) => entry.id), workItemIds: items.map((entry) => entry.id) },
      });
    }
  }
  if (runtime) await dispatchQueuedOutcomeWorkItems(tx, runtime.messaging, item.botId);
}

/** The approved execution snapshot, separate from all main-chat history. */
export async function outcomeRunContext(db: Prisma.TransactionClient, botId: string, workItemId: string): Promise<string> {
  const item = await db.outcomeWorkItem.findFirst({
    where: { id: workItemId, botId, executorType: "agent" },
    include: { contractRevision: { include: { criteria: { orderBy: { ordinal: "asc" } } } } },
  });
  if (!item || !item.contractRevision.approvedAt || !["approved", "superseded"].includes(item.contractRevision.status))
    throw new OutcomeError("contract_revision_not_approved", "An outcome thread requires its approved contract");
  return [
    "## Outcome execution context",
    JSON.stringify({
      outcome: { id: item.outcomeId, contractRevision: item.contractRevision.revision, goal: item.contractRevision.goal,
        acceptance: item.contractRevision.criteria.map(({ id, statement, required }) => ({ id, statement, required })), boundaries: item.contractRevision.boundaries },
      execution: { workItemId: item.id, outputRequirements: [`Write deliverable files to outcomes/${item.outcomeId}/${item.id}/`] },
    }),
    "Work quietly in this isolated Outcome thread. End with a complete final assistant result. Never publish progress or results in the main conversation. Use RequestOutcomeDecision for decisions and RequestHumanAction for human work when available. Use WakeParent only when the main conversation must handle a platform blocker.",
  ].join("\n");
}
