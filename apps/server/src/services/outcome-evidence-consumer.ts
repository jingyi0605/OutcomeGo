import type { PrismaClient } from "@outcomego/db";
import type { EventWakeup } from "../event-wakeup";
import type { OutcomeReviewService } from "./outcome-review-service";
import { outcomeWrite } from "./outcome-write";

/** Durable Event backlog plus LISTEN wakeups; the cursor is committed only after idempotent business writes. */
export class OutcomeEvidenceConsumer {
  private stopController: AbortController | null = null;
  private loop: Promise<void> | null = null;
  constructor(private readonly prisma: PrismaClient, private readonly reviews: OutcomeReviewService,
    private readonly wakeup: Pick<EventWakeup, "currentVersion" | "wait">) {}

  start(): void {
    if (this.loop) return;
    const controller = new AbortController();
    this.stopController = controller;
    this.loop = this.run(controller.signal);
  }
  async stop(): Promise<void> {
    this.stopController?.abort();
    await this.loop;
    this.loop = null;
    this.stopController = null;
  }

  async drain(signal?: AbortSignal): Promise<number> {
    const scope = "outcome-evidence-cursor", key = "v1";
    const cursor = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    const response = cursor?.response as { sequence?: string } | null;
    const events = await this.prisma.event.findMany({ where: { sequence: { gt: BigInt(response?.sequence ?? "0") }, topic: { in: ["outcome.output.recorded", "outcome.work_item.updated"] } }, orderBy: { sequence: "asc" }, take: 100 });
    let processed = 0;
    for (const event of events) {
      if (signal?.aborted) break;
      const envelope = event.payload as { eventId?: string; workItemId?: string; payload?: { outputId?: string; to?: string } };
      if (event.topic === "outcome.output.recorded" && envelope.payload?.outputId) {
        await this.reviews.recordOutputEvidence(envelope.payload.outputId);
        const output = await this.prisma.outcomeOutput.findUnique({ where: { id: envelope.payload.outputId }, select: { workItemId: true } });
        if (output) await this.reviews.prereview(output.workItemId, signal);
      } else if (envelope.payload?.to === "completed" && envelope.workItemId) {
        await this.reviews.prereview(envelope.workItemId, signal);
      }
      if (signal?.aborted) break;
      await outcomeWrite(this.prisma, "outcome-event:output-evidence", envelope.eventId ?? event.sequence.toString(), { sequence: event.sequence.toString() }, async () => ({ processed: true }));
      await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
        const current = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
        const value = current?.response as { sequence?: string } | null;
        if (BigInt(value?.sequence ?? "0") < event.sequence) await tx.idempotencyRecord.upsert({ where: { scope_key: { scope, key } },
          create: { scope, key, requestHash: "cursor", response: { sequence: event.sequence.toString() }, status: "completed", expiresAt: new Date("9999-01-01") },
          update: { response: { sequence: event.sequence.toString() } },
        });
      });
      processed++;
    }
    return processed;
  }
  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const version = this.wakeup.currentVersion;
      try { if (await this.drain(signal) === 100) continue; }
      catch (error) { if (!signal.aborted) console.error("outcome evidence recovery", error); }
      if (!signal.aborted) await this.wakeup.wait(version, 5_000, signal);
    }
  }
}
