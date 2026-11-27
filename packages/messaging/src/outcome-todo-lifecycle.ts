import type { Prisma, PrismaClient } from "@outcomego/db";

export async function publishTodoChanges(tx: Prisma.TransactionClient, rows: Array<{ id: string; revision: number }>) {
  if (!rows.length) return;
  await tx.event.createMany({ data: rows.map(({ id, revision }) => ({ topic: "goal.updated", entityId: id, payload: { outcomeId: id, revision } })) });
}

export async function expireTodoRows(tx: Prisma.TransactionClient, now: Date, filter: Prisma.OutcomeWhereInput = {}) {
  const where: Prisma.OutcomeWhereInput = { kind: "todo", status: "suggested", AND: [filter, {
    kindMeta: { path: ["expiresAt"], lte: now.toISOString() },
  }] };
  const candidates = await tx.outcome.findMany({ where, orderBy: { id: "asc" }, select: { id: true } });
  const rows: Array<{ id: string; revision: number; createdBy: string; createdByRunId: unknown }> = [];
  for (const { id } of candidates) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${id}`}))`;
    const current = await tx.outcome.findFirst({ where: { ...where, id }, select: { kindMeta: true } });
    if (!current?.kindMeta || typeof current.kindMeta !== "object" || Array.isArray(current.kindMeta)) continue;
    const { kindMeta } = current;
    if (typeof kindMeta.expiresAt !== "string" || !(new Date(kindMeta.expiresAt) <= now)) continue;
    const row = await tx.outcome.update({
      where: { id },
      data: { status: "cancelled", cancelledAt: now, kindMeta: { ...kindMeta, dismissReason: "expired" }, dedupeKey: null, snoozeUntil: null, updatedAt: now, revision: { increment: 1 } },
      select: { id: true, revision: true, createdBy: true },
    });
    rows.push({ ...row, createdByRunId: kindMeta.createdByRunId });
  }
  await publishTodoChanges(tx, rows);
  return rows;
}

export async function expireTodoSuggestions(db: PrismaClient, now = new Date()): Promise<number> {
  const rows = await db.$transaction((tx) => expireTodoRows(tx, now));
  for (const row of rows) console.info("todo.expired", { todoId: row.id, actor: row.createdBy, runId: row.createdByRunId, reason: "expired" });
  return rows.length;
}
