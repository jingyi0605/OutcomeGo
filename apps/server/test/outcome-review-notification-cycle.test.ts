import { expect, test } from "bun:test";
import { Effect } from "effect";
import { parseOutcomeInboxQuery } from "@outcomego/contracts/outcome-inbox";
import { enqueueOutcomeTurn, reconcileOutcomeInboxNotifications, settleOutcomeWorkItem, unreadOutcomeNotifications } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { WakeWorker } from "../../worker/src/worker";
import { PushNotificationDispatcher } from "../../worker/src/push-notifications";
import type { ApnsClient } from "../../worker/src/apns";
import type { FcmClient } from "../../worker/src/fcm";
import { OutcomeReviewService } from "../src/services/outcome-review-service";
import { OutcomeInboxService } from "../src/services/outcome-inbox-service";

test.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("read review A, real FAIL/rework and repeated settlement produce exactly one new unread review B", async () => {
  const h = await outcomeThreadFixture();
  const originalAuth = process.env.OUTCOMEGO_AUTH_MODE;
  process.env.OUTCOMEGO_AUTH_MODE = "disabled";
  const device = await h.db.pushDevice.create({ data: { installationId: crypto.randomUUID(), platform: "ios", provider: "apns",
    pushToken: crypto.randomUUID().replaceAll("-", "").repeat(2), authRequired: false, apnsTopic: "test.outcomego", apnsEnvironment: "sandbox" } });
  const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root });
  const reviews = new OutcomeReviewService(h.db, h.messaging, async () => { throw new Error("Inference is outside this review cycle"); });
  const inbox = new OutcomeInboxService(h.db);
  const query = parseOutcomeInboxQuery(new URLSearchParams({ category: "acceptance_pending" }));
  const unread = () => h.db.$transaction(tx => unreadOutcomeNotifications(tx));
  const settle = async (runId: string) => {
    await h.db.run.update({ where: { id: runId }, data: { status: "completed", completedAt: new Date() } });
    await h.db.inboxEvent.updateMany({ where: { runId }, data: { status: "completed", completedAt: new Date() } });
    await h.db.botRunLease.deleteMany({ where: { runId } });
    await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
  };
  try {
    const original = await h.item();
    await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: original.id, reason: "start", content: "Research", clientId: crypto.randomUUID() }));
    const initial = await worker.claim(h.bot.id);
    if (!initial) throw new Error("Expected an initial Outcome run");
    await h.db.outcomeOutput.create({ data: { outcomeId: h.outcome.id, workItemId: original.id, runId: initial.runId,
      title: "Original report", kind: "final_result", content: "Initial comparison", dedupeKey: `final:${original.id}` } });
    await settle(initial.runId);
    await reconcileOutcomeInboxNotifications(h.db);
    const first = (await unread()).find(value => value.outcomeId === h.outcome.id)!;
    expect(first.type).toBe("outcome.review.required");
    await h.db.channelReadState.create({ data: { channelId: h.channel.id, lastReadNotificationSequence: BigInt(first.notificationSequence) } });
    const criterion = await h.db.outcomeAcceptanceCriterion.findFirstOrThrow({ where: { contractRevisionId: h.revision.id } });
    await Effect.runPromise(reviews.submit(h.outcome.id, { expectedRevision: 1, results: [{ criterionId: criterion.id, result: "FAIL",
      evidenceIds: [], comment: "Compare the missing restore scenario" }], clientRequestId: crypto.randomUUID() }, "owner:local"));
    await reconcileOutcomeInboxNotifications(h.db);
    expect((await unread()).filter(value => value.outcomeId === h.outcome.id)).toEqual([]);
    await Effect.runPromise(reviews.rework(h.outcome.id, { expectedRevision: 1, criterionIds: [criterion.id],
      comment: "Add the restore comparison", clientRequestId: crypto.randomUUID() }, "owner:local"));
    const reworkRun = await worker.claim(h.bot.id);
    if (!reworkRun) throw new Error("Expected the real rework run");
    expect(reworkRun.outcomeWorkItemId).not.toBe(original.id);
    await reconcileOutcomeInboxNotifications(h.db);
    expect((await Effect.runPromise(inbox.list(query, h.outcome.id))).items).toEqual([]);
    expect((await unread()).filter(value => value.outcomeId === h.outcome.id)).toEqual([]);
    const reworkId = reworkRun.outcomeWorkItemId!;
    await h.db.outcomeOutput.create({ data: { outcomeId: h.outcome.id, workItemId: reworkId, runId: reworkRun.runId,
      title: "Reworked report", kind: "final_result", content: "Updated comparison", dedupeKey: `final:${reworkId}` } });
    await settle(reworkRun.runId);
    await reconcileOutcomeInboxNotifications(h.db);
    await settle(reworkRun.runId);
    await reconcileOutcomeInboxNotifications(h.db);
    const after = (await unread()).filter(value => value.outcomeId === h.outcome.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.factKey).not.toBe(first.factKey);
    expect(BigInt(after[0]!.notificationSequence)).toBeGreaterThan(BigInt(first.notificationSequence));
    expect(await h.db.channelNotification.count({ where: { channelId: h.channel.id, kind: "outcome" } })).toBe(2);
    const page = await Effect.runPromise(inbox.list(query, h.outcome.id));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.read).toBe(false);
    expect(await h.db.outboxDelivery.count({ where: { target: device.id, payload: { path: ["factKey"], equals: after[0]!.factKey } } })).toBe(1);
    await h.db.outboxDelivery.updateMany({ where: { target: device.id }, data: { availableAt: new Date(0) } });
    const sent: string[] = [];
    await new PushNotificationDispatcher(h.db, "disabled", { send: async (_device: unknown, payload: { factKey: string }) => {
      sent.push(payload.factKey); return { status: 200 };
    } } as unknown as ApnsClient, {} as FcmClient).drain();
    expect(sent).toEqual([after[0]!.factKey]);
    expect(JSON.stringify(after)).not.toContain("comparison");
  } finally {
    process.env.OUTCOMEGO_AUTH_MODE = originalAuth;
    await h.db.outboxDelivery.deleteMany({ where: { target: device.id } });
    await h.db.pushDevice.delete({ where: { id: device.id } });
    await h.cleanup();
  }
});
