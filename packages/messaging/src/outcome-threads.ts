import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import type { ServerInferenceSettings } from "@outcomego/contracts";
import { OutcomeError, parseOutcomePlan } from "@outcomego/contracts/outcomes";
import { Prisma, type PrismaClient } from "@outcomego/db";
import type { AgentMessaging } from "./index";
import { readFeatureSettings } from "./feature-settings";
import { enqueueOutcomeThreadTurn, resolveOutcomeRole } from "./outcome-roles";
import { readOutcomeReviewBatch } from "./outcome-review-batch";
import { finalRunMessage, runGroupBackgroundWorkRunning } from "./automation-results";
import { appendOutcomeEvent, recomputeOutcomeStatus, transitionWorkItem } from "./outcome-state";
import { outcomeDispatchEnabled } from "./outcome-availability";
import { isOutcomeDecisionRevisionActive, outcomeDecisionRevisionActiveSql } from "./outcome-decisions";

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
  if (!await isOutcomeDecisionRevisionActive(tx, item.outcomeId, item.contractRevisionId, item.id))
    throw new OutcomeError("contract_revision_not_approved", "A newer approved revision replaced this execution snapshot");
  // A capacity wait must never lose the content of a resolved decision or human receipt.
  if (!previous) await tx.idempotencyRecord.create({ data: {
    scope, key: input.clientId, requestHash, response: JSON.parse(JSON.stringify({ input })), status: "processing", expiresAt: ttl(),
  } });
  if (!outcomeDispatchEnabled()) return { status: "queued_for_capacity" };
  // Not before its scheduled time (specs/004.10 design §5.2). The intent stays "processing" and is released by
  // the due-time sweep. This sits before the capacity check, so a task that is only waiting for its time never
  // holds one of the bot's slots. The process clock decides here; the sweep's SQL uses the database clock, and
  // any skew only delays a release by one pass, never duplicates or loses it.
  const releasedAt = new Date();
  if (item.scheduledAt && item.scheduledAt.getTime() > releasedAt.getTime()) return { status: "queued_for_capacity" };
  const dependencies = Array.isArray(item.dependsOn) ? item.dependsOn.filter((id): id is string => typeof id === "string") : [];
  if (dependencies.length) {
    if (
      (await tx.outcomeWorkItem.count({
        where: { id: { in: dependencies }, outcomeId: item.outcomeId, status: { in: ["completed", "accepted"] } },
      })) !== dependencies.length
    ) {
      return { status: "queued_for_capacity" };
    }
    const [pendingTaskReviews, unfinishedReworks] = await Promise.all([
      tx.outcomeThreadTurn.count({
        where: {
          thread: { outcomeId: item.outcomeId },
          purpose: "review_task",
          workItemId: { in: dependencies },
          status: { in: ["queued", "running"] },
        },
      }),
      tx.outcomeWorkItem.count({
        where: {
          outcomeId: item.outcomeId,
          reworkOfWorkItemId: { in: dependencies },
          status: { notIn: ["completed", "accepted"] },
        },
      }),
    ]);
    if (pendingTaskReviews > 0 || unfinishedReworks > 0) {
      return { status: "queued_for_capacity" };
    }
  }
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
      await transitionWorkItem(tx, { workItemId: item.id, to, reason: "bot_not_runnable", actor, messaging });
    return { status: "queued_for_capacity" };
  }
  const channel = await tx.channel.findFirst({
    where: { kind: "bot_dm", archivedAt: null, members: { some: { botId: item.botId } } }, orderBy: { createdAt: "asc" },
  });
  if (!channel) {
    if (["queued", "running"].includes(item.status)) await transitionWorkItem(tx, { workItemId: item.id, to: "retry_pending", reason: "bot_conversation_unavailable", actor, messaging });
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
  if (item.scheduledAt) {
    // One line per release of a scheduled task, so a late or missing start can be traced (non-functional 3.3).
    console.info("outcome.scheduled_release " + JSON.stringify({
      workItemId: item.id, scheduledAt: item.scheduledAt.toISOString(), releasedAt: releasedAt.toISOString(),
      delaySeconds: Math.max(0, Math.round((releasedAt.getTime() - item.scheduledAt.getTime()) / 1000)),
    }));
  }
  return result;
}

