import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoutineService, wakeAutomationParent } from "@outcomego/messaging";
import type { ComputerEvent } from "@outcomego/contracts";
import { recover } from "../../server/src/services/startup-recovery";
import { dispatchComputerTurn } from "../src/runtime-dispatch";
import { AUTOMATION_RETRY_DELAYS_MS, WakeWorker } from "../src/worker";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;

type Claimed = { runId: string; inboxId: string; botId: string; ownerId: string; attempt: number };
type Internals = {
  boss: { send: (...args: unknown[]) => Promise<unknown> };
  claim(botId: string): Promise<Claimed | null>;
  fail(claimed: Claimed, error: unknown, interrupted?: boolean): Promise<void>;
  settleCompletedWake(claimed: Claimed): Promise<void>;
  heartbeat(claimed: Claimed): Promise<void>;
  projection: { apply(runId: string, conversationId: string, botId: string, event: ComputerEvent, attempt?: Claimed): Promise<boolean> };
  syncRoutineRunFile(botId: string, runId: string): Promise<void>;
};

const outage = () => new Error('500: {"message":"upstream exploded","type":"server_error"}');

test.skipIf(!databaseUrl)("a buffered completion after Stop settles cancellation without retaining its lease", async () => {
  const h = await harness("Stop before buffered completion");
  try {
    const claimed = (await h.internals.claim(h.botId))!;
    await h.db.run.update({ where: { id: claimed.runId }, data: {
      status: "cancelled", completedAt: new Date(), error: { code: "cancelled_by_user", message: "Stopped" },
    } });
    await h.internals.projection.apply(claimed.runId, h.conversationId, h.botId,
      { type: "turn.completed", turnId: claimed.runId, status: "completed" });
    expect((await h.db.run.findUniqueOrThrow({ where: { id: claimed.runId } })).status).toBe("cancelled");
    await h.internals.settleCompletedWake(claimed);
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } })).status).toBe("failed");
    expect(await h.db.botRunLease.count({ where: { runId: claimed.runId } })).toBe(0);
    expect((await h.db.run.findUniqueOrThrow({ where: { id: claimed.runId } })).status).toBe("cancelled");
    expect((await h.db.routineExecution.findFirstOrThrow({ where: { routineId: h.routineId } })).status).toBe("cancelled");
  } finally {
    await h.cleanup();
  }
}, 30_000);

