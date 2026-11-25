import { requestNotificationPayload, type RequestNotificationPayload } from "@outcomego/contracts/notification-content";
import { deriveRequestDisplayState, needsMeZone, type RequestProgressState, type RequestBlockSource } from "@outcomego/contracts/task-overview";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { readFeatureSettings } from "./feature-settings";
import { INDEPENDENT_RUN_ORIGINS } from "./request-progress";

/** Upper bound on requests looked at in one pass; the rest are picked up by the next pass. */
const SCAN_LIMIT = 200;

/**
 * Announces a request that waits on the owner: once per request, revision and state (design 3.4). Only these
 * interrupt; progress, waiting and completion stay silent. Every field comes from the stored request progress;
 * nothing the bot wrote reaches the alert text.
 */
export async function publishRequestNotification(tx: Prisma.TransactionClient, input: RequestNotificationPayload): Promise<boolean> {
  // Same channel lock as read markers and outcome notifications.
  await tx.$executeRaw`SELECT 1 FROM "outcomego_channel" WHERE id = ${input.channelId}::uuid FOR NO KEY UPDATE`;
  const created = await tx.channelNotification.createMany({
    data: { key: input.factKey, channelId: input.channelId, botId: input.botId, kind: "request", payload: input as unknown as Prisma.InputJsonValue },
    skipDuplicates: true,
  });
  if (!created.count) return false;
  const activity = await tx.channelNotification.findUniqueOrThrow({ where: { key: input.factKey } });
  const payload = { ...input, notificationSequence: activity.sequence.toString() };
  await tx.event.create({ data: { topic: "notification.created", entityId: input.channelId, payload: payload as unknown as Prisma.InputJsonValue } });
  const disabledAuth = process.env.OUTCOMEGO_AUTH_MODE?.trim().toLowerCase() === "disabled";
  const { notificationRouting } = await import("./notification-presence");
  const routing = await notificationRouting(tx, disabledAuth ? "disabled" : "required");
  const bot = await tx.bot.findUnique({ where: { id: input.botId } });
  // The durable fact stays even when the owner's preferences suppress alerts.
  if (!routing.smartEnabled || !bot?.notificationsEnabled) return true;
  const devices = await tx.pushDevice.findMany({
    where: disabledAuth ? { enabled: true, authRequired: false } : { enabled: true, authRequired: true, authSession: { is: { expiresAt: { gt: new Date() } } } },
    select: { id: true },
  });
  if (devices.length)
    await tx.outboxDelivery.createMany({
      data: devices.map((device) => ({
        deliveryKey: `notification:request:${activity.sequence}:${device.id}`, topic: "push.notification", target: device.id,
        payload: payload as unknown as Prisma.InputJsonValue, availableAt: new Date(Date.now() + 1_500),
      })),
      skipDuplicates: true,
    });
  return true;
}

interface StoredProgress { state: RequestProgressState; blockSource?: RequestBlockSource }

/** Scans tracked requests and announces those that newly wait on the owner. Returns how many were announced. */
export async function notifyRequestsNeedingOwner(prisma: PrismaClient, now = new Date()): Promise<number> {
  const policy = resolveTaskPolicy((await readFeatureSettings(prisma)).taskPolicy);
  const checkOverdueMinutes = policy["activity.checkOverdueMinutes"] as number;
  const rows = await prisma.run.findMany({
    where: {
      requestProgress: { not: Prisma.DbNull }, requestStoppedAt: null, channelId: { not: null },
      origin: { notIn: [...INDEPENDENT_RUN_ORIGINS] }, bot: { status: "active" },
      OR: [{ requestProgress: { path: ["state"], equals: "blocked" } }, { requestProgress: { path: ["state"], equals: "waiting" } }],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: SCAN_LIMIT,
    select: { id: true, botId: true, channelId: true, createdAt: true, requestProgress: true, requestRevision: true, requestReconciliations: true, requestNextCheckAt: true },
  });
  let announced = 0;
  for (const row of rows) {
    const progress = row.requestProgress as unknown as StoredProgress;
    const state = deriveRequestDisplayState(
      { state: progress.state, blockSource: progress.blockSource, reconciliations: row.requestReconciliations, nextCheckAt: row.requestNextCheckAt },
      now, { checkOverdueMinutes }
    );
    if (!needsMeZone(state) || !row.channelId) continue;
    const kind = state as RequestNotificationPayload["state"];
    // A bot that asked in the conversation already produced a message alert there; a second one would repeat it.
    if (kind === "needs_owner" && (await prisma.channelMessage.count({ where: { channelId: row.channelId, senderBotId: row.botId, createdAt: { gte: row.createdAt } } }))) continue;
    const payload = requestNotificationPayload({ requestId: row.id, state: kind, revision: row.requestRevision, botId: row.botId, channelId: row.channelId });
    const done = await prisma.$transaction((tx) => publishRequestNotification(tx, payload));
    if (done) announced += 1;
  }
  return announced;
}