/** Try-lock other Outcomes or same-Outcome cross-bot dependents so a drain cannot reverse lock order. */
export async function dispatchQueuedOutcomeWorkItems(
  tx: Prisma.TransactionClient,
  messaging: AgentMessaging,
  botId: string,
  outcomeId?: string
) {
  if (!outcomeDispatchEnabled()) return;
  const scopeFilter = outcomeId
    ? Prisma.sql`(w."botId" = ${botId}::uuid OR w."outcomeId" = ${outcomeId}::uuid)`
    : Prisma.sql`w."botId" = ${botId}::uuid`;
  const items = await tx.$queryRaw<Array<{ id: string; outcomeId: string }>>`
    SELECT w.id, w."outcomeId" FROM "outcomego_outcome_work_item" w
    JOIN "outcomego_outcome" o ON o.id = w."outcomeId"
    JOIN "outcomego_outcome_contract_revision" revision ON revision.id = w."contractRevisionId"
    WHERE ${scopeFilter} AND w."executorType" = 'agent'
      AND w.status NOT IN ('completed', 'failed', 'cancelled')
      AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL
      AND revision."approvedAt" IS NOT NULL AND revision.status IN ('approved', 'superseded')
      AND ${outcomeDecisionRevisionActiveSql(Prisma.sql`w."outcomeId"`, Prisma.sql`w."contractRevisionId"`, Prisma.sql`w.id`)}
      AND (w."scheduledAt" IS NULL OR w."scheduledAt" <= now())
      AND EXISTS (SELECT 1 FROM "outcomego_idempotency_record" r
        WHERE r.scope = 'outcome-turn:' || w.id::text AND r.status = 'processing')
    ORDER BY w."createdAt", w.id LIMIT 100`;
  for (const item of items) {
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${`outcome:${item.outcomeId}`})) AS locked`;
    if (!lock?.locked) continue;
    const current = await tx.outcomeWorkItem.findUnique({ where: { id: item.id }, include: { outcome: true, contractRevision: true } });
    if (!current || terminal.includes(current.status) || current.outcome.cancelledAt || current.outcome.acceptedAt || !current.contractRevision.approvedAt
      || !await isOutcomeDecisionRevisionActive(tx, current.outcomeId, current.contractRevisionId, current.id)) continue;
    const pending = await tx.idempotencyRecord.findFirst({
      where: { scope: scopeFor(item.id), status: "processing" }, orderBy: { createdAt: "asc" },
    });
    const input = (pending?.response as { input?: EnqueueOutcomeTurnInput } | null)?.input;
    if (input) await enqueueOutcomeTurn(tx, messaging, input);
  }
}

/**
 * Releases tasks whose scheduled time has arrived (specs/004.10 design §5.2). Only queued agent tasks that are due
 * and still hold a pending start intent are looked at, never every task. Each bot is drained in its own
 * transaction, the same way recovery does it. Safe to repeat: a release goes through the same client ID, so it can
 * never create a second run. State is in the database, so a restart that spans the due time still releases it.
 */
export async function dispatchDueScheduledWorkItems(
  prisma: PrismaClient,
  messaging: AgentMessaging
): Promise<{ bots: number; released: number }> {
  if (!outcomeDispatchEnabled()) return { bots: 0, released: 0 };
  const due = await prisma.$queryRaw<Array<{ id: string; botId: string }>>`
    SELECT w.id, w."botId" FROM "outcomego_outcome_work_item" w
    WHERE w."executorType" = 'agent' AND w.status = 'queued'
      AND w."scheduledAt" IS NOT NULL AND w."scheduledAt" <= now()
      AND EXISTS (SELECT 1 FROM "outcomego_idempotency_record" r
        WHERE r.scope = 'outcome-turn:' || w.id::text AND r.status = 'processing')
    ORDER BY w."scheduledAt", w.id LIMIT 100`;
  const botIds = [...new Set(due.map((row) => row.botId))];
  let released = 0;
  for (const botId of botIds) {
    const before = await prisma.run.count({ where: { botId, origin: "outcome" } });
    await prisma.$transaction((tx) => dispatchQueuedOutcomeWorkItems(tx, messaging, botId), { timeout: 30_000 });
    released += (await prisma.run.count({ where: { botId, origin: "outcome" } })) - before;
  }
  return { bots: botIds.length, released };
}

const TEXT_OUTPUT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".log", ".json", ".csv", ".tsv", ".yaml", ".yml"]);
const outputFileContent = async (workspaceRoot: string, path: string): Promise<string | undefined> => {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (!TEXT_OUTPUT_EXTENSIONS.has(extension)) return undefined;
  try {
    const content = await readFile(join(workspaceRoot, path), "utf8");
    return content.length > 16_000 ? `${content.slice(0, 8_000)}\n[…]\n${content.slice(-8_000)}` : content;
  } catch {
    return undefined;
  }
};

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
 * Emits `outcome.review.required` idempotently per revision and, when a reviewer role is configured,
 * enqueues a holistic preliminary review turn once per results batch.
 */
export async function emitReviewRequiredIfNeeded(
  tx: Prisma.TransactionClient,
  outcomeId: string,
  contractRevisionId: string,
  contractRevisionNumber: number,
  messaging?: AgentMessaging
): Promise<boolean> {
  const latestOutput = await tx.outcomeOutput.findFirst({
    where: { outcomeId, workItem: { contractRevisionId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  const key = `review-required:${contractRevisionId}`;
  const existing = !latestOutput || await tx.event.findFirst({
    where: { topic: "outcome.review.required", entityId: outcomeId, payload: { path: ["idempotencyKey"], equals: key } },
  });
  if (!existing) {
    const [criteria, items] = await Promise.all([
      tx.outcomeAcceptanceCriterion.findMany({ where: { contractRevisionId }, select: { id: true } }),
      tx.outcomeWorkItem.findMany({ where: { outcomeId, contractRevisionId, status: "completed" }, select: { id: true } }),
    ]);
    await appendOutcomeEvent(tx, "outcome.review.required", outcomeId, {
      actor,
      contractRevision: contractRevisionNumber,
      idempotencyKey: key,
      payload: { criterionIds: criteria.map((entry) => entry.id), workItemIds: items.map((entry) => entry.id) },
    });
  }
  if (messaging) await enqueueOutcomePrereviewIfNeeded(tx, messaging, outcomeId, contractRevisionId, contractRevisionNumber);
  return Boolean(latestOutput);
}

/** Run under the outcome lock, shared by settlement and the periodic recovery scan. */
export async function enqueueOutcomePrereviewIfNeeded(
  tx: Prisma.TransactionClient, messaging: AgentMessaging, outcomeId: string,
  contractRevisionId: string, contractRevisionNumber: number,
): Promise<boolean> {
  if (!outcomeDispatchEnabled()) return false;
  const outcome = await tx.outcome.findUnique({
    where: { id: outcomeId },
    select: { botId: true, status: true, trackingMode: true, currentRevisionId: true, cancelledAt: true, acceptedAt: true, currentRevision: { select: { status: true } } },
  });
  if (outcome?.currentRevisionId !== contractRevisionId || outcome.currentRevision?.status !== "approved" || outcome.trackingMode !== "standard" ||
      outcome.cancelledAt || outcome.acceptedAt || !["review_pending", "decision_pending"].includes(outcome.status)) return false;
  const resolved = await resolveOutcomeRole(tx, "reviewer", outcome.botId);
  if (!(resolved.status === "configured" || resolved.status === "model_only") || !resolved.botId) return false;
  const batch = await readOutcomeReviewBatch(tx, outcomeId, contractRevisionId);
  if (!batch.hasResults) return false;
  const duplicate = await tx.outcomeThreadTurn.findFirst({
    where: { thread: { outcomeId, role: "reviewer" }, purpose: "review", clientRequestId: batch.key },
    select: { status: true },
  });
  if (duplicate) return duplicate.status !== "failed";
  try {
    await enqueueOutcomeThreadTurn(tx, messaging, {
      outcomeId,
      botId: resolved.botId,
      purpose: "review",
      text: `Perform holistic preliminary review for contract revision ${contractRevisionNumber}.`,
      actor: "system:outcome-reviewer",
      clientRequestId: batch.key,
      model: resolved.model,
    });
    return true;
  } catch (error) {
    if (!(error instanceof OutcomeError) || error.code !== "bot_not_runnable") throw error;
    return false;
  }
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
      const outputRoot = runtime.workspaceRoot ?? runtime.messaging.agentData.workspaceRoot;
      for (const path of await outputFiles(outputRoot, directory)) {
        const content = await outputFileContent(outputRoot, path);
        outputs.push({
          dedupeKey: `file:${item.id}:${path}`,
          kind: "file",
          contentRef: path,
          title: posix.basename(path),
          ...(content !== undefined ? { content } : {}),
        });
      }
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
    if (item.status === "queued") await transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "reconciled_run", actor, messaging: runtime?.messaging });
    await transitionWorkItem(tx, { workItemId: item.id, to, reason: `run_${final.status}`, actor, idempotencyKey: `settle:${final.id}`, messaging: runtime?.messaging });
  }
  // Enqueue task-level review BEFORE recomputeOutcomeStatus so a pending deliverable review keeps status in running.
  if (
    to === "completed" &&
    runtime?.messaging &&
    item.kind === "initial" &&
    item.planKey &&
    !item.reworkOfWorkItemId &&
    !item.outcome.cancelledAt &&
    !item.outcome.acceptedAt
  ) {
    const planTask = parseOutcomePlan(item.contractRevision.plan)?.tasks.find((task) => task.key === item.planKey);
    if (planTask?.nature === "deliverable") {
      const resolvedReviewer = await resolveOutcomeRole(tx, "reviewer", item.outcome.botId);
      if ((resolvedReviewer.status === "configured" || resolvedReviewer.status === "model_only") && resolvedReviewer.botId) {
        const existingReviewTurn = await tx.outcomeThreadTurn.findFirst({
          where: { thread: { outcomeId: item.outcomeId }, purpose: "review_task", workItemId: item.id },
          select: { id: true },
        });
        if (!existingReviewTurn) {
          try {
            await enqueueOutcomeThreadTurn(tx, runtime.messaging, {
              outcomeId: item.outcomeId,
              botId: resolvedReviewer.botId,
              purpose: "review_task",
              text: `Review completed deliverable task "${item.title}" (workItemId=${item.id}, planKey=${item.planKey}).`,
              actor: "system:task_review",
              clientRequestId: `review-task:${item.id}`,
              model: resolvedReviewer.model,
              workItemId: item.id,
            });
          } catch (error) {
            if (!(error instanceof OutcomeError) || error.code !== "bot_not_runnable") throw error;
            await appendOutcomeEvent(tx, "outcome.task_review.decided", item.outcomeId, {
              actor: "system:task_review",
              contractRevision: item.contractRevision.revision,
              workItemId: item.id,
              idempotencyKey: `review-task-unreviewed:${item.id}`,
              payload: { workItemId: item.id, verdict: "unreviewed" },
            });
          }
        }
      }
    }
  }
  const status = await recomputeOutcomeStatus(tx, item.outcomeId, actor);
  if (status === "review_pending") {
    await emitReviewRequiredIfNeeded(tx, item.outcomeId, item.contractRevisionId, item.contractRevision.revision, runtime?.messaging);
  }
  if (runtime) await dispatchQueuedOutcomeWorkItems(tx, runtime.messaging, item.botId, item.outcomeId);
}

/** The approved execution snapshot, separate from all main-chat history. */
const OWNER_REPORT_GUIDANCE = "Write for the person who asked, in their language. Start with the answer or what you need them to decide. Then give only the facts, risk or uncertainty that changes the decision. Use everyday words and short sentences. Keep internal IDs, tool names, file paths, raw logs and jargon out of the opening; put necessary technical detail in the supporting records. Say what was done, what is only proposed, and what is still unknown. Never imply the user has already approved something they have not approved.";

export async function outcomeRunContext(db: Prisma.TransactionClient, botId: string, workItemId: string): Promise<string> {
  const item = await db.outcomeWorkItem.findFirst({
    where: { id: workItemId, botId, executorType: "agent" },
    include: { contractRevision: { include: { criteria: { orderBy: { ordinal: "asc" } } } } },
  });
  if (!item || !item.contractRevision.approvedAt || !["approved", "superseded"].includes(item.contractRevision.status))
    throw new OutcomeError("contract_revision_not_approved", "An outcome thread requires its approved contract");
  const plan = parseOutcomePlan(item.contractRevision.plan);
  const planTask = item.planKey ? plan?.tasks.find((task) => task.key === item.planKey) : undefined;
  const coveredIds = new Set(planTask?.covers ?? []);
  const depIds = Array.isArray(item.dependsOn) ? item.dependsOn.filter((id): id is string => typeof id === "string") : [];
  const upstreamItems = depIds.length
    ? await db.outcomeWorkItem.findMany({
        where: { id: { in: depIds }, outcomeId: item.outcomeId },
        orderBy: { ordinal: "asc" },
        select: {
          id: true,
          planKey: true,
          title: true,
          outputs: {
            orderBy: { createdAt: "asc" },
            select: { kind: true, title: true, content: true, contentRef: true },
          },
        },
      })
    : [];
  const criteriaList = item.contractRevision.criteria.map(({ id, statement, required }) => ({ id, statement, required }));
  const coveredCriteria = coveredIds.size ? criteriaList.filter((criterion) => coveredIds.has(criterion.id)) : null;
  const upstreamOutputs = upstreamItems.length
    ? upstreamItems.map((upstream) => ({
        workItemId: upstream.id,
        ...(upstream.planKey ? { planKey: upstream.planKey } : {}),
        title: upstream.title,
        outputs: upstream.outputs.map((output) => ({
          kind: output.kind,
          title: output.title,
          summary: output.content ? output.content.slice(0, 1_200) : null,
          contentRef: output.contentRef,
        })),
      }))
    : undefined;
  const executionGuidance = item.reworkOfWorkItemId
    ? "Work quietly in this isolated Outcome thread. Complete ONLY the rework fixes listed in your task instructions under the unchanged approved contract—do not redo already-accepted parts or change unrelated work. Call ReportOutcomeProgress at start and progress changes, record updated outputs and verified evidence clearly, and never try to change the contract or plan. Use WakeParent only when the main conversation must handle a platform blocker."
    : "Work quietly in this isolated Outcome thread. Handle ONLY this assigned work item and return a complete final assistant result; never modify the contract or plan or publish updates in the main conversation. Immediately call ReportOutcomeProgress when starting execution to publish the initial phase/stage and structured task list, and call ReportOutcomeProgress promptly at every phase change or whenever any task becomes in_progress, completed, or blocked. If the goal states explicit prerequisites (access, credentials, approvals, environment conditions), check each one before relying on it and include it in the `prerequisites` field of ReportOutcomeProgress with status met, unmet or unknown; resend the list whenever a status changes. Record concrete outputs and verified evidence clearly. Use RequestOutcomeDecision for decisions and RequestHumanAction for real-world/human steps when available. Use WakeParent only when the main conversation must handle a platform blocker.";
  return [
    "## Outcome execution context",
    JSON.stringify({
      outcome: {
        id: item.outcomeId,
        contractRevision: item.contractRevision.revision,
        goal: item.contractRevision.goal,
        acceptance: coveredCriteria && coveredCriteria.length ? coveredCriteria : criteriaList,
        ...(coveredCriteria && coveredCriteria.length ? { allAcceptance: criteriaList } : {}),
        boundaries: item.contractRevision.boundaries,
      },
      execution: {
        workItemId: item.id,
        ...(item.planKey ? { planKey: item.planKey } : {}),
        ...(item.title ? { title: item.title } : {}),
        ...(item.instructions ? { instructions: item.instructions } : {}),
        ...(planTask ? { nature: planTask.nature } : {}),
        ...(item.reworkOfWorkItemId ? { reworkOfWorkItemId: item.reworkOfWorkItemId } : {}),
        outputRequirements: [`Write deliverable files to outcomes/${item.outcomeId}/${item.id}/`],
        ...(item.progress ? { progress: item.progress } : {}),
        ...(upstreamOutputs ? { upstreamOutputs } : {}),
      },
    }),
    executionGuidance,
    "For RequestOutcomeDecision, nextStepSummary is the question the owner sees first: write one short question, not a report or a command. Give each option a short action label and distinguish what will happen from what has already happened. Put the result and the issue in completedSummary and problemSummary, and option-specific effects in consequence. Ask only when an actual user choice is needed.",
    OWNER_REPORT_GUIDANCE,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// A goal's own thread (specs/004.8)
// ---------------------------------------------------------------------------

const threadActor = "system:outcome-thread" as const;
const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled", "interrupted"] as const;
export const OUTCOME_THREAD_EVENT_TOPIC = "goal.thread.updated";

/** Clients refresh the goal from this and, when a turn ends, tell the owner which goal answered. */
const announceThreadTurn = async (tx: Prisma.TransactionClient, outcomeId: string, turnId: string, status: string) => {
  const title = (await tx.outcome.findUnique({ where: { id: outcomeId }, select: { title: true } }))?.title ?? "";
  await tx.event.create({ data: { topic: OUTCOME_THREAD_EVENT_TOPIC, entityId: outcomeId, payload: { outcomeId, turnId, status, title } } });
};

/** The turn's run took its lease: it is working now. */
export async function startOutcomeThreadTurn(tx: Prisma.TransactionClient, runId: string): Promise<void> {
  const turn = await tx.outcomeThreadTurn.findUnique({ where: { runId }, include: { thread: { select: { outcomeId: true } } } });
  if (!turn || turn.status !== "queued") return;
  await tx.outcomeThreadTurn.update({ where: { id: turn.id }, data: { status: "running" } });
  await announceThreadTurn(tx, turn.thread.outcomeId, turn.id, "running");
}

/**
 * A finished run settles its turn: the bot's final message becomes the reply shown with the goal, a failed
 * or cancelled run records why. The goal's status is then derived again from the facts.
 */
export async function settleOutcomeThreadTurn(
  tx: Prisma.TransactionClient,
  runId: string,
  messaging?: AgentMessaging
): Promise<void> {
  const turn = await tx.outcomeThreadTurn.findUnique({
    where: { runId },
    include: {
      thread: { select: { outcomeId: true, botId: true } },
      run: { select: { status: true, error: true } },
    },
  });
  if (!turn?.run || turn.status === "completed" || turn.status === "failed") return;
  if (!(TERMINAL_RUN_STATUSES as readonly string[]).includes(turn.run.status)) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${turn.thread.outcomeId}`}))`;
  const completed = turn.run.status === "completed";
  const reply = completed ? (await finalRunMessage(tx, runId))?.trim() || null : null;
  const detail = turn.run.error && typeof turn.run.error === "object" ? turn.run.error as { code?: unknown; message?: unknown } : null;

  let unreviewedFallback = false;
  if (turn.purpose === "review_task" && turn.workItemId && turn.result == null) {
    const workItem = await tx.outcomeWorkItem.findUnique({
      where: { id: turn.workItemId },
      include: {
        outcome: { select: { cancelledAt: true, acceptedAt: true, currentRevisionId: true } },
        contractRevision: { select: { revision: true, status: true } },
      },
    });
    if (
      workItem &&
      !workItem.outcome.cancelledAt &&
      !workItem.outcome.acceptedAt &&
      workItem.contractRevisionId === workItem.outcome.currentRevisionId &&
      workItem.contractRevision.status === "approved"
    ) {
      unreviewedFallback = true;
      await appendOutcomeEvent(tx, "outcome.task_review.decided", turn.thread.outcomeId, {
        actor: "system:task_review",
        contractRevision: workItem.contractRevision.revision,
        workItemId: workItem.id,
        idempotencyKey: `review-task-unreviewed:${turn.id}`,
        payload: { workItemId: workItem.id, verdict: "unreviewed" },
      });
    }
  }

  await tx.outcomeThreadTurn.update({
    where: { id: turn.id },
    data: {
      ...(completed
        ? { status: "completed", reply }
        : {
            status: "failed",
            error: {
              code: typeof detail?.code === "string" ? detail.code : `run_${turn.run.status}`,
              message: typeof detail?.message === "string" ? detail.message : "The bot's turn did not finish",
            },
          }),
      ...(unreviewedFallback
        ? {
            result: {
              verdict: "unreviewed",
              findings: [],
              reason: completed ? "review_no_verdict" : "review_turn_failed",
            },
          }
        : {}),
    },
  });
  const derivedStatus = await recomputeOutcomeStatus(tx, turn.thread.outcomeId, threadActor);
  if (unreviewedFallback) {
    if (derivedStatus === "review_pending") {
      const outcome = await tx.outcome.findUnique({
        where: { id: turn.thread.outcomeId },
        select: { currentRevision: { select: { id: true, revision: true } } },
      });
      if (outcome?.currentRevision) {
        await emitReviewRequiredIfNeeded(
          tx,
          turn.thread.outcomeId,
          outcome.currentRevision.id,
          outcome.currentRevision.revision,
          messaging
        );
      }
    }
    if (messaging) {
      await dispatchQueuedOutcomeWorkItems(tx, messaging, turn.thread.botId, turn.thread.outcomeId);
    }
  }
  await announceThreadTurn(tx, turn.thread.outcomeId, turn.id, completed ? "completed" : "failed");
}

/** Turns whose run already ended (a crash between the run and its settlement) are settled on a later pass. */
export async function settleFinishedOutcomeThreadTurns(
  prisma: PrismaClient,
  messaging?: AgentMessaging
): Promise<number> {
  const stale = await prisma.outcomeThreadTurn.findMany({
    where: { status: { in: ["queued", "running"] }, run: { status: { in: [...TERMINAL_RUN_STATUSES] } } },
    select: { runId: true }, take: 50,
  });
  for (const { runId } of stale) if (runId) await prisma.$transaction((tx) => settleOutcomeThreadTurn(tx, runId, messaging));
  return stale.length;
}

/** What the role bot is told at the start of a goal-thread turn; facts come from saved records, never main chat. */
export async function outcomeThreadContext(
  db: Prisma.TransactionClient | PrismaClient,
  botId: string,
  threadId: string,
  options?: { globalInference?: ServerInferenceSettings | null }
): Promise<string> {
  const thread = await db.outcomeThread.findFirst({
    where: { id: threadId, botId },
    include: { outcome: { include: { currentRevision: { include: { criteria: { orderBy: { ordinal: "asc" } } } } } } },
  });
  if (!thread) throw new OutcomeError("outcome_not_found", "This goal thread no longer exists");
  const { outcome } = thread;
  const revision = outcome.currentRevision;
  const activeTurn = await db.outcomeThreadTurn.findFirst({
    where: { threadId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "asc" },
    select: { purpose: true, workItemId: true },
  });
  const purpose = activeTurn?.purpose ?? "owner_message";
  const isReviewerTurn = purpose === "review" || purpose === "review_task";
  const settings = await readFeatureSettings(db);
  const environmentNote = settings.environmentNote?.trim() || null;
  const parsedPlan = revision ? parseOutcomePlan(revision.plan) : null;

  let assignableBots: Array<{
    id: string;
    name: string;
    description?: string;
    effectiveModel: { providerId: string; modelId: string; reasoning: string } | null;
  }> | undefined;
  let submitterBot: { id: string; name: string | null } | undefined;

  if (!isReviewerTurn) {
    const rows = await db.bot.findMany({
      where: {
        status: "active",
        subagentIdentity: { is: null },
        conversation: { isNot: null },
        channelMemberships: { some: { channel: { kind: "bot_dm", archivedAt: null } } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        inferenceProvider: true,
        inferenceModel: true,
        inferenceReasoning: true,
      },
    });
    const globalFallback = options?.globalInference?.modelId
      ? {
          providerId: options.globalInference.providerId,
          modelId: options.globalInference.modelId,
          reasoning: options.globalInference.reasoning,
        }
      : null;
    assignableBots = rows.map((row) => ({
      id: row.id,
      name: row.name,
      ...(row.description.trim() ? { description: row.description.trim() } : {}),
      effectiveModel:
        row.inferenceProvider && row.inferenceModel
          ? {
              providerId: row.inferenceProvider,
              modelId: row.inferenceModel,
              reasoning: row.inferenceReasoning ?? options?.globalInference?.reasoning ?? "medium",
            }
          : globalFallback,
    }));
    if (purpose === "plan") {
      const submitter = await db.bot.findUnique({ where: { id: outcome.botId }, select: { id: true, name: true } });
      submitterBot = { id: outcome.botId, name: submitter?.name ?? null };
    }
  }

  const contextPayload = {
    outcome: {
      id: outcome.id,
      title: outcome.title,
      description: outcome.description,
      status: outcome.status,
      contract: revision
        ? {
            revision: revision.revision,
            status: revision.status,
            goal: revision.goal,
            acceptance: revision.criteria.map(({ id, statement, required }) => ({ id, statement, required })),
            boundaries: revision.boundaries,
            budget: revision.budget,
          }
        : null,
      ...(parsedPlan && !isReviewerTurn ? { plan: parsedPlan } : {}),
      ...(isReviewerTurn && parsedPlan?.notes ? { planNotes: parsedPlan.notes } : {}),
    },
    turn: {
      purpose,
      ...(activeTurn?.workItemId ? { workItemId: activeTurn.workItemId } : {}),
    },
    ...(environmentNote ? { environmentNote } : {}),
    ...(submitterBot ? { submitterBot } : {}),
    ...(assignableBots ? { assignableBots } : {}),
  };

  if (purpose === "review") {
    return [
      "## Goal thread",
      JSON.stringify(contextPayload),
      "You are the reviewer role performing the holistic preliminary review before user acceptance. Your goal is to reduce—not inflate—what the user needs to inspect.",
      "- Inspect the goal state, contract, planNotes, outputs, evidence, decision records when present, and task-level review notes with GetOutcome. You have the box's Read and Shell tools. For every output with a contentRef, read the referenced text or Markdown file from /workspace before judging it. For DOCX or other structured files, use a read-only Shell command to extract or inspect its contents. Do not rely on file names, progress summaries or an executor's final sentence when the saved file is available. Never rerun the work or modify its outputs.",
      "- Verify: (1) required acceptance criteria satisfaction, (2) whether anything violated boundaries.excluded, and (3) whether reported claims are backed by valid evidence. A decision record is an executor report, not proof. Distinguish open choices from resolved, expired, or withdrawn ones; do not ask again about a closed choice.",
      "- For facts about external systems or the real world, only external records, deterministic checks, and human receipts count as evidence—an executing bot's statement alone is never sufficient; mark missing evidence `unclear` (never `likely_pass` or `likely_fail`). For criteria verified via deterministic_check, check that recorded check evidence passed without re-running work yourself.",
      "- Decide for yourself how to gather facts: GetOutcome for the saved records, Read or a read-only Shell for files. Then call SubmitPrereview once with one result per criterion. Its `conclusion` is the owner-facing opening of the report: either one complete sentence of at most 50 characters, or 2 to 5 complete items of at most 30 characters each (the app numbers them; do not number them yourself). Every sentence or item names its subject, states the concrete recorded fact with its figure, and says what it means for the decision. Fragments such as a bare label plus a number are not acceptable. When the goal is quantitative, cover every decision-driving figure, grouping like-for-like readings. When a required criterion is unclear, state its most important unresolved fact in the conclusion itself. Process details, evidence explanations and notes belong in the criterion reasons, not in the conclusion.",
      OWNER_REPORT_GUIDANCE,
      "- SubmitPrereview is the only submission: its conclusion is the report opening, not a second document. Write each attention item as a concrete question. Cite the evidence IDs behind each criterion.",
      "- If comparable figures help the owner decide, include up to two charts in the same SubmitPrereview call. Each point cites either an evidenceId or a saved output `file` path, plus the exact excerpt containing its label, its single reading and the unit; the app verifies the excerpt exists in that source and shows where it came from. Never estimate, calculate or invent figures. Omit charts when the records do not support them. If the submission is rejected, read the error, correct that field and submit again.",
      "- You are advisory only: you cannot approve, reject, or accept on behalf of the user.",
    ].join("\n");
  }
  if (purpose === "review_task") {
    return [
      "## Goal thread",
      JSON.stringify(contextPayload),
      "You are the reviewer role performing task-level review on a single completed deliverable work item. Default to `pass`; when unsure, pass. Inspect only recorded outputs and evidence with GetOutcome. You have the box's Read and Shell tools. For every output with a contentRef, read the referenced text or Markdown file from /workspace before judging it. For DOCX or other structured files, use a read-only Shell command to extract or inspect its contents. Never re-execute the task or modify its outputs.",
      "- Judge ONLY against: (1) the required acceptance criteria covered by this task (`covers`), and (2) explicit contract boundaries.",
      "- Read `planNotes`, shared memory, and `environmentNote` first to understand planning assumptions; discrepancies with `planNotes` or `environmentNote` go into `note`, never into rejection.",
      "- Reject ONLY for serious errors (contradicting a covered required criterion or contract boundary, or key factual errors) or omissions (missing required output), citing the exact basis and reason. Each task may be rejected at most once.",
      "- Never reject for formatting, style, wording, naming, optional criteria, personal extra standards, optimization ideas, or extra work unless it violates an explicit boundaries.excluded item; put non-blocking suggestions in `note`. Never reject for missing external evidence—describe what evidence is missing in `note` so holistic review marks it `unclear`. For deterministic_check criteria, verify recorded pass evidence without re-running checks.",
      "- `note` is never sent to the executing bot; never phrase it as rework commands or use it to bypass rejection rules. Record your decision with ReviewTaskResult.",
    ].join("\n");
  }
  return [
    "## Goal thread",
    JSON.stringify(contextPayload),
    "You are the planner thread for this goal, separate from the user's main conversation. The user message is the owner's own unmodified words.",
    "- Write or revise contracts via SaveOutcomeContract (first revision needs a title), and break work into executable tasks via SavePlan (never only describe tasks in prose). Keep task count minimal—split along natural domain units (sources/topics for research, chapters/deliverables for writing, change steps with risks for operations, work packages for project management) only when independent or sequential; do not impose a fixed software pipeline template. Prefer one task over several when the same Bot would do consecutive steps and the later step only turns the earlier result into a report or summary; each extra task becomes its own sub-conversation with its own review, so split only when work needs a different Bot, different permissions, or can run in parallel.",
    "- Every SavePlan task must declare `nature`: `deliverable` (inspectable, modifiable output) or `action` (operation on an external system or real environment; pick `action` if uncertain). For steps requiring a person in the real world, instruct the executing bot to request a human action card rather than creating human tasks yourself. You have the box's Read and Shell tools for read-only inspection of existing local files and environment facts when they affect the plan. Do not execute the requested work, modify files, or treat a local inspection as approval. Never embed credentials or grant permissions in plans; you cannot approve contracts, and you may only accept or rework a review_pending outcome when the owner's words in this turn direct it.",
    "- Before planning, use RecallMemory for relevant shared facts. Reconcile conflicts using precedence: user's current words > newer shared facts > environmentNote (ask the user instead of guessing if conflict alters the plan). Write durable environment facts revealed by the user (paths, accounts, preferences, restrictions) into shared memory via UpdateMemory.",
    "- Make every task's instructions self-contained (background, paths/account names/references, constraints, completion criteria—no secrets), because the executing bot only sees its assigned instructions. Use SavePlan.notes to record decomposition rationale, assumptions, and known risks for the reviewer and user.",
    ...(submitterBot
      ? [
          `- Submitted via bot "${submitterBot.name ?? submitterBot.id}" (${submitterBot.id}). When more background is needed, call ReadTranscript on that bot's conversation rather than guessing.`,
        ]
      : []),
    "- When the owner explicitly asks in this turn to cancel, stop, or drop the goal, call CancelOutcome (never respond with a plan instead; system-triggered turns cannot cancel).",
    OWNER_REPORT_GUIDANCE,
    "- In your final reply, say what changed and the next action in two or three short sentences. If you need a choice, ask a direct question and explain the practical difference. Write contract titles, acceptance criteria and task titles in plain language; keep Bot-only instructions separate. Do not repeat the full contract or message the main chat.",
    purpose === "plan"
      ? "- Goal newly submitted: if the description is sufficient, save the contract and task plan now; otherwise ask concise clarifying questions."
      : purpose === "replan"
        ? "- Execution alert (replan): read GetOutcome and call SavePlan to add replacement tasks or adjust/drop unstarted queued tasks (cannot alter started/finished tasks), SaveOutcomeContract if contract scope must change, or explain cleanly what owner action is needed."
        : outcome.status === "review_pending"
          ? [
              "- Acceptance conversation (outcome is review_pending): first call GetOutcome (and inspect saved output files with Read or read-only Shell if needed) so you judge the owner's reply against the actual deliverables, preliminary review, and pending verification items.",
              "- Decide the next step strictly from the owner's words:",
              "  1. Accept and finish: ONLY when all requested work is already done and the owner confirms the results pass, reports successful verification, or asks to accept/complete the goal as-is, call AcceptOutcome with the current contract revision. If the owner asks to perform any action or step first before ending (for example, 'run one backup first, then end the goal'), NEVER call AcceptOutcome yet—dispatch that work first via step 2.",
              "  2. Continue under the same contract: if the owner asks for fixes, adjustments, or additional execution/follow-up steps within the existing goal and boundaries (even if they also say to end the goal afterwards), call RequestOutcomeRework (to revise the delivered result with the executing Bot) or SavePlan (to add follow-up tasks while keeping started/finished tasks verbatim).",
              "  3. Change scope or criteria: if the owner's feedback changes the goal, acceptance criteria, or scope boundaries, call SaveOutcomeContract (and SavePlan if tasks should be updated) so the owner can approve the new revision.",
              "  4. Cancel: only if the owner explicitly asks to cancel, stop, or drop the goal, call CancelOutcome.",
              "  5. Clarify without changing state: if the owner is only asking a question or their intent is unclear, answer concisely and ask a direct follow-up question without calling state-changing tools.",
            ].join("\n")
          : "- Follow the owner's instructions faithfully; leave contract and plan untouched if no change was requested.",
  ].join("\n");
}
