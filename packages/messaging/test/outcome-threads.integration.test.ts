import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentMessaging, wakeAutomationParent, automationContinuationRoute, outcomeRunContext, enqueueOutcomeTurn, settleOutcomeWorkItem, dispatchQueuedOutcomeWorkItems, transitionWorkItem } from "../src";
import { outcomeThreadFixture } from "./fixtures/outcome-thread";
import { settleAgainstCallback } from "./fixtures/outcome-race";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const actor = "system:fixture" as const;
describe.skipIf(!url)("Outcome turn enqueue and group settlement", () => {
  test("two capacity reservations; third drains after settlement; repeated enqueue/settlement are idempotent", async () => {
    const h = await outcomeThreadFixture();
    try {
      const items = await Promise.all([h.item(1), h.item(2), h.item(3)]);
      const enqueue = (index: number, content = "Execute quietly") => h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
        workItemId: items[index]!.id, content, reason: "start", clientId: `outcome-run:${h.outcome.id}:1:${items[index]!.id}`,
      }));
      const first = await enqueue(0);
      expect(first.status).toBe("enqueued");
      expect(await enqueue(0)).toEqual(first);
      await expect(enqueue(0, "Changed input")).rejects.toMatchObject({ code: "idempotency_conflict" });
      expect((await enqueue(1)).status).toBe("enqueued");
      expect(await enqueue(2)).toEqual({ status: "queued_for_capacity" });
      expect(await h.db.run.count({ where: { botId: h.bot.id } })).toBe(2);
      const runId = (first as { runId: string }).runId;
      const run = await h.db.run.findUniqueOrThrow({ where: { id: runId }, include: { inboxEvents: true } });
      expect(run).toMatchObject({ origin: "outcome", outcomeWorkItemId: items[0]!.id });
      expect(run.inboxEvents[0]!.payload).toMatchObject({ outcomeWorkItemId: items[0]!.id });
      expect(run.inboxEvents[0]!.payload).not.toHaveProperty("interruptedRunId");
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: items[0]!.id, to: "running", reason: "claimed", actor }));
      await h.db.run.update({ where: { id: runId }, data: { status: "completed", completedAt: new Date() } });
      await h.db.event.create({ data: { topic: "run_item.completed", entityId: runId, payload: { item: { type: "agentMessage", text: "Final report with sources" } } } });
      const directory = join(h.root, "outcomes", h.outcome.id, items[0]!.id);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "report.md"), "Fixture report");
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
      const events = await h.db.event.count({ where: { entityId: h.outcome.id } });
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect(await h.db.event.count({ where: { entityId: h.outcome.id } })).toBe(events);
      expect(await h.db.outcomeOutput.count({ where: { workItemId: items[0]!.id } })).toBe(2);
      expect(await h.db.run.count({ where: { botId: h.bot.id } })).toBe(3);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items[2]!.id } })).rootRunId).not.toBeNull();
      expect(await h.db.channelMessage.count({ where: { channelId: h.channel.id } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  test("background shell and child keep group running; continuation stays in the same Outcome", async () => {
    const h = await outcomeThreadFixture();
    const childId = crypto.randomUUID();
    try {
      const item = await h.item();
      const result = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
      const runId = (result as { runId: string }).runId;
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
      await h.db.run.update({ where: { id: runId }, data: { status: "completed" } });
      await h.db.bot.create({ data: { id: childId, name: "Child", defaultDirectory: h.root } });
      const child = await h.db.subagent.create({ data: { parentBotId: h.bot.id, parentRunId: runId, parentChannelId: h.channel.id, childBotId: childId, launchCallId: "fixture", description: "Check", prompt: "Check", subagentType: "executor", status: "running", outputPath: "/tmp/task" } });
      const settle = () => h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
      await settle();
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("running");
      await h.db.subagent.update({ where: { id: child.id }, data: { status: "completed" } });
      await h.db.runItem.create({ data: { runId, kind: "command", status: "completed", content: { shellKind: "background", result: { details: { status: "running", outputPath: "/tmp/shell.log" } } } } });
      await settle();
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("running");
      await h.messaging.completeShell({ id: "fixture", scope: h.bot.id, channelId: h.channel.id, automationRunId: runId, outputPath: "/tmp/shell.log", exitCode: 0, title: "Check" });
      const continuation = await h.db.run.findFirstOrThrow({ where: { botId: h.bot.id, id: { not: runId } } });
      expect(continuation).toMatchObject({ origin: "outcome", outcomeWorkItemId: item.id });
      await settle();
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("running");
      await h.db.run.update({ where: { id: continuation.id }, data: { status: "completed" } });
      await h.db.inboxEvent.updateMany({ where: { runId: continuation.id }, data: { status: "completed" } });
      await h.db.event.create({ data: { topic: "run_item.completed", entityId: continuation.id, payload: { item: { type: "agentMessage", text: "Complete result" } } } });
      await settle();
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("completed");
      expect((await h.db.outcomeOutput.findFirstOrThrow({ where: { workItemId: item.id } })).runId).toBe(continuation.id);
    } finally { await h.db.bot.deleteMany({ where: { id: childId } }); await h.cleanup(); }
  });

  test("settlement serializes a real shell callback after its family snapshot", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      const result = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
      const runId = (result as { runId: string }).runId;
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
      await h.db.run.update({ where: { id: runId }, data: { status: "completed" } });
      await h.db.runItem.create({ data: { runId, kind: "command", status: "completed", content: { shellKind: "background", result: { details: { status: "running", outputPath: "/tmp/racing-shell.log" } } } } });
      await settleAgainstCallback(h.db, runId, db => new AgentMessaging(db, h.messaging.boss, h.store).completeShell({
        id: "racing", scope: h.bot.id, channelId: h.channel.id, automationRunId: runId, outputPath: "/tmp/racing-shell.log", exitCode: 0, title: "Check",
      }));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("running");
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id, status: "queued" } })).toBe(1);
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("running");
    } finally { await h.cleanup(); }
  });

  test("platform handoff parks the Outcome, waits for the main conversation and ignores late callbacks", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      const first = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
      const runId = (first as { runId: string }).runId;
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
      await h.db.run.update({ where: { id: runId }, data: { status: "running" } });
      const main = await h.db.$transaction(tx => h.messaging.enqueueWake(tx, { botId: h.bot.id, channelId: h.channel.id, origin: "user", type: "user.message", content: "Chat", clientId: `main:${item.id}`, priority: 300 }));
      await h.db.run.update({ where: { id: main.run.id }, data: { status: "running" } });
      const context = { botId: h.bot.id, runId, conversationId: h.bot.conversation!.id, channelId: h.channel.id,
        origin: "outcome" as const, deliveryId: null, callId: "handoff", replyToMessageId: null, isFork: false };
      const result = await wakeAutomationParent(h.messaging, context, { message: "Platform reconnection is required" });
      expect(await wakeAutomationParent(h.messaging, context, { message: "Platform reconnection is required" })).toEqual(result);
      expect(result.automation_run_ids).toEqual([runId]);
      expect((await h.db.run.findUniqueOrThrow({ where: { id: main.run.id } })).status).toBe("running");
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("needs_review");
      expect(await h.db.$transaction(tx => automationContinuationRoute(tx, h.bot.id, runId))).toBeNull();
      await h.db.run.update({ where: { id: runId }, data: { status: "completed" } });
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("needs_review");
      const resumed = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Reconnected; resume", reason: "recovery", clientId: `recovery:${item.id}:1` }));
      expect(resumed.status).toBe("enqueued");
      expect(await h.db.$transaction(tx => automationContinuationRoute(tx, h.bot.id, runId))).toBeNull();
      expect(await h.db.channelMessage.count({ where: { channelId: h.channel.id } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  test("hidden context stays bound to the approved historical revision", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      await h.db.outcomeContractRevision.update({ where: { id: h.revision.id }, data: { status: "superseded" } });
      const next = await h.db.outcomeContractRevision.create({ data: { outcomeId: h.outcome.id, revision: 2, status: "pending_approval", goal: ["Unapproved replacement"], boundaries: {}, executionBotId: h.bot.id, contentHash: "next", createdBy: "owner:local" } });
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { currentRevisionId: next.id } });
      const context = await outcomeRunContext(h.db, h.bot.id, item.id);
      expect(context).toContain("Compare two approaches");
      expect(context).toContain("Cite sources");
      expect(context).not.toContain("Unapproved replacement");
    } finally { await h.cleanup(); }
  });

  test("one hundred older waiting items cannot hide a capacity-queued intent", async () => {
    const h = await outcomeThreadFixture();
    try {
      await h.db.outcomeWorkItem.createMany({ data: Array.from({ length: 100 }, (_, index) => ({
        outcomeId: h.outcome.id, contractRevisionId: h.revision.id, botId: h.bot.id, executorType: "agent" as const,
        title: "Older waiting fixture", status: "waiting_decision" as const, ordinal: index + 1, createdAt: new Date("2026-01-01"),
      })) });
      const items = await Promise.all([h.item(101), h.item(102), h.item(103)]);
      const results = [];
      for (const item of items) results.push(await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
        workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}`,
      })));
      expect(results[2]!.status).toBe("queued_for_capacity");
      const runId = (results[0] as { runId: string }).runId;
      await h.db.run.update({ where: { id: runId }, data: { status: "completed" } });
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items[2]!.id } })).rootRunId).not.toBeNull();
      expect(await h.db.outcomeWorkItem.count({ where: { outcomeId: h.outcome.id, status: "waiting_decision" } })).toBe(100);
    } finally { await h.cleanup(); }
  });

  for (const lastStatus of ["completed", "failed"] as const) test(`actual last execution wins over enqueue order (${lastStatus})`, async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      const first = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
      const rootId = (first as { runId: string }).runId;
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
      await h.db.run.update({ where: { id: rootId }, data: { status: "completed", startedAt: new Date("2026-01-01T00:00:00Z") } });
      const make = (label: string) => h.db.$transaction(tx => h.messaging.enqueueWake(tx, { botId: h.bot.id, channelId: h.channel.id, origin: "outcome", outcomeWorkItemId: item.id,
        content: label, type: "shell.completed", clientId: `${label}:${item.id}`, priority: label === "shell" ? 50 : 260 }));
      const shell = await make("shell"); const child = await make("child");
      await h.db.run.update({ where: { id: child.run.id }, data: { status: "completed", startedAt: new Date("2026-01-01T00:00:01Z") } });
      await h.db.run.update({ where: { id: shell.run.id }, data: { status: lastStatus, startedAt: new Date("2026-01-01T00:00:02Z") } });
      for (const [runId, text] of [[shell.run.id, "Actual final shell result"], [child.run.id, "Earlier executed child result"]])
        await h.db.event.create({ data: { topic: "run_item.completed", entityId: runId!, payload: { item: { type: "agentMessage", text } } } });
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, shell.run.id, h.runtime));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(lastStatus);
      const output = await h.db.outcomeOutput.findFirst({ where: { workItemId: item.id } });
      if (lastStatus === "completed") expect(output).toMatchObject({ runId: shell.run.id, content: "Actual final shell result" });
      else expect(output).toBeNull();
    } finally { await h.cleanup(); }
  });

  for (const [status, expected] of [["failed", "failed"], ["cancelled", "cancelled"], ["interrupted", "needs_review"]] as const) {
    test(`${status} maps to ${expected}`, async () => {
      const h = await outcomeThreadFixture();
      try {
        const item = await h.item();
        const result = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
        const runId = (result as { runId: string }).runId;
        await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
        await h.db.run.update({ where: { id: runId }, data: { status } });
        await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
        expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(expected);
        expect(await h.db.outcomeOutput.count({ where: { workItemId: item.id } })).toBe(0);
      } finally { await h.cleanup(); }
    });
  }

  for (const state of ["waiting_decision", "waiting_human"] as const) test(`${state} survives settlement and resumes one context`, async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      const input = { workItemId: item.id, content: "Execute", reason: "start" as const, clientId: `start:${item.id}` };
      const result = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, input));
      const runId = (result as { runId: string }).runId;
      await h.db.$transaction(async tx => {
        await transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor });
        await transitionWorkItem(tx, { workItemId: item.id, to: state, reason: "waiting", actor });
      });
      await h.db.run.update({ where: { id: runId }, data: { status: "completed" } });
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(state);
      await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { ...input, content: "Approved choice", reason: "decision_resolved", clientId: `${item.id}:decision:1` }));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("running");
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(2);
    } finally { await h.cleanup(); }
  });

  test("facts-only settlement can be completed with runtime, including periodic queued drain", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      const enqueued = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
      const runId = (enqueued as { runId: string }).runId;
      await h.db.run.update({ where: { id: runId }, data: { status: "completed" } });
      const directory = join(h.root, "outcomes", h.outcome.id, item.id);
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, "result.txt"), "Deliverable");
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId));
      expect(await h.db.outcomeOutput.count({ where: { workItemId: item.id } })).toBe(0);
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect(await h.db.outcomeOutput.count({ where: { workItemId: item.id } })).toBe(1);
      await h.db.$transaction(tx => dispatchQueuedOutcomeWorkItems(tx, h.messaging, h.bot.id));
    } finally { await h.cleanup(); }
  });
});
