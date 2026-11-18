import { ApiError } from "@outcomego/contracts";
import type { Prisma } from "@outcomego/db";
import { assertBackgroundRequestDeliveryAllowed, lockAgentLifecycle, requestIsStopped } from "@outcomego/messaging";

/** Called in the transaction that claims a connected publication, before transport I/O. */
export async function assertConnectedPublicationAllowed(
  tx: Prisma.TransactionClient,
  source: { botId: string; runId: string | null },
): Promise<void> {
  await lockAgentLifecycle(tx, source.botId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-run-claim:${source.botId}`}))`;
  // Running cancellation also updates this row without the request-progress lock.
  if (source.runId)
    await tx.$queryRaw`SELECT id FROM "outcomego_run" WHERE id = ${source.runId}::uuid FOR NO KEY UPDATE`;
  const run = source.runId && await tx.run.findUnique({
    where: { id: source.runId },
    select: { id: true, botId: true, origin: true, status: true, requestStoppedAt: true, error: true },
  });
  if (!run || run.botId !== source.botId)
    throw new ApiError(409, "tool_context_invalid", "The connected publication has no matching Run");
  if (requestIsStopped(run))
    throw new ApiError(409, "request_stopped", "This request was stopped; its connected result was not delivered.");
  if (run.status !== "running")
    throw new ApiError(409, "tool_context_invalid", "The connected publication Run is no longer active");
  await assertBackgroundRequestDeliveryAllowed(tx, { botId: run.botId, runId: run.id, origin: run.origin });
}
