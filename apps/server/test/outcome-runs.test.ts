import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { COMPUTER_API_PATHS } from "@outcomego/contracts/service-protocol";
import { enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeService } from "../src/services/outcome-service";
import { RunService } from "../src/services/run-service";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const actor = "owner:local" as const;
const errorCode = async (effect: Effect.Effect<unknown, Error>) => {
  const result = await Effect.runPromise(Effect.either(effect));
  expect(result._tag).toBe("Left");
  return result._tag === "Left" ? (result.left as { code?: string }).code : undefined;
};

describe.skipIf(!url)("Outcome execution service", () => {
  test("approved start is transactional, deduplicated, and D11 creates only one initial item", async () => {
    const h = await outcomeThreadFixture();
    try {
      const service = new OutcomeService(h.db, h.messaging);
      const input = { expectedRevision: 1, clientRequestId: `start:${h.outcome.id}` };
      const result = await Effect.runPromise(service.startRun(h.outcome.id, input, actor));
      expect(result.workItems).toHaveLength(1);
      expect(result.workItems[0]!.status).toBe("queued");
      expect(result.workItems[0]!.rootRunId).not.toBeNull();
      expect(await Effect.runPromise(service.startRun(h.outcome.id, input, actor))).toEqual(result);
      await Effect.runPromise(service.startRun(h.outcome.id, { ...input, clientRequestId: `${input.clientRequestId}:again` }, actor));
      expect(await h.db.outcomeWorkItem.count({ where: { outcomeId: h.outcome.id } })).toBe(1);
      expect(await h.db.run.count({ where: { botId: h.bot.id } })).toBe(1);
      expect(await errorCode(service.startRun(h.outcome.id, { ...input, expectedRevision: 2 }, actor))).toBe("idempotency_conflict");
      expect(await h.db.channelMessage.count({ where: { channelId: h.channel.id } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  test("unapproved/mismatched contract cannot leave a WorkItem or Run", async () => {
    const h = await outcomeThreadFixture();
    try {
      const service = new OutcomeService(h.db, h.messaging);
      await h.db.outcomeContractRevision.update({ where: { id: h.revision.id }, data: { status: "pending_approval", approvedAt: null } });
      expect(await errorCode(service.startRun(h.outcome.id, { expectedRevision: 1, clientRequestId: crypto.randomUUID() }, actor))).toBe("contract_revision_not_approved");
      expect(await errorCode(service.startRun(h.outcome.id, { expectedRevision: 2, clientRequestId: crypto.randomUUID() }, actor))).toBe("contract_revision_conflict");
      expect(await h.db.outcomeWorkItem.count({ where: { outcomeId: h.outcome.id } })).toBe(0);
      expect(await h.db.run.count({ where: { botId: h.bot.id } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  for (const [botStatus, expected] of [["provisioning", "retry_pending"], ["archived", "failed"]] as const) test(`${botStatus} bot records ${expected} without a partial Run`, async () => {
    const h = await outcomeThreadFixture();
    try {
      const service = new OutcomeService(h.db, h.messaging);
      await h.db.bot.update({ where: { id: h.bot.id }, data: { status: botStatus } });
      const result = await Effect.runPromise(service.startRun(h.outcome.id, { expectedRevision: 1, clientRequestId: crypto.randomUUID() }, actor));
      expect(result.workItems[0]!.status).toBe(expected);
      expect(result.workItems[0]!.rootRunId).toBeNull();
      expect(await h.db.run.count({ where: { botId: h.bot.id } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  test("enqueue failure rolls back WorkItem, mailbox and idempotency facts", async () => {
    const h = await outcomeThreadFixture();
    try {
      const original = h.messaging.enqueueWake.bind(h.messaging);
      h.messaging.enqueueWake = async (...args) => { await original(...args); throw new Error("injected enqueue failure"); };
      const service = new OutcomeService(h.db, h.messaging);
      const result = await Effect.runPromise(Effect.either(service.startRun(h.outcome.id, { expectedRevision: 1, clientRequestId: crypto.randomUUID() }, actor)));
      expect(result._tag).toBe("Left");
      expect(await h.db.outcomeWorkItem.count({ where: { outcomeId: h.outcome.id } })).toBe(0);
      expect(await h.db.run.count({ where: { botId: h.bot.id } })).toBe(0);
    } finally { await h.cleanup(); }
  });

  test("cancel stops exact group and nested workers; foreground/Routine remain active; old computer404 is retryable", async () => {
    const h = await outcomeThreadFixture();
    const childIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const requests: Array<{ path: string; body: unknown }> = [];
    let scopedReady = false;
    try {
      const runs = new RunService(h.db, async (path, init) => {
        requests.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
        if (path.endsWith("/stop-runs") && !scopedReady) return new Response("Not found", { status: 404 });
        return Response.json({ ok: true, stopped: 1 });
      });
      let cancelledHook = 0;
      const service = new OutcomeService(h.db, h.messaging, runs, async () => { cancelledHook++; });
      const started = await Effect.runPromise(service.startRun(h.outcome.id, { expectedRevision: 1, clientRequestId: crypto.randomUUID() }, actor));
      const item = started.workItems[0]!;
      const rootId = item.rootRunId!;
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
      await h.db.run.update({ where: { id: rootId }, data: { status: "completed" } });
      const others = [];
      for (const origin of ["user", "routine"] as const) others.push(await h.db.run.create({ data: {
        botId: h.bot.id, conversationId: h.bot.conversation!.id, channelId: h.channel.id, userMessageId: crypto.randomUUID(), status: "running", origin,
      } }));
      for (const childId of childIds) await h.db.bot.create({ data: { id: childId, name: "Child", defaultDirectory: h.root, conversation: { create: {} } } });
      const children: Array<{ id: string; runId: string }> = [];
      for (const [i, childId] of childIds.entries()) {
        const bot = await h.db.bot.findUniqueOrThrow({ where: { id: childId }, include: { conversation: true } });
        const childRun = await h.db.run.create({ data: { botId: childId, conversationId: bot.conversation!.id, userMessageId: crypto.randomUUID(), origin: "agent", status: "running" } });
        const parentRunId = i === 0 ? rootId : i === 1 ? children[0]!.runId : others[0]!.id;
        const subagent = await h.db.subagent.create({ data: {
          parentBotId: i === 1 ? childIds[0]! : h.bot.id, parentRunId, parentChannelId: h.channel.id, childBotId: childId,
          launchCallId: `child-${i}`, description: "Check", prompt: "Check", subagentType: "executor", status: "running", currentRunId: childRun.id, outputPath: "/tmp/fixture",
        } });
        children.push({ id: subagent.id, runId: childRun.id });
      }
      const input = { clientRequestId: `cancel:${h.outcome.id}` };
      expect(await errorCode(service.cancel(h.outcome.id, input, actor))).toBe("outcome_stop_incomplete");
      expect((await h.db.outcome.findUniqueOrThrow({ where: { id: h.outcome.id } })).status).toBe("cancelled");
      expect(requests.some(request => request.path === COMPUTER_API_PATHS.backgroundShellsStop(h.bot.id))).toBe(false);
      scopedReady = true;
      expect((await Effect.runPromise(service.cancel(h.outcome.id, input, actor))).status).toBe("cancelled");
      expect(cancelledHook).toBe(1);
      for (const other of others) expect((await h.db.run.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("running");
      for (const child of children.slice(0, 2)) expect((await h.db.subagent.findUniqueOrThrow({ where: { id: child.id } })).status).toBe("stopped");
      expect((await h.db.subagent.findUniqueOrThrow({ where: { id: children[2]!.id } })).status).toBe("running");
      const stop = requests.findLast(request => request.path === COMPUTER_API_PATHS.backgroundShellRunsStop(h.bot.id));
      expect(stop?.body).toEqual({ runIds: [rootId] });
      expect(requests.every(request => !request.path.endsWith("/background-shells/stop"))).toBe(true);
    } finally { await h.db.bot.deleteMany({ where: { id: { in: childIds } } }); await h.cleanup(); }
  });

  test("transcript reads only this work item's persisted projection, paginates and omits private payloads", async () => {
    const h = await outcomeThreadFixture();
    try {
      const service = new OutcomeService(h.db, h.messaging);
      const started = await Effect.runPromise(service.startRun(h.outcome.id, { expectedRevision: 1, clientRequestId: crypto.randomUUID() }, actor));
      const item = started.workItems[0]!;
      await h.db.message.create({ data: { botId: h.bot.id, conversationId: h.bot.conversation!.id, runId: item.rootRunId, clientId: crypto.randomUUID(), role: "assistant", content: "Observed result", status: "completed" } });
      await h.db.runItem.create({ data: { runId: item.rootRunId!, kind: "tool", title: "PrivateTool", status: "completed", content: { tool: "PrivateTool", arguments: { secret: "must-stay-private" }, result: { content: [{ type: "text", text: "private-response" }] } } } });
      await h.db.runItem.create({ data: { runId: item.rootRunId!, kind: "reasoning", status: "completed", content: { text: "reasoning-private" } } });
      const all = await Effect.runPromise(service.transcript(h.outcome.id, item.id));
      expect(all.total).toBe(3);
      expect(JSON.stringify(all)).toContain("Observed result");
      expect(JSON.stringify(all)).not.toContain("must-stay-private");
      expect(JSON.stringify(all)).not.toContain("reasoning-private");
      expect(JSON.stringify(all)).not.toContain("private-response");
      const page = await Effect.runPromise(service.transcript(h.outcome.id, item.id, { limit: 1 }));
      expect(page.rows).toHaveLength(1); expect(page.next_before).toBe(2);
      expect(await errorCode(service.transcript(h.outcome.id, crypto.randomUUID()))).toBe("work_item_not_found");
    } finally { await h.cleanup(); }
  });
});
