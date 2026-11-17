import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  AGENT_WORK_ITEM_STATUSES, HUMAN_WORK_ITEM_STATUSES, OutcomeError,
  type OutcomeEventTopic, type WorkItemStatus,
} from "@outcomego/contracts/outcomes";
import { createPrismaClient, type Prisma } from "@outcomego/db";
import { appendOutcomeEvent, recomputeOutcomeStatus, transitionWorkItem } from "../src/outcome-state";
import { OutcomeThreadFake } from "../src/testing/outcome-thread-fake";
import type { AgentMessaging } from "../src";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const actor = "system:outcome-state-test" as const;
const statuses = [...new Set([...AGENT_WORK_ITEM_STATUSES, ...HUMAN_WORK_ITEM_STATUSES])];

// Enumerated from parent §42.2, human §16, and existing Outcome-wide cancellation/submission semantics.
const allowed = {
  agent: [
    "queued:running", "queued:retry_pending", "queued:failed", "queued:cancelled",
    "running:completed", "running:failed", "running:cancelled", "running:waiting_decision",
    "running:waiting_human", "running:retry_pending", "running:needs_review", "running:queued",
    "waiting_decision:running", "waiting_decision:cancelled", "waiting_human:running", "waiting_human:cancelled",
    "retry_pending:running", "retry_pending:failed", "retry_pending:cancelled",
    "needs_review:running", "needs_review:cancelled", "needs_review:completed",
  ],
  human: [
    "pending:ready", "pending:in_progress", "pending:cancelled", "ready:in_progress", "ready:cancelled",
    "in_progress:submitted", "in_progress:paused", "in_progress:cancelled",
    "paused:in_progress", "paused:cancelled", "submitted:review_pending", "submitted:rejected", "submitted:cancelled",
    "review_pending:accepted", "review_pending:rejected", "review_pending:cancelled",
    "rejected:in_progress", "rejected:cancelled",
  ],
};

