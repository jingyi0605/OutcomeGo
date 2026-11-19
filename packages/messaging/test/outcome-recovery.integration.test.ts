import { describe, expect, test } from "bun:test";
import { enqueueOutcomeTurn, notifyTaskProgress, recoverOutcomeWorkItem, recoverOutcomeWorkItems, transitionWorkItem } from "../src";
import { outcomeThreadFixture } from "./fixtures/outcome-thread";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
type Fixture = Awaited<ReturnType<typeof outcomeThreadFixture>>;
async function start(h: Fixture, ordinal = 1) {
  const item = await h.item(ordinal);
  const result = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
    workItemId: item.id, content: "Verify and compare", reason: "start", clientId: `start:${item.id}`,
  }));
  if (result.status !== "enqueued") throw new Error("Fixture did not enqueue");
  await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor: "system:fixture" }));
  await h.db.run.update({ where: { id: result.runId }, data: { status: "running", startedAt: new Date() } });
  return { item, runId: result.runId };
}
async function finish(h: Fixture, runId: string, status: "interrupted" | "completed" | "failed" = "interrupted", tick = 0) {
  await h.db.run.update({ where: { id: runId }, data: { status, startedAt: new Date(Date.now() + tick), completedAt: new Date() } });
  await h.db.inboxEvent.updateMany({ where: { runId }, data: { status: "completed", completedAt: new Date() } });
  await h.db.botRunLease.deleteMany({ where: { runId } });
}
const recover = (h: Fixture, id: string, confirmedStoppedRunIds?: ReadonlySet<string>) =>
  h.db.$transaction(tx => recoverOutcomeWorkItem(tx, id, { ...h.runtime, confirmedStoppedRunIds }));

