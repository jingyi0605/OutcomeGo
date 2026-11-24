import { afterAll, describe, expect, test } from "bun:test";
import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import {
  dispatchDueScheduledWorkItems,
  enqueueOutcomeTurn,
  settleOutcomeWorkItem,
  transitionWorkItem,
  updateFeatureSettings,
} from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { createDeferWorkItemTool } from "../src/services/outcome-defer-tool";

// Specs/004.10 task 2.5: the DeferWorkItem tool. Needs a disposable PostgreSQL database.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});
const actor = "system:fixture" as const;
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

/** A task that is genuinely running: claimed, with its turn running, exactly as the tool sees it in production. */
async function runningTask() {
  const h = await outcomeThreadFixture();
  cleanups.push(async () => {
    await h.db.featureSettings.deleteMany({ where: { id: "global" } });
    await h.cleanup();
  });
  const item = await h.item(1);
  const started = await h.db.$transaction((tx) =>
    enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` })
  );
  const runId = (started as { runId: string }).runId;
  await h.db.$transaction((tx) => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
  await h.db.run.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });
  const tool = createDeferWorkItemTool(h.db, h.messaging);
  const request = (args: Record<string, unknown>, overrides: Partial<DynamicToolCallRequest> = {}): DynamicToolCallRequest => ({
    runId, botId: h.bot.id, conversationId: "c", channelId: h.channel.id, deliveryId: null, callId: "call", tool: "DeferWorkItem", arguments: args, ...overrides,
  });
  const call = (args: Record<string, unknown>, ctx: Partial<{ runId: string; workItemId: string; botId: string }> = {}, req: Partial<DynamicToolCallRequest> = {}) =>
    tool(request(args, req), { runId, workItemId: item.id, botId: h.bot.id, ...ctx });
  const row = () => h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } });
  const failure = async (promise: Promise<unknown>) => {
    const result = await promise.then(() => null, (error) => error);
    expect(result).toBeInstanceOf(ApiError);
    return result as ApiError;
  };
  return { h, item, runId, call, row, failure };
}

describe.skipIf(!url)("DeferWorkItem tool (specs/004.10 task 2.5)", () => {
  // Specs/004.10 task 3.2: clients never receive `outcome.*` events, so an open goal learns of a deferral from this one.
  test("a deferral announces itself to the open goal with one goal.schedule.changed event, and a refused one announces nothing", async () => {
    const t = await runningTask();
    const signals = () => t.h.db.event.findMany({ where: { topic: "goal.schedule.changed", entityId: t.h.outcome.id } });
    await t.failure(t.call({ resumeAt: "not a time" }));
    expect(await signals()).toHaveLength(0);
    await t.call({ resumeAt: later(120), note: "Continue." });
    const events = await signals();
    expect(events).toHaveLength(1);
    // Only identity: the client reloads the goal, so no times, titles or notes ride along.
    expect(events[0]!.payload).toEqual({ outcomeId: t.h.outcome.id });
  });

  test("defers a running task: queued, due at the chosen time, counted, with the note held as its next instructions", async () => {
    const t = await runningTask();
    const resumeAt = later(120);
    const result = (await t.call({ resumeAt, note: "Continue from step three.", reason: "Waiting on an outside result" })) as Record<string, unknown>;
    expect(result).toMatchObject({ deferred: true, workItemId: t.item.id });
    expect(new Date(result.resumeAt as string).toISOString()).toBe(new Date(resumeAt).toISOString());
    expect(String(result.instruction)).toMatch(/end this turn/i);
    const row = await t.row();
    expect(row.status).toBe("queued");
    expect(row.statusReason).toBe("deferred_by_agent");
    expect(row.scheduledAt!.toISOString()).toBe(new Date(resumeAt).toISOString());
    expect(row.deferCount).toBe(1);
    expect(row.completedAt).toBeNull();
    const held = await t.h.db.idempotencyRecord.findMany({ where: { scope: `outcome-turn:${t.item.id}`, status: "processing" } });
    expect(held).toHaveLength(1);
    expect(held[0]!.key).toBe(`defer:${t.item.id}:1`);
    expect(JSON.stringify(held[0]!.response)).toContain("Continue from step three.");
    expect(JSON.stringify(held[0]!.response)).toContain("resume_scheduled");
    // It ends the turn; it starts nothing new.
    expect(await t.h.db.run.count({ where: { outcomeWorkItemId: t.item.id } })).toBe(1);
  });

  test("writes an audit event with the new time, the old one and who did it", async () => {
    const t = await runningTask();
    const resumeAt = later(90);
    await t.call({ resumeAt, note: "Go on", reason: "Not ready" });
    const events = await t.h.db.event.findMany({ where: { topic: "outcome.schedule.changed", entityId: t.h.outcome.id } });
    expect(events).toHaveLength(1);
    const payload = (events[0]!.payload as { payload: Record<string, unknown>; actorId?: string });
    expect(payload.payload).toMatchObject({
      target: "work_item", workItemId: t.item.id, source: "agent_defer", reason: "Not ready",
      previous: { scheduledAt: null },
    });
    expect(new Date(payload.payload.scheduledAt as string).toISOString()).toBe(new Date(resumeAt).toISOString());
  });

  test("changes nothing about the contract, the dependencies or the permissions", async () => {
    const t = await runningTask();
    const before = {
      revision: await t.h.db.outcomeContractRevision.findUniqueOrThrow({ where: { id: t.h.revision.id } }),
      item: await t.row(),
    };
    await t.call({ resumeAt: later(60), note: "Go on" });
    const after = {
      revision: await t.h.db.outcomeContractRevision.findUniqueOrThrow({ where: { id: t.h.revision.id } }),
      item: await t.row(),
    };
    expect(after.revision.contentHash).toBe(before.revision.contentHash);
    expect(after.revision.status).toBe(before.revision.status);
    expect(JSON.stringify(after.item.dependsOn)).toBe(JSON.stringify(before.item.dependsOn));
    expect(after.item.botId).toBe(before.item.botId);
    expect(after.item.instructions).toBe(before.item.instructions);
  });

  test("a time that is not a real offset timestamp, or is not in the future, is refused as invalid_schedule and nothing changes", async () => {
    const t = await runningTask();
    const bad = ["soon", "2026-12-01", "2026-12-01T09:00:00", "2026-02-30T09:00:00Z", new Date(Date.now() - 60_000).toISOString(), new Date().toISOString()];
    for (const resumeAt of bad) {
      const error = await t.failure(t.call({ resumeAt, note: "Go on" }));
      expect([error.status, error.code]).toEqual([400, "invalid_schedule"]);
    }
    const row = await t.row();
    expect(row.status).toBe("running");
    expect(row.deferCount).toBe(0);
    expect(await t.h.db.event.count({ where: { topic: "outcome.schedule.changed", entityId: t.h.outcome.id } })).toBe(0);
  });

  test("how far ahead is allowed comes from the owner's policy", async () => {
    const t = await runningTask();
    await updateFeatureSettings(t.h.db, { taskPolicy: { "schedule.deferMaxDays": 2 } });
    const tooFar = await t.failure(t.call({ resumeAt: later(3 * 24 * 60), note: "Go on" }));
    expect([tooFar.status, tooFar.code]).toEqual([400, "invalid_schedule"]);
    expect((await t.row()).status).toBe("running");
    await updateFeatureSettings(t.h.db, { taskPolicy: { "schedule.deferMaxDays": 5 } });
    await t.call({ resumeAt: later(3 * 24 * 60), note: "Go on" });
    expect((await t.row()).status).toBe("queued");
  });

  test("how many times a task may be deferred comes from the owner's policy, and the refusal changes nothing", async () => {
    const t = await runningTask();
    await updateFeatureSettings(t.h.db, { taskPolicy: { "schedule.deferMaxCount": 2 } });
    await t.h.db.outcomeWorkItem.update({ where: { id: t.item.id }, data: { deferCount: 2 } });
    const error = await t.failure(t.call({ resumeAt: later(60), note: "Go on" }));
    expect([error.status, error.code]).toEqual([409, "defer_limit_reached"]);
    const row = await t.row();
    expect(row.status).toBe("running");
    expect(row.deferCount).toBe(2);
    await updateFeatureSettings(t.h.db, { taskPolicy: { "schedule.deferMaxCount": 3 } });
    await t.call({ resumeAt: later(60), note: "Go on" });
    expect((await t.row()).deferCount).toBe(3);
  });

  test("only the task's own running turn may defer it: anything else is tool_context_invalid", async () => {
    const t = await runningTask();
    const args = { resumeAt: later(60), note: "Go on" };
    const other = await t.h.item(2);
    // Each attempt is a function, so it starts only when its turn comes and the cases cannot race each other.
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["another bot", () => t.call(args, { botId: crypto.randomUUID() })],
      ["another run id in the context", () => t.call(args, { runId: crypto.randomUUID() })],
      ["a run id that differs from the request", () => t.call(args, {}, { runId: crypto.randomUUID() })],
      ["a different work item's context", () => t.call(args, { workItemId: other.id })],
    ];
    for (const [label, attempt] of cases) {
      const error = await t.failure(attempt());
      expect([label, error.status, error.code]).toEqual([label, 409, "tool_context_invalid"]);
    }
    expect((await t.row()).status).toBe("running");
  });

  test("a turn that has already ended cannot defer, and a second call after a successful one is refused without counting twice", async () => {
    const t = await runningTask();
    await t.call({ resumeAt: later(60), note: "Go on" });
    const again = await t.failure(t.call({ resumeAt: later(120), note: "Again" }));
    expect(again.status).toBe(409);
    expect((await t.row()).deferCount).toBe(1);
    const ended = await runningTask();
    await ended.h.db.run.update({ where: { id: ended.runId }, data: { status: "completed", completedAt: new Date() } });
    expect((await ended.failure(ended.call({ resumeAt: later(60), note: "Go on" }))).code).toBe("tool_context_invalid");
  });

  test("a task that is not running (still queued) cannot be deferred", async () => {
    const t = await runningTask();
    await t.h.db.outcomeWorkItem.update({ where: { id: t.item.id }, data: { status: "queued" } });
    const error = await t.failure(t.call({ resumeAt: later(60), note: "Go on" }));
    expect(error.status).toBe(409);
    expect((await t.row()).deferCount).toBe(0);
  });

  test("a cancelled goal cannot have its tasks deferred", async () => {
    const t = await runningTask();
    await t.h.db.outcome.update({ where: { id: t.h.outcome.id }, data: { cancelledAt: new Date(), status: "cancelled" } });
    const error = await t.failure(t.call({ resumeAt: later(60), note: "Go on" }));
    expect(error.status).toBe(409);
    expect((await t.row()).status).toBe("running");
  });

  test("a note that is empty after trimming is refused", async () => {
    const t = await runningTask();
    expect((await t.failure(t.call({ resumeAt: later(60), note: "   " }))).status).toBe(400);
    expect((await t.row()).status).toBe("running");
  });

  test("two calls at the same moment defer once", async () => {
    const t = await runningTask();
    const results = await Promise.allSettled([
      t.call({ resumeAt: later(60), note: "First" }),
      t.call({ resumeAt: later(90), note: "Second" }),
    ]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    const row = await t.row();
    expect(row.deferCount).toBe(1);
    expect(await t.h.db.idempotencyRecord.count({ where: { scope: `outcome-turn:${t.item.id}`, status: "processing" } })).toBe(1);
  });

  test("end to end: the turn ends, the task is not settled, and at its time it starts again with the note", async () => {
    const t = await runningTask();
    await t.call({ resumeAt: later(60), note: "Continue from step three." });
    await t.h.db.run.update({ where: { id: t.runId }, data: { status: "completed", completedAt: new Date() } });
    await t.h.db.event.create({ data: { topic: "run_item.completed", entityId: t.runId, payload: { item: { type: "agentMessage", text: "Stopping for now." } } } });
    await t.h.db.$transaction((tx) => settleOutcomeWorkItem(tx, t.runId, t.h.runtime));
    expect((await t.row()).status).toBe("queued");
    expect(await t.h.db.outcomeOutput.count({ where: { workItemId: t.item.id } })).toBe(0);
    // Not due yet: nothing starts.
    await dispatchDueScheduledWorkItems(t.h.db, t.h.messaging);
    expect(await t.h.db.run.count({ where: { outcomeWorkItemId: t.item.id } })).toBe(1);
    // Its time comes.
    await t.h.db.outcomeWorkItem.update({ where: { id: t.item.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await dispatchDueScheduledWorkItems(t.h.db, t.h.messaging);
    await dispatchDueScheduledWorkItems(t.h.db, t.h.messaging);
    const runs = await t.h.db.run.findMany({ where: { outcomeWorkItemId: t.item.id }, orderBy: { createdAt: "asc" }, include: { inboxEvents: true } });
    expect(runs).toHaveLength(2);
    expect(JSON.stringify(runs[1]!.inboxEvents[0]!.payload)).toContain("Continue from step three.");
  });
});
