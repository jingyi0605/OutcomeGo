import { expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import { channelNotificationStates, unreadChannelCount } from "@outcomego/messaging";
import { Effect } from "effect";
import { NotificationService } from "../src/services/notification-service";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;

const fixtureAt = <T>(values: readonly T[], index: number): T => {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing notification fixture at index ${index}`);
  return value;
};

test.skipIf(!databaseUrl)("concurrent, duplicated and stale reads preserve newer messages and reactions", async () => {
  const prisma = createPrismaClient(databaseUrl!);
  const bot = await prisma.bot.create({ data: { name: "Notification chaos QA", defaultDirectory: "/tmp/notification-chaos" } });
  const channelIds: string[] = [];
  const installationId = crypto.randomUUID();
  try {
    const device = await prisma.pushDevice.create({ data: {
      installationId, platform: "ios", provider: "apns", pushToken: "ab".repeat(32),
      apnsEnvironment: "development", apnsTopic: "dev.openteam.mobile.swift",
      notificationScope: "cd".repeat(32), authRequired: false,
    } });
    const service = new NotificationService(prisma, "disabled");
    const initialSnapshot = await Effect.runPromise(service.snapshot());
    // Global badges include other conversations, including fixtures that ran first.
    const unrelatedChannel = await prisma.channel.create({ data: {
      kind: "bot_dm", name: "Unrelated unread conversation",
      members: { create: { botId: bot.id, ordinal: 0 } },
    } });
    channelIds.push(unrelatedChannel.id);
    const unrelatedMessage = await prisma.channelMessage.create({ data: {
      channelId: unrelatedChannel.id, sender: "agent", senderBotId: bot.id, content: "Keep this reply unread",
    } });
    const unrelatedReaction = await prisma.channelNotification.create({ data: {
      key: crypto.randomUUID(), channelId: unrelatedChannel.id, botId: bot.id, kind: "reaction", payload: {},
    } });
    const backgroundSnapshot = await Effect.runPromise(service.snapshot());
    expect(backgroundSnapshot.badgeCount).toBe(initialSnapshot.badgeCount + 2);
    for (let index = 0; index < 2; index++) {
      const channel = await prisma.channel.create({ data: {
        kind: "bot_dm", name: `Notification chaos ${index}`,
        members: { create: { botId: bot.id, ordinal: 0 } },
      } });
      channelIds.push(channel.id);
      await prisma.channelMessage.createMany({ data: Array.from({ length: 12 }, (_, message) => ({
        channelId: channel.id, sender: "agent" as const, senderBotId: bot.id, content: `Reply ${message}`,
      })) });
      await prisma.channelNotification.createMany({ data: Array.from({ length: 7 }, () => ({
        key: crypto.randomUUID(), channelId: channel.id, botId: bot.id, kind: "reaction", payload: {},
      })) });
    }
    const channelId = fixtureAt(channelIds, 1);
    const otherChannelId = fixtureAt(channelIds, 2);
    const messages = await prisma.channelMessage.findMany({ where: { channelId }, orderBy: { sequence: "asc" } });
    const reactions = await prisma.channelNotification.findMany({ where: { channelId }, orderBy: { sequence: "asc" } });
    const targetMessage = fixtureAt(messages, 7).sequence.toString();
    const targetActivity = fixtureAt(reactions, 3).sequence.toString();
    // Reordered requests overlap and contain duplicates. None acknowledges the
    // newest four replies or three reactions in this chat.
    await Promise.all(Array.from({ length: 40 }, (_, index) => Effect.runPromise(service.markChannelRead(
      channelId, fixtureAt(messages, index % 8).sequence.toString(), fixtureAt(reactions, index % 4).sequence.toString(),
    ))));
    const persisted = await prisma.channelReadState.findUniqueOrThrow({ where: { channelId } });
    expect(persisted.lastReadSequence.toString()).toBe(targetMessage);
    expect(persisted.lastReadNotificationSequence.toString()).toBe(targetActivity);
    expect(await prisma.channelReadState.findUnique({ where: { channelId: otherChannelId } })).toBeNull();
    const snapshot = await Effect.runPromise(service.snapshot());
    // Seven unread in the first chat and nineteen in the second contribute exactly 26.
    expect((await Effect.runPromise(service.markChannelRead(channelId, targetMessage, targetActivity))).unreadCount).toBe(7);
    const otherActivity = (await channelNotificationStates(prisma, [otherChannelId])).get(otherChannelId);
    expect(await unreadChannelCount(prisma, otherChannelId, 0n)).toBe(12);
    expect(otherActivity?.activityUnreadCount).toBe(7);
    expect(snapshot.badgeCount - backgroundSnapshot.badgeCount).toBe(26);
    expect(snapshot.badgeCount).toBe(initialSnapshot.badgeCount + 2 + 26);
    const eventCount = await prisma.event.count({ where: { topic: "channel.read", entityId: channelId } });
    const outboxCount = await prisma.outboxDelivery.count({ where: { target: device.id } });
    expect(eventCount).toBeGreaterThan(0);
    expect(outboxCount).toBeGreaterThan(0);
    await Promise.all(Array.from({ length: 20 }, () => Effect.runPromise(service.markChannelRead(channelId, targetMessage, targetActivity))));
    expect(await prisma.event.count({ where: { topic: "channel.read", entityId: channelId } })).toBe(eventCount);
    expect(await prisma.outboxDelivery.count({ where: { target: device.id } })).toBe(outboxCount);
    await expect(Effect.runPromise(service.markChannelRead(channelId, "-1", "0"))).rejects.toThrow();
    // An excessive cursor is bounded by stored content. A later reply remains unread.
    await Effect.runPromise(service.markChannelRead(channelId, "999999999999999999", "999999999999999999"));
    const next = await prisma.channelMessage.create({ data: {
      channelId, sender: "agent", senderBotId: bot.id, content: "Arrived after the read",
    } });
    const stale = await Effect.runPromise(service.markChannelRead(channelId, targetMessage, targetActivity));
    expect(stale.lastReadSequence).toBe(messages.at(-1)!.sequence.toString());
    expect(stale.unreadCount).toBe(1);
    expect(BigInt(stale.lastReadSequence)).toBeLessThan(next.sequence);
    // Reads retire only this conversation; the other nineteen and background two survive.
    expect((await Effect.runPromise(service.snapshot())).badgeCount).toBe(backgroundSnapshot.badgeCount + 19 + 1);
    expect(await prisma.channelReadState.findUnique({ where: { channelId: unrelatedChannel.id } })).toBeNull();
    expect(await prisma.channelMessage.findUnique({ where: { id: unrelatedMessage.id } })).toEqual(unrelatedMessage);
    expect(await prisma.channelNotification.findUnique({ where: { sequence: unrelatedReaction.sequence } })).toEqual(unrelatedReaction);
    const deliveries = await prisma.outboxDelivery.findMany({ where: { target: device.id } });
    expect(deliveries.every(delivery => (delivery.payload as { kind: string }).kind === "badge-sync")).toBe(true);
  } finally {
    const devices = await prisma.pushDevice.findMany({ where: { installationId }, select: { id: true } });
    await prisma.outboxDelivery.deleteMany({ where: { target: { in: devices.map(device => device.id) } } });
    await prisma.event.deleteMany({ where: { entityId: { in: channelIds } } });
    await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
    await prisma.pushDevice.deleteMany({ where: { installationId } });
    await prisma.bot.delete({ where: { id: bot.id } });
    await prisma.$disconnect();
  }
}, 30_000);
