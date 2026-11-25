import { createHash } from "node:crypto";
import { ApiError } from "@outcomego/contracts";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import {
  deriveTodoDisplayState, TodoSourceRef, type TodoAction, type TodoActionInput, type TodoCreate,
  type TodoItemView, type TodoListQuery, type TodoListResponse, type TodoUpdate,
} from "@outcomego/contracts/todo";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { readFeatureSettings, readUserTimeZone } from "@outcomego/messaging";

type TodoRow = Prisma.OwnerTodoItemGetPayload<{}>;
type Db = PrismaClient | Prisma.TransactionClient;
const dayMs = 86_400_000;

const notFound = () => new ApiError(404, "todo_not_found", "Todo not found");
const invalidTransition = () => new ApiError(409, "todo_transition_invalid", "This action is unavailable in the current todo state");
const dateOrNull = (value: string | null) => value === null ? null : new Date(value);

function view(row: TodoRow, now: Date, timeZone: string): TodoItemView {
  const { ownerId, dedupeKey, sourceRef, ...fields } = row;
  return {
    ...fields,
    sourceRef: TodoSourceRef.safeParse(sourceRef).data ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    snoozeUntil: row.snoozeUntil?.toISOString() ?? null,
    followUpAt: row.followUpAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...deriveTodoDisplayState(row, now, timeZone),
  };
}

async function changed(tx: Prisma.TransactionClient, row: TodoRow) {
  await tx.event.create({ data: { topic: "todo.changed", entityId: row.id, payload: { todoId: row.id, revision: row.revision } } });
}

export class OwnerTodoService {
  constructor(private readonly db: PrismaClient) {}

  async ownerForSession(authMode: "required" | "disabled", sessionId: string | null): Promise<string> {
    if (authMode === "disabled") return "local";
    const session = sessionId && await this.db.session.findUnique({ where: { id: sessionId } });
    if (!session || session.expiresAt <= new Date()) throw new ApiError(401, "unauthorized", "Sign in to OutcomeGo to continue");
    return session.userId;
  }

  private async settings(db: Db) {
    const feature = await readFeatureSettings(db);
    if (!feature.outcomesEnabled) throw new ApiError(403, "outcomes_disabled", "Goal management is turned off");
    return resolveTaskPolicy(feature.taskPolicy);
  }