const harness = async (name: string) => {
  const root = await mkdtemp(join(tmpdir(), "automation-retry-"));
  const keys = ["DATABASE_URL", "OUTCOMEGO_WORKSPACE_ROOT", "OUTCOMEGO_AGENT_DATA_ROOT"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { DATABASE_URL: databaseUrl, OUTCOMEGO_WORKSPACE_ROOT: root, OUTCOMEGO_AGENT_DATA_ROOT: join(root, "data") });
  const worker = new WakeWorker();
  const internals = worker as unknown as Internals;
  const sent: unknown[][] = [];
  internals.boss.send = async (...args: unknown[]) => { sent.push(args); return "job"; };
  (worker.messaging as unknown as { boss: unknown }).boss = { send: async () => "job", sendDebounced: async () => "job" };
  const db = worker.prisma;
  const botId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  const bot = await db.bot.create({ data: { id: botId, name, defaultDirectory: root, status: "active", onboardingStatus: "completed", conversation: { create: {} } }, include: { conversation: true } });
  await db.channel.create({ data: { id: channelId, kind: "bot_dm", name, directKey: `bot:${botId}`, members: { create: { botId, ordinal: 0 } } } });
  const routines = new RoutineService(db, worker.messaging);
  const routine = await routines.mutate(botId, crypto.randomUUID(), null, { action: "create", name: "Morning brief", prompt: "Send the morning brief.", schedule: "@every 1h" }) as { id: string };
  await db.routine.update({ where: { id: routine.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  expect(await routines.dispatchDue()).toBe(1);
  return {
    worker, internals, db, botId, channelId, conversationId: bot.conversation!.id, routineId: routine.id, sent,
    // Make the requeued wake claimable now instead of after its backoff.
    due: () => db.inboxEvent.updateMany({ where: { botId, status: "pending" }, data: { availableAt: new Date(Date.now() - 1000) } }),
    cleanup: async () => {
      await db.bot.deleteMany({ where: { id: botId } });
      await db.channel.deleteMany({ where: { id: channelId } });
      await worker.stop();
      for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
      await rm(root, { recursive: true, force: true });
    },
  };
};

test.skipIf(!databaseUrl)("chaos: a routine run that fails before acting is retried with backoff, then fails for good", async () => {
  const h = await harness("Outage retry");
  try {
    const first = await h.internals.claim(h.botId);
    expect(first).not.toBeNull();
    for (const [index, delay] of AUTOMATION_RETRY_DELAYS_MS.entries()) {
      const claimed = index === 0 ? first! : await h.internals.claim(h.botId);
      // The same run and wake come back, so the routine's execution stays the one that fired.
      expect(claimed?.runId).toBe(first!.runId);
      // Every turn starts by recording its prompt fingerprint, before the model is called.
      await h.db.runItem.create({ data: { runId: claimed!.runId, upstreamItemId: `prompt:${claimed!.runId}:${crypto.randomUUID()}`, kind: "tool", status: "completed", title: "promptFingerprint", content: { type: "promptFingerprint" } } });
      // The model provider is down for the whole attempt.
      await h.db.run.update({ where: { id: claimed!.runId }, data: { status: "failed" } });
      const before = Date.now();
      await h.internals.fail(claimed!, outage());
      const wake = await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed!.inboxId } });
      expect(wake.status).toBe("pending");
      expect(wake.availableAt.getTime()).toBeGreaterThanOrEqual(before + delay - 1000);
      expect((await h.db.run.findUniqueOrThrow({ where: { id: claimed!.runId } })).status).toBe("queued");
      expect(h.sent.at(-1)).toEqual(["bot-wake", { botId: h.botId }, expect.objectContaining({ startAfter: delay / 1000 })]);
      // The routine is not reported failed while a retry is pending.
      expect((await h.db.routineExecution.findFirstOrThrow({ where: { routineId: h.routineId } })).status).toBe("running");
      await h.due();
    }
    const last = await h.internals.claim(h.botId);
    await h.db.run.update({ where: { id: last!.runId }, data: { status: "failed" } });
    await h.internals.fail(last!, outage());
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: last!.inboxId } })).status).toBe("failed");
    expect((await h.db.routineExecution.findFirstOrThrow({ where: { routineId: h.routineId } })).status).toBe("failed");
  } finally {
    await h.cleanup();
  }
}, 30000);

test.skipIf(!databaseUrl)("chaos: a routine run that already ran a tool is not retried", async () => {
  const h = await harness("Acted once");
  try {
    const claimed = await h.internals.claim(h.botId);
    await h.db.runItem.create({ data: { runId: claimed!.runId, kind: "tool", status: "completed", content: { name: "UpdateMemory" } } });
    await h.db.run.update({ where: { id: claimed!.runId }, data: { status: "failed" } });
    await h.internals.fail(claimed!, outage());
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed!.inboxId } })).status).toBe("failed");
    expect((await h.db.routineExecution.findFirstOrThrow({ where: { routineId: h.routineId } })).status).toBe("failed");
    expect(h.sent.filter(([queue]) => queue === "bot-wake")).toEqual([]);
  } finally {
    await h.cleanup();
  }
}, 30000);

test.skipIf(!databaseUrl)("chaos: a routine paused after it fired is not retried", async () => {
  const h = await harness("Paused");
  try {
    const claimed = await h.internals.claim(h.botId);
    await h.db.routine.update({ where: { id: h.routineId }, data: { enabled: false, pausedAt: new Date() } });
    await h.db.run.update({ where: { id: claimed!.runId }, data: { status: "failed" } });
    await h.internals.fail(claimed!, outage());
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed!.inboxId } })).status).toBe("failed");
  } finally {
    await h.cleanup();
  }
}, 30000);

