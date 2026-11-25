import { suppressMobileNotification } from "@outcomego/contracts/notification-presence";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import {
  HELD_NOT_FINAL,
  notificationMessageIsSettlement,
  notificationRouting,
  unreadBadgeCount,
  reconcileOutcomeInboxNotifications,
  outcomeNotificationIsCurrent,
  readFeatureSettings,
} from "@outcomego/messaging";
import { ApnsSettingsStore } from "@outcomego/db/apns-settings";
import {
  PUSH_DELIVERY_ADVISORY_LOCK,
  type PushNotificationPayload,
  isAgentNotificationKind,
  notificationIsRead,
} from "@outcomego/contracts";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { ApnsClient } from "./apns";
import { FcmClient } from "./fcm";

const MAX_ATTEMPTS = 5;
const PUSH_DELIVERY_TRANSACTION_TIMEOUT_MS = 20_000;

type ClaimedDelivery = {
  id: string;
  deliveryKey: string;
  target: string;
  payload: Prisma.JsonValue;
  attempts: number;
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const retryAt = (attempt: number): Date =>
  new Date(Date.now() + Math.min(5 * 60_000, 2 ** Math.max(0, attempt - 1) * 5_000));

const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2_000);

export type PushAuthenticationMode = "disabled" | "required";

export const pushAuthenticationModeFromEnvironment = (
  value = process.env.OUTCOMEGO_AUTH_MODE
): PushAuthenticationMode => (value?.trim().toLowerCase() === "disabled" ? "disabled" : "required");

export const deliverablePushDeviceWhere = (
  authMode: PushAuthenticationMode,
  now = new Date()
): Prisma.PushDeviceWhereInput =>
  authMode === "disabled"
    ? { enabled: true, authRequired: false }
    : {
        enabled: true,
        authRequired: true,
        authSession: { is: { expiresAt: { gt: now } } },
      };

export const pushDeviceSessionIsDeliverable = (
  device: {
    enabled: boolean;
    authRequired: boolean;
    authSession: { expiresAt: Date } | null;
  },
  authMode: PushAuthenticationMode,
  now = new Date()
): boolean =>
  device.enabled &&
  (authMode === "disabled"
    ? !device.authRequired
    : device.authRequired && Boolean(device.authSession && device.authSession.expiresAt > now));

