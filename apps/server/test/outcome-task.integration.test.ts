import { expect, test } from "bun:test";
import {
  enqueueOutcomeTurn, transitionWorkItem, ensureRequestForTask, settleRequestProgress,
  recoverRequestProgress, requestProgressSnapshot, dispatchRequestChecks,
} from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { settleAgainstCallback } from "../../../packages/messaging/test/fixtures/outcome-race";
import { SubagentService } from "../src/services/subagent/service";
import { WakeWorker } from "../../worker/src/worker";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
test.skipIf(!url)("actual Outcome Task completion serializes with settlement and never owns a main request", async () => {
  const h = await outcomeThreadFixture();
  let childId: string | undefined;
  let childChannel: string | null = null;
  try {
    await h.store.writeRootSettings({});
    await h.store.writeInferenceSettings({ providerId: "openai-codex", modelId: "fixture-model", reasoning: "low" });
    const service = new SubagentService(h.db, h.messaging, {} as never, h.root, async () => Response.json({ ok: true }), h.store);
    const main = await h.db.$transaction(tx => h.messaging.enqueueWake(tx, { botId: h.bot.id, channelId: h.channel.id, origin: "user", type: "user.message", content: "Unrelated chat request", clientId: `main:${h.bot.id}`, priority: 300 }));
    await h.db.run.update({ where: { id: main.run.id }, data: { status: "running" } });
    await h.db.$transaction(tx => ensureRequestForTask(tx, h.bot.id, main.run.id));
    const original = await h.db.run.findUniqueOrThrow({ where: { id: main.run.id } });
    const item = await h.item();
    const first = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
    const runId = (first as { runId: string }).runId;
    await h.db.run.update({ where: { id: runId }, data: { status: "running" } });
    await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor: "system:test" }));
    const receipt = await service.task({ botId: h.bot.id, runId, conversationId: h.bot.conversation!.id, channelId: h.channel.id,
      deliveryId: null, origin: "outcome", callId: `outcome-task:${item.id}`, replyToMessageId: null, isFork: false },
      { description: "Check sources", subagent_type: "executor", prompt: "Read the fixture sources only.", request_run_id: main.run.id });
    expect(receipt).not.toContain("Parent request_run_id");
    const child = await h.db.subagent.findFirstOrThrow({ where: { parentRunId: runId } });
    childId = child.childBotId;
    expect(child.requestRunId).toBeNull();
    expect((await h.db.run.findUniqueOrThrow({ where: { id: runId } })).requestProgress).toBeNull();
    const childRun = await h.db.run.findUniqueOrThrow({ where: { id: child.currentRunId! } });
    childChannel = childRun.channelId;
    await h.db.subagent.update({ where: { id: child.id }, data: { status: "running" } });
    await h.db.subagentAttempt.update({ where: { childRunId: childRun.id }, data: { status: "running" } });
    await h.db.run.update({ where: { id: runId }, data: { status: "completed" } });
    const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: h.db, messaging: h.messaging });
    await settleAgainstCallback(h.db, runId, db => db.$transaction(async tx => {
      await tx.run.update({ where: { id: childRun.id }, data: { status: "completed" } });
      await tx.message.create({ data: { botId: child.childBotId, conversationId: childRun.conversationId, runId: childRun.id,
        clientId: `result:${childRun.id}`, role: "assistant", content: "Verified fixture source result", status: "completed" } });
      await worker.completeSubagent(tx, { botId: child.childBotId, runId: childRun.id });
    }));
    expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("running");
    const continuation = await h.db.run.findFirstOrThrow({ where: { outcomeWorkItemId: item.id, id: { not: runId } } });
    expect(continuation.origin).toBe("outcome");
    await h.db.$transaction(tx => settleRequestProgress(tx, h.messaging, h.bot.id, runId));
    // Historical accidental bookkeeping must also be excluded from recovery, due checks and the main prompt.
    await h.db.run.update({ where: { id: runId }, data: { requestProgress: original.requestProgress!, requestNextCheckAt: new Date(0) } });
    await recoverRequestProgress(h.db, h.messaging);
    await dispatchRequestChecks(h.db, h.messaging);
    const snapshots = await requestProgressSnapshot(h.db, h.bot.id, h.channel.id);
    expect(snapshots.map(row => row.request_run_id)).toEqual([main.run.id]);
    expect((await h.db.run.findUniqueOrThrow({ where: { id: main.run.id } })).requestProgress).toEqual(original.requestProgress);
    expect(await h.db.inboxEvent.count({ where: { botId: h.bot.id, type: "request.check" } })).toBe(0);
    expect(await h.db.run.count({ where: { botId: h.bot.id, origin: "background_revival" } })).toBe(0);
    expect(await h.db.channelMessage.count({ where: { channelId: h.channel.id } })).toBe(0);
    await h.db.run.update({ where: { id: runId }, data: { status: "cancelled" } });
    await expect(service.task({ botId: h.bot.id, runId, conversationId: h.bot.conversation!.id, channelId: h.channel.id,
      deliveryId: null, origin: "outcome", callId: `late-task:${item.id}`, replyToMessageId: null, isFork: false },
      { description: "Late task", subagent_type: "executor", prompt: "Must not dispatch after cancellation" }))
      .rejects.toMatchObject({ code: "request_context_inactive" });
    expect(await h.db.subagent.count({ where: { parentRunId: runId } })).toBe(1);
  } finally {
    await h.db.idempotencyRecord.deleteMany({ where: { scope: `subagent-task:${h.bot.id}` } });
    if (childId) await h.db.bot.delete({ where: { id: childId } });
    if (childChannel) await h.db.channel.delete({ where: { id: childChannel } });
    await h.cleanup();
  }
}, 15_000);