test.skipIf(!databaseUrl)("chaos: a routine's handoff to the parent survives a failed parent turn", async () => {
  const h = await harness("Handoff retry");
  try {
    const routineRun = await h.internals.claim(h.botId);
    // The routine finished and handed its result to the parent.
    const handoff = await wakeAutomationParent(h.worker.messaging, {
      botId: h.botId, conversationId: h.conversationId, channelId: h.channelId, runId: routineRun!.runId,
      callId: crypto.randomUUID(), origin: "routine", isFork: false, deliveryId: null, replyToMessageId: null,
    }, { message: "The brief is ready: rain at 9am." });
    await h.db.run.update({ where: { id: routineRun!.runId }, data: { status: "completed", completedAt: new Date() } });
    await h.db.inboxEvent.update({ where: { id: routineRun!.inboxId }, data: { status: "completed", completedAt: new Date() } });
    await h.db.botRunLease.deleteMany({ where: { botId: h.botId } });
    const parentTurn = await h.internals.claim(h.botId);
    expect(parentTurn?.runId).toBe(handoff.run_id);
    // The parent's turn hits the provider outage before it can message the user.
    await h.db.run.update({ where: { id: parentTurn!.runId }, data: { status: "failed" } });
    await h.internals.fail(parentTurn!, outage());
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: parentTurn!.inboxId } })).status).toBe("pending");
    await h.due();
    // The same handoff is offered again, so the user still gets the result.
    expect((await h.internals.claim(h.botId))?.runId).toBe(handoff.run_id);
  } finally {
    await h.cleanup();
  }
}, 30000);

for (const settled of [false, true]) {
  test.skipIf(!databaseUrl)(`a former routine wake owner cannot fail a ${settled ? "completed" : "live"} reclaimed attempt`, async () => {
    const h = await harness("Reclaimed owner fence");
    try {
      const former = (await h.internals.claim(h.botId))!;
      await h.db.inboxEvent.update({ where: { id: former.inboxId }, data: { claimedAt: new Date(Date.now() - 180_000) } });
      await h.db.botRunLease.updateMany({ where: { runId: former.runId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      const successor = await h.internals.claim(h.botId);
      expect(successor?.runId).toBe(former.runId);
      const successorLease = await h.db.botRunLease.findFirstOrThrow({ where: { runId: former.runId } });
      if (settled) {
        await h.db.run.update({ where: { id: former.runId }, data: { status: "completed", completedAt: new Date() } });
        await h.db.inboxEvent.update({ where: { id: former.inboxId }, data: { status: "completed", completedAt: new Date() } });
        await h.db.botRunLease.deleteMany({ where: { runId: former.runId } });
      }
      await h.internals.fail(former, outage());
      expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: former.inboxId } })).status).toBe(settled ? "completed" : "processing");
      expect((await h.db.run.findUniqueOrThrow({ where: { id: former.runId } })).status).toBe(settled ? "completed" : "running");
      if (!settled) expect((await h.db.botRunLease.findFirstOrThrow({ where: { runId: former.runId } })).ownerId).toBe(successorLease.ownerId);
      expect(h.sent.filter(([queue]) => queue === "bot-wake")).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  }, 30_000);
}

test.skipIf(!databaseUrl)("projected completion settles its inbox after a current-owner failure", async () => {
  const h = await harness("Projected completion recovery");
  try {
    const claimed = (await h.internals.claim(h.botId))!;
    await h.internals.projection.apply(claimed.runId, h.conversationId, h.botId,
      { type: "turn.completed", turnId: claimed.runId, status: "completed" });
    await h.internals.fail(claimed, new Error("settlement failed after completion projection"));
    expect((await h.db.run.findUniqueOrThrow({ where: { id: claimed.runId } })).status).toBe("completed");
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } })).status).toBe("completed");
    expect(await h.db.botRunLease.count({ where: { runId: claimed.runId } })).toBe(0);
    expect((await h.db.routineExecution.findFirstOrThrow({ where: { runId: claimed.runId } })).status).toBe("completed");
    expect(await h.db.event.count({ where: { topic: "run.interrupted", entityId: claimed.runId } })).toBe(0);
  } finally {
    await h.cleanup();
  }
}, 30_000);

