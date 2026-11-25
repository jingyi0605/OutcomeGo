import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import { compareTodoAttention, deriveTodoAttention, type TodoDigest } from "@outcomego/contracts/todo";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { readFeatureSettings } from "./feature-settings";
import { todoAttentionWhere, todoLocalDay } from "./owner-todo-attention";
import { enqueueTodoPush } from "./owner-todo-notifications";
import { readUserTimeZone } from "./user-time-zone";

const scope = "todo-digest";
const pushBodyByteLimit = 2800;

async function digestSettings(db: PrismaClient) {
  const settings = await readFeatureSettings(db);
  const policy = resolveTaskPolicy(settings.taskPolicy);
  if (!settings.outcomesEnabled || !policy["todo.digest.enabled"]) return null;
  return { timeZone: await readUserTimeZone(db), localTime: String(policy["todo.digest.localTime"]), maxTitles: Number(policy["todo.digest.maxTitles"]) };
}

async function digestForDay(db: Prisma.TransactionClient, ownerId: string, now: Date, timeZone: string, maxTitles: number,
  day: Awaited<ReturnType<typeof todoLocalDay>>): Promise<TodoDigest | null> {
  const rows = await db.ownerTodoItem.findMany({
    where: await todoAttentionWhere(db, ownerId, now, timeZone, day),
    select: { id: true, status: true, title: true, dueAt: true, scheduledAt: true, followUpAt: true, snoozeUntil: true, expiresAt: true, urgency: true, createdAt: true },
  });
  const counts = { overdue: 0, today: 0, follow_up: 0, suggested: 0 };
  const entries = rows.flatMap((row) => {
    const attention = deriveTodoAttention(row, now, timeZone);
    if (!attention || (attention === "today" && !row.dueAt)) return [];
    counts[attention] += 1;
    const since = attention === "overdue" ? row.dueAt : attention === "follow_up" ? row.followUpAt : row.createdAt;
    return [{ key: row.id, attention, urgency: row.urgency, since: (since ?? row.createdAt).toISOString(), title: row.title }];
  });
  if (!entries.length) return null;
  const titles = entries.sort(compareTodoAttention).slice(0, maxTitles).map(({ title }) => title);
  return { date: day.date, counts, titles };
}

export async function readTodoDigest(db: PrismaClient, ownerId: string, now = new Date()): Promise<TodoDigest | null> {
  const settings = await digestSettings(db);
  if (!settings) return null;
  const day = await todoLocalDay(db, now, settings.timeZone);
  return digestForDay(db, ownerId, now, settings.timeZone, settings.maxTitles, day);
}

function digestBody(digest: TodoDigest, chinese: boolean): string {
  const { today, overdue, suggested, follow_up } = digest.counts;
  let body = chinese
    ? `今天到期 ${today} · 逾期 ${overdue} · 待分诊 ${suggested} · 需跟进 ${follow_up}`
    : `Due today ${today} · Overdue ${overdue} · Suggestions ${suggested} · Follow-up ${follow_up}`;
  for (const title of digest.titles) {
    const line = `\n• ${title.replace(/\s+/g, " ").trim()}`;
    if (Buffer.byteLength(body + line) > pushBodyByteLimit) break;
    body += line;
  }
  return body;
}

export async function dispatchTodoDigest(db: PrismaClient, authMode: "required" | "disabled", now = new Date()): Promise<boolean> {
  const settings = await digestSettings(db);
  if (!settings) return false;
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
  if (localTime < settings.localTime) return false;
  const users = authMode === "required" ? await db.user.findMany({ take: 2, select: { id: true } }) : [];
  if (authMode === "required" && users.length !== 1) return false;
  const ownerId = users[0]?.id ?? "local";
  return db.$transaction(async (tx) => {
    const day = await todoLocalDay(tx, now, settings.timeZone);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}), hashtext(${day.date}))`;
    if (await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: day.date } } })) return false;

    const digest = await digestForDay(tx, ownerId, now, settings.timeZone, settings.maxTitles, day);
    if (!digest) return false;
    const deliveries = await enqueueTodoPush(tx, ownerId, `${scope}:${day.date}`, now, (chinese) => ({
      schemaVersion: 1, kind: "todo", type: "digest", ownerId, date: day.date,
      title: chinese ? "待办晨报" : "To-do digest",
      body: digestBody(digest, chinese),
    }));
    if (!deliveries) return false;
    await tx.idempotencyRecord.create({ data: { scope, key: day.date, requestHash: day.date, status: "completed", expiresAt: day.end } });
    return true;
  });
}
