import { normalizeRobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import {
  type AgentNotificationPayload,
  type ChannelNotificationState,
  type ChannelNotificationView,
  agentNotificationPresentation,
  truncateNotificationText,
} from "@outcomego/contracts";
import { channelMessageSummary } from "@outcomego/product-core/channel-events";
import { Prisma } from "@outcomego/db";

type NotificationInput = Omit<AgentNotificationPayload, "badgeCount" | "notificationSequence">;

/** Persist activity once, then fan out the same identity to every registered device. */
export const publishChannelNotification = async (
  tx: Prisma.TransactionClient,
  key: string,
  input: NotificationInput
): Promise<void> => {
  input = {
    ...input,
    title: truncateNotificationText(input.title),
    body: truncateNotificationText(input.body),
  };
  const [bot, channel] = await Promise.all([
    tx.bot.findUnique({ where: { id: input.botId } }),
    tx.channel.findUnique({ where: { id: input.channelId } }),
  ]);
  if (
    !bot ||
    !bot.notificationsEnabled ||
    bot.hiddenFromSidebar ||
    !channel ||
    channel.archivedAt ||
    channel.hiddenFromSidebar ||
    channel.kind === "agent_dm" ||
    // The reply already reached the user in their outside chat, and the conversation is hidden on mobile.
    channel.kind === "external_dm"
  )
    return;
  input = {
    ...input,
    // A group's alert is titled with the group; the sender avatar still shows which Bot.
    title: truncateNotificationText(
      channel.kind === "group" && channel.name.trim() ? channel.name : bot.name
    ),
    sender: {
      name: truncateNotificationText(bot.name),
      icon: normalizeRobotAvatarShape(bot.icon),
      color: /^#[0-9a-f]{6}$/i.test(bot.color) ? bot.color : "#4f7cff",
    },
  };
  // Serialize activity allocation with reads in this channel. NO KEY UPDATE is
  // compatible with the foreign-key locks already held by message inserts.
  await tx.$executeRaw`SELECT 1 FROM "outcomego_channel" WHERE id = ${input.channelId}::uuid FOR NO KEY UPDATE`;
  const created = await tx.channelNotification.createMany({
    data: {
      key,
      channelId: input.channelId,
      botId: input.botId,
      kind: input.kind,
      messageSequence: input.messageSequence ? BigInt(input.messageSequence) : null,
      payload: input as unknown as Prisma.InputJsonValue,
    },
    skipDuplicates: true,
  });
  if (!created.count) return;
  const activity = await tx.channelNotification.findUniqueOrThrow({ where: { key } });
  const payload: AgentNotificationPayload = {
    ...input,
    notificationSequence: activity.sequence.toString(),
    badgeCount: 0,
  };
  await tx.event.create({
    data: {
      topic: "notification.created",
      entityId: input.channelId,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
  const disabledAuth = process.env.OUTCOMEGO_AUTH_MODE?.trim().toLowerCase() === "disabled";
  const devices = await tx.pushDevice.findMany({
    where: disabledAuth
      ? { enabled: true, authRequired: false }
      : {
          enabled: true,
          authRequired: true,
          authSession: { is: { expiresAt: { gt: new Date() } } },
        },
    select: { id: true },
  });
  if (devices.length)
    await tx.outboxDelivery.createMany({
      data: devices.map(({ id }) => ({
        deliveryKey: `notification:activity:${activity.sequence}:${id}`,
        topic: "push.notification",
        target: id,
        payload: payload as unknown as Prisma.InputJsonValue,
        // Let the foreground client's read receipt overtake an alert before it is sent.
        availableAt: new Date(Date.now() + 1_500),
      })),
      skipDuplicates: true,
    });
};

export const publishMessageNotification = async (
  tx: Prisma.TransactionClient,
  message: {
    id: string;
    channelId: string;
    sequence: bigint;
    senderBotId: string | null;
    sourceRunId: string | null;
    content: string;
    metadata: unknown;
  }
): Promise<void> => {
  if (!message.senderBotId) return;
  const metadata =
    message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : {};
  if ("fromAgent" in metadata || "toAgent" in metadata) return;
  const bot = await tx.bot.findUnique({
    where: { id: message.senderBotId },
    select: { name: true },
  });
  if (!bot) return;
  const kind = "message";
  const { title, body } = agentNotificationPresentation({
    kind,
    botName: bot.name,
    body: messageNotificationBody(message),
  });
  await publishChannelNotification(tx, `message:${message.id}`, {
    schemaVersion: 1,
    kind,
    botId: message.senderBotId,
    channelId: message.channelId,
    runId: message.sourceRunId ?? "",
    messageSequence: message.sequence.toString(),
    messageId: message.id,
    ...(metadata.branched === true ? { threadMessageId: message.id } : {}),
    title,
    body,
  });
};

/** Refresh a progress message's pending alert without allocating another activity or push. */
export const refreshMessageNotification = async (
  tx: Prisma.TransactionClient,
  message: Parameters<typeof publishMessageNotification>[1]
): Promise<void> => {
  const body = truncateNotificationText(messageNotificationBody(message));
  await tx.$executeRaw`UPDATE "outcomego_channel_notification" SET "payload" = "payload" || jsonb_build_object('body', ${body}::text)
    WHERE "key" = ${`message:${message.id}`} AND "channelId" = ${message.channelId}::uuid`;
  await tx.$executeRaw`UPDATE "outcomego_outbox_delivery" SET "payload" = "payload" || jsonb_build_object('body', ${body}::text)
    WHERE "topic" = 'push.notification' AND "status" = 'pending' AND "payload"->>'messageId' = ${message.id}`;
};

/** The same plain-text line the chat list shows: first line of text, "Sent 1 image", a card's prompt. */
export const messageNotificationBody = (message: {
  id: string;
  channelId: string;
  sequence: bigint;
  senderBotId: string | null;
  sourceRunId: string | null;
  content: string;
  metadata: unknown;
}): string =>
  channelMessageSummary({
    ...message,
    sequence: message.sequence.toString(),
    sender: "agent",
    createdAt: "",
  });

/** Bounded alert history plus durable read markers; missing history never means read. */
export const channelNotificationStates = async (
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  channelIds: string[]
): Promise<Map<string, ChannelNotificationState>> => {
  if (!channelIds.length) return new Map();
  const rows = await tx.$queryRaw<
    Array<{
      channelId: string;
      lastReadSequence: bigint;
      lastReadNotificationSequence: bigint;
      notificationCursor: bigint;
      notifications: ChannelNotificationView[];
      activityUnreadCount: bigint;
    }>
  >(Prisma.sql`
    SELECT requested."channelId", COALESCE(state."lastReadSequence", 0) AS "lastReadSequence",
      COALESCE(state."lastReadNotificationSequence", 0) AS "lastReadNotificationSequence",
      COALESCE((SELECT MAX(n."sequence") FROM "outcomego_channel_notification" n
        WHERE n."channelId" = requested."channelId"), 0) AS "notificationCursor",
      COALESCE((SELECT jsonb_agg(alert.payload || jsonb_build_object('notificationSequence', alert.sequence::text))
        FROM (SELECT n.payload, n.sequence FROM "outcomego_channel_notification" n
          JOIN "outcomego_bot" bot ON bot.id = n."botId"
          WHERE n."channelId" = requested."channelId" AND NOT n.revoked
            AND n.kind IN ('message', 'reaction')
            AND bot."notificationsEnabled" AND NOT bot."hiddenFromSidebar"
            AND CASE WHEN n.kind = 'reaction'
              THEN n.sequence > COALESCE(state."lastReadNotificationSequence", 0)
              ELSE n."messageSequence" > COALESCE(state."lastReadSequence", 0) END
          ORDER BY n.sequence DESC LIMIT 100) alert), '[]'::jsonb) AS notifications,
      (SELECT COUNT(*) FROM "outcomego_channel_notification" n WHERE n."channelId" = requested."channelId"
        AND NOT n.revoked AND n.kind = 'reaction'
        AND EXISTS (SELECT 1 FROM "outcomego_bot" b WHERE b.id = n."botId" AND b."notificationsEnabled" AND NOT b."hiddenFromSidebar")
        AND n.sequence > COALESCE(state."lastReadNotificationSequence", 0)) AS "activityUnreadCount"
    FROM unnest(${channelIds}::uuid[]) requested("channelId")
    LEFT JOIN "outcomego_channel_read_state" state ON state."channelId" = requested."channelId"
  `);
  return new Map(
    rows.map((row) => [
      row.channelId,
      {
        ...row,
        lastReadSequence: row.lastReadSequence.toString(),
        lastReadNotificationSequence: row.lastReadNotificationSequence.toString(),
        notificationCursor: row.notificationCursor.toString(),
        activityUnreadCount: Number(row.activityUnreadCount),
      },
    ])
  );
};

/** Outcome activity uses the Bot's existing channel but never creates a chat message. */
export async function publishOutcomeNotification(
  tx: Prisma.TransactionClient,
  input: import("@outcomego/contracts/notification-content").OutcomeNotificationPayload
): Promise<void> {
  // Same channel lock as read markers; key is the business fact, never an event delivery ID.
  await tx.$executeRaw`SELECT 1 FROM "outcomego_channel" WHERE id = ${input.channelId}::uuid FOR NO KEY UPDATE`;
  const created = await tx.channelNotification.createMany({ data: {
    key: input.factKey, channelId: input.channelId, botId: input.botId, kind: "outcome", payload: input as unknown as Prisma.InputJsonValue,
  }, skipDuplicates: true });
  if (!created.count) return;
  const activity = await tx.channelNotification.findUniqueOrThrow({ where: { key: input.factKey } });
  const payload = { ...input, notificationSequence: activity.sequence.toString() };
  await tx.event.create({ data: { topic: "notification.created", entityId: input.channelId, payload: payload as unknown as Prisma.InputJsonValue } });
  const disabledAuth = process.env.OUTCOMEGO_AUTH_MODE?.trim().toLowerCase() === "disabled";
  const { notificationRouting } = await import("./notification-presence");
  const routing = await notificationRouting(tx, disabledAuth ? "disabled" : "required");
  const bot = await tx.bot.findUnique({ where: { id: input.botId } });
  // Keep the durable fact even when existing preferences suppress proactive alerts.
  if (!routing.smartEnabled || !bot?.notificationsEnabled) return;
  const devices = await tx.pushDevice.findMany({ where: disabledAuth ? { enabled: true, authRequired: false } : {
    enabled: true, authRequired: true, authSession: { is: { expiresAt: { gt: new Date() } } },
  }, select: { id: true } });
  // Decisions are independent actions, exempt from aggregation (004.3 §33/43).
  const mergeable = input.priority < 4 && !input.decisionId;
  let mergeSequence: bigint | null = null;
  if (mergeable) {
    const previous = await tx.channelNotification.findFirst({ where: {
      channelId: input.channelId, kind: "outcome", key: { not: input.factKey }, revoked: false,
      createdAt: { gte: new Date(activity.createdAt.getTime() - 60_000) },
      AND: [ { payload: { path: ["outcomeId"], equals: input.outcomeId } }, { payload: { path: ["contractRevision"], equals: input.contractRevision } },
        { payload: { path: ["category"], equals: input.category } }, { payload: { path: ["priority"], lt: 4 } } ],
    }, orderBy: { sequence: "desc" } });
    mergeSequence = previous?.sequence ?? null;
  }
  if (mergeSequence) return;
  if (devices.length) await tx.outboxDelivery.createMany({ data: devices.map(device => ({
    deliveryKey: `notification:outcome:${activity.sequence}:${device.id}`, topic: "push.notification", target: device.id,
    payload: payload as unknown as Prisma.InputJsonValue, availableAt: new Date(Date.now() + (mergeable ? 60_000 : 1_500)),
  })), skipDuplicates: true });
}
