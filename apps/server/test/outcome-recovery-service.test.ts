import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeRecoveryService } from "../src/services/outcome-recovery-service";
import { recover } from "../src/services/startup-recovery";
import { enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("Outcome recovery queries and metrics", () => {
  test("attention is null until reported and replayed/concurrent deltas count once", async () => {
    const h = await outcomeThreadFixture();
    const service = new OutcomeRecoveryService(h.db, h.messaging);
    try {
      expect((await Effect.runPromise(service.metrics(h.outcome.id))).attentionSeconds).toBeNull();
      const input = { clientRequestId: "delta:1", seconds: 1.25, surface: "decision" as const };
      const responses = await Promise.all([Effect.runPromise(service.recordAttention(h.outcome.id, input, "owner:local")), Effect.runPromise(service.recordAttention(h.outcome.id, input, "owner:local"))]);
      expect(responses).toEqual([{ recorded: true, seconds: 1.25, surface: "decision" }, { recorded: true, seconds: 1.25, surface: "decision" }]);
      const conflict = await Effect.runPromise(Effect.either(service.recordAttention(h.outcome.id, { ...input, seconds: 2 }, "owner:local")));
      expect(conflict._tag).toBe("Left");
      if (conflict._tag === "Left") expect(conflict.left).toMatchObject({ code: "idempotency_conflict" });
      const metrics = await Effect.runPromise(service.metrics(h.outcome.id));
      expect(metrics.attentionSeconds).toBe(1.25);
      expect(metrics.humanInterventionCount).toBe(1);
      expect(metrics.contractTraceabilityRate).toBeNull();
      expect(metrics.duplicateEventCount).toBeNull();
      expect(JSON.stringify(metrics)).not.toContain("Compare and cite sources");
    } finally { await h.cleanup(); }
  });

  test("reconcile is idempotent and diagnostics exclude provider bodies, prompts and instructions", async () => {
    const h = await outcomeThreadFixture();
    const service = new OutcomeRecoveryService(h.db, h.messaging);
    let deliveryId: string | undefined;
    try {
      const item = await h.item();
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "fixture", actor: "system:fixture" }));
      deliveryId = (await h.db.outboxDelivery.create({ data: { deliveryKey: `fixture:${item.id}`, topic: "push.notification", target: "fixture", payload: { outcomeId: h.outcome.id }, status: "failed", attempts: 5, error: { message: "PRIVATE_PROVIDER_BODY", code: "SECRET_TOKEN" } } })).id;
      const first = await Effect.runPromise(service.reconcile(h.outcome.id, { clientRequestId: "reconcile:1" }, "owner:local"));
      const second = await Effect.runPromise(service.reconcile(h.outcome.id, { clientRequestId: "reconcile:1" }, "owner:local"));
      expect(second).toEqual(first);
      expect(first.items[0]).toMatchObject({ status: "needs_review", reasonCode: "state_inconsistent", recoveryCount: 0 });
      expect(first.notificationFailures).toEqual([{ id: deliveryId, status: "failed", attempts: 5, errorCode: "notification_retry_exhausted" }]);
      expect(JSON.stringify(first)).not.toContain("PRIVATE_PROVIDER_BODY");
      expect(JSON.stringify(first)).not.toContain("SECRET_TOKEN");
      expect(await h.db.event.count({ where: { topic: "outcome.recovered", entityId: h.outcome.id } })).toBe(1);
      expect(await h.db.outcomeDecision.count({ where: { outcomeId: h.outcome.id } })).toBe(1);
    } finally {
      if (deliveryId) await h.db.outboxDelivery.deleteMany({ where: { id: deliveryId } });
      await h.cleanup();
    }
  });

  test("actual startup recovery continues an interrupted Outcome without posting main-chat notices", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      const queued = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Compare", reason: "start", clientId: "restart:initial" }));
      if (queued.status !== "enqueued") throw new Error("Fixture did not enqueue");
      await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "fixture", actor: "system:fixture" }));
      await h.db.run.update({ where: { id: queued.runId }, data: { status: "running", startedAt: new Date() } });
      await h.db.inboxEvent.updateMany({ where: { runId: queued.runId }, data: { status: "processing", claimedAt: new Date() } });
      await recover(h.db, { send: async () => "job" } as never, h.messaging, async () => new Response("{}"));
      expect((await h.db.run.findUniqueOrThrow({ where: { id: queued.runId } })).status).toBe("interrupted");
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id, origin: "outcome", status: "queued" } })).toBe(1);
      expect(await h.db.channelMessage.count({ where: { channelId: h.channel.id } })).toBe(0);
      expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).recoveryCount).toBe(1);
    } finally { await h.cleanup(); }
  });
});