  async create(ownerId: string, input: TodoCreate, now = new Date()): Promise<TodoItemView> {
    const { clientRequestId, ...fields } = input;
    const scope = `todo-create:${ownerId}`;
    const requestHash = createHash("sha256").update(JSON.stringify(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)))).digest("hex");
    return this.db.$transaction(async (tx) => {
      const policy = await this.settings(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}), hashtext(${clientRequestId}))`;
      const receipt = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: clientRequestId } } });
      if (receipt) {
        if (receipt.requestHash !== requestHash) throw new ApiError(409, "idempotency_conflict", "Idempotency key content changed");
        return receipt.response as unknown as TodoItemView;
      }
      const row = await tx.ownerTodoItem.create({ data: {
        ...fields, ownerId, createdVia: "owner_ui", createdBy: `user:${ownerId}`, acceptedBy: "owner",
        dueAt: fields.dueAt ? new Date(fields.dueAt) : null,
        scheduledAt: fields.scheduledAt ? new Date(fields.scheduledAt) : null,
        createdAt: now, updatedAt: now,
      } });
      const response = view(row, now, await readUserTimeZone(tx));
      await tx.idempotencyRecord.create({ data: {
        scope, key: clientRequestId, requestHash, status: "completed",
        response: { ...response, sourceRef: null }, expiresAt: new Date(now.getTime() + Number(policy["todo.restoreRetentionDays"]) * dayMs),
      } });
      await changed(tx, row);
      return response;
    });
  }

  async detail(ownerId: string, id: string, now = new Date()): Promise<TodoItemView> {
    await this.settings(this.db);
    const row = await this.db.ownerTodoItem.findFirst({ where: { id, ownerId } });
    if (!row) throw notFound();
    return view(row, now, await readUserTimeZone(this.db));
  }

  async list(ownerId: string, query: TodoListQuery = {}, now = new Date()): Promise<TodoListResponse> {
    const policy = await this.settings(this.db);
    const and: Prisma.OwnerTodoItemWhereInput[] = [];
    const where: Prisma.OwnerTodoItemWhereInput = { ownerId, AND: and };
    if (query.tag) where.tags = { has: query.tag };
    if (query.view === "history") {
      const cutoff = new Date(now.getTime() - Number(policy["todo.restoreRetentionDays"]) * dayMs);
      and.push({ OR: [{ status: "done", completedAt: { gte: cutoff } }, { status: "dismissed", dismissedAt: { gte: cutoff } }] });
    } else {
      where.status = query.view === "suggestions" ? "suggested" : { in: ["suggested", "open", "waiting"] };
    }
    if (query.view === "needs_me") and.push({ OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }] });
    if (query.from || query.to) {
      const range = { gte: query.from ? new Date(query.from) : undefined, lt: query.to ? new Date(query.to) : undefined };
      and.push({ OR: [{ dueAt: range }, { scheduledAt: range }, { followUpAt: range }] });
    }
    if (query.cursor) {
      const cursor = await this.db.ownerTodoItem.findFirst({ where: { id: query.cursor, ownerId } });
      if (!cursor) throw new ApiError(400, "invalid_request", "Invalid todo cursor");
      and.push({ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] });
    }
    const limit = query.limit ?? 200;
    const [rows, timeZone] = await Promise.all([
      this.db.ownerTodoItem.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 }),
      readUserTimeZone(this.db),
    ]);
    const nextCursor = rows.length > limit ? rows[limit - 1]!.id : null;
    return { items: rows.slice(0, limit).map((row) => view(row, now, timeZone)), nextCursor };
  }

  private async mutate(ownerId: string, id: string, revision: number, now: Date,
    change: (row: TodoRow, retentionDays: number) => Prisma.OwnerTodoItemUpdateManyMutationInput): Promise<TodoItemView> {
    return this.db.$transaction(async (tx) => {
      const policy = await this.settings(tx);
      const current = await tx.ownerTodoItem.findFirst({ where: { id, ownerId } });
      if (!current) throw notFound();
      const conflict = (latest: TodoRow) => new ApiError(409, "todo_conflict", "Todo has changed", { revision: latest.revision, status: latest.status });
      if (current.revision !== revision) throw conflict(current);
      const data = change(current, Number(policy["todo.restoreRetentionDays"]));
      const updated = await tx.ownerTodoItem.updateMany({ where: { id, ownerId, revision }, data: { ...data, revision: { increment: 1 }, updatedAt: now } });
      const row = await tx.ownerTodoItem.findUniqueOrThrow({ where: { id } });
      if (updated.count !== 1) throw conflict(row);
      await changed(tx, row);
      return view(row, now, await readUserTimeZone(tx));
    });
  }

  update(ownerId: string, id: string, input: TodoUpdate, now = new Date()): Promise<TodoItemView> {
    const { revision, dueAt, scheduledAt, followUpAt, ...fields } = input;
    return this.mutate(ownerId, id, revision, now, (row) => {
      if (row.status === "done" || row.status === "dismissed" || (row.status === "suggested" && (fields.status || followUpAt !== undefined))) throw invalidTransition();
      const status = fields.status ?? row.status;
      const followUp = followUpAt === undefined ? row.followUpAt : dateOrNull(followUpAt);
      if (status === "waiting" && !followUp) throw new ApiError(400, "invalid_request", "Waiting requires a follow-up time");
      if (status !== "waiting" && followUpAt) throw invalidTransition();
      return {
        ...fields,
        ...(dueAt !== undefined ? { dueAt: dateOrNull(dueAt) } : {}),
        ...(scheduledAt !== undefined ? { scheduledAt: dateOrNull(scheduledAt) } : {}),
        followUpAt: status === "waiting" ? followUp : null,
      };
    });
  }

  act(ownerId: string, id: string, action: TodoAction, input: TodoActionInput, now = new Date()): Promise<TodoItemView> {
    return this.mutate(ownerId, id, input.revision, now, (row, retentionDays) => {
      const active = row.status === "open" || row.status === "waiting";
      const suggestion = row.status === "suggested";
      switch (action) {
        case "accept":
          if (!suggestion) throw invalidTransition();
          return { status: "open", acceptedBy: "owner", snoozeUntil: null, expiresAt: null };
        case "snooze": {
          if (!active && !suggestion) throw invalidTransition();
          const until = input.snoozeUntil && new Date(input.snoozeUntil);
          if (!until || !(until > now)) throw new ApiError(400, "invalid_request", "Snooze time must be in the future");
          return { snoozeUntil: until };
        }
        case "dismiss":
          if (!active && !suggestion) throw invalidTransition();
          return { status: "dismissed", dismissedAt: now, dismissReason: "owner", snoozeUntil: null };
        case "complete":
          if (!active) throw invalidTransition();
          return { status: "done", completedAt: now, completionNote: input.note ?? null, snoozeUntil: null };
        case "restore": {
          const endedAt = row.status === "done" ? row.completedAt : row.status === "dismissed" ? row.dismissedAt : null;
          if (!endedAt || now.getTime() - endedAt.getTime() > retentionDays * dayMs) throw invalidTransition();
          return { status: "open", acceptedBy: row.acceptedBy ?? "owner", completedAt: null, completionNote: null,
            dismissedAt: null, dismissReason: null, expiresAt: null, followUpAt: null };
        }
      }
    });
  }
}
