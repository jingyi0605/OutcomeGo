import { ApiError } from "@outcomego/contracts";
import type { Prisma } from "@outcomego/db";
import { assertBackgroundRequestDeliveryAllowed } from "@outcomego/messaging";

/** Called in the transaction that claims a connected publication, before transport I/O. */
export async function assertConnectedPublicationAllowed(
  tx: Prisma.TransactionClient,
  source: { botId: string; runId: string | null },
): Promise<void> {
  const run = source.runId && await tx.run.findUnique({
    where: { id: source.runId }, select: { id: true, botId: true, origin: true },
  });
  if (!run || run.botId !== source.botId)
    throw new ApiError(409, "tool_context_invalid", "The connected publication has no matching Run");
  await assertBackgroundRequestDeliveryAllowed(tx, { botId: run.botId, runId: run.id, origin: run.origin });
}
