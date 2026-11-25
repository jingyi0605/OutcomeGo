import { afterEach, describe, expect, test } from "bun:test";
import { notifyRequestsNeedingOwner } from "@outcomego/messaging";
import { PushNotificationDispatcher } from "../../worker/src/push-notifications";
import type { ApnsClient } from "../../worker/src/apns";
import type { FcmClient } from "../../worker/src/fcm";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";

// Specs/004.10 task 4.5 (requirements A5.1 to A5.4): only a request that waits on the owner, or that nobody follows up,
// is announced; each request, revision and state once; never when the bot already asked in the conversation.
// Needs a disposable PostgreSQL database. Fixtures are scenario-neutral placeholders.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
type Fixture = Awaited<ReturnType<typeof outcomeThreadFixture>>;
const minutes = (value: number) => new Date(Date.now() + value * 60_000);

async function setup() {
  const h = await outcomeThreadFixture();
  const authMode = process.env.OUTCOMEGO_AUTH_MODE;
  process.env.OUTCOMEGO_AUTH_MODE = "disabled";
  const device = await h.db.pushDevice.create({
    data: { installationId: `req-notify-${crypto.randomUUID()}`, platform: "ios", provider: "apns", pushToken: crypto.randomUUID().replaceAll("-", "").repeat(2), authRequired: false, apnsEnvironment: "sandbox", apnsTopic: "test.outcomego", notificationScope: "fixture" },
  });
  cleanups.push(async () => {
    if (authMode === undefined) delete process.env.OUTCOMEGO_AUTH_MODE;
    else process.env.OUTCOMEGO_AUTH_MODE = authMode;
    await h.db.outboxDelivery.deleteMany({ where: { target: device.id } });
    await h.db.pushDevice.delete({ where: { id: device.id } });
    await h.db.featureSettings.deleteMany({ where: { id: "global" } });
    await h.cleanup();
  });
  return h;
}

interface Options {
  state?: "working" | "waiting" | "blocked" | "complete";
  blockSource?: "user" | "policy" | "tool" | "runtime";
  revision?: number;
  nextCheckAt?: Date | null;
  stopped?: boolean;
}
async function request(h: Fixture, options: Options = {}) {
  const message = await h.db.message.create({ data: { botId: h.bot.id, conversationId: h.bot.conversation!.id, role: "user", content: "A request", status: "completed" } });
  const state = options.state ?? "blocked";
  return h.db.run.create({
    data: {
      botId: h.bot.id, conversationId: h.bot.conversation!.id, channelId: h.channel.id, userMessageId: message.id, status: "completed", origin: "user",
      requestProgress: { key: "k", state, summary: "SECRET-BOT-TEXT", nextAction: "SECRET-BOT-TEXT", ...(options.blockSource ? { blockSource: options.blockSource } : {}), runId: "x", revision: options.revision ?? 3 },
      requestRevision: options.revision ?? 3, requestNextCheckAt: options.nextCheckAt ?? null, requestStoppedAt: options.stopped ? new Date() : null,
    },
  });
}
const facts = (h: Fixture) => h.db.channelNotification.findMany({ where: { channelId: h.channel.id, kind: "request" } });