describe.skipIf(!url)("durable Outcome restart recovery", () => {
  test("concurrent restart passes enqueue once in the original thread and leave main/Routine untouched", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await finish(h, runId);
      const unrelated = [];
      for (const origin of ["user", "routine"] as const) unrelated.push(await h.db.run.create({ data: {
        botId: h.bot.id, conversationId: h.bot.conversation!.id, userMessageId: crypto.randomUUID(), origin, status: "running",
      } }));
      await h.db.botRunLease.create({ data: { botId: h.bot.id, scope: "foreground", runId: unrelated[0]!.id, ownerId: "main", expiresAt: new Date(Date.now() + 60_000) } });
      const results = await Promise.all([recover(h, item.id), recover(h, item.id)]);
      expect(results.filter(Boolean)).toEqual(["resume_queued"]);
      const runs = await h.db.run.findMany({ where: { outcomeWorkItemId: item.id } });
      expect(runs).toHaveLength(2);
      expect(runs.every(run => run.origin === "outcome")).toBe(true);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } }))).toMatchObject({ recoveryCount: 1, retryCount: 1, rootRunId: runId });
      expect(await h.db.run.count({ where: { id: { in: unrelated.map(run => run.id) }, status: "running" } })).toBe(2);
      expect(await h.db.botRunLease.count({ where: { ownerId: "main" } })).toBe(1);
      expect(await h.db.channelMessage.count({ where: { channelId: h.channel.id } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  test("third interruption creates one unknown-result Decision and never a fourth automatic Run", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      let current = runId;
      for (let index = 0; index < 3; index++) {
        await finish(h, current, "interrupted", index * 1000);
        expect(await recover(h, item.id)).toBe(index < 2 ? "resume_queued" : "needs_review");
        const next = await h.db.run.findFirst({ where: { outcomeWorkItemId: item.id, status: "queued" } });
        if (next) current = next.id;
      }
      await recover(h, item.id);
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(3);
      expect(await h.db.outcomeDecision.count({ where: { workItemId: item.id, reasonCode: "external_result_unknown", status: "open" } })).toBe(1);
      expect(await h.db.event.count({ where: { entityId: h.outcome.id, topic: "outcome.decision.required" } })).toBe(1);
      expect(await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "needs_review", recoveryCount: 2 });
    } finally { await h.cleanup(); }
  });

  /** A worker task the runtime parked for the thread's decision (for example after repeated restarts). */
  async function parkBlockedTask(h: Fixture, runId: string) {
    const childId = crypto.randomUUID();
    await h.db.bot.create({ data: { id: childId, name: "Blocked child", defaultDirectory: h.root } });
    const progress = { key: "recovery-limit:10", runId, state: "blocked", blockSource: "runtime", revision: 10, summary: "Three automatic recovery attempts did not finish this task.", evidence: [], remaining: ["Collect the remaining report"], nextAction: "Ask for a decision." };
    const task = await h.db.subagent.create({ data: { parentBotId: h.bot.id, parentRunId: runId, parentChannelId: h.channel.id, childBotId: childId, launchCallId: "blocked", description: "Collect report", prompt: "Collect report", subagentType: "executor", status: "waiting", outputPath: "/tmp/task", progress, progressRevision: 10 } });
    return { task, childId, progress };
  }

  test("a task parked as blocked, whose wake was lost, resumes the thread once", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await finish(h, runId, "completed");
      const { task, childId } = await parkBlockedTask(h, runId);
      expect(await recover(h, item.id)).toBe("resume_queued");
      const resumed = await h.db.run.findFirstOrThrow({ where: { outcomeWorkItemId: item.id, id: { not: runId } } });
      expect(resumed.origin).toBe("outcome");
      const prompt = await h.db.message.findFirstOrThrow({ where: { runId: resumed.id } });
      expect(prompt.content).toContain(`sand-subagent-${task.id}`);
      // The queued turn owns the goal now; nothing else is enqueued while it is pending.
      expect(await recover(h, item.id)).toBeNull();
      // A restart cutting that resumed turn off must not strand the goal: ordinary recovery continues it.
      await finish(h, resumed.id, "interrupted", 1000);
      expect(await recover(h, item.id)).toBe("resume_queued");
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(3);
      await h.db.bot.delete({ where: { id: childId } });
    } finally { await h.cleanup(); }
  });

  test("a waiting task with a scheduled check still holds the thread back", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await finish(h, runId, "completed");
      const { task, childId } = await parkBlockedTask(h, runId);
      await h.db.subagent.update({ where: { id: task.id }, data: { nextCheckAt: new Date(Date.now() + 60_000), progress: { ...(task.progress as object), state: "waiting" } } });
      expect(await recover(h, item.id)).toBeNull();
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(1);
      await h.db.bot.delete({ where: { id: childId } });
    } finally { await h.cleanup(); }
  });

  test("a blocked-task notification reaches an Outcome thread instead of being superseded", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      const { task, childId, progress } = await parkBlockedTask(h, runId);
      const wake = await h.db.$transaction(tx => notifyTaskProgress(tx, h.messaging, { ...task, requestRunId: null }, progress as never, "recovery-limit:10"));
      const run = await h.db.run.findUniqueOrThrow({ where: { id: wake! } });
      expect(run).toMatchObject({ origin: "outcome", outcomeWorkItemId: item.id });
      // Routine progress stays quiet for Outcome threads; only a blocker needs them.
      expect(await h.db.$transaction(tx => notifyTaskProgress(tx, h.messaging, { ...task, requestRunId: null }, { ...progress, state: "working" } as never, "working:11"))).toBeNull();
      await h.db.bot.delete({ where: { id: childId } });
    } finally { await h.cleanup(); }
  });

  test("completed-but-unsettled family is settled once with one Output", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await finish(h, runId, "completed");
      await h.db.event.create({ data: { entityId: runId, topic: "run_item.completed", payload: { item: { type: "agentMessage", text: "Verified comparison" } } } });
      expect(await recover(h, item.id)).toBe("resettle");
      await recover(h, item.id);
      expect(await h.db.outcomeOutput.count({ where: { workItemId: item.id } })).toBe(1);
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(1);
    } finally { await h.cleanup(); }
  });

  for (const status of ["waiting_decision", "waiting_human", "needs_review"] as const) test(`${status} survives restart without a continuation`, async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: status, reason: status === "needs_review" ? "platform_handoff" : "fixture", actor: "system:fixture" }));
      await finish(h, runId, status === "needs_review" ? "interrupted" : "completed");
      expect(await recover(h, item.id)).toBeNull();
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(1);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(status);
    } finally { await h.cleanup(); }
  });

  test("expired lease alone cannot replace an executor; confirmed stop fences only that old Run", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await h.db.botRunLease.create({ data: { botId: h.bot.id, scope: `outcome:${item.id}`, runId, ownerId: "old", expiresAt: new Date(Date.now() - 1000) } });
      expect(await recover(h, item.id)).toBeNull();
      expect((await h.db.run.findUniqueOrThrow({ where: { id: runId } })).status).toBe("running");
      expect(await recover(h, item.id, new Set([runId]))).toBe("resume_queued");
      expect((await h.db.run.findUniqueOrThrow({ where: { id: runId } })).status).toBe("interrupted");
      expect(await h.db.botRunLease.count({ where: { ownerId: "old" } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  test("valid lease wins even over a stale stop confirmation", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await h.db.botRunLease.create({ data: { botId: h.bot.id, scope: `outcome:${item.id}`, runId, ownerId: "live", expiresAt: new Date(Date.now() + 60_000) } });
      expect(await recover(h, item.id, new Set([runId]))).toBeNull();
      expect((await h.db.run.findUniqueOrThrow({ where: { id: runId } })).status).toBe("running");
    } finally { await h.cleanup(); }
  });

  test("new pending revision preserves the effective approved snapshot; its approval cancels interrupted old work", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await finish(h, runId);
      await h.db.outcomeContractRevision.update({ where: { id: h.revision.id }, data: { status: "superseded" } });
      const next = await h.db.outcomeContractRevision.create({ data: { outcomeId: h.outcome.id, revision: 2, status: "pending_approval", goal: [], boundaries: {}, executionBotId: h.bot.id, contentHash: "next", createdBy: "owner:local" } });
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { currentRevisionId: next.id } });
      expect(await recover(h, item.id)).toBe("resume_queued");
      const continuation = await h.db.run.findFirstOrThrow({ where: { outcomeWorkItemId: item.id, status: "queued" } });
      await finish(h, continuation.id, "interrupted", 1000);
      await h.db.outcomeContractRevision.update({ where: { id: next.id }, data: { status: "approved", approvedAt: new Date(), approvedBy: "owner:local" } });
      expect(await recover(h, item.id)).toBe("cancelled");
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("cancelled");
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(2);
    } finally { await h.cleanup(); }
  });

  test("unknown external receipt is preserved for a Decision without automatic replay", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await finish(h, runId);
      await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { statusReason: "external_receipt_unknown" } });
      expect(await recover(h, item.id)).toBe("needs_review");
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(1);
      expect(await h.db.outcomeDecision.count({ where: { workItemId: item.id, reasonCode: "external_result_unknown" } })).toBe(1);
    } finally { await h.cleanup(); }
  });

  test("exhausted started execution can request a Decision while its successor is only pending", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await start(h);
      await finish(h, runId);
      await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { recoveryCount: 2 } });
      await h.db.outcomeContractRevision.update({ where: { id: h.revision.id }, data: { status: "superseded" } });
      const pending = await h.db.outcomeContractRevision.create({ data: {
        outcomeId: h.outcome.id, revision: 2, status: "pending_approval", goal: [], boundaries: {},
        executionBotId: h.bot.id, contentHash: "pending", createdBy: "owner:local",
      } });
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { currentRevisionId: pending.id } });
      expect(await recover(h, item.id)).toBe("needs_review");
      expect(await h.db.outcomeDecision.findFirstOrThrow({ where: { workItemId: item.id } })).toMatchObject({
        contractRevisionId: h.revision.id, status: "open", reasonCode: "external_result_unknown",
      });
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(1);
    } finally { await h.cleanup(); }
  });

  test("scanner bounds batches at 100 and traverses old waiting work rather than starving later work", async () => {
    const h = await outcomeThreadFixture();
    try {
      await h.db.outcomeWorkItem.createMany({ data: Array.from({ length: 101 }, (_, ordinal) => ({
        outcomeId: h.outcome.id, contractRevisionId: h.revision.id, botId: h.bot.id, executorType: "agent" as const,
        status: "waiting_human" as const, title: "Waiting", ordinal,
      })) });
      const first = await recoverOutcomeWorkItems(h.db, h.runtime, null, h.outcome.id);
      expect(first.scanned).toBe(100);
      expect(first.nextCursor).not.toBeNull();
      const next = await recoverOutcomeWorkItems(h.db, h.runtime, first.nextCursor, h.outcome.id);
      expect(next).toEqual({ scanned: 1, nextCursor: null });
    } finally { await h.cleanup(); }
  });
});