test.skipIf(!databaseUrl)("completed settlement retries its file reconciliation without reopening the run", async () => {
  const h = await harness("Completed file recovery");
  try {
    const claimed = (await h.internals.claim(h.botId))!;
    await h.internals.projection.apply(claimed.runId, h.conversationId, h.botId,
      { type: "turn.completed", turnId: claimed.runId, status: "completed" });
    await h.db.inboxEvent.update({ where: { id: claimed.inboxId }, data: { status: "completed", completedAt: new Date() } });
    await h.db.botRunLease.deleteMany({ where: { runId: claimed.runId } });
    let synced = 0;
    h.internals.syncRoutineRunFile = async () => { synced++; };
    await h.internals.fail(claimed, new Error("routine file sync failed after settlement"));
    expect(synced).toBe(1);
    const run = await h.db.run.findUniqueOrThrow({ where: { id: claimed.runId } });
    expect(run.status).toBe("completed");
    expect(run.memoryReviewPending).toBe(false);
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } })).status).toBe("completed");
    expect(await h.db.event.count({ where: { topic: "inbox.completed", entityId: claimed.inboxId } })).toBe(0);
  } finally {
    await h.cleanup();
  }
}, 30_000);

for (const state of ["running", "backoff", "failed", "completed"] as const) {
  test.skipIf(!databaseUrl)(`attempt fencing rejects old dispatch, results and failure after the successor is ${state}`, async () => {
    const h = await harness(`Late owner: ${state}`);
    try {
      const former = (await h.internals.claim(h.botId))!;
      await h.db.inboxEvent.update({ where: { id: former.inboxId }, data: { claimedAt: new Date(Date.now() - 180_000) } });
      await h.db.botRunLease.updateMany({ where: { runId: former.runId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      const successor = (await h.internals.claim(h.botId))!;
      expect(successor.attempt).toBe(former.attempt + 1);
      if (state === "backoff") await h.internals.fail(successor, outage());
      if (state === "failed") {
        await h.db.runItem.create({ data: { runId: successor.runId, kind: "command", status: "completed", content: {} } });
        await h.db.run.update({ where: { id: successor.runId }, data: { status: "failed" } });
        await h.internals.fail(successor, outage());
      }
      if (state === "completed") {
        expect(await h.internals.projection.apply(successor.runId, h.conversationId, h.botId,
          { type: "turn.completed", turnId: successor.runId, status: "completed" }, successor)).toBe(true);
        await h.internals.settleCompletedWake(successor);
      }
      const before = await h.db.run.findUniqueOrThrow({ where: { id: former.runId } });
      const wake = await h.db.inboxEvent.findUniqueOrThrow({ where: { id: former.inboxId } });
      const events = await h.db.event.count({ where: { entityId: former.runId } });
      let sends = 0;
      await expect(dispatchComputerTurn(h.db, former.runId, async () => {
        sends++; return Response.json({ accepted: true });
      }, 1000, former)).rejects.toThrow("superseded");
      expect(sends).toBe(0);
      for (const event of [
        { type: "agent.delta", turnId: former.runId, itemId: "stale-answer", delta: "obsolete" },
        { type: "turn.completed", turnId: former.runId, status: "failed" },
        { type: "turn.completed", turnId: former.runId, status: "completed" },
      ] satisfies ComputerEvent[]) {
        expect(await h.internals.projection.apply(former.runId, h.conversationId, h.botId, event, former)).toBe(false);
      }
      await h.internals.fail(former, outage());
      await h.internals.settleCompletedWake(former);
      expect(await h.db.run.findUniqueOrThrow({ where: { id: former.runId } })).toEqual(before);
      expect(await h.db.inboxEvent.findUniqueOrThrow({ where: { id: former.inboxId } })).toEqual(wake);
      expect(await h.db.event.count({ where: { entityId: former.runId } })).toBe(events);
      expect(await h.db.message.count({ where: { runId: former.runId, upstreamItemId: "stale-answer" } })).toBe(0);
    } finally { await h.cleanup(); }
  }, 30_000);
}

for (const status of ["completed", "cancelled"] as const) {
  test.skipIf(!databaseUrl)(`a replacement worker settles durable ${status} projection after the first worker stops`, async () => {
    const h = await harness(`Restart settlement: ${status}`);
    let replacement: WakeWorker | undefined;
    try {
      const claimed = (await h.internals.claim(h.botId))!;
      if (status === "cancelled") await h.db.run.update({
        where: { id: claimed.runId },
        data: { status, error: { code: "cancelled_by_user" }, completedAt: new Date() },
      });
      await h.internals.projection.apply(claimed.runId, h.conversationId, h.botId,
        { type: "turn.completed", turnId: claimed.runId, status: "completed" }, claimed);
      await h.db.botRunLease.updateMany({ where: { runId: claimed.runId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await h.worker.stop();
      replacement = new WakeWorker();
      replacement.boss.send = async () => "job";
      (replacement.messaging as unknown as { boss: unknown }).boss = { send: async () => "job", sendDebounced: async () => "job" };
      await replacement.kickStalledWakes();
      await replacement.kickStalledWakes();
      expect((await replacement.prisma.run.findUniqueOrThrow({ where: { id: claimed.runId } })).status).toBe(status);
      expect((await replacement.prisma.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } })).status)
        .toBe(status === "completed" ? "completed" : "failed");
      expect(await replacement.prisma.botRunLease.count({ where: { runId: claimed.runId } })).toBe(0);
      expect((await replacement.prisma.routineExecution.findUniqueOrThrow({ where: { runId: claimed.runId } })).status).toBe(status);
      expect(await replacement.prisma.event.count({ where: { topic: "inbox.completed", entityId: claimed.inboxId } }))
        .toBe(status === "completed" ? 1 : 0);
    } finally { await replacement?.stop(); await h.cleanup(); }
  }, 30_000);
}

test.skipIf(!databaseUrl)("a lost retry notification is recovered from its durable due time after worker restart", async () => {
  const h = await harness("Lost queue notification");
  let replacement: WakeWorker | undefined;
  try {
    const claimed = (await h.internals.claim(h.botId))!;
    h.internals.boss.send = async () => { throw new Error("queue notification unavailable"); };
    await expect(h.internals.fail(claimed, outage())).rejects.toThrow("queue notification unavailable");
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } })).status).toBe("pending");
    await h.worker.stop();
    replacement = new WakeWorker();
    const sent: unknown[] = [];
    replacement.boss.send = async (...args) => { sent.push(args); return "job"; };
    await replacement.kickStalledWakes();
    expect(sent).toHaveLength(0);
    await h.due();
    await replacement.kickStalledWakes();
    expect(sent).toHaveLength(1);
    const next = await (replacement as unknown as Internals).claim(h.botId);
    expect(next?.runId).toBe(claimed.runId);
    expect(next?.attempt).toBe(2);
  } finally { await replacement?.stop(); await h.cleanup(); }
}, 30_000);

