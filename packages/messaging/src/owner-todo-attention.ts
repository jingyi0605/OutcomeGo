import { localDateOf } from "@outcomego/contracts/task-overview";
import type { Prisma } from "@outcomego/db";

export async function todoAttentionWhere(db: Pick<Prisma.TransactionClient, "$queryRaw">, ownerId: string, now: Date, timeZone: string): Promise<Prisma.OwnerTodoItemWhereInput> {
  const localDate = localDateOf(now, timeZone);
  const [day] = await db.$queryRaw<Array<{ start: Date; end: Date }>>`
    SELECT ${localDate}::date::timestamp AT TIME ZONE ${timeZone} AS start,
      (${localDate}::date + 1)::timestamp AT TIME ZONE ${timeZone} AS "end"`;
  const today = { gte: day!.start, lt: day!.end };
  return { ownerId, AND: [
    { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }] },
    { OR: [
      { status: "suggested", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { status: { in: ["open", "waiting"] }, OR: [{ dueAt: { lt: now } }, { dueAt: today }] },
      { status: "waiting", followUpAt: { lte: now } },
      { status: "open", dueAt: null, scheduledAt: today },
    ] },
  ] };
}
