import { Prisma, type PrismaClient, type Event } from "@outcomego/db";
import { resolveOutcomeRole } from "@outcomego/messaging";
import type { EventWakeup } from "../event-wakeup";
import type { OutcomeReviewService } from "./outcome-review-service";
import { outcomeWrite } from "./outcome-write";
import { OUTCOME_EVIDENCE_EVENT_SCOPE, pendingOutcomeEvidenceEventSql } from "./outcome-event-retention";

/** Durable receipts are the processing authority: sequence allocation does not imply commit ordering. */
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
    const scope = OUTCOME_EVIDENCE_EVENT_SCOPE;
    const events = await this.prisma.$queryRaw<Event[]>(Prisma.sql`
      SELECT event.* FROM "outcomego_event" AS event
      WHERE ${pendingOutcomeEvidenceEventSql}
      ORDER BY event."sequence" ASC LIMIT 100
    `);
    const resolvedReviewer = await resolveOutcomeRole(this.prisma, "reviewer");
    const useReviewerRole = resolvedReviewer.status === "configured" || resolvedReviewer.status === "model_only";
    let processed = 0;
    for (const event of events) {
      if (signal?.aborted) break;
      const envelope = event.payload as { eventId?: string; workItemId?: string; payload?: { outputId?: string; to?: string } };
      if (event.topic === "outcome.output.recorded" && envelope.payload?.outputId) {
        await this.reviews.recordOutputEvidence(envelope.payload.outputId);
        if (!useReviewerRole) {
          const output = await this.prisma.outcomeOutput.findUnique({ where: { id: envelope.payload.outputId }, select: { workItemId: true } });
          if (output) await this.reviews.prereview(output.workItemId, signal);
        }
      } else if (!useReviewerRole && envelope.payload?.to === "completed" && envelope.workItemId) {
        await this.reviews.prereview(envelope.workItemId, signal);
      }
      if (signal?.aborted) break;
      const eventId = envelope.eventId ?? event.sequence.toString();
      await outcomeWrite(this.prisma, scope, eventId, { eventId }, async () => ({ processed: true }));
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
