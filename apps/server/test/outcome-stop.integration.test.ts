import { expect, test } from "bun:test";
import { Effect } from "effect";
import { COMPUTER_API_PATHS } from "@outcomego/contracts/service-protocol";
import { enqueueOutcomeTurn, transitionWorkItem, dispatchQueuedOutcomeWorkItems } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { RunService } from "../src/services/run-service";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const actor = "system:test" as const;

test.skipIf(!url)("direct group Stop fences completed-root callbacks before IO and preserves sibling work", async () => {
  const h = await outcomeThreadFixture();
  try {
    const items = [await h.item(1), await h.item(2), await h.item(3)];
    const ids: string[] = [];
    for (const item of items.slice(0, 2)) {
      const wake = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
        workItemId: item.id, content: "Read only", reason: "start", clientId: `start:${item.id}`,
      }));
      ids.push((wake as { runId: string }).runId);
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
      await h.db.run.update({ where: { id: ids.at(-1)! }, data: { status: "completed" } });
    }
    const queued = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
      workItemId: items[2]!.id, content: "Capacity wait", reason: "start", clientId: `start:${items[2]!.id}`,
    }));
    expect(queued.status).toBe("queued_for_capacity");
    await h.db.runItem.create({ data: { runId: ids[0]!, kind: "command", status: "completed",
      content: { shellKind: "background", result: { details: { status: "running", outputPath: "/tmp/stopped-shell.log" } } } } });
    const callback = (id: string) => h.messaging.completeShell({
      id, scope: h.bot.id, channelId: h.channel.id, automationRunId: ids[0]!,
      outputPath: "/tmp/stopped-shell.log", exitCode: 0, title: "Stopped command",
    });
    let callbackDuringStop = false;
    const requests: string[] = [];
    const runs = new RunService(h.db, async path => {
      requests.push(path);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items[0]!.id } })).status).toBe("cancelled");
      expect(await callback("during-stop")).toMatchObject({ delivered: false, ignored: true });
      callbackDuringStop = true;
      return Response.json({ stopped: 1, runIds: [ids[0]] });
    });
    // Rootless capacity intents need the same fence, even though there is no physical run to stop.
    await Effect.runPromise(runs.cancelOutcomeWorkItems([items[2]!.id]));
    expect(requests).toHaveLength(0);
    expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items[2]!.id } })).status).toBe("cancelled");
    await Effect.runPromise(runs.cancelOutcomeWorkItems([items[0]!.id]));
    await Effect.runPromise(runs.cancelOutcomeWorkItems([items[0]!.id]));
    expect(callbackDuringStop).toBe(true);
    expect(await callback("after-stop")).toMatchObject({ delivered: false, ignored: true });
    await h.db.$transaction(tx => dispatchQueuedOutcomeWorkItems(tx, h.messaging, h.bot.id));
    expect(await h.db.run.count({ where: { outcomeWorkItemId: items[0]!.id } })).toBe(1);
    expect(await h.db.run.count({ where: { outcomeWorkItemId: items[2]!.id } })).toBe(0);
    expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items[1]!.id } })).status).toBe("running");
    expect((await h.db.run.findUniqueOrThrow({ where: { id: ids[1]! } })).status).toBe("completed");
    const outcome = await h.db.outcome.findUniqueOrThrow({ where: { id: h.outcome.id } });
    expect(outcome.cancelledAt).toBeNull();
    expect(outcome.status).toBe("running");
    expect(requests.every(path => path === COMPUTER_API_PATHS.backgroundShellRunsStop(h.bot.id))).toBe(true);
    const events = await h.db.event.findMany({ where: { entityId: h.outcome.id, topic: "outcome.work_item.updated" } });
    expect(events.filter(event => {
      const payload = event.payload as { workItemId?: string; payload?: { to?: string } };
      return payload.workItemId === items[0]!.id && payload.payload?.to === "cancelled";
    })).toHaveLength(1);
  } finally { await h.cleanup(); }
});

test.skipIf(!url)("Outcome cancellation exhausts a historical descendant chain beyond four levels", async () => {
  const h = await outcomeThreadFixture();
  const childBotIds: string[] = [];
  try {
    const item = await h.item();
    const wake = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
      workItemId: item.id, content: "Read only", reason: "start", clientId: `start:${item.id}`,
    }));
    const rootId = (wake as { runId: string }).runId;
    await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
    await h.db.run.update({ where: { id: rootId }, data: { status: "completed" } });
    let parentBotId = h.bot.id;
    let parentRunId = rootId;
    const children: Array<{ id: string; runId: string; botId: string }> = [];
    // Current Task rejects nested launch, but persisted historical graphs still require complete cancellation.
    for (let depth = 0; depth < 6; depth++) {
      const bot = await h.db.bot.create({ data: {
        name: `Historical child ${depth}`, status: "active", defaultDirectory: h.root, conversation: { create: {} },
      }, include: { conversation: true } });
      childBotIds.push(bot.id);
      const run = await h.db.run.create({ data: {
        botId: bot.id, conversationId: bot.conversation!.id, origin: "agent", status: "running", userMessageId: crypto.randomUUID(),
      } });
      const child = await h.db.subagent.create({ data: {
        parentBotId, parentRunId, parentChannelId: h.channel.id, childBotId: bot.id, currentRunId: run.id,
        launchCallId: `depth:${depth}`, description: "Read only", prompt: "Read only", subagentType: "executor",
        status: "running", outputPath: "/tmp/fixture",
      } });
      children.push({ id: child.id, runId: run.id, botId: bot.id });
      parentBotId = bot.id;
      parentRunId = run.id;
    }
    const scoped = new Set<string>();
    const runs = new RunService(h.db, async (path, init) => {
      if (path.endsWith("/stop-runs")) {
        for (const id of JSON.parse(String(init.body)).runIds) scoped.add(id);
      } else expect(path.endsWith("/background-shells/stop")).toBe(false);
      return Response.json({ ok: true });
    });
    await Effect.runPromise(runs.cancelOutcomeWorkItems([item.id]));
    for (const child of children) {
      expect((await h.db.subagent.findUniqueOrThrow({ where: { id: child.id } })).status).toBe("stopped");
      expect((await h.db.run.findUniqueOrThrow({ where: { id: child.runId } })).status).toBe("cancelled");
      expect(scoped.has(child.runId)).toBe(true);
    }
    expect(scoped.has(rootId)).toBe(true);
    // Replay is also complete; it must not keep revisiting only the first four historical levels.
    await Effect.runPromise(runs.cancelOutcomeWorkItems([item.id]));
  } finally {
    await h.db.bot.deleteMany({ where: { id: { in: childBotIds } } });
    await h.cleanup();
  }
});
