import { describe, expect, test } from "bun:test";
import { dispatchDueOutcomeAdvice, dispatchDueScheduledOutcomes, enqueueOutcomeThreadTurn, enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { contextScopeForRun, WakeWorker } from "../src/worker";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("Outcome worker isolation", () => {
  test("planner claims use read-only target scope and do not borrow for reviewers or inactive targets", async () => {
    const h = await outcomeThreadFixture();
    const planner = await h.db.bot.create({ data: { name: "Separate planner", status: "active", defaultDirectory: h.root, conversation: { create: {} } } });
    const plannerChannel = await h.db.channel.create({ data: { kind: "bot_dm", directKey: `bot:${planner.id}`, name: "Planner", members: { create: { botId: planner.id, ordinal: 0 } } } });
    const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root });
    try {
      const attachment = await h.messaging.assets.ingestBytes({ fileName: "source.txt", bytes: new TextEncoder().encode("Original context") });
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { attachments: [attachment] } });
      const modes = [
        { purpose: "plan", planMode: "triage" }, { purpose: "plan", planMode: "advice" }, { purpose: "plan", planMode: "contract_plan" },
        { purpose: "owner_message" }, { purpose: "replan" }, { purpose: "review" },
      ] as const;
      for (const mode of modes) {
        const { turn } = await h.db.$transaction((tx) => enqueueOutcomeThreadTurn(tx, h.messaging, {
          ...mode, outcomeId: h.outcome.id, botId: planner.id, text: "Read only", actor: "owner:local", clientRequestId: crypto.randomUUID(),
        }));
        const claimed = await worker.claim(planner.id);
        expect(claimed).toMatchObject({ runId: turn.runId, goalThread: { purpose: mode.purpose, outcomeId: h.outcome.id } });
        if (mode.purpose === "review") expect(claimed).toMatchObject({ accessMode: "full", borrowedBot: undefined });
        else expect(claimed).toMatchObject({ accessMode: "research_readonly", borrowedBot: { id: h.bot.id, name: h.bot.name }, unmaterializedOutcomeAttachments: [attachment] });
        await h.db.botRunLease.deleteMany({ where: { runId: turn.runId! } });
        await h.db.run.update({ where: { id: turn.runId! }, data: { status: "completed" } });
      }
      await h.db.bot.update({ where: { id: h.bot.id }, data: { status: "archived" } });
      await h.db.$transaction((tx) => enqueueOutcomeThreadTurn(tx, h.messaging, {
        purpose: "plan", planMode: "advice", outcomeId: h.outcome.id, botId: planner.id, text: "Advice", actor: "owner:local", clientRequestId: crypto.randomUUID(),
      }));
      expect(await worker.claim(planner.id)).toMatchObject({ accessMode: "research_readonly", borrowedBot: undefined });
    } finally {
      const runs = await h.db.run.findMany({ where: { botId: planner.id }, select: { id: true } });
      await h.db.event.deleteMany({ where: { entityId: { in: runs.map((run) => run.id) } } });
      await h.db.bot.delete({ where: { id: planner.id } });
      await h.db.channel.delete({ where: { id: plannerChannel.id } });
      await h.cleanup();
    }
  });
  test("superseded advice is skipped and the scheduled run claims its Outcome scope", async () => {
    const h = await outcomeThreadFixture();
    const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root });
    const target = { id: h.outcome.id };
    const previous = await h.db.featureSettings.findUnique({ where: { id: "global" } });
    const now = new Date("2026-11-25T01:00:00.000Z");
    const due = new Date("2026-11-25T02:00:00.000Z");
    try {
      await h.db.featureSettings.upsert({ where: { id: "global" }, create: { id: "global", outcomesEnabled: true }, update: { outcomesEnabled: true } });
      await h.db.outcome.update({ where: target, data: { kind: "scheduled_once", status: "scheduled", currentRevisionId: null, prepareAt: now, scheduledAt: due } });
      expect(await dispatchDueOutcomeAdvice(h.db, h.messaging, now)).toBe(1);
      const advice = await h.db.outcomeThreadTurn.findFirstOrThrow({ where: { thread: { outcomeId: target.id } } });
      await h.db.outcome.update({ where: target, data: { revision: { increment: 1 } } });
      expect(await dispatchDueScheduledOutcomes(h.db, h.messaging, due)).toBe(1);
      const claimed = await worker.claim(h.bot.id);
      expect(claimed).not.toBeNull();
      expect(await h.db.run.findUniqueOrThrow({ where: { id: claimed!.runId } })).toMatchObject({ origin: "outcome", outcomeId: target.id, outcomeWorkItemId: null });
      expect(await h.db.contextSession.findUniqueOrThrow({ where: { id: claimed!.contextSessionId } })).toMatchObject({ scope: "outcome", scopeId: target.id });
      expect(await h.db.botRunLease.findUniqueOrThrow({ where: { runId: claimed!.runId } })).toMatchObject({ scope: `outcome:${target.id}` });
      expect(await worker.claim(h.bot.id)).toBeNull();
      expect(await h.db.outcomeThreadTurn.findUniqueOrThrow({ where: { id: advice.id } })).toMatchObject({ status: "cancelled", skipReason: "schedule_superseded" });
      expect(await h.db.run.findUniqueOrThrow({ where: { id: advice.runId! } })).toMatchObject({ status: "cancelled" });
    } finally {
      if (previous) await h.db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: previous.outcomesEnabled } });
      else await h.db.featureSettings.deleteMany({ where: { id: "global" } });
      await h.cleanup();
    }
  });

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

