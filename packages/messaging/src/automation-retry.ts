import { Prisma } from "@outcomego/db";
import { finalizeInterruptedItems } from "./interrupted-progress";
import { requestIsStopped } from "./request-state";
import { requestWakeAllowed } from "./request-progress";

/** Three retries after the first attempt, only before any observable action. */
export const AUTOMATION_RETRY_DELAYS_MS = [30_000, 120_000, 300_000] as const;
export const AUTOMATION_ATTEMPT_LIMIT = AUTOMATION_RETRY_DELAYS_MS.length + 1;
const retryableWakes = new Set([
  "routine.scheduled", "routine.manual", "routine.event", "automation.wake_parent", "request.check",
]);

export const automationRetryDelay = (type: string, attempts: number): number | null =>
  retryableWakes.has(type) && Number.isInteger(attempts) && attempts >= 1
    ? AUTOMATION_RETRY_DELAYS_MS[attempts - 1] ?? null
    : null;

/** Caller holds the recovery/claim and run gates. Queue notification is a post-commit hint;
 * the durable pending row is also picked up by the periodic worker sweep. */
export async function requeueAutomationWake(
  tx: Prisma.TransactionClient,
  input: { botId: string; runId: string; inboxId: string; attempt: number },
  error: unknown
): Promise<number | null> {
  const [run, inbox, bot] = await Promise.all([
    tx.run.findUnique({ where: { id: input.runId } }),
    tx.inboxEvent.findUnique({ where: { id: input.inboxId } }),
    tx.bot.findUnique({ where: { id: input.botId }, select: { status: true } }),
  ]);
  const delay = inbox && automationRetryDelay(inbox.type, inbox.attempts);
  const code = run?.error && typeof run.error === "object" && !Array.isArray(run.error)
    ? (run.error as { code?: unknown }).code : undefined;
  if (
    delay === null || !inbox || inbox.attempts !== input.attempt || inbox.status !== "processing" ||
    inbox.runId !== input.runId || inbox.botId !== input.botId ||
    bot?.status !== "active" || !run || !["running", "failed"].includes(run.status) ||
    code === "priority_peer_interrupt" || requestIsStopped(run)
  ) return null;
  if (!(await requestWakeAllowed(tx, inbox))) return null;
  const acted = await tx.runItem.count({
    where: {
      runId: input.runId, kind: { in: ["command", "file_change", "tool"] },
      OR: [{ upstreamItemId: null }, { NOT: { upstreamItemId: { startsWith: "prompt:" } } }],
    },
  }) + await tx.channelMessage.count({ where: { sourceRunId: input.runId, sender: "agent" } })
    // Fork-specific durable receipts can precede the streamed tool item. An unknown
    // connector outcome must remain owned by external recovery, never replayed here.
    + await tx.pluginInvocation.count({ where: { runId: input.runId } })
    + await tx.externalOutboundDelivery.count({ where: { runId: input.runId } });
  if (acted) return null;
  if (run.origin === "routine") {
    const payload = inbox.payload as { automationContextRunId?: string } | null;
    const execution = await tx.routineExecution.findUnique({
      where: { runId: payload?.automationContextRunId ?? input.runId },
      select: { routine: { select: { deletedAt: true, pausedAt: true, enabled: true } } },
    });
    if (!execution || execution.routine.deletedAt || execution.routine.pausedAt || !execution.routine.enabled) return null;
  }
  await finalizeInterruptedItems(tx, input.runId, false);
  await tx.botRunLease.deleteMany({ where: { runId: input.runId } });
  await tx.inboxEvent.update({
    where: { id: input.inboxId },
    data: { status: "pending", claimedAt: null, completedAt: null, error: Prisma.DbNull, availableAt: new Date(Date.now() + delay) },
  });
  await tx.run.update({
    where: { id: input.runId }, data: { status: "queued", error: Prisma.DbNull, completedAt: null },
  });
  await tx.event.create({
    data: {
      topic: "run.retry_queued", entityId: input.runId,
      payload: {
        botId: input.botId, inboxId: input.inboxId, attempt: input.attempt,
        attemptLimit: AUTOMATION_ATTEMPT_LIMIT, delayMs: delay,
        message: error instanceof Error ? error.message : String(error),
      },
    },
  });
  return delay;
}
