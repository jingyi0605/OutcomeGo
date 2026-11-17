import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outcomeNotificationPayload } from "@outcomego/contracts/notification-content";
import { publishOutcomeNotification, reconcileOutcomeDecisionNotifications } from "@outcomego/messaging";
import { DecisionService } from "../src/services/decision-service";
import { NotificationService } from "../src/services/notification-service";
import { OutcomeInboxService } from "../src/services/outcome-inbox-service";
import { parseOutcomeInboxQuery } from "@outcomego/contracts/outcome-inbox";
import { PushNotificationDispatcher } from "../../worker/src/push-notifications";
import type { ApnsClient } from "../../worker/src/apns";
import type { FcmClient } from "../../worker/src/fcm";
import { actor, fixture, run, testDb } from "./fixtures/outcome-inbox-fixture";
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;

describe.skipIf(!url)("Outcome notification facts and delivery", () => {
  let db: ReturnType<typeof testDb>; const bots: string[] = []; let deviceId: string;
  const originalAuth = process.env.OUTCOMEGO_AUTH_MODE;
  beforeAll(async () => {
    db = testDb();
    process.env.OUTCOMEGO_AUTH_MODE = "disabled";
    const device = await db.pushDevice.create({ data: { installationId: `inbox-test-${crypto.randomUUID()}`, platform: "ios", provider: "apns", pushToken: crypto.randomUUID().replaceAll("-", "").repeat(2), authRequired: false, apnsEnvironment: "sandbox", apnsTopic: "test.outcomego", notificationScope: "fixture" } }); deviceId = device.id;
  });
  afterAll(async () => {
    process.env.OUTCOMEGO_AUTH_MODE = originalAuth;
    await db.outboxDelivery.deleteMany({ where: { target: deviceId } });
    await db.pushDevice.delete({ where: { id: deviceId } });
    await db.bot.deleteMany({ where: { id: { in: bots } } });
    await db.notificationPreferences.deleteMany({ where: { id: "global" } });
    await db.$disconnect();
  });
  const create = async () => { const f = await fixture(db); bots.push(f.bot.id); return f; };
  const payload = (f: Awaited<ReturnType<typeof create>>, factKey: string) => outcomeNotificationPayload({ type: "outcome.review.required", factKey: `${f.outcome.id}:${factKey}`, outcomeId: f.outcome.id, botId: f.bot.id, channelId: f.channel.id, contractRevision: 1 });
  test("one fact creates one durable activity/intent despite duplicate events and parallel projection", async () => {
    const f = await create(); const decisions = new DecisionService(db); const d = await run(decisions.create(f.input, actor));
    const event = await db.event.findFirstOrThrow({ where: { topic: "outcome.decision.required", entityId: f.outcome.id } });
    const notifications = new NotificationService(db, "disabled");
    await Promise.all(Array.from({ length: 3 }, () => run(notifications.projectOutcomeEvent(event.sequence.toString()))));
    const duplicate = await db.event.create({ data: { topic: event.topic, entityId: event.entityId, payload: JSON.parse(JSON.stringify(event.payload)) } });
    await run(notifications.projectOutcomeEvent(duplicate.sequence.toString()));
    expect(await db.channelNotification.count({ where: { key: `decision.required:${d.id}` } })).toBe(1);
    const deliveries = await db.outboxDelivery.findMany({ where: { target: deviceId, payload: { path: ["decisionId"], equals: d.id } } });
    expect(deliveries).toHaveLength(1);
    expect(JSON.stringify(deliveries[0]?.payload)).not.toContain("SECRET");
    expect(JSON.stringify(deliveries[0]?.payload)).not.toContain("Private title");
    expect(await db.channelMessage.count({ where: { channelId: f.channel.id } })).toBe(0);
  });
  test("closed preferences or Bot notifications keep facts and Inbox, creating no push", async () => {
    for (const toggle of ["global", "bot"]) {
      const f = await create();
      if (toggle === "global") await db.notificationPreferences.upsert({ where: { id: "global" }, create: { id: "global", smartEnabled: false }, update: { smartEnabled: false } });
      else await db.bot.update({ where: { id: f.bot.id }, data: { notificationsEnabled: false } });
      const d = await run(new DecisionService(db).create(f.input, actor));
      expect(await db.channelNotification.count({ where: { key: `decision.required:${d.id}` } })).toBe(1);
      expect(await db.outboxDelivery.count({ where: { payload: { path: ["decisionId"], equals: d.id } } })).toBe(0);
      expect((await run(new OutcomeInboxService(db).list(parseOutcomeInboxQuery(new URLSearchParams()), f.outcome.id))).items).toHaveLength(1);
      await db.notificationPreferences.upsert({ where: { id: "global" }, create: { id: "global", smartEnabled: true }, update: { smartEnabled: true } });
    }
  });
  test("ordinary progress is silent, eligible alerts merge for 60 seconds, Decisions and urgent alerts stay separate", async () => {
    const f = await create();
    const event = await db.event.create({ data: { topic: "outcome.work_item.updated", entityId: f.outcome.id, payload: { payload: { to: "running" } } } });
    expect(await run(new NotificationService(db).projectOutcomeEvent(event.sequence.toString()))).toEqual({ projected: false });
    expect(await db.channelNotification.count({ where: { channelId: f.channel.id } })).toBe(0);
    const a = payload(f, "review:one"); const b = payload(f, "review:two");
    await db.$transaction(tx => publishOutcomeNotification(tx, a));
    await db.$transaction(tx => publishOutcomeNotification(tx, b));
    expect(await db.channelNotification.count({ where: { channelId: f.channel.id } })).toBe(2);
    expect(await db.outboxDelivery.count({ where: { target: deviceId, payload: { path: ["outcomeId"], equals: f.outcome.id } } })).toBe(1);
    await db.$transaction(tx => publishOutcomeNotification(tx, { ...payload(f, "review:urgent"), priority: 4 }));
    await db.$transaction(tx => publishOutcomeNotification(tx, { ...payload(f, "review:revision2"), contractRevision: 2 }));
    await db.channelNotification.updateMany({ where: { channelId: f.channel.id }, data: { createdAt: new Date(Date.now()-61_000) } });
    await db.$transaction(tx => publishOutcomeNotification(tx, payload(f, "review:after-window")));
    expect(await db.outboxDelivery.count({ where: { target: deviceId, payload: { path: ["outcomeId"], equals: f.outcome.id } } })).toBe(4);
    const decisions = new DecisionService(db);
    await run(decisions.create(f.input, actor));
    await run(decisions.create({ ...f.input, workItemId: undefined, reasonCode: "second-decision" }, actor));
    expect(await db.outboxDelivery.count({ where: { target: deviceId, payload: { path: ["outcomeId"], equals: f.outcome.id } } })).toBe(6);
  });
  test("real dispatcher retries provider failures without changing Decision or Inbox, then succeeds", async () => {
    const f = await create(); const d = await run(new DecisionService(db).create(f.input, actor));
    const where = { target: deviceId, payload: { path: ["decisionId"], equals: d.id } };
    // Retire unrelated fixtures so this assertion observes only the intended provider call.
    await db.outboxDelivery.updateMany({ where: { target: deviceId, NOT: { payload: { path: ["decisionId"], equals: d.id } } }, data: { status: "delivered" } });
    await db.outboxDelivery.updateMany({ where, data: { availableAt: new Date(0) } });
    let calls = 0;
    const apns = { send: async () => { calls++; return { status: 503, reason: "ServiceUnavailable" }; } } as unknown as ApnsClient;
    const dispatcher = new PushNotificationDispatcher(db, "disabled", apns, {} as FcmClient);
    await dispatcher.drain();
    expect(calls).toBe(1);
    const failed = await db.outboxDelivery.findFirstOrThrow({ where });
    expect(failed.status).toBe("failed"); expect(failed.attempts).toBe(1); expect(failed.error).toMatchObject({ reason: "ServiceUnavailable" });
    expect((await run(new DecisionService(db).get(d.id))).status).toBe("open");
    expect((await run(new OutcomeInboxService(db).list(parseOutcomeInboxQuery(new URLSearchParams()), f.outcome.id))).items).toHaveLength(1);
    await db.outboxDelivery.updateMany({ where, data: { availableAt: new Date(0) } });
    const good = new PushNotificationDispatcher(db, "disabled", { send: async () => ({ status: 200 }) } as unknown as ApnsClient, {} as FcmClient);
    await good.drain();
    expect((await db.outboxDelivery.findFirstOrThrow({ where })).status).toBe("delivered");
  });
  test("startup and periodic drains recover a crash gap after Event pruning and a late transaction commit", async () => {
    const f = await create(); const d = await run(new DecisionService(db).create(f.input, actor));
    await db.outboxDelivery.deleteMany({ where: { payload: { path: ["decisionId"], equals: d.id } } });
    await db.channelNotification.delete({ where: { key: `decision.required:${d.id}` } });
    await db.event.deleteMany({ where: { entityId: f.outcome.id, topic: "outcome.decision.required" } });
    const dispatcher = new PushNotificationDispatcher(db, "disabled", { send: async () => ({ status: 200 }) } as unknown as ApnsClient, {} as FcmClient);
    await dispatcher.drain();
    expect(await db.channelNotification.count({ where: { key: `decision.required:${d.id}` } })).toBe(1);
    expect(await db.outboxDelivery.count({ where: { target: deviceId, payload: { path: ["decisionId"], equals: d.id } } })).toBe(1);
    await dispatcher.drain();
    expect(await db.outboxDelivery.count({ where: { target: deviceId, payload: { path: ["decisionId"], equals: d.id } } })).toBe(1);
    const late = await create(); let release!: () => void; let inserted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { inserted = resolve; });
    const id = crypto.randomUUID();
    const transaction = db.$transaction(async tx => {
      await tx.outcomeDecision.create({ data: { id, outcomeId: late.outcome.id, contractRevisionId: late.revision.id, reasonCode: "late", completedSummary: "Ready", problemSummary: "Choose", nextStepSummary: "Continue", options: [], idempotencyKey: crypto.randomUUID() } });
      inserted(); await gate;
    });
    await ready; await dispatcher.drain();
    expect(await db.channelNotification.count({ where: { key: `decision.required:${id}` } })).toBe(0);
    release(); await transaction; await dispatcher.drain();
    expect(await db.channelNotification.count({ where: { key: `decision.required:${id}` } })).toBe(1);
  });
  test("recovery failure leaves ordinary push delivery working and retries permanent facts on next drain", async () => {
    const f = await create(); const d = await run(new DecisionService(db).create(f.input, actor));
    await db.channelNotification.delete({ where: { key: `decision.required:${d.id}` } });
    await db.outboxDelivery.deleteMany({ where: { target: deviceId } });
    await db.outboxDelivery.create({ data: { deliveryKey: crypto.randomUUID(), topic: "push.notification", target: deviceId, payload: { schemaVersion: 1, kind: "badge-sync", badgeCount: 0 } } });
    let attempts = 0; let sent = 0;
    const dispatcher = new PushNotificationDispatcher(db, "disabled", { send: async () => { sent++; return { status: 200 }; } } as unknown as ApnsClient, {} as FcmClient,
      async () => { attempts++; if (attempts === 1) throw new Error("injected transient database failure"); return reconcileOutcomeDecisionNotifications(db); });
    await dispatcher.drain(); expect(sent).toBe(1);
    expect(await db.channelNotification.count({ where: { key: `decision.required:${d.id}` } })).toBe(0);
    await dispatcher.drain(); expect(attempts).toBe(2);
    expect(await db.channelNotification.count({ where: { key: `decision.required:${d.id}` } })).toBe(1);
  });
  test("more than 100 missing-channel facts cannot starve an eligible decision, and a later channel is recovered", async () => {
    const missing = await create();
    await db.channel.delete({ where: { id: missing.channel.id } });
    await db.outcomeDecision.createMany({ data: Array.from({ length: 101 }, () => ({ outcomeId: missing.outcome.id, contractRevisionId: missing.revision.id, reasonCode: "missing-channel", completedSummary: "Ready", problemSummary: "Choose", nextStepSummary: "Continue", options: [], idempotencyKey: crypto.randomUUID(), createdAt: new Date(Date.now()-5000) })) });
    const f = await create(); const d = await run(new DecisionService(db).create(f.input, actor));
    await db.channelNotification.delete({ where: { key: `decision.required:${d.id}` } });
    await reconcileOutcomeDecisionNotifications(db);
    expect(await db.channelNotification.count({ where: { key: `decision.required:${d.id}` } })).toBe(1);
    const channel = await db.channel.create({ data: { kind: "bot_dm", name: "Late channel", members: { create: { botId: missing.bot.id, ordinal: 1 } } } });
    await reconcileOutcomeDecisionNotifications(db); await reconcileOutcomeDecisionNotifications(db);
    expect(await db.channelNotification.count({ where: { channelId: channel.id } })).toBe(101);
    await db.outboxDelivery.updateMany({ where: { target: deviceId }, data: { status: "delivered" } });
  });
  test("read or absent merge targets never swallow a later required action", async () => {
    for (const mode of ["read", "no-device"] as const) {
      await db.outboxDelivery.updateMany({ where: { target: deviceId }, data: { status: "delivered" } });
      const f = await create();
      if (mode === "no-device") await db.pushDevice.update({ where: { id: deviceId }, data: { enabled: false } });
      const action = async (ordinal: number) => {
        const work = await db.outcomeWorkItem.create({ data: { outcomeId: f.outcome.id, contractRevisionId: f.revision.id, botId: f.bot.id,
          title: "Inspect the action", ordinal, executorType: "human", kind: "human_action", status: "ready",
          humanActionCard: { create: { purpose: "Inspect", steps: [], evidenceRequirements: [], requestedByWorkItemId: f.item.id } } } });
        return outcomeNotificationPayload({ type: "outcome.human_action.required", factKey: `human_action.required:${work.id}`,
          outcomeId: f.outcome.id, botId: f.bot.id, channelId: f.channel.id, contractRevision: 1 });
      };
      const first = await action(2);
      await db.$transaction(tx => publishOutcomeNotification(tx, first));
      const activity = await db.channelNotification.findUniqueOrThrow({ where: { key: first.factKey } });
      if (mode === "read") await db.channelReadState.create({ data: { channelId: f.channel.id, lastReadNotificationSequence: activity.sequence } });
      else await db.pushDevice.update({ where: { id: deviceId }, data: { enabled: true } });
      const second = await action(3);
      await db.$transaction(tx => publishOutcomeNotification(tx, second));
      await db.outboxDelivery.updateMany({ where: { target: deviceId }, data: { availableAt: new Date(0) } });
      const delivered: string[] = [];
      await new PushNotificationDispatcher(db, "disabled", { send: async (_device: unknown, alert: { factKey?: string }) => { if (alert.factKey) delivered.push(alert.factKey); return { status: 200 }; } } as unknown as ApnsClient, {} as FcmClient).drain();
      expect(delivered).toEqual([second.factKey]);
    }
  });
  test("preference changes after queueing, read markers and withdrawal prevent provider sends", async () => {
    for (const mode of ["preference", "read", "withdraw"] as const) {
      const f = await create(); const decisions = new DecisionService(db); const d = await run(decisions.create(f.input, actor));
      const activity = await db.channelNotification.findUniqueOrThrow({ where: { key: `decision.required:${d.id}` } });
      if (mode === "preference") await db.notificationPreferences.update({ where: { id: "global" }, data: { smartEnabled: false } });
      if (mode === "read") await run(new NotificationService(db).markChannelRead(f.channel.id, "0", activity.sequence.toString()));
      if (mode === "withdraw") await run(decisions.withdraw(d.id, actor));
      await db.outboxDelivery.updateMany({ where: { target: deviceId }, data: { availableAt: new Date(0) } });
      let sends = 0;
      await new PushNotificationDispatcher(db, "disabled", { send: async () => { sends++; return { status: 200 }; } } as unknown as ApnsClient, {} as FcmClient).drain();
      expect(sends).toBe(0);
      await db.notificationPreferences.update({ where: { id: "global" }, data: { smartEnabled: true } });
    }
  });
});