test.skipIf(!databaseUrl)("a failed settlement transaction is retried without demoting the projected completion", async () => {
  const h = await harness("Settlement transaction outage");
  try {
    const claimed = (await h.internals.claim(h.botId))!;
    await h.internals.projection.apply(claimed.runId, h.conversationId, h.botId,
      { type: "turn.completed", turnId: claimed.runId, status: "completed" }, claimed);
    const schedule = h.worker.messaging.scheduleTranscriptProjection;
    h.worker.messaging.scheduleTranscriptProjection = async () => { throw new Error("transaction unavailable"); };
    try {
      await expect(h.internals.settleCompletedWake(claimed)).rejects.toThrow("transaction unavailable");
      expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } })).status).toBe("processing");
    } finally { h.worker.messaging.scheduleTranscriptProjection = schedule; }
    await h.internals.fail(claimed, new Error("transaction unavailable"));
    expect((await h.db.run.findUniqueOrThrow({ where: { id: claimed.runId } })).status).toBe("completed");
    expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } })).status).toBe("completed");
    expect(await h.db.event.count({ where: { topic: "inbox.completed", entityId: claimed.inboxId } })).toBe(1);
    expect(await h.db.event.count({ where: { topic: "run.interrupted", entityId: claimed.runId } })).toBe(0);
  } finally { await h.cleanup(); }
}, 30_000);

