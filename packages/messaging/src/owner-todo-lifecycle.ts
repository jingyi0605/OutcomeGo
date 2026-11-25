import type { Prisma, PrismaClient } from "@outcomego/db";

export async function publishTodoChanges(tx: Prisma.TransactionClient, rows: Array<{ id: string; revision: number }>) {
  if (!rows.length) return;
  await tx.event.createMany({ data: rows.map(({ id, revision }) => ({ topic: "todo.changed", entityId: id, payload: { todoId: id, revision } })) });
}

export async function expireTodoRows(tx: Prisma.TransactionClient, now: Date, filter: Prisma.OwnerTodoItemWhereInput = {}) {
  const rows = await tx.ownerTodoItem.updateManyAndReturn({
    where: { ...filter, status: "suggested", expiresAt: { lte: now } },
    data: { status: "dismissed", dismissedAt: now, dismissReason: "expired", dedupeKey: null, snoozeUntil: null, updatedAt: now, revision: { increment: 1 } },
    select: { id: true, revision: true, createdBy: true, createdByRunId: true },
  });
  await publishTodoChanges(tx, rows);
  return rows;
}

export async function expireTodoSuggestions(db: PrismaClient, now = new Date()): Promise<number> {
  const rows = await db.$transaction((tx) => expireTodoRows(tx, now));
  for (const row of rows) console.info("todo.expired", { todoId: row.id, actor: row.createdBy, runId: row.createdByRunId, reason: "expired" });
  return rows.length;
}