// The tool pause and owner continuation must use the real worker's same Outcome context.
describe.skipIf(!url)("Outcome decision pause and continuation", () => {
  test("a decision ends one turn, keeps the work paused and resumes alongside the main chat", async () => {
    const { createOutcomeDecisionTool } = await import("../../server/src/services/outcome-decision-tool");
    const { DecisionService } = await import("../../server/src/services/decision-service");
    const { settleOutcomeWorkItem } = await import("@outcomego/messaging");
    const { Effect } = await import("effect");
    const h = await outcomeThreadFixture();
    const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root });
    try {
      const item = await h.item();
      await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Research", reason: "start", clientId: `outcome-run:${h.outcome.id}:1:${item.id}` }));
      const initial = await worker.claim(h.bot.id);
      if (!initial) throw new Error("Expected the initial Outcome turn");
      const source = await h.db.run.findUniqueOrThrow({ where: { id: initial.runId } });
      const decisions = new DecisionService(h.db, { messaging: h.messaging });
      const tool = createOutcomeDecisionTool(h.db, decisions);
      const result = await tool({ runId: source.id, botId: h.bot.id, conversationId: source.conversationId, channelId: source.channelId!, deliveryId: source.deliveryId, callId: "pause", tool: "RequestOutcomeDecision", arguments: {
        completedSummary: "Compared approaches", problemSummary: "Choose one approach", nextStepSummary: "Choose the next step", reasonCode: "missing_input", options: [{ label: "Continue", consequence: "Continue with the current contract" }],
      } }, { runId: source.id, workItemId: item.id, botId: h.bot.id }) as { decisionId: string };
      await h.db.run.update({ where: { id: source.id }, data: { status: "completed", completedAt: new Date() } });
      await h.db.inboxEvent.updateMany({ where: { runId: source.id }, data: { status: "completed", completedAt: new Date() } });
      await h.db.botRunLease.deleteMany({ where: { runId: source.id } });
      await h.db.$transaction(tx => settleOutcomeWorkItem(tx, source.id, h.runtime));
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("waiting_decision");
      const foreground = await h.db.$transaction(tx => h.messaging.acceptDirectUserMessage(tx, { botId: h.bot.id, channelId: h.channel.id, clientId: crypto.randomUUID(), content: "Keep discussing the unrelated main topic" }));
      const main = await worker.claim(h.bot.id);
      expect(main?.runId).toBe(foreground.run.id);
      expect((await h.db.run.findUniqueOrThrow({ where: { id: foreground.run.id } })).status).toBe("running");
      const resolve = { optionId: "option-1", expectedContractRevision: 1, clientRequestId: crypto.randomUUID() };
      const outcomes = await Promise.all([resolve, { ...resolve, clientRequestId: crypto.randomUUID() }].map(input => Effect.runPromise(Effect.either(decisions.resolve(result.decisionId, input, "owner:local")))));
      expect(outcomes.filter(result => result._tag === "Right")).toHaveLength(1);
      const resumed = await worker.claim(h.bot.id);
      expect(resumed?.contextSessionId).toBe(initial.contextSessionId);
      expect(resumed?.outcomeWorkItemId).toBe(item.id);
      expect(resumed?.runId).not.toBe(initial.runId);
      expect((await h.db.run.findUniqueOrThrow({ where: { id: foreground.run.id } })).status).toBe("running");
      expect(await h.db.channelMessage.count({ where: { channelId: h.channel.id, senderBotId: h.bot.id } })).toBe(0);
    } finally { await h.cleanup(); }
  });
});