test.skipIf(!databaseUrl)("an expired worker cannot resurrect its lease or project a late completion before takeover", async () => {
  const h = await harness("Expired heartbeat");
  try {
    const claimed = (await h.internals.claim(h.botId))!;
    await h.db.botRunLease.updateMany({ where: { runId: claimed.runId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const before = await h.db.botRunLease.findUniqueOrThrow({ where: { runId: claimed.runId } });
    await h.internals.heartbeat(claimed);
    expect(await h.db.botRunLease.findUniqueOrThrow({ where: { runId: claimed.runId } })).toEqual(before);
    expect(await h.internals.projection.apply(claimed.runId, h.conversationId, h.botId,
      { type: "turn.completed", turnId: claimed.runId, status: "completed" }, claimed)).toBe(false);
    expect((await h.db.run.findUniqueOrThrow({ where: { id: claimed.runId } })).status).toBe("running");
  } finally { await h.cleanup(); }
}, 30_000);

for (const receipt of ["plugin-invocation", "external-delivery"] as const) {
  test.skipIf(!databaseUrl)(`a durable ${receipt} prevents automation retry even when its streamed tool item was lost`, async () => {
    const h = await harness("Durable external action");
    let installationId: string | undefined;
    try {
      const claimed = (await h.internals.claim(h.botId))!;
      const installation = await h.db.pluginInstallation.create({ data: {
        pluginKey: crypto.randomUUID(), version: "1", name: "Fixture", publisher: "test", manifest: {},
        connections: { create: { connectorKey: "fixture", name: "Fixture", transport: "stdio", authType: "none" } },
      }, include: { connections: true } });
      installationId = installation.id;
      const connectionId = installation.connections[0]!.id;
      if (receipt === "plugin-invocation") {
        await h.db.pluginInvocation.create({ data: {
          callId: crypto.randomUUID(), connectionId, botId: h.botId, runId: claimed.runId, toolName: "SendMessage",
        } });
      } else {
        const message = await h.db.channelMessage.create({ data: {
          channelId: h.channelId, sender: "agent", senderBotId: h.botId, clientId: crypto.randomUUID(), content: "External intent",
        } });
        await h.db.externalOutboundDelivery.create({ data: {
          callId: crypto.randomUUID(), connectionId, botId: h.botId, runId: claimed.runId,
          channelMessageId: message.id, status: "uncertain", errorCode: "external_delivery_interrupted",
        } });
      }
      await h.db.run.update({ where: { id: claimed.runId }, data: { status: "failed" } });
      await h.internals.fail(claimed, outage());
      expect((await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } })).status).toBe("failed");
      expect(await h.db.event.count({ where: { entityId: claimed.runId, topic: "run.retry_queued" } })).toBe(0);
      expect(await h.db.runItem.count({ where: { runId: claimed.runId } })).toBe(0);
      if (receipt === "external-delivery") {
        expect((await h.db.externalOutboundDelivery.findFirstOrThrow({ where: { runId: claimed.runId } })).status).toBe("uncertain");
      }
    } finally {
      if (installationId) await h.db.pluginInstallation.delete({ where: { id: installationId } });
      await h.cleanup();
    }
  }, 30_000);
}

for (const claimedParent of [false, true]) {
  test.skipIf(!databaseUrl)(`Stop of the routine root fences its ${claimedParent ? "claimed retry" : "queued handoff"} through the durable result receipt`, async () => {
    const h = await harness("Stopped handoff");
    try {
      const root = (await h.internals.claim(h.botId))!;
      const handoff = await wakeAutomationParent(h.worker.messaging, {
        botId: h.botId, conversationId: h.conversationId, channelId: h.channelId, runId: root.runId,
        callId: crypto.randomUUID(), origin: "routine", isFork: false, deliveryId: null, replyToMessageId: null,
      }, { message: "Delayed result" });
      await h.db.run.update({ where: { id: root.runId }, data: { status: "completed", completedAt: new Date() } });
      await h.db.inboxEvent.update({ where: { id: root.inboxId }, data: { status: "completed" } });
      await h.db.botRunLease.deleteMany({ where: { runId: root.runId } });
      const parent = claimedParent ? (await h.internals.claim(h.botId))! : null;
      // Simulate the durable Stop committing while transport cancellation is delayed.
      await h.db.run.update({ where: { id: root.runId }, data: { requestStoppedAt: new Date() } });
      if (parent) await h.internals.fail(parent, outage());
      expect(await h.internals.claim(h.botId)).toBeNull();
      expect((await h.db.run.findUniqueOrThrow({ where: { id: handoff.run_id } })).status)
        .toBe(claimedParent ? "interrupted" : "cancelled");
      expect(await h.db.event.count({ where: { entityId: handoff.run_id, topic: "run.retry_queued" } })).toBe(0);
    } finally { await h.cleanup(); }
  }, 30_000);
}

