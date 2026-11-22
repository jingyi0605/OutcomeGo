import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient } from "@outcomego/db";
import { Effect } from "effect";
import type { OutcomeBriefService } from "./outcome-brief-service";
import type { OutcomeService } from "./outcome-service";

const BATCH_SIZE = 4;
const SCAN_INTERVAL_MS = 15_000;

export class OutcomeResultSummaryWorker {
  private running?: { controller: AbortController; loop: Promise<void> };

  constructor(
    private readonly prisma: Pick<PrismaClient, "outcome">,
    private readonly outcomes: Pick<OutcomeService, "get">,
    private readonly briefs: Pick<OutcomeBriefService, "getResult">,
    private readonly ensurePrereview?: (outcomeId: string, revision: { id: string; revision: number }) => Promise<boolean>,
  ) {}

  start(): void {
    if (this.running) return;
    const controller = new AbortController();
    this.running = { controller, loop: this.run(controller.signal) };
  }

  async stop(): Promise<void> {
    const running = this.running;
    running?.controller.abort();
    await running?.loop;
    this.running = undefined;
  }

  async scan(signal?: AbortSignal): Promise<void> {
    let after: string | undefined;
    while (!signal?.aborted) {
      const page: { id: string }[] = await this.prisma.outcome.findMany({
        where: { status: { in: ["review_pending", "decision_pending"] }, id: after ? { gt: after } : undefined },
        select: { id: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });
      await Promise.all(page.map(async ({ id }) => {
        if (signal?.aborted) return;
        try {
          const outcome = await Effect.runPromise(this.outcomes.get(id));
          const revision = outcome.currentRevisionView;
          if (!revision || signal?.aborted || !["review_pending", "decision_pending"].includes(outcome.status)) return;
          if (outcome.prereview || outcome.prereviewStatus === "pending") return;
          if (revision.status === "approved" && outcome.prereviewStatus !== "unreviewed" &&
              await this.ensurePrereview?.(id, revision)) return;
          // Preserve the background summary when there is no current, runnable review.
          if (outcome.status === "review_pending" && !signal?.aborted) {
            await this.briefs.getResult(outcome, revision, signal);
          }
        } catch (error) {
          if (!signal?.aborted) console.warn("Outcome results summary generation failed", id, error);
        }
      }));
      if (page.length < BATCH_SIZE) return;
      after = page.at(-1)!.id;
    }
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.scan(signal);
      } catch (error) {
        if (!signal.aborted) console.warn("Outcome results summary scan failed", error);
      }
      if (!signal.aborted) {
        await delay(SCAN_INTERVAL_MS, undefined, { signal, ref: false }).catch(() => undefined);
      }
    }
  }
}
