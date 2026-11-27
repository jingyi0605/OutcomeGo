import { ApiError } from "@outcomego/contracts";
import type { OutcomeAutoAcceptRuleView } from "@outcomego/contracts/outcomes";
import type { Prisma } from "@outcomego/db";
import { readUserTimeZone, todoLocalDay } from "@outcomego/messaging";

type RuleRow = Prisma.OutcomeAutoAcceptRuleGetPayload<{}>;
export function autoAcceptRuleView(row: RuleRow): OutcomeAutoAcceptRuleView {
  const { ownerId, createdAt, updatedAt, lastMatchedAt, ...fields } = row;
  return { ...fields, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(), lastMatchedAt: lastMatchedAt?.toISOString() ?? null };
}

export function requireAutoAcceptBinding(rule: { routineId?: string | null; botId?: string | null }) {
  if (!rule.routineId && !rule.botId) throw new ApiError(400, "invalid_request", "A routine or bot is required");
}

export async function lockTodoRules(tx: Prisma.TransactionClient, ownerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`todo-agent:${ownerId}`}))`;
}

export async function matchTodoRule(tx: Prisma.TransactionClient, ownerId: string,
  context: { botId: string; routineId: string | null; sourceKind: string }, cap: unknown, now: Date) {
  const rule = await tx.outcomeAutoAcceptRule.findFirst({ where: {
    ownerId, enabled: true,
    AND: [
      { OR: [{ routineId: { not: null } }, { botId: { not: null } }] },
      { OR: [{ botId: null }, { botId: context.botId }] },
      context.routineId ? { OR: [{ routineId: null }, { routineId: context.routineId }] } : { routineId: null },
      { OR: [{ sourceKind: null }, { sourceKind: context.sourceKind }] },
    ],
  }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!rule) return null;
  const { id, name, routineId, botId } = rule;
  if (typeof cap === "number") {
    const { start, end } = await todoLocalDay(tx, now, await readUserTimeZone(tx));
    const hits = await tx.outcome.count({ where: { ownerId, kind: "todo", kindMeta: { path: ["autoAcceptRuleId"], equals: id }, createdAt: { gte: start, lt: end } } });
    if (hits >= cap) return { id, name, routineId, botId, limited: true };
  }
  return { id, name, routineId, botId, limited: false };
}