for (const scenario of ["claim", "retry"] as const) test.skipIf(!databaseUrl)(`bootstrap ${scenario} preserves the bot-before-run lock order of the user's first message`, async () => {
  const h = await harness("Bootstrap lock ordering");
  const locked = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let skipping: Promise<unknown> | undefined, failing: Promise<unknown> | undefined;
  try {
    await h.db.run.updateMany({ where: { botId: h.botId }, data: { origin: "bootstrap" } });
    await h.db.inboxEvent.updateMany({ where: { botId: h.botId }, data: { type: "bot.bootstrap" } });
    await h.db.bot.update({ where: { id: h.botId }, data: { onboardingStatus: "queued" } });
    const claimed = scenario === "retry" ? (await h.internals.claim(h.botId))! : null;
    const greeting = await h.db.run.findFirstOrThrow({ where: { botId: h.botId } });
    skipping = h.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "outcomego_bot" WHERE "id" = ${h.botId} FOR NO KEY UPDATE`;
      locked.resolve();
      await release.promise;
      return h.worker.messaging.skipBootstrapForUser(tx, h.botId);
    });
    await locked.promise;
    failing = scenario === "retry" ? h.internals.fail(claimed!, outage(), true) : h.internals.claim(h.botId);
    let blocked = false;
    const deadline = Date.now() + 2000;
    while (!blocked && Date.now() < deadline) {
      const rows = await h.db.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT true AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%outcomego_bot%'
          AND query NOT LIKE '%pg_stat_activity%'`;
      blocked = rows.length > 0;
      if (!blocked) await Bun.sleep(5);
    }
    expect(blocked).toBe(true);
    release.resolve();
    const results = await Promise.all([skipping, failing]);
    if (scenario === "claim") expect(results[1]).toBeNull();
    expect((await h.db.run.findUniqueOrThrow({ where: { id: greeting.id } })).status).toBe("cancelled");
    expect((await h.db.bot.findUniqueOrThrow({ where: { id: h.botId } })).onboardingStatus).toBe("skipped_by_user");
    expect(await h.db.event.count({ where: { topic: "bot.bootstrap.retry_queued", entityId: h.botId } })).toBe(0);
  } finally {
    release.resolve(); await Promise.allSettled([skipping, failing]); await h.cleanup();
  }
}, 30_000);

for (const acted of [false, true]) {
  test.skipIf(!databaseUrl)(`server restart ${acted ? "interrupts acted work" : "preserves the bounded routine retry"} without changing its identity`, async () => {
    const h = await harness("Server restart");
    try {
      const claimed = (await h.internals.claim(h.botId))!;
      if (acted) await h.db.runItem.create({ data: { runId: claimed.runId, kind: "command", status: "completed", content: {} } });
      const restart = () => recover(h.db, h.worker.boss, h.worker.messaging, async () => Response.json({ stopped: true }));
      await restart();
      await restart();
      const run = await h.db.run.findUniqueOrThrow({ where: { id: claimed.runId } });
      expect(run.status).toBe(acted ? "interrupted" : "queued");
      if (!acted) {
        expect(await h.internals.claim(h.botId)).toBeNull();
        const wake = await h.db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.inboxId } });
        expect(wake.status).toBe("pending");
        expect(wake.attempts).toBe(1);
        expect(await h.db.event.count({ where: { topic: "run.retry_queued", entityId: claimed.runId } })).toBe(1);
        // A buffered failure from the pre-restart worker cannot consume a second retry.
        await h.internals.fail(claimed, outage());
        await h.due();
        expect((await h.internals.claim(h.botId))?.attempt).toBe(2);
      } else {
        expect(await h.db.event.count({ where: { topic: "run.retry_queued", entityId: claimed.runId } })).toBe(0);
      }
    } finally { await h.cleanup(); }
  }, 30_000);
}
