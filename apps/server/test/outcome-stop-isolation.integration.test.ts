import { expect, test } from "bun:test";
import { Effect } from "effect";
import { enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { RunService } from "../src/services/run-service";
import { SubagentService } from "../src/services/subagent/service";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;
async function fixture() {
  const h = await outcomeThreadFixture();
  const children: string[] = [];
  const paths: string[] = [];
  const transport = { scopedStatus: 200 };
  const computerFetch = async (path: string) => {
    paths.push(path);
    return Response.json({ ok: true, stopped: 1 }, { status: path.endsWith("/stop-runs") ? transport.scopedStatus : 200 });
  };
  const runs = new RunService(h.db, computerFetch);
  const service = new SubagentService(h.db, h.messaging, runs, h.root, computerFetch, h.store);
  const parent = async (origin: "user" | "routine" | "outcome") => {
    if (origin === "outcome") {
      const ordinal = await h.db.outcomeWorkItem.count({ where: { outcomeId: h.outcome.id } }) + 1;
      const item = await h.item(ordinal);
      const result = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
        workItemId: item.id, content: "Outcome task", reason: "start", clientId: crypto.randomUUID(),
      }));
      return h.db.run.findUniqueOrThrow({ where: { id: (result as { runId: string }).runId } });
    }
    return h.db.run.create({ data: {
      botId: h.bot.id, conversationId: h.bot.conversation!.id, channelId: h.channel.id,
      origin, status: "running", userMessageId: crypto.randomUUID(),
    } });
  };
  const child = async (parentRun: { id: string; botId: string }, requestRunId?: string) => {
    const bot = await h.db.bot.create({ data: { name: "Stop fixture child", defaultDirectory: h.root, conversation: { create: {} } }, include: { conversation: true } });
    children.push(bot.id);
    const run = await h.db.run.create({ data: {
      botId: bot.id, conversationId: bot.conversation!.id, origin: "agent", status: "running", userMessageId: crypto.randomUUID(),
    } });
    const worker = await h.db.subagent.create({ data: {
      parentBotId: parentRun.botId, parentRunId: parentRun.id, requestRunId, parentChannelId: h.channel.id,
      childBotId: bot.id, launchCallId: crypto.randomUUID(), description: "Test worker", prompt: "Test",
      subagentType: "executor", status: "running", currentRunId: run.id, outputPath: "/tmp/fixture",
    } });
    return { worker, run };
  };
  return { ...h, parent, child, service, paths, transport, async close() {
    await h.db.bot.deleteMany({ where: { id: { in: children.reverse() } } });
    await h.cleanup();
  } };
}

test.skipIf(!databaseUrl)("foreground Stop preserves Outcome children, their descendants and request lineage while retaining broad ordinary Stop", async () => {
  const h = await fixture();
  try {
    const main = await h.parent("user"), routine = await h.parent("routine"), outcome = await h.parent("outcome");
    const ordinary = await h.child(main), other = await h.child(routine), independent = await h.child(outcome);
    const descendant = await h.child(independent.run);
    const legacy = await h.child(main, outcome.id);
    await Effect.runPromise(h.service.stopRun(main.id));
    for (const child of [ordinary, other])
      expect((await h.db.subagent.findUniqueOrThrow({ where: { id: child.worker.id } })).status).toBe("stopped");
    for (const child of [independent, descendant, legacy])
      expect((await h.db.subagent.findUniqueOrThrow({ where: { id: child.worker.id } })).status).toBe("running");
    expect((await h.db.run.findUniqueOrThrow({ where: { id: outcome.id } })).requestStoppedAt).toBeNull();
    expect(h.paths.some(path => path.includes(independent.worker.childBotId))).toBe(false);
  } finally { await h.close(); }
});

