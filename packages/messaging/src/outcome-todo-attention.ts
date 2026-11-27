import { localDateOf } from "@outcomego/contracts/task-overview";
import { Prisma } from "@outcomego/db";

export async function todoLocalDay(db: Pick<Prisma.TransactionClient, "$queryRaw">, now: Date, timeZone: string) {
  const localDate = localDateOf(now, timeZone);
  const [day] = await db.$queryRaw<Array<{ start: Date; end: Date }>>`
    SELECT ${localDate}::date::timestamp AT TIME ZONE ${timeZone} AS start,
      (${localDate}::date + 1)::timestamp AT TIME ZONE ${timeZone} AS "end"`;
  return { date: localDate, ...day! };
}

export function liveTodoSuggestionWhere(now: Date): Prisma.OutcomeWhereInput {
  return { kind: "todo", status: "suggested", OR: [
    { kindMeta: { path: ["expiresAt"], equals: Prisma.AnyNull } },
    { kindMeta: { path: ["expiresAt"], gt: now.toISOString() } },
  ] };
}

export async function todoAttentionWhere(db: Pick<Prisma.TransactionClient, "$queryRaw">, ownerId: string, now: Date, timeZone: string,
  day?: Awaited<ReturnType<typeof todoLocalDay>>): Promise<Prisma.OutcomeWhereInput> {
  const { start, end } = day ?? await todoLocalDay(db, now, timeZone);
  const today = { gte: start, lt: end };
  return { ownerId, kind: "todo", AND: [
    { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }] },
    { OR: [
      liveTodoSuggestionWhere(now),
      { status: { in: ["open", "waiting"] }, OR: [{ dueAt: { lt: now } }, { dueAt: today }] },
      { status: "waiting", followUpAt: { lte: now } },
      { status: "open", dueAt: null, scheduledAt: today },
    ] },
  ] };
}