describe.skipIf(!url)("announcing requests that need the owner (specs/004.10 task 4.5)", () => {
  for (const [name, blockSource, state] of [
    ["waits on the owner", "user", "needs_owner"],
    ["is blocked by policy", "policy", "needs_owner"],
    ["has nobody following it up", "runtime", "no_follow_up"],
  ] as const) {
    test(`a request that ${name} is announced once, however often the scan runs`, async () => {
      const h = await setup();
      const run = await request(h, { blockSource });
      expect(await notifyRequestsNeedingOwner(h.db)).toBeGreaterThanOrEqual(1);
      await notifyRequestsNeedingOwner(h.db);
      const rows = await facts(h);
      expect(rows.map((row) => row.key)).toEqual([`request:${run.id}:3:${state}`]);
      expect(await h.db.outboxDelivery.count({ where: { payload: { path: ["requestId"], equals: run.id } } })).toBe(1);
      expect(await h.db.event.count({ where: { topic: "notification.created", payload: { path: ["factKey"], equals: rows[0]!.key } } })).toBe(1);
    });
  }

  test("a check that did not fire is announced, and the alert says nothing the bot wrote", async () => {
    const h = await setup();
    const run = await request(h, { state: "waiting", nextCheckAt: minutes(-24 * 60) });
    await notifyRequestsNeedingOwner(h.db);
    const [fact] = await facts(h);
    expect(fact!.key).toBe(`request:${run.id}:3:check_not_fired`);
    expect(JSON.stringify(fact!.payload)).not.toContain("SECRET-BOT-TEXT");
    const delivery = await h.db.outboxDelivery.findFirstOrThrow({ where: { payload: { path: ["requestId"], equals: run.id } } });
    expect(JSON.stringify(delivery.payload)).not.toContain("SECRET-BOT-TEXT");
  });

  test("progress, waiting, finished, stopped and not-yet-overdue requests stay silent", async () => {
    const h = await setup();
    await request(h, { state: "working" });
    await request(h, { state: "waiting", nextCheckAt: minutes(30) });
    await request(h, { state: "waiting" });
    await request(h, { state: "complete" });
    await request(h, { state: "blocked", blockSource: "user", stopped: true });
    await request(h, { state: "blocked", blockSource: "tool" });
    expect(await notifyRequestsNeedingOwner(h.db)).toBe(0);
    expect(await facts(h)).toHaveLength(0);
  });

  test("a new revision or a new state is a new thing to announce; the same one is not", async () => {
    const h = await setup();
    const run = await request(h, { blockSource: "user" });
    await notifyRequestsNeedingOwner(h.db);
    await h.db.run.update({ where: { id: run.id }, data: { requestRevision: 4 } });
    await notifyRequestsNeedingOwner(h.db);
    await h.db.run.update({ where: { id: run.id }, data: { requestProgress: { key: "k", state: "blocked", blockSource: "runtime", summary: "s", runId: "x", revision: 4 } } });
    await notifyRequestsNeedingOwner(h.db);
    await notifyRequestsNeedingOwner(h.db);
    expect((await facts(h)).map((row) => row.key).sort()).toEqual([`request:${run.id}:3:needs_owner`, `request:${run.id}:4:needs_owner`, `request:${run.id}:4:no_follow_up`].sort());
  });

  test("a bot that already asked in the conversation is not announced a second time, but a request nobody follows up still is", async () => {
    const h = await setup();
    const asked = await request(h, { blockSource: "user" });
    const forgotten = await request(h, { blockSource: "runtime" });
    await h.db.channelMessage.create({ data: { channelId: h.channel.id, sender: "agent", senderBotId: h.bot.id, content: "Which one?" } });
    await notifyRequestsNeedingOwner(h.db);
    const keys = (await facts(h)).map((row) => row.key);
    expect(keys).toContain(`request:${forgotten.id}:3:no_follow_up`);
    expect(keys).not.toContain(`request:${asked.id}:3:needs_owner`);
  });

  test("when the owner turned alerts off the fact is kept and no push is queued", async () => {
    const h = await setup();
    await h.db.bot.update({ where: { id: h.bot.id }, data: { notificationsEnabled: false } });
    const run = await request(h, { blockSource: "user" });
    await notifyRequestsNeedingOwner(h.db);
    expect(await facts(h)).toHaveLength(1);
    expect(await h.db.outboxDelivery.count({ where: { payload: { path: ["requestId"], equals: run.id } } })).toBe(0);
  });

  for (const moveOn of [false, true]) {
    test(`the push is ${moveOn ? "dropped when the request has moved on before it was sent" : "sent while the request still waits on the owner"}`, async () => {
      const h = await setup();
      const run = await request(h, { blockSource: "user" });
      await notifyRequestsNeedingOwner(h.db);
      if (moveOn) await h.db.run.update({ where: { id: run.id }, data: { requestProgress: { key: "k", state: "working", summary: "s", runId: "x", revision: 3 } } });
      // The alert waits a moment before it may go out; the test does not.
      await h.db.outboxDelivery.updateMany({ where: { payload: { path: ["requestId"], equals: run.id } }, data: { availableAt: new Date(0) } });
      const sent: Array<{ kind: string; requestId?: string }> = [];
      const apns = { send: async (_device: unknown, payload: { kind: string; requestId?: string }) => (sent.push(payload), { status: 200 }) } as unknown as ApnsClient;
      await new PushNotificationDispatcher(h.db, "disabled", apns, {} as FcmClient, async () => 0).drain();
      expect(sent.filter((payload) => payload.requestId === run.id)).toHaveLength(moveOn ? 0 : 1);
      if (!moveOn) expect(sent.find((payload) => payload.requestId === run.id)).toMatchObject({ kind: "request" });
    });
  }
});