export const claimOutboxDeliveries = async (
  client: Pick<PrismaClient, "$queryRaw">,
  topic: string,
  limit: number
): Promise<ClaimedDelivery[]> =>
  client.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
    WITH candidates AS (
      SELECT delivery."id"
      FROM "outcomego_outbox_delivery" AS delivery
      WHERE delivery."topic" = ${topic}
        AND delivery."status" IN ('pending', 'failed')
        AND delivery."attempts" < ${MAX_ATTEMPTS}
        AND delivery."availableAt" <= CURRENT_TIMESTAMP
      ORDER BY delivery."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.max(1, Math.min(1_000, Math.floor(limit)))}
    )
    UPDATE "outcomego_outbox_delivery" AS delivery
    SET "status" = 'delivering',
        "attempts" = delivery."attempts" + 1,
        "error" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM candidates
    WHERE delivery."id" = candidates."id"
    RETURNING
      delivery."id",
      delivery."deliveryKey",
      delivery."target",
      delivery."payload",
      delivery."attempts"
  `);

type PushAttempt = { delivery: ClaimedDelivery; device: Prisma.PushDeviceGetPayload<{}>; payload: PushNotificationPayload };

const logExhaustedOutcomePush = (delivery: ClaimedDelivery, payload: PushNotificationPayload): void => {
  if (payload.kind !== "outcome" || delivery.attempts < MAX_ATTEMPTS) return;
  console.error("Outcome notification retries exhausted", {
    outcomeId: payload.outcomeId, contractRevision: payload.contractRevision,
    notificationSequence: payload.notificationSequence, deliveryId: delivery.id, code: "notification_retry_exhausted",
  });
};

export class PushNotificationDispatcher {
  private draining = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly authMode = pushAuthenticationModeFromEnvironment(),
    private readonly apns = new ApnsClient(async () => (await new ApnsSettingsStore(prisma).load()).config),
    private readonly fcm = new FcmClient(),
    private readonly recoverOutcomeNotifications: () => Promise<unknown> = () => reconcileOutcomeInboxNotifications(prisma)
  ) {}

  async configurationStatus() {
    return new ApnsSettingsStore(this.prisma).status();
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      // Existing startup and periodic drains recover facts even when the producer crashed before projection.
      try { await this.recoverOutcomeNotifications(); }
      catch { console.warn("Outcome notification recovery failed; retrying on the next push drain"); }
      await this.drainNotifications();
    } finally {
      this.draining = false;
    }
  }

  private async claim(topic: string, limit: number) {
    return claimOutboxDeliveries(this.prisma, topic, limit);
  }

  private async deliverableDevices(
    client: Pick<PrismaClient, "pushDevice">,
    deviceIds: readonly string[]
  ) {
    const checkedAt = new Date();
    const devices = await client.pushDevice.findMany({
      where: {
        AND: [{ id: { in: [...deviceIds] } }, deliverablePushDeviceWhere(this.authMode, checkedAt)],
      },
      include: { authSession: { select: { expiresAt: true, userId: true } } },
    });
    return devices.filter((device) =>
      pushDeviceSessionIsDeliverable(device, this.authMode, checkedAt)
    );
  }

  private async drainNotifications(): Promise<void> {
    while (true) {
      const deliveries = await this.claim("push.notification", 100);
      if (deliveries.length === 0) return;
      const devices = await this.deliverableDevices(
        this.prisma,
        deliveries.map((delivery) => delivery.target)
      );
      const deviceById = new Map(devices.map((device) => [device.id, device] as const));
      const sendable = deliveries.flatMap((delivery) => {
        const device = deviceById.get(delivery.target);
        const payload = delivery.payload as unknown as PushNotificationPayload;
        if (
          !device ||
          payload.schemaVersion !== 1 ||
          !(payload.kind === "badge-sync" || payload.kind === "outcome" || payload.kind === "request" || payload.kind === "todo" || isAgentNotificationKind(payload.kind))
        ) {
          return [];
        }
        return [{ delivery, device, payload }];
      });
      const skipped = deliveries.filter(
        (delivery) => !sendable.some((item) => item.delivery.id === delivery.id)
      );
      if (skipped.length > 0) {
        await this.prisma.outboxDelivery.updateMany({
          where: { id: { in: skipped.map((delivery) => delivery.id) } },
          data: { status: "delivered", deliveredAt: new Date() },
        });
      }
      if (sendable.length === 0) continue;

      try {
        await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
              SELECT pg_advisory_xact_lock(
                ${PUSH_DELIVERY_ADVISORY_LOCK.namespace},
                ${PUSH_DELIVERY_ADVISORY_LOCK.key}
              )::text
            `;
            const currentBadgeCount = await unreadBadgeCount(tx);
            const deviceIds = sendable.map(({ delivery }) => delivery.target);
            await tx.$queryRaw(
              Prisma.sql`
                SELECT "id"
                FROM "outcomego_push_device"
                WHERE "id"::text IN (${Prisma.join(deviceIds)})
                ORDER BY "id"
                FOR UPDATE
              `
            );
            const finalDevices = await this.deliverableDevices(tx, deviceIds);
            const finalDeviceById = new Map(
              finalDevices.map((device) => [device.id, device] as const)
            );
            const routing = sendable.some(item =>
              item.payload.kind !== "badge-sync" &&
              (item.device.platform === "ios" || item.device.platform === "android")
            )
              ? await notificationRouting(tx, this.authMode) : null;
            const allowed = await Promise.all(
              sendable.map((item) => {
                if (item.payload.kind === "todo") {
                  const current = finalDeviceById.get(item.device.id);
                  const ownerId = this.authMode === "disabled" ? "local" : current?.authSession?.userId;
                  if (!current || ownerId !== item.payload.ownerId) return false;
                }
                if (item.payload.kind !== "badge-sync" && routing &&
                  (item.device.platform === "ios" || item.device.platform === "android") &&
                  suppressMobileNotification(routing, item.device.platform)) return false;
                return this.notificationIsDeliverable(tx, item.payload);
              })
            );
            // "Final summary only": a progress message is set aside, not discarded. Its settlement
            // can still arrive, and markSettlementMessage releases the held delivery then.
            const finalOnly = routing?.botMessageLevel === "final_only";
            const held = await Promise.all(
              sendable.map(async (item, index) =>
                finalOnly && allowed[index] && item.payload.kind === "message"
                  ? !(await this.messageIsSettlement(tx, item.payload))
                  : false
              )
            );
            const attempted = sendable.flatMap((item, index) => {
              const device = finalDeviceById.get(item.delivery.target);
              return device && allowed[index] && !held[index] ? [{ ...item, device }] : [];
            });
            const heldItems = sendable.filter((item, index) => held[index] && finalDeviceById.has(item.delivery.target));
            const retired = sendable.filter(
              (item, index) => !held[index] && (!finalDeviceById.has(item.delivery.target) || !allowed[index])
            );
            if (retired.length > 0) {
              await tx.outboxDelivery.updateMany({
                where: { id: { in: retired.map(({ delivery }) => delivery.id) } },
                data: { status: "delivered", deliveredAt: new Date() },
              });
            }
            if (heldItems.length > 0) {
              await tx.outboxDelivery.updateMany({
                where: { id: { in: heldItems.map(({ delivery }) => delivery.id) } },
                data: { status: "delivered", deliveredAt: new Date(), error: json({ held: HELD_NOT_FINAL }) },
              });
            }
            if (attempted.length === 0) return;
            await this.deliver(tx, attempted, currentBadgeCount);
          },
          {
            maxWait: PUSH_DELIVERY_TRANSACTION_TIMEOUT_MS,
            timeout: PUSH_DELIVERY_TRANSACTION_TIMEOUT_MS,
          }
        );
      } catch (error) {
        for (const item of sendable) {
          logExhaustedOutcomePush(item.delivery, item.payload);
          await this.prisma.outboxDelivery.update({
            where: { id: item.delivery.id },
            data: {
              status: "failed",
              availableAt: retryAt(item.delivery.attempts),
              error: json({ message: errorMessage(error) }),
            },
          });
        }
      }
    }
  }

  private async deliver(tx: Prisma.TransactionClient, attempted: PushAttempt[], badgeCount: number) {
    await Promise.all(attempted.map(async item => {
      try {
        const result = item.device.platform === "android"
          ? await this.fcm.send(item.device, item.payload, badgeCount, item.delivery.deliveryKey)
          : await this.apns.send(item.device, item.payload, badgeCount, item.delivery.deliveryKey);
        const retired = item.device.platform === "android"
          ? result.status === 404 || result.reason === "UNREGISTERED"
          : result.status === 410 || (result.status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(result.reason ?? ""));
        const accepted = result.status === 200 || retired;
        if (!accepted) logExhaustedOutcomePush(item.delivery, item.payload);
        if (retired) await tx.pushDevice.updateMany({ where: { id: item.device.id }, data: { enabled: false } });
        await tx.outboxDelivery.update({ where: { id: item.delivery.id }, data: {
          status: accepted ? "delivered" : "failed",
          deliveredAt: accepted ? new Date() : null,
          attempts: retired ? MAX_ATTEMPTS : item.delivery.attempts,
          availableAt: retryAt(item.delivery.attempts),
          error: accepted ? Prisma.DbNull : json({ message: `${item.device.platform === "android" ? "FCM" : "APNs"} rejected notification (${result.status})`, reason: result.reason ?? "Unknown" }),
        } });
      } catch (error) {
        logExhaustedOutcomePush(item.delivery, item.payload);
        await tx.outboxDelivery.update({ where: { id: item.delivery.id }, data: {
          status: "failed", availableAt: retryAt(item.delivery.attempts), error: json({ message: errorMessage(error) }),
        } });
      }
    }));
  }

  /** An alert that cannot be matched to a message is never held back for being "not final". */
  private async messageIsSettlement(
    tx: Prisma.TransactionClient,
    payload: PushNotificationPayload
  ): Promise<boolean> {
    if (payload.kind === "badge-sync" || payload.kind === "outcome" || payload.kind === "request" || payload.kind === "todo" || !payload.messageSequence) return true;
    return notificationMessageIsSettlement(tx, payload.channelId, payload.messageSequence);
  }

  private async notificationIsDeliverable(
    tx: Prisma.TransactionClient,
    payload: PushNotificationPayload
  ): Promise<boolean> {
    if (payload.kind === "badge-sync") return true;
    if (payload.kind === "todo") {
      const [settings, routing] = await Promise.all([readFeatureSettings(tx), notificationRouting(tx, this.authMode)]);
      const policy = resolveTaskPolicy(settings.taskPolicy);
      return settings.outcomesEnabled && routing.smartEnabled && Boolean(policy[payload.type === "urgent" ? "todo.highUrgencyNotify" : "todo.digest.enabled"]);
    }
    if (payload.kind === "outcome") {
      const [bot, activity, state, preferences] = await Promise.all([
        tx.bot.findUnique({ where: { id: payload.botId } }),
        tx.channelNotification.findUnique({ where: { key: payload.factKey } }),
        tx.channelReadState.findUnique({ where: { channelId: payload.channelId } }),
        tx.notificationPreferences.findUnique({ where: { id: "global" } }),
      ]);
      if (preferences?.smartEnabled === false || !bot?.notificationsEnabled || !activity || activity.revoked || activity.sequence.toString() !== payload.notificationSequence ||
        (state && activity.sequence <= state.lastReadNotificationSequence)) return false;
      if (payload.decisionId) {
        const decision = await tx.outcomeDecision.findUnique({ where: { id: payload.decisionId }, include: { outcome: { select: { currentRevisionId: true, cancelledAt: true, acceptedAt: true } } } });
        if (!decision || !["open", "presented"].includes(decision.status) || decision.outcome.cancelledAt || decision.outcome.acceptedAt ||
          (decision.expiresAt && decision.expiresAt <= new Date())) return false;
      }
      return outcomeNotificationIsCurrent(tx, payload);
    }
    if (payload.kind === "request") {
      const [bot, activity, state, preferences, run] = await Promise.all([
        tx.bot.findUnique({ where: { id: payload.botId } }),
        tx.channelNotification.findUnique({ where: { key: payload.factKey } }),
        tx.channelReadState.findUnique({ where: { channelId: payload.channelId } }),
        tx.notificationPreferences.findUnique({ where: { id: "global" } }),
        tx.run.findUnique({ where: { id: payload.requestId }, select: { requestStoppedAt: true, requestRevision: true, requestProgress: true } }),
      ]);
      const progress = run?.requestProgress as { state?: string } | null | undefined;
      // Stale once the request moved on: it is stopped, revised, or no longer waiting or blocked.
      const current = !!run && !run.requestStoppedAt && run.requestRevision === payload.revision && (progress?.state === "blocked" || progress?.state === "waiting");
      return !(preferences?.smartEnabled === false || !bot?.notificationsEnabled || !activity || activity.revoked || activity.sequence.toString() !== payload.notificationSequence ||
        (state && activity.sequence <= state.lastReadNotificationSequence) || !current);
    }
    const [state, bot, channel] = await Promise.all([
      tx.channelReadState.findUnique({ where: { channelId: payload.channelId } }),
      tx.bot.findUnique({ where: { id: payload.botId } }),
      tx.channel.findUnique({ where: { id: payload.channelId } }),
    ]);
    if (
      !bot?.notificationsEnabled ||
      bot.hiddenFromSidebar ||
      !channel ||
      channel.archivedAt ||
      channel.notificationsMuted ||
      channel.hiddenFromSidebar
    )
      return false;
    // Alerts are durable channel activity; a payload without its sequence is not deliverable.
    if (!payload.notificationSequence) return false;
    const activity = await tx.channelNotification.findUnique({
      where: { sequence: BigInt(payload.notificationSequence) },
    });
    if (!activity || activity.revoked || activity.sequence <= channel.mutedThroughNotificationSequence) return false;
    return (
      !state ||
      !notificationIsRead(payload, {
        lastReadSequence: state.lastReadSequence.toString(),
        lastReadNotificationSequence: state.lastReadNotificationSequence.toString(),
      })
    );
  }
}
