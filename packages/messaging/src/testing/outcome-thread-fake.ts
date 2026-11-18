import type { Prisma } from "@outcomego/db";
import type { AgentMessaging } from "../index";
import { transitionWorkItem } from "../outcome-state";
import type { EnqueueOutcomeTurnInput, EnqueueOutcomeTurnResult } from "../outcome-threads";

/** Test-only substitute; records calls and changes state without creating a Run or a visible message. */
export class OutcomeThreadFake {
  readonly enqueueCalls: EnqueueOutcomeTurnInput[] = [];
  readonly settleCalls: string[] = [];

  enqueueOutcomeTurn = async (
    tx: Prisma.TransactionClient,
    _messaging: AgentMessaging,
    input: EnqueueOutcomeTurnInput
  ): Promise<EnqueueOutcomeTurnResult> => {
    this.enqueueCalls.push({ ...input });
    await transitionWorkItem(tx, {
      workItemId: input.workItemId,
      to: "running",
      reason: input.reason,
      actor: "system:outcome-thread-fake",
      idempotencyKey: input.clientId,
    });
    return { status: "enqueued", runId: `fake:${input.clientId}` };
  };

  settleOutcomeWorkItem = async (_tx: Prisma.TransactionClient, runId: string): Promise<void> => {
    this.settleCalls.push(runId);
  };
}
