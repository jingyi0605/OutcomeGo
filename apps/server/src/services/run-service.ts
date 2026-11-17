import {
  ApiError,
} from "@outcomego/contracts";
import { COMPUTER_API_PATHS } from "@outcomego/contracts/service-protocol";
import type { PrismaClient } from "@outcomego/db";
import { lockAgentLifecycle } from "@outcomego/messaging";
import { Effect } from "effect";
import { appendEvent, type ComputerFetch, serviceEffect, stopSubagentShells } from "./service-utils";

const runCancellation = async <A>(effect: Effect.Effect<A, Error>): Promise<A> => {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Left") throw result.left;
  return result.right;
};

export class RunService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly computerFetch: ComputerFetch,
  ) {}

  /** Stop exact Outcome run groups, including delegated workers and their commands. */
  cancelOutcomeWorkItems = (workItemIds: readonly string[]) => serviceEffect(async () => {
    const runs = await this.prisma.run.findMany({ where: { outcomeWorkItemId: { in: [...workItemIds] } } });
    if (!runs.length) return { ok: true };
    const allRunIds = new Set(runs.map(run => run.id));
    const stoppedChildren = new Set<string>();
    let incomplete = false;
    const attempt = async (operation: () => Promise<unknown>) => {
      try { await operation(); return true; }
      catch { incomplete = true; return false; }
    };
    for (const run of runs) await attempt(() => runCancellation(this.cancel(run.id)));
    // Drain nested workers, including a child created just before its parent's cancellation arrived.
    for (let pass = 0; pass < 4; pass++) {
      const children = await this.prisma.$transaction(async tx => {
        // Task dispatch holds the same lifecycle lock through its context check and insertion.
        for (const botId of [...new Set(runs.map(run => run.botId))].sort()) await lockAgentLifecycle(tx, botId);
        return tx.subagent.findMany({ where: { parentRunId: { in: [...allRunIds] }, id: { notIn: [...stoppedChildren] } } });
      });
      if (!children.length) break;
      for (const child of children) {
        const current = await this.prisma.subagent.findUnique({ where: { id: child.id } });
        if (!current || !allRunIds.has(current.parentRunId)) { stoppedChildren.add(child.id); continue; }
        const childRuns = await this.prisma.run.findMany({ where: { botId: child.childBotId } });
        let stopped = true;
        for (const run of childRuns) {
          allRunIds.add(run.id);
          if (!await attempt(() => runCancellation(this.cancel(run.id)))) stopped = false;
        }
        if (!await attempt(() => stopSubagentShells(this.computerFetch, child.childBotId))) stopped = false;
        if (!stopped) continue;
        await this.prisma.$transaction(async tx => {
          const now = new Date();
          const stopped = await tx.subagent.updateMany({
            where: { id: child.id, currentRunId: child.currentRunId, parentRunId: child.parentRunId, status: { in: ["provisioning", "queued", "running", "waiting"] } },
            data: { status: "stopped", stoppedAt: now, completedAt: now, nextCheckAt: null },
          });
          if (stopped.count) {
            await tx.subagentAttempt.updateMany({
              where: { subagentId: child.id, status: { in: ["provisioning", "queued", "running", "waiting"] } },
              data: { status: "stopped", stoppedAt: now, completedAt: now },
            });
            await appendEvent(tx, "subagent.stopped", child.id, { parentBotId: child.parentBotId, subagentId: child.id, runId: child.currentRunId, callId: "outcome-cancel" });
          }
        });
        stoppedChildren.add(child.id);
      }
    }
    const remaining = await this.prisma.subagent.count({
      where: { parentRunId: { in: [...allRunIds] }, status: { in: ["provisioning", "queued", "running", "waiting"] } },
    });
    for (const botId of new Set(runs.map(run => run.botId))) {
      const runIds = runs.filter(run => run.botId === botId).map(run => run.id);
      await attempt(async () => {
        const response = await this.computerFetch(COMPUTER_API_PATHS.backgroundShellRunsStop(botId), {
          method: "POST", body: JSON.stringify({ runIds }), signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Outcome shell stop was not acknowledged");
      });
    }
    if (incomplete || remaining) throw new ApiError(503, "outcome_stop_incomplete", "Some Outcome work could not be stopped; retry cancellation", { retryable: true });
    // The runtime still owns cleanup while a turn is stopping. Only terminal leases may be released.
    await this.prisma.botRunLease.deleteMany({
      where: { runId: { in: [...allRunIds] }, run: { status: { in: ["completed", "failed", "cancelled", "interrupted"] } } },
    });
    return { ok: true };
  });

  /** Stops one turn. The user's stop goes through SubagentService.stopRun, which also stops the subagents. */
  cancel = (runId: string) =>
    serviceEffect(async () => {
      let run = await this.prisma.run.findUnique({ where: { id: runId } });
      if (!run) throw new ApiError(404, "run_not_found", "Run not found");
      if (run.status === "queued") {
        const completedAt = new Date();
        const cancelled = await this.prisma.$transaction(async (tx) => {
          // Claim updates inbox then run; serialize with it before taking either row.
          // Otherwise queued cancellation can hold the run while each waits on the other's inbox/run.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-run-claim:${run!.botId}`}))`;
          const updated = await tx.run.updateMany({
            where: { id: runId, status: "queued" },
            data: {
              status: "cancelled",
              completedAt,
              error: { code: "cancelled_by_user", message: "Cancelled before execution" },
            },
          });
          if (updated.count === 0) return false;
          await tx.inboxEvent.updateMany({
            where: { runId, status: "pending" },
            data: {
              status: "completed",
              completedAt,
              error: { code: "cancelled_by_user", message: "Cancelled before execution" },
            },
          });
          await appendEvent(tx, "run.cancelled", runId, { runId, beforeExecution: true });
          return true;
        });
        if (cancelled) return { ok: true, status: "cancelled" };
        // A worker may have claimed the queued run before the conditional write.
        run = await this.prisma.run.findUnique({ where: { id: runId } });
        if (!run) throw new ApiError(404, "run_not_found", "Run not found");
      }
      if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
        return { ok: true, status: run.status };
      }
      try {
        const response = await this.computerFetch(COMPUTER_API_PATHS.turnCancel(runId), {
          method: "POST",
          body: JSON.stringify({ reason: "stop" }),
        });
        if (!response.ok) throw new ApiError(409, "run_not_active", await response.text());
      } catch (error) {
        const current = await this.prisma.run.findUnique({ where: { id: runId } });
        if (
          !current ||
          !["completed", "failed", "cancelled", "interrupted"].includes(current.status)
        )
          throw error;
        return { ok: true, status: current.status };
      }
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.run.updateMany({
          where: { id: runId, status: { in: ["queued", "running"] } },
          data: { status: "cancelled", completedAt: new Date(), error: { code: "cancelled_by_user", message: "The user stopped this turn" } },
        });
        if (updated.count) await appendEvent(tx, "run.cancel_requested", runId, { runId });
      });
      const current = await this.prisma.run.findUnique({ where: { id: runId } });
      return { ok: true, status: current?.status ?? "cancelled" };
    });
}
