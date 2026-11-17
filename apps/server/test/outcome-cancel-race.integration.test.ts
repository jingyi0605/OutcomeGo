import { expect, test } from "bun:test";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { COMPUTER_API_PATHS } from "@outcomego/contracts/service-protocol";
import { enqueueOutcomeTurn, transitionWorkItem, type ToolContext } from "@outcomego/messaging";
import { Effect } from "effect";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeService } from "../src/services/outcome-service";
import { RunService } from "../src/services/run-service";
import { SubagentService } from "../src/services/subagent/service";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const actor = "owner:local" as const;

for (const owner of ["user", "outcome"] as const) for (const phase of ["before", "after"] as const) {
  test.skipIf(!url)(`Outcome cancel preserves a real ${owner} Task resume ${phase} binding reservation`, async () => {
    const h = await outcomeThreadFixture();
    let childId: string | undefined;
    let childChannelId: string | null = null;
    let resumed: Promise<string> | undefined;
    const requests: Array<{ path: string; ids: string[] }> = [];
    const shells = new Set<string>();
    let remoteReady = phase === "after";
    try {
      await h.store.writeRootSettings({});
      await h.store.writeInferenceSettings({ providerId: "openai-codex", modelId: "fixture-model", reasoning: "low" });
      const item = await h.item();
      const first = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
        workItemId: item.id, content: "Read sources", reason: "start", clientId: `start:${item.id}`,
      }));
      const rootId = (first as { runId: string }).runId;
      await h.db.run.update({ where: { id: rootId }, data: { status: "running" } });
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
      const context = (runId: string, origin: "user" | "outcome", callId: string): ToolContext => ({
        botId: h.bot.id, runId, conversationId: h.bot.conversation!.id, channelId: h.channel.id,
        origin, callId, deliveryId: null, replyToMessageId: null, isFork: false,
      });
      const tasks = new SubagentService(h.db, h.messaging, {} as never, h.root, async () => Response.json({ ok: true }), h.store);
      await tasks.task(context(rootId, "outcome", "original"), { description: "Read sources", prompt: "Read only", subagent_type: "executor" });
      const child = await h.db.subagent.findFirstOrThrow({ where: { parentRunId: rootId } });
      childId = child.childBotId;
      childChannelId = (await h.db.run.findUniqueOrThrow({ where: { id: child.currentRunId! } })).channelId;
      const originalRunId = child.currentRunId!;
      await h.db.bot.update({ where: { id: child.childBotId }, data: { status: "active" } });
      // A steered turn replaced the original attempt's run while its old command still lives.
      const steered = await h.db.$transaction(tx => h.messaging.enqueueWake(tx, {
        botId: child.childBotId, channelId: childChannelId!, origin: "agent", type: "subagent.steer",
        content: "Read updated scope", clientId: `subagent-steer:${child.id}`, priority: 350,
      }));
      await h.db.run.update({ where: { id: originalRunId }, data: { status: "running" } });
      await h.db.run.update({ where: { id: steered.run.id }, data: { status: "completed" } });
      await h.db.subagentAttempt.update({ where: { childRunId: originalRunId }, data: { childRunId: steered.run.id, status: "waiting" } });
      await h.db.subagent.update({ where: { id: child.id }, data: {
        currentRunId: steered.run.id, status: "waiting", nextCheckAt: null,
        scopeUpdates: [{ callId: "steer", runId: steered.run.id, message: "Read updated scope" }],
      } });
      await h.db.run.update({ where: { id: rootId }, data: { status: "completed" } });
      shells.add(originalRunId);
      shells.add(steered.run.id);

      let newParentRunId: string;
      if (owner === "user") {
        const wake = await h.db.$transaction(tx => h.messaging.enqueueWake(tx, {
          botId: h.bot.id, channelId: h.channel.id, origin: "user", type: "user.message",
          clientId: `main:${item.id}`, content: "New independent request", priority: 300,
        }));
        newParentRunId = wake.run.id;
      } else {
        const outcome = await h.db.outcome.create({ data: { botId: h.bot.id, title: "Independent Outcome" } });
        const revision = await h.db.outcomeContractRevision.create({ data: {
          outcomeId: outcome.id, revision: 1, status: "approved", approvedAt: new Date(), approvedBy: actor,
          goal: ["Independent task"], boundaries: {}, executionBotId: h.bot.id, contentHash: "independent", createdBy: actor,
        } });
        await h.db.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: revision.id, status: "approved" } });
        const work = await h.db.outcomeWorkItem.create({ data: {
          outcomeId: outcome.id, contractRevisionId: revision.id, botId: h.bot.id, executorType: "agent",
          status: "queued", title: "Independent work", instructions: "Read only", ordinal: 1,
        } });
        const wake = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
          workItemId: work.id, content: "Independent work", reason: "start", clientId: `start:${work.id}`,
        }));
        newParentRunId = (wake as { runId: string }).runId;
        await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: work.id, to: "running", reason: "claimed", actor }));
      }
      await h.db.run.update({ where: { id: newParentRunId }, data: { status: "running" } });
      let resumePid: number | undefined;
      const resumeDb = new Proxy(h.db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (write: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(async tx => {
          const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          resumePid = row!.pid;
          return write(tx);
        });
      } });
      const resume = async () => {
        const service = new SubagentService(resumeDb, h.messaging, {} as never, h.root, async () => Response.json({ ok: true }), h.store);
        await service.task(context(newParentRunId, owner, "new-owner"), {
          resume: `sand-subagent-${child.id}`, description: "Independent request", prompt: "Read the new task only.",
        });
        const current = await h.db.subagent.findUniqueOrThrow({ where: { id: child.id } });
        shells.add(current.currentRunId!);
        await h.db.run.update({ where: { id: current.currentRunId! }, data: { status: "running" } });
        await h.db.botRunLease.create({ data: { botId: child.childBotId, scope: "foreground", runId: current.currentRunId!, ownerId: "fixture", expiresAt: new Date(Date.now() + 60_000) } });
        return current.currentRunId!;
      };
      let reserved = false;
      const cancellationDb = new Proxy(h.db, { get(target, property) {
        if (property === "subagent") return new Proxy(target.subagent, { get(delegate, method) {
          if (method !== "findUnique") return Reflect.get(delegate, method);
          return async (query: Parameters<typeof target.subagent.findUnique>[0]) => {
            const current = await delegate.findUnique(query);
            // Reproduce the old discovery/effects gap if cancellation reads the binding without a lock.
            if (phase === "after" && !resumed && current?.id === child.id) { resumed = resume(); await resumed; }
            return current;
          };
        } });
        if (property !== "$transaction") return Reflect.get(target, property);
        return async (write: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          if (reserved) return target.$transaction(write);
          reserved = true;
          if (phase === "before") { resumed = resume(); await resumed; }
          return target.$transaction(async tx => {
            const delegate = new Proxy(tx.subagent, { get(delegate, method) {
              if (method !== "findUnique") return Reflect.get(delegate, method);
              return async (query: Parameters<typeof tx.subagent.findUnique>[0]) => {
                const current = await delegate.findUnique(query);
                if (phase === "after" && !resumed && current?.id === child.id) {
                  resumed = resume();
                  let waiting = false;
                  for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
                    if (resumePid) {
                      const [activity] = await h.db.$queryRaw<Array<{ wait_event: string | null }>>`
                        SELECT wait_event FROM pg_stat_activity WHERE pid = ${resumePid}`;
                      waiting = activity?.wait_event === "advisory";
                    }
                    if (!waiting) await Bun.sleep(5);
                  }
                  expect(waiting).toBe(true);
                }
                return current;
              };
            } });
            return write(new Proxy(tx, { get(target, key) { return key === "subagent" ? delegate : Reflect.get(target, key); } }));
          });
        };
      } }) as PrismaClient;
      const runs = new RunService(cancellationDb, async (path, init) => {
        if (resumed) await resumed;
        const body = init.body ? JSON.parse(String(init.body)) : {};
        requests.push({ path, ids: body.runIds ?? [] });
        if (path.endsWith("/stop-runs")) {
          if (!remoteReady) return new Response("Not found", { status: 404 });
          for (const id of body.runIds) shells.delete(id);
        }
        if (path === COMPUTER_API_PATHS.backgroundShellsStop(child.childBotId)) shells.clear();
        return Response.json({ ok: true });
      });
      const service = new OutcomeService(h.db, h.messaging, runs);
      const input = { clientRequestId: `cancel:${item.id}` };
      const firstCancel = await Effect.runPromise(Effect.either(service.cancel(h.outcome.id, input, actor)));
      if (!remoteReady) {
        expect(firstCancel._tag).toBe("Left");
        if (firstCancel._tag === "Left") expect(firstCancel.left).toMatchObject({ code: "outcome_stop_incomplete", details: { retryable: true } });
        expect((await h.db.outcome.findUniqueOrThrow({ where: { id: h.outcome.id } })).cancelledAt).not.toBeNull();
        remoteReady = true;
        await Effect.runPromise(service.cancel(h.outcome.id, input, actor));
      } else expect(firstCancel._tag).toBe("Right");
      expect(reserved).toBe(true);
      expect(resumed).toBeDefined();
      const newRunId = await resumed!;
      expect(shells.has(originalRunId)).toBe(false);
      expect(shells.has(steered.run.id)).toBe(false);
      expect(shells.has(newRunId)).toBe(true);
      expect((await h.db.run.findUniqueOrThrow({ where: { id: originalRunId } })).status).toBe("cancelled");
      expect((await h.db.run.findUniqueOrThrow({ where: { id: newRunId } })).status).toBe("running");
      expect((await h.db.run.findUniqueOrThrow({ where: { id: newParentRunId } })).status).toBe("running");
      const current = await h.db.subagent.findUniqueOrThrow({ where: { id: child.id } });
      expect(current.parentRunId).toBe(newParentRunId);
      expect(current.currentRunId).toBe(newRunId);
      expect(current.status).toBe("queued");
      expect((await h.db.subagentAttempt.findUniqueOrThrow({ where: { childRunId: newRunId } })).status).toBe("queued");
      expect(await h.db.botRunLease.count({ where: { botId: child.childBotId, runId: newRunId } })).toBe(1);
      expect(requests.every(request => !request.path.endsWith("/background-shells/stop"))).toBe(true);
      expect(requests.some(request => request.path === COMPUTER_API_PATHS.turnCancel(newRunId))).toBe(false);
      const stops = requests.filter(request => request.path === COMPUTER_API_PATHS.backgroundShellRunsStop(child.childBotId));
      expect(stops.length).toBeGreaterThan(0);
      expect(stops.every(request => !request.ids.includes(newRunId))).toBe(true);
    } finally {
      await resumed?.catch(() => undefined);
      await h.db.idempotencyRecord.deleteMany({ where: { scope: `subagent-task:${h.bot.id}` } });
      if (childId) await h.db.bot.delete({ where: { id: childId } });
      if (childChannelId) await h.db.channel.delete({ where: { id: childChannelId } });
      await h.cleanup();
    }
  }, 15_000);
}