test.skipIf(!databaseUrl)("trusted Outcome StopSubagent(all) scopes its WorkItem; legacy all preserves Outcome; global stopBot includes it", async () => {
  const h = await fixture();
  try {
    const main = await h.parent("user"), outcome = await h.parent("outcome"), sibling = await h.parent("outcome");
    const own = await h.child(outcome), ordinary = await h.child(main), other = await h.child(sibling);
    await h.service.stop(h.bot.id, "outcome-all", { all: true }, outcome.id);
    expect((await h.db.subagent.findUniqueOrThrow({ where: { id: own.worker.id } })).status).toBe("stopped");
    for (const child of [ordinary, other])
      expect((await h.db.subagent.findUniqueOrThrow({ where: { id: child.worker.id } })).status).toBe("running");
    await h.service.stop(h.bot.id, "legacy-all", { all: true });
    expect((await h.db.subagent.findUniqueOrThrow({ where: { id: ordinary.worker.id } })).status).toBe("stopped");
    expect((await h.db.subagent.findUniqueOrThrow({ where: { id: other.worker.id } })).status).toBe("running");
    await Effect.runPromise(h.service.stopBot(h.bot.id));
    expect((await h.db.subagent.findUniqueOrThrow({ where: { id: other.worker.id } })).status).toBe("stopped");
  } finally { await h.close(); }
});

test.skipIf(!databaseUrl)("a worker rebound after selection is never stopped by the previous caller", async () => {
  const h = await fixture();
  try {
    const main = await h.parent("user"), outcome = await h.parent("outcome");
    const worker = await h.child(main);
    const select = h.service["runningOwned"].bind(h.service);
    h.service["runningOwned"] = async (...args) => {
      const snapshot = await select(...args);
      await h.db.subagent.update({ where: { id: worker.worker.id }, data: { parentRunId: outcome.id } });
      return snapshot;
    };
    await h.service.stop(h.bot.id, "old-caller", { subagent_id: worker.worker.id }, main.id);
    expect((await h.db.run.findUniqueOrThrow({ where: { id: worker.run.id } })).status).toBe("running");
    expect(h.paths).toEqual([]);
  } finally { await h.close(); }
});

for (const stop of ["run", "bot"] as const) {
  test.skipIf(!databaseUrl)(`${stop} Stop fences completed Outcome roots before actual late shell completion`, async () => {
    const h = await fixture();
    try {
      const root = await h.parent("outcome");
      const sibling = stop === "run" ? await h.parent("outcome") : null;
      const queuedIntent = stop === "bot" ? await h.item(2) : null;
      await h.db.$transaction(tx => transitionWorkItem(tx, {
        workItemId: root.outcomeWorkItemId!, to: "running", reason: "claimed", actor: "system:test",
      }));
      await h.db.run.update({ where: { id: root.id }, data: { status: "completed" } });
      await h.db.runItem.create({ data: {
        runId: root.id, kind: "command", status: "completed",
        content: { shellKind: "background", result: { details: { status: "running", outputPath: "/tmp/stopped-shell.log" } } },
      } });
      if (stop === "run") await Effect.runPromise(h.service.stopRun(root.id));
      else await Effect.runPromise(h.service.stopBot(h.bot.id));
      const before = await h.db.run.count({ where: { outcomeWorkItemId: root.outcomeWorkItemId } });
      expect(await h.messaging.completeShell({
        id: crypto.randomUUID(), scope: h.bot.id, channelId: h.channel.id,
        automationRunId: root.id, outputPath: "/tmp/stopped-shell.log", exitCode: 0, title: "Old result",
      })).toMatchObject({ delivered: false, ignored: true });
      expect(await h.db.run.count({ where: { outcomeWorkItemId: root.outcomeWorkItemId } })).toBe(before);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: root.outcomeWorkItemId! } })).status).toBe("cancelled");
      if (sibling)
        expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: sibling.outcomeWorkItemId! } })).status).toBe("queued");
      if (queuedIntent)
        expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: queuedIntent.id } })).status).toBe("cancelled");
    } finally { await h.close(); }
  });
}

test.skipIf(!databaseUrl)("global Stop retries physical cancellation after the WorkItem fact was already committed", async () => {
  const h = await fixture();
  try {
    const root = await h.parent("outcome");
    await h.db.run.update({ where: { id: root.id }, data: { status: "completed" } });
    h.transport.scopedStatus = 404;
    expect((await Effect.runPromise(Effect.either(h.service.stopBot(h.bot.id))))._tag).toBe("Left");
    expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: root.outcomeWorkItemId! } })).status).toBe("cancelled");
    const count = h.paths.filter(path => path.endsWith("/stop-runs")).length;
    h.transport.scopedStatus = 200;
    expect((await Effect.runPromise(Effect.either(h.service.stopBot(h.bot.id))))._tag).toBe("Right");
    expect(h.paths.filter(path => path.endsWith("/stop-runs")).length).toBeGreaterThan(count);
  } finally { await h.close(); }
});
