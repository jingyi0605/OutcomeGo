import {
  ApiError,
} from "@outcomego/contracts";
import { COMPUTER_API_PATHS } from "@outcomego/contracts/service-protocol";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { lockAgentLifecycle, stopRequestProgress, transitionWorkItem } from "@outcomego/messaging";
import { Effect } from "effect";
import { appendEvent, type ComputerFetch, serviceEffect } from "./service-utils";

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
    // Stop and API cancellation share the same authoritative fence, even if the root turn already ended.
    await this.prisma.$transaction(async tx => {
      const items = await tx.outcomeWorkItem.findMany({
        where: { id: { in: [...workItemIds] }, executorType: "agent" },
        orderBy: [{ outcomeId: "asc" }, { id: "asc" }], select: { id: true, outcomeId: true },
      });
      for (const item of items) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${item.outcomeId}`}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-work-item:${item.id}`}))`;
        const current = await tx.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } });
        if (!["completed", "failed", "cancelled", "accepted"].includes(current.status))
          await transitionWorkItem(tx, { workItemId: item.id, to: "cancelled", reason: "outcome_stopped", actor: "system:outcome-runtime" });
      }
    });
    const runs = await this.prisma.run.findMany({ where: { outcomeWorkItemId: { in: [...workItemIds] } } });
    return this.cancelRunGroups(runs);
  });

  cancelChatBranch = (channelId: string, branchId: string) => serviceEffect(async () => {
    const runs = await this.prisma.$transaction(async tx => {
      const scoped = await tx.$queryRaw<Array<{ id: string; botId: string }>>(Prisma.sql`
        SELECT DISTINCT r.id, r."botId" FROM outcomego_run r
        JOIN outcomego_channel c ON c.id = r."channelId" AND c.kind = 'bot_dm' AND c."archivedAt" IS NULL
        JOIN outcomego_inbox_event i ON i."runId" = r.id
        JOIN outcomego_channel_message m ON m."channelId" = c.id AND m.id::text = i.payload->>'replyToMessageId'
        WHERE c.id = ${channelId}::uuid AND r.origin = 'user' AND m.metadata->'branched' = 'true'::jsonb
          AND m.metadata->>'questionScopeId' = ${branchId}
        ORDER BY r."botId", r.id`);
      for (const run of scoped) await stopRequestProgress(tx, run.botId, run.id);
      return scoped;
    });
    return this.cancelRunGroups(runs);
  });

  private async cancelRunGroups(runs: readonly { id: string; botId: string }[]) {
    if (!runs.length) return { ok: true };
    const allRunIds = new Set(runs.map(run => run.id));
    const runIdsByBot = new Map<string, Set<string>>();
    for (const run of runs) {
      if (!runIdsByBot.has(run.botId)) runIdsByBot.set(run.botId, new Set());
      runIdsByBot.get(run.botId)!.add(run.id);
    }
    const stoppedChildren = new Set<string>();
    let incomplete = false;
    const attempt = async (operation: () => Promise<unknown>) => {
      try { await operation(); return true; }
      catch { incomplete = true; return false; }
    };
    for (const run of runs) await attempt(() => runCancellation(this.cancel(run.id)));
    // Drain nested workers, including a child created just before its parent's cancellation arrived.
    while (true) {
      const captured = await this.prisma.$transaction(async tx => {
        // Reserve the binding before effects. Resume takes this same parent lifecycle lock.
        for (const botId of [...runIdsByBot.keys()].sort()) await lockAgentLifecycle(tx, botId);
        const candidates = await tx.subagent.findMany({
          where: { id: { notIn: [...stoppedChildren] }, OR: [
            { parentRunId: { in: [...allRunIds] } },
            { attempts: { some: { parentRunId: { in: [...allRunIds] } } } },
          ] }, orderBy: { id: "asc" }, select: { id: true },
        });
        const captured: Array<{ childId: string; botId: string; runIds: string[] }> = [];
        for (const candidate of candidates) {
          // Steering and periodic task continuation also update this row before committing a new run.
          await tx.$queryRaw`SELECT id FROM "outcomego_subagent" WHERE id = ${candidate.id}::uuid FOR UPDATE`;
          const child = await tx.subagent.findUnique({
            where: { id: candidate.id }, include: { attempts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
          });
          if (!child) continue;
          const ownedAttempts = child.attempts.filter(entry => allRunIds.has(entry.parentRunId));
          const ids = new Set(ownedAttempts.flatMap(entry => entry.childRunId ? [entry.childRunId] : []));
          if (allRunIds.has(child.parentRunId) && child.currentRunId) ids.add(child.currentRunId);
          // Attempts keep the latest steered run. Resolve their original mailbox identities as well.
          const keys = ownedAttempts.flatMap(entry => [
            `subagent:${child.id}:resume:${entry.parentToolCallId}`,
            ...(entry.parentToolCallId.startsWith("continuation:") ? [entry.parentToolCallId] : []),
          ]);
          if (child.attempts[0] && allRunIds.has(child.attempts[0].parentRunId)) keys.push(`subagent:${child.id}:initial`);
          for (const inbox of await tx.inboxEvent.findMany({
            where: { botId: child.childBotId, idempotencyKey: { in: keys } }, select: { runId: true },
          })) ids.add(inbox.runId);
          // Scope updates retain each steering run. A resume entry starts the next parent's segment.
          let parentRunId = child.attempts[0]?.parentRunId ?? child.parentRunId;
          for (const update of Array.isArray(child.scopeUpdates) ? child.scopeUpdates : []) {
            if (!update || typeof update !== "object" || Array.isArray(update)) continue;
            const binding = child.attempts.find(entry => entry.parentToolCallId === update.callId);
            if (binding) parentRunId = binding.parentRunId;
            if (allRunIds.has(parentRunId) && typeof update.runId === "string") ids.add(update.runId);
          }
          const now = new Date();
          const stopped = await tx.subagent.updateMany({
            where: { id: child.id, currentRunId: child.currentRunId, parentRunId: { in: [...allRunIds] }, status: { in: ["provisioning", "queued", "running", "waiting"] } },
            data: { status: "stopped", stoppedAt: now, completedAt: now, nextCheckAt: null },
          });
          await tx.subagentAttempt.updateMany({
            where: { id: { in: ownedAttempts.map(entry => entry.id) }, status: { in: ["provisioning", "queued", "running", "waiting"] } },
            data: { status: "stopped", stoppedAt: now, completedAt: now },
          });
          if (stopped.count)
            await appendEvent(tx, "subagent.stopped", child.id, { parentBotId: child.parentBotId, subagentId: child.id, runId: child.currentRunId, callId: "outcome-cancel" });
          const ownedRuns = await tx.run.findMany({ where: { botId: child.childBotId, id: { in: [...ids] } }, select: { id: true } });
          captured.push({ childId: child.id, botId: child.childBotId, runIds: ownedRuns.map(run => run.id) });
        }
        return captured;
      });
      if (!captured.length) break;
      for (const child of captured) {
        if (!runIdsByBot.has(child.botId)) runIdsByBot.set(child.botId, new Set());
        for (const runId of child.runIds) {
          allRunIds.add(runId);
          runIdsByBot.get(child.botId)!.add(runId);
          await attempt(() => runCancellation(this.cancel(runId)));
        }
        stoppedChildren.add(child.childId);
      }
    }
    const remaining = await this.prisma.subagent.count({
      where: { parentRunId: { in: [...allRunIds] }, status: { in: ["provisioning", "queued", "running", "waiting"] } },
    });
    for (const [botId, ids] of runIdsByBot) {
      const runIds = [...ids];
      if (!runIds.length) continue;
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
  }

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
