import type { Prisma } from "@outcomego/db";
import type { RunOrigin } from "@outcomego/contracts";
import { lockAgentLifecycle } from "@outcomego/messaging";

/** Internal worker identity; no runtime or client contract changes are required. */
export interface WakeAttempt {
  botId: string;
  runId: string;
  inboxId: string;
  ownerId: string;
  attempt: number;
  origin?: RunOrigin;
}

/** Match routine lifecycle, claim and cancellation lock ordering. Projection does
 * not hold the global recovery gate while startup waits for runtime cancellation. */
export async function lockWakeAttempt(tx: Prisma.TransactionClient, attempt: WakeAttempt): Promise<void> {
  await lockAgentLifecycle(tx, attempt.botId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-run-claim:${attempt.botId}`}))`;
  // The user's first message skips onboarding under the bot row before writing Run.
  // Preserve that order for bootstrap projection/retry as well as final settlement.
  if (attempt.origin === "bootstrap") {
    await tx.$queryRaw`SELECT "id" FROM "outcomego_bot" WHERE "id" = ${attempt.botId} FOR NO KEY UPDATE`;
  }
  await tx.$executeRaw`SELECT id FROM "outcomego_run" WHERE id = ${attempt.runId}::uuid FOR NO KEY UPDATE`;
}

/** The durable counter still fences an old owner after a successor releases its lease.
 * A terminal current attempt may finish settlement after claim pruned its terminal lease. */
export async function ownsWakeAttempt(
  tx: Prisma.TransactionClient,
  attempt: WakeAttempt,
  allowTerminal = false
): Promise<boolean> {
  const inbox = await tx.inboxEvent.findUnique({ where: { id: attempt.inboxId } });
  if (!inbox || inbox.runId !== attempt.runId || inbox.botId !== attempt.botId || inbox.attempts !== attempt.attempt) return false;
  const lease = await tx.botRunLease.findUnique({ where: { runId: attempt.runId } });
  if (lease && lease.ownerId !== attempt.ownerId) return false;
  const terminal = allowTerminal && !!(await tx.run.findFirst({
    where: { id: attempt.runId, status: { in: ["completed", "cancelled"] } }, select: { id: true },
  }));
  if (terminal) return true;
  // Use the database clock, as external delivery fencing does.
  const live = lease && await tx.$queryRaw<Array<{ live: boolean }>>`
    SELECT "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') AS live
    FROM "outcomego_bot_run_lease" WHERE "runId" = ${attempt.runId}::uuid`;
  return inbox.status === "processing" && !!live?.[0]?.live;
}
