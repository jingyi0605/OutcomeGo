import { isOutcomeDecisionRevisionActive, outcomeDecisionRevisionActiveSql } from "./outcome-decisions";
import { normalizeRobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import {
  type AgentNotificationPayload,
  type ChannelNotificationState,
  type ChannelNotificationView,
  agentNotificationPresentation,
  truncateNotificationText,
  outcomeNotificationPayload,
} from "@outcomego/contracts";
import type { BotMessageNotifyLevel } from "@outcomego/contracts/notification-presence";
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
  // Serialize activity allocation with reads in this channel. NO KEY UPDATE is
  // compatible with the foreign-key locks already held by message inserts.
  await tx.$executeRaw`SELECT 1 FROM "outcomego_channel" WHERE id = ${input.channelId}::uuid FOR NO KEY UPDATE`;
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
  if (channel.notificationsMuted) return;
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

const openWorkerStatuses = ["provisioning", "queued", "running", "waiting"] as const;

/**
 * Something this turn started still owes a result: a subagent of this turn (or of the request it
 * continues), or a background command nobody read. Its result arrives in a later turn, so this
 * turn's last message is an acknowledgement, not the settlement.
 */
export const runHasOpenWork = async (
  tx: Prisma.TransactionClient,
  runId: string
): Promise<boolean> => {
  const run = await tx.run.findUnique({ where: { id: runId }, select: { backgroundWorkPending: true } });
  if (run?.backgroundWorkPending) return true;
  const event = await tx.inboxEvent.findFirst({ where: { runId }, select: { payload: true } });
  const contextRunId = (event?.payload as { taskContextRunId?: unknown } | null)?.taskContextRunId;
  const requestRunIds = [runId, ...(typeof contextRunId === "string" ? [contextRunId] : [])];
  return (
    (await tx.subagent.count({
      where: {
        status: { in: [...openWorkerStatuses] },
        OR: [{ parentRunId: runId }, { requestRunId: { in: requestRunIds } }],
      },
    })) > 0
  );
};

/** Marks a push set aside by "final summary only" alerts, so settlement can release it. */
export const HELD_NOT_FINAL = "not_final";

/**
 * Record that this message is the turn's settlement: the reply the user was waiting for. The
 * floating window and its arrival cue key off this fact, not off the model remembering end_turn.
 */
export const markSettlementMessage = async (
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  messageId: string
): Promise<void> => {
  const marked = await tx.$executeRaw`UPDATE "outcomego_channel_message"
    SET "metadata" = COALESCE("metadata", '{}'::jsonb) || '{"settled": true}'::jsonb
    WHERE "id" = ${messageId}::uuid AND NOT (COALESCE("metadata", '{}'::jsonb) ? 'settled')`;
  if (!marked) return;
  // With "final summary only" alerts, this message's push was set aside while it still looked like
  // progress. Its activity already exists, so publishing cannot allocate another push; send the
  // held one now. The delivery check still drops it if the message has been read meanwhile.
  await tx.$executeRaw`UPDATE "outcomego_outbox_delivery"
    SET "status" = 'pending', "deliveredAt" = NULL, "error" = NULL,
      "availableAt" = CURRENT_TIMESTAMP + interval '1.5 seconds'
    WHERE "topic" = 'push.notification' AND "status" = 'delivered'
      AND "error"->>'held' = ${HELD_NOT_FINAL} AND "payload"->>'messageId' = ${messageId}`;
};

/**
 * A Bot message that closes a turn or waits on the owner: the replies "final summary only" alerts
 * and the floating window count. Expects the message row to be aliased `m`.
 */
export const settlementMessageSql = Prisma.sql`(
  m.metadata->'end_turn' = 'true'::jsonb
  -- The server marks a turn's last visible message "settled" when the run completes with no
  -- worker still owing a result (markSettlementMessage). That covers a final reply whose
  -- own send omitted end_turn, such as a room turn that fell back to its final text.
  OR m.metadata->'settled' = 'true'::jsonb
  OR m.metadata ? 'draftOutcomeNotification'
  OR m.metadata->>'type' IN ('widget', 'secret-request', 'computer-handoff', 'user-form')
  OR (m.metadata->>'type' IN ('external-draft', 'imessage-send')
    AND COALESCE(m.metadata->>'cardState', 'pending') <> 'sending')
  OR (m.metadata->>'type' = 'bot-template' AND m.metadata->>'cardState' = 'draft')
)`;

/** Whether the alert's message is a settlement; false when the message no longer exists. */
export const notificationMessageIsSettlement = async (
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  channelId: string,
  messageSequence: string
): Promise<boolean> => {
  const [row] = await tx.$queryRaw<Array<{ settled: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM "outcomego_channel_message" m
      WHERE m."channelId" = ${channelId}::uuid AND m.sequence = ${messageSequence}::bigint
        AND ${settlementMessageSql}
    ) AS settled
  `);
  return row?.settled === true;
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
      dockUnreadCount: bigint | null;
      dockNotificationSequence: bigint | null;
      dockMessageSequence: bigint | null;
      dockCreatedAt: Date | null;
      botMessageLevel: BotMessageNotifyLevel;
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
            AND NOT channel."notificationsMuted" AND n.sequence > channel."mutedThroughNotificationSequence"
            AND n.kind IN ('message', 'reaction')
            AND bot."notificationsEnabled" AND NOT bot."hiddenFromSidebar"
            AND CASE WHEN n.kind = 'reaction'
              THEN n.sequence > COALESCE(state."lastReadNotificationSequence", 0)
              ELSE n."messageSequence" > COALESCE(state."lastReadSequence", 0) END
          ORDER BY n.sequence DESC LIMIT 100) alert), '[]'::jsonb) AS notifications,
      (SELECT COUNT(*) FROM "outcomego_channel_notification" n WHERE n."channelId" = requested."channelId"
        AND NOT n.revoked AND n.kind = 'reaction'
        AND EXISTS (SELECT 1 FROM "outcomego_bot" b WHERE b.id = n."botId" AND b."notificationsEnabled" AND NOT b."hiddenFromSidebar")
        AND n.sequence > COALESCE(state."lastReadNotificationSequence", 0)) AS "activityUnreadCount",
      dock."unreadCount" AS "dockUnreadCount", dock.sequence AS "dockNotificationSequence",
      dock."messageSequence" AS "dockMessageSequence", dock."createdAt" AS "dockCreatedAt",
      COALESCE((SELECT p."botMessageLevel"::text FROM "outcomego_notification_preferences" p
        WHERE p.id = 'global'), 'every_message') AS "botMessageLevel"
    FROM unnest(${channelIds}::uuid[]) requested("channelId")
    JOIN "outcomego_channel" channel ON channel.id = requested."channelId"
    LEFT JOIN "outcomego_channel_read_state" state ON state."channelId" = requested."channelId"
    LEFT JOIN LATERAL (
      SELECT COUNT(*) OVER () AS "unreadCount", n.sequence, n."messageSequence", n."createdAt"
      FROM "outcomego_channel_notification" n
      JOIN "outcomego_bot" bot ON bot.id = n."botId"
      JOIN "outcomego_channel_message" m ON m."channelId" = n."channelId"
        AND m.sequence = n."messageSequence"
      WHERE n."channelId" = requested."channelId" AND n.kind = 'message' AND NOT n.revoked
        AND NOT channel."notificationsMuted" AND n.sequence > channel."mutedThroughNotificationSequence"
        AND bot."notificationsEnabled" AND NOT bot."hiddenFromSidebar"
        AND n."messageSequence" > COALESCE(state."lastReadSequence", 0)
        AND ${settlementMessageSql}
      ORDER BY n.sequence DESC LIMIT 1
    ) dock ON true
  `);
  return new Map(
    rows.map(({ dockUnreadCount, dockNotificationSequence, dockMessageSequence, dockCreatedAt, ...row }) => [
      row.channelId,
      {
        ...row,
        lastReadSequence: row.lastReadSequence.toString(),
        lastReadNotificationSequence: row.lastReadNotificationSequence.toString(),
        notificationCursor: row.notificationCursor.toString(),
        activityUnreadCount: Number(row.activityUnreadCount),
        botDock: {
          unreadCount: Number(dockUnreadCount ?? 0n),
          latest:
            dockNotificationSequence != null && dockMessageSequence != null && dockCreatedAt != null
              ? {
                  notificationSequence: dockNotificationSequence.toString(),
                  messageSequence: dockMessageSequence.toString(),
                  createdAt: dockCreatedAt.toISOString(),
                }
              : null,
        },
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
  if (mergeSequence) {
    const state = await tx.channelReadState.findUnique({ where: { channelId: input.channelId } });
    const previousUnread = !state || mergeSequence > state.lastReadNotificationSequence;
    const queued = previousUnread ? await tx.outboxDelivery.findMany({ where: {
      topic: "push.notification", status: { in: ["pending", "failed"] },
      target: { in: devices.map(device => device.id) },
      AND: [{ payload: { path: ["notificationSequence"], equals: mergeSequence.toString() } }, { payload: { path: ["outcomeId"], equals: input.outcomeId } }],
    } }) : [];
    const mergedTargets = new Set(queued.map(delivery => delivery.target));
    // Advance the surviving alert to the newest unread fact; never merge into read or absent delivery.
    if (queued.length) await tx.outboxDelivery.updateMany({ where: { id: { in: queued.map(delivery => delivery.id) } }, data: { payload: payload as unknown as Prisma.InputJsonValue } });
    const unmerged = devices.filter(device => !mergedTargets.has(device.id));
    if (unmerged.length) await tx.outboxDelivery.createMany({ data: unmerged.map(device => ({
      deliveryKey: `notification:outcome:${activity.sequence}:${device.id}`, topic: "push.notification", target: device.id,
      payload: payload as unknown as Prisma.InputJsonValue, availableAt: new Date(Date.now() + 60_000),
    })), skipDuplicates: true });
    return;
  }
  if (devices.length) await tx.outboxDelivery.createMany({ data: devices.map(device => ({
    deliveryKey: `notification:outcome:${activity.sequence}:${device.id}`, topic: "push.notification", target: device.id,
    payload: payload as unknown as Prisma.InputJsonValue, availableAt: new Date(Date.now() + (mergeable ? 60_000 : 1_500)),
  })), skipDuplicates: true });
}


/** Fact-backed projection also works after the originating Event has been pruned. */
export async function publishRequiredDecisionNotification(tx: Prisma.TransactionClient, decisionId: string): Promise<boolean> {
  const found = await tx.outcomeDecision.findUnique({ where: { id: decisionId }, select: { outcomeId: true } });
  if (!found) return false;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`}))`;
  const decision = await tx.outcomeDecision.findUniqueOrThrow({ where: { id: decisionId }, include: { outcome: true, contractRevision: true } });
  const botId = decision.outcome.botId;
  if (!botId || !["open", "presented"].includes(decision.status) || !await isOutcomeDecisionRevisionActive(tx, decision.outcomeId, decision.contractRevisionId, decision.workItemId) || decision.outcome.cancelledAt || decision.outcome.acceptedAt ||
    (decision.expiresAt && decision.expiresAt <= new Date())) return false;
  const channel = await tx.channel.findFirst({ where: { kind: "bot_dm", archivedAt: null, members: { some: { botId } } }, orderBy: { createdAt: "asc" } });
  if (!channel) return false;
  await publishOutcomeNotification(tx, outcomeNotificationPayload({ type: "outcome.decision.required", factKey: `decision.required:${decision.id}`,
    outcomeId: decision.outcomeId, decisionId: decision.id, botId, channelId: channel.id,
    contractRevision: decision.contractRevision.revision, urgent: decision.reasonCode === "external_result_unknown" }));
  return true;
}

/** Bounded periodic reconciliation has no event high-water mark; eligibility precedes LIMIT. */
export async function reconcileOutcomeDecisionNotifications(prisma: import("@outcomego/db").PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT d.id FROM "outcomego_outcome_decision" d
    JOIN "outcomego_outcome" o ON o.id = d."outcomeId"
    WHERE ${outcomeDecisionRevisionActiveSql(Prisma.sql`o.id`, Prisma.sql`d."contractRevisionId"`, Prisma.sql`d."workItemId"`)}
      AND d.status IN ('open', 'presented') AND (d."expiresAt" IS NULL OR d."expiresAt" > CURRENT_TIMESTAMP)
      AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "outcomego_channel_notification" n WHERE n.key = 'decision.required:' || d.id::text)
      AND EXISTS (SELECT 1 FROM "outcomego_channel" c JOIN "outcomego_channel_member" m ON m."channelId" = c.id
        WHERE c.kind = 'bot_dm' AND c."archivedAt" IS NULL AND m."botId" = o."botId")
    ORDER BY d."createdAt", d.id LIMIT 100
  `);
  let projected = 0;
  for (const row of rows) if (await prisma.$transaction(tx => publishRequiredDecisionNotification(tx, row.id))) projected++;
  return projected;
}
