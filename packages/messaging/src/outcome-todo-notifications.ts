import type { TodoNotificationPayload } from "@outcomego/contracts/notification-content";
import type { Prisma } from "@outcomego/db";
import { notificationRouting } from "./notification-presence";

export async function enqueueTodoPush(tx: Prisma.TransactionClient, ownerId: string, key: string, now: Date,
  payloadForLocale: (chinese: boolean) => TodoNotificationPayload): Promise<number> {
  const authMode: "disabled" | "required" = ownerId === "local" ? "disabled" : "required";
  if (!(await notificationRouting(tx, authMode, now)).smartEnabled) return 0;
  const devices = await tx.pushDevice.findMany({
    where: authMode === "disabled" ? { enabled: true, authRequired: false }
      : { enabled: true, authRequired: true, authSession: { is: { userId: ownerId, expiresAt: { gt: now } } } },
    select: { id: true, locale: true },
  });
  if (!devices.length) return 0;
  const result = await tx.outboxDelivery.createMany({
    data: devices.map(({ id, locale }) => ({
      deliveryKey: `${key}:${id}`, topic: "push.notification", target: id, availableAt: now,
      payload: { ...payloadForLocale(/^zh(?:-|$)/i.test(locale ?? "")) },
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export function enqueueUrgentTodoPush(tx: Prisma.TransactionClient, ownerId: string, todoId: string, now: Date) {
  return enqueueTodoPush(tx, ownerId, `todo:urgent:${todoId}`, now, (chinese) => ({
    schemaVersion: 1, kind: "todo", type: "urgent", ownerId, todoId,
    title: chinese ? "有一件高紧急度待办" : "A high-urgency to-do needs your attention",
    body: chinese ? "打开 OutcomeGo 查看待办。" : "Open OutcomeGo to review it.",
  }));
}
