import { describe, expect, test } from "bun:test";
import { enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { contextScopeForRun, WakeWorker } from "../src/worker";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("Outcome worker isolation", () => {
  test("main chat and two Outcomes claim independently; typed input cannot interrupt Outcome", async () => {
    const h = await outcomeThreadFixture();
    const worker = Object.assign(Object.create(WakeWorker.prototype), {
      prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root,
    }) as WakeWorker;
    const claim = (id = h.bot.id) => (worker as unknown as { claim(id: string): Promise<{ runId: string; contextSessionId: string; outcomeWorkItemId: string | null; ownerId: string } | null> }).claim(id);
    try {
      const foreground = await h.db.$transaction(tx => h.messaging.acceptDirectUserMessage(tx, {
        botId: h.bot.id, channelId: h.channel.id, clientId: `main:${h.bot.id}`, content: "Keep chatting",
      }));
      const main = await claim();
      expect(main?.runId).toBe(foreground.run.id);
      const items = await Promise.all([h.item(1), h.item(2)]);
      for (const item of items) await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
        workItemId: item.id, content: "Execute", reason: "start", clientId: `outcome-run:${h.outcome.id}:1:${item.id}`,
      }));
      const first = await claim(); const second = await claim();
      expect(first).not.toBeNull(); expect(second).not.toBeNull();
      expect(first?.contextSessionId).not.toBe(main?.contextSessionId);
      const context = await h.db.contextSession.findUniqueOrThrow({ where: { id: first!.contextSessionId } });
      expect(context).toMatchObject({ scope: "outcome", scopeId: first!.outcomeWorkItemId });
      const leases = await h.db.botRunLease.findMany({ where: { botId: h.bot.id } });
      expect(leases.map(lease => lease.scope).sort()).toEqual(["foreground", ...items.map(item => `outcome:${item.id}`)].sort());
      const mainState = await h.db.run.findUniqueOrThrow({ where: { id: main!.runId } });
      expect(mainState.status).toBe("running");
      const typed = await h.db.$transaction(tx => h.messaging.acceptDirectUserMessage(tx, {
        botId: h.bot.id, channelId: h.channel.id, clientId: `typed:${h.bot.id}`, content: "Another main message",
      }));
      expect(typed.interruptRunId).toBe(main!.runId);
      expect((await h.db.run.findUniqueOrThrow({ where: { id: first!.runId } })).status).toBe("running");
      await h.db.botRunLease.deleteMany({ where: { botId: h.bot.id, scope: "foreground" } });
      const typedClaim = await claim();
      expect(typedClaim?.runId).toBe(typed.run.id);
      expect((await h.db.run.findUniqueOrThrow({ where: { id: second!.runId } })).status).toBe("running");
      // A queued continuation cannot overlap another turn in the same WorkItem.
      const item = items.find(item => item.id === first!.outcomeWorkItemId)!;
      await h.db.$transaction(tx => h.messaging.enqueueWake(tx, { botId: h.bot.id, channelId: h.channel.id,
        outcomeWorkItemId: item.id, origin: "outcome", content: "Continue", type: "shell.completed", clientId: `continue:${item.id}`, priority: 280 }));
      expect(await claim()).toBeNull();
    } finally { await h.cleanup(); }
  });

  test("computerUse shares one parent desktop with Outcome work while unrelated desktop behavior stays compatible", async () => {
    const h = await outcomeThreadFixture();
    const childIds = [crypto.randomUUID(), crypto.randomUUID()];
    const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root });
    try {
      const item = await h.item();
      const enqueued = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` }));
      const outcomeRun = (enqueued as { runId: string }).runId;
      const mainRun = await h.db.run.create({ data: { botId: h.bot.id, conversationId: h.bot.conversation!.id, channelId: h.channel.id, origin: "user", userMessageId: crypto.randomUUID(), status: "completed" } });
      const childRuns: string[] = [];
      for (const [index, id] of childIds.entries()) {
        await h.db.bot.create({ data: { id, name: "Desktop worker", defaultDirectory: h.root, status: "active", conversation: { create: {} } } });
        const child = await h.db.$transaction(tx => h.messaging.enqueueWake(tx, { botId: id, channelId: h.channel.id, origin: "agent", type: "subagent.task", content: "Inspect desktop", clientId: `desktop:${id}`, priority: 350 }));
        childRuns.push(child.run.id);
        await h.db.subagent.create({ data: { parentBotId: h.bot.id, childBotId: id, parentRunId: index === 0 ? outcomeRun : mainRun.id, parentChannelId: h.channel.id,
          currentRunId: child.run.id, subagentType: "computerUse", status: "queued", launchCallId: `desktop:${id}`, description: "Inspect", prompt: "Inspect", outputPath: "/tmp/fixture" } });
      }
      expect((await worker.claim(childIds[0]))?.runId).toBe(childRuns[0]);
      expect(await worker.claim(childIds[1])).toBeNull();
      await h.db.run.update({ where: { id: childRuns[0]! }, data: { status: "completed" } });
      expect((await worker.claim(childIds[1]))?.runId).toBe(childRuns[1]);
    } finally { await h.db.bot.deleteMany({ where: { id: { in: childIds } } }); await h.cleanup(); }
  });

  test("Outcome wake is independent of a superseded main request", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      const wake = await h.db.$transaction(tx => h.messaging.enqueueWake(tx, { botId: h.bot.id, channelId: h.channel.id,
        outcomeWorkItemId: item.id, taskContextRunId: crypto.randomUUID(), origin: "outcome", content: "Continue", type: "subagent.completed", clientId: `outcome:${item.id}`, priority: 280 }));
      const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root });
      const claimed = await worker.claim(h.bot.id);
      expect(claimed?.runId).toBe(wake.run.id);
    } finally { await h.cleanup(); }
  });
});

test("context selection requires an Outcome identity and leaves existing scopes unchanged", () => {
  expect(contextScopeForRun("outcome", "dm", "conversation", undefined, "work")).toEqual({ scope: "outcome", scopeId: "work" });
  expect(() => contextScopeForRun("outcome", "dm", "conversation")).toThrow("work item");
  expect(contextScopeForRun("routine", "dm", "conversation", "root")).toEqual({ scope: "automation", scopeId: "root" });
  expect(contextScopeForRun("user", "dm", "conversation")).toEqual({ scope: "channel", scopeId: "dm" });
});