describe.skipIf(!url)("shared Outcome state", () => {
  let db!: ReturnType<typeof createPrismaClient>;
  let botId: string;
  let outcomeId: string;
  const items = { agent: "", human: "" };

  beforeAll(async () => {
    db = createPrismaClient(url!);
    const bot = await db.bot.create({ data: { name: "Outcome state fixture", defaultDirectory: "/tmp", conversation: { create: {} } } });
    botId = bot.id;
    const outcome = await db.outcome.create({ data: { botId, title: "State fixture" } });
    outcomeId = outcome.id;
    const revision = await db.outcomeContractRevision.create({ data: {
      outcomeId, revision: 1, status: "approved", goal: [], boundaries: {},
      executionBotId: botId, contentHash: "fixture", createdBy: actor,
    } });
    await db.outcome.update({ where: { id: outcomeId }, data: { currentRevisionId: revision.id, status: "approved" } });
    for (const [index, executorType] of (["agent", "human"] as const).entries()) {
      const item = await db.outcomeWorkItem.create({ data: {
        outcomeId, contractRevisionId: revision.id, botId, executorType, title: executorType, ordinal: index + 1,
        status: executorType === "agent" ? "queued" : "pending",
      } });
      items[executorType] = item.id;
    }
  });

  afterAll(async () => {
    if (db) {
      await db.event.deleteMany({ where: { entityId: outcomeId } });
      await db.idempotencyRecord.deleteMany({ where: { scope: { in: Object.values(items).map((id) => `outcome-work-item:${id}`) } } });
      if (botId) await db.bot.delete({ where: { id: botId } });
      await db.$disconnect();
    }
  });

  const reset = (executor: "agent" | "human", status: WorkItemStatus) =>
    db.outcomeWorkItem.update({ where: { id: items[executor] }, data: { status, statusReason: null, startedAt: null, completedAt: null } });
  const change = (to: WorkItemStatus, idempotencyKey?: string, reason = "fixture") =>
    db.$transaction((tx) => transitionWorkItem(tx, { workItemId: items.agent, to, reason, actor, idempotencyKey }));
  const updateEvents = () => db.event.count({ where: { entityId: outcomeId, topic: "outcome.work_item.updated" } });

  for (const executor of ["agent", "human"] as const) {
    const fromStates = executor === "agent" ? AGENT_WORK_ITEM_STATUSES : HUMAN_WORK_ITEM_STATUSES;
    for (const from of fromStates) for (const to of statuses) {
      const valid = allowed[executor].includes(`${from}:${to}`);
      test(`${executor} ${from} -> ${to} is ${valid ? "allowed" : "refused"}`, async () => {
        await reset(executor, from);
        const before = await updateEvents();
        const operation = () => db.$transaction((tx) =>
          transitionWorkItem(tx, { workItemId: items[executor], to, reason: "fixture", actor }));
        if (valid) {
          await operation();
          const item = await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items[executor] } });
          expect(item.status).toBe(to);
          expect(item.statusReason).toBe("fixture");
          expect(item.startedAt !== null).toBe(["running", "in_progress"].includes(to));
          expect(item.completedAt !== null).toBe(["completed", "failed", "cancelled", "accepted"].includes(to));
          expect(await updateEvents()).toBe(before + 1);
          const event = await db.event.findFirstOrThrow({
            where: { entityId: outcomeId, topic: "outcome.work_item.updated" }, orderBy: { sequence: "desc" },
          });
          expect(event.payload).toMatchObject({ actorId: actor, workItemId: item.id, payload: { from, to, reason: "fixture" } });
        } else {
          await expect(operation()).rejects.toMatchObject({ code: "invalid_outcome_transition" });
          expect((await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items[executor] } })).status).toBe(from);
          expect(await updateEvents()).toBe(before);
        }
      });
    }
  }

  test("transitions recompute decision/human side states and preserve the first start time", async () => {
    await reset("human", "cancelled");
    await reset("agent", "queued");
    await change("running");
    const started = (await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items.agent } })).startedAt;
    await change("waiting_decision");
    expect(await db.outcome.findUniqueOrThrow({ where: { id: outcomeId } })).toMatchObject({ status: "decision_pending", resumeStatus: "approved" });
    await change("running");
    await change("waiting_human");
    expect((await db.outcome.findUniqueOrThrow({ where: { id: outcomeId } })).status).toBe("human_action_pending");
    await change("running");
    await change("completed");
    expect((await db.outcome.findUniqueOrThrow({ where: { id: outcomeId } })).status).toBe("review_pending");
    expect((await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items.agent } })).startedAt).toEqual(started);
  });

  test("duplicate concurrent requests emit one event and a changed request conflicts", async () => {
    await reset("agent", "queued");
    const key = crypto.randomUUID();
    const before = await updateEvents();
    await Promise.all([change("running", key), change("running", key)]);
    expect(await updateEvents()).toBe(before + 1);
    await expect(change("running", key, "another reason")).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  test("a transaction rollback restores both state and events", async () => {
    await reset("agent", "queued");
    const before = await updateEvents();
    await expect(db.$transaction(async (tx) => {
      await transitionWorkItem(tx, { workItemId: items.agent, to: "running", reason: "fixture", actor });
      throw new Error("rollback fixture");
    })).rejects.toThrow("rollback fixture");
    expect((await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items.agent } })).status).toBe("queued");
    expect(await updateEvents()).toBe(before);
  });

  test("missing work items and unregistered event names are refused", async () => {
    await expect(db.$transaction((tx) => transitionWorkItem(tx, {
      workItemId: crypto.randomUUID(), to: "running", reason: "fixture", actor,
    }))).rejects.toBeInstanceOf(OutcomeError);
    expect(() => appendOutcomeEvent({} as Prisma.TransactionClient, "run.completed" as OutcomeEventTopic, outcomeId, {
      actor, payload: { from: "queued", to: "running", reason: "fixture" },
    })).toThrow("Unknown Outcome event topic");
  });

  test("the test substitute records calls and uses shared transitions without creating a run", async () => {
    await reset("agent", "waiting_decision");
    const fake = new OutcomeThreadFake();
    const input = { workItemId: items.agent, content: "Continue", reason: "decision_resolved" as const, clientId: crypto.randomUUID() };
    const runs = await db.run.count({ where: { botId } });
    await db.$transaction((tx) => fake.enqueueOutcomeTurn(tx, {} as AgentMessaging, input));
    expect(fake.enqueueCalls).toEqual([input]);
    expect((await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: items.agent } })).status).toBe("running");
    expect(await db.run.count({ where: { botId } })).toBe(runs);
    await db.$transaction((tx) => fake.settleOutcomeWorkItem(tx, "fake-run"));
    expect(fake.settleCalls).toEqual(["fake-run"]);
    await db.$transaction((tx) => recomputeOutcomeStatus(tx, outcomeId, actor));
  });
});
