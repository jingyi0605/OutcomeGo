import { z } from "zod";
import { isOverdue, localDateOf } from "./task-overview";

export const TodoId = z.string().uuid();
export const TodoInstant = z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)));
export const TodoUrgency = z.enum(["low", "normal", "high"]);
export const TodoView = z.enum(["needs_me", "suggestions", "all", "history"]);
export const TodoAction = z.enum(["accept", "snooze", "dismiss", "complete", "restore"]);
export const TodoTag = z.string().trim().min(1).max(40);
const title = z.string().trim().min(1).max(200);
const note = z.string().max(4000);
const instant = TodoInstant.nullable().optional();
const revision = z.number().int().min(1).max(2_147_483_647);

export const TodoSourceRef = z.object({
  kind: z.string().trim().min(1).max(40).refine((value) => !value.includes(":")),
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(120),
}).strict().refine((ref) => !Object.values(ref).some((value) => /(?:\b[a-z][\w+.-]*:\/\/|\bwww\.)/i.test(value)));
export type TodoSourceRef = z.infer<typeof TodoSourceRef>;

export const TodoCreate = z.object({
  title,
  note: note.nullable().optional(),
  dueAt: instant,
  scheduledAt: instant,
  tags: TodoTag.array().max(5).optional(),
  urgency: TodoUrgency.optional(),
  clientRequestId: z.string().trim().min(1).max(200),
}).strict();
export type TodoCreate = z.infer<typeof TodoCreate>;

const todoAutoAcceptRuleFields = z.object({
  name: z.string().trim().min(1).max(80),
  routineId: TodoId.nullable().optional(),
  botId: TodoId.nullable().optional(),
  sourceKind: z.string().trim().min(1).max(40).nullable().optional(),
  enabled: z.boolean().optional(),
}).strict();
export const TodoAutoAcceptRuleCreate = todoAutoAcceptRuleFields.refine(({ routineId, botId }) => Boolean(routineId || botId));
export const TodoAutoAcceptRuleUpdate = todoAutoAcceptRuleFields.partial().refine((fields) => Object.keys(fields).length > 0);
export type TodoAutoAcceptRuleCreate = z.infer<typeof TodoAutoAcceptRuleCreate>;
export type TodoAutoAcceptRuleUpdate = z.infer<typeof TodoAutoAcceptRuleUpdate>;
export interface TodoAutoAcceptRuleView {
  id: string;
  name: string;
  routineId: string | null;
  botId: string | null;
  sourceKind: string | null;
  enabled: boolean;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TodoCreateFromTurn = TodoCreate.extend({
  ownerMessageRef: TodoId.optional(),
  sourceRef: TodoSourceRef.optional(),
});
export const TodoSuggest = TodoCreate.omit({ note: true }).extend({
  sourceRef: TodoSourceRef,
  summary: z.string().trim().min(1).max(300),
});
export type TodoCreateFromTurn = z.infer<typeof TodoCreateFromTurn>;
export type TodoSuggest = z.infer<typeof TodoSuggest>;
export type TodoSourceDecision =
  | { status: "open"; reason: null; authorizedByMessageId: string }
  | { status: "suggested"; reason: "suggestion" | "owner_ref_missing" | "owner_ref_invalid" };

export function decideTodoSource(operation: "create" | "suggest", reference: string | undefined, valid: boolean): TodoSourceDecision {
  if (operation === "suggest") return { status: "suggested", reason: "suggestion" };
  if (!reference) return { status: "suggested", reason: "owner_ref_missing" };
  if (!valid) return { status: "suggested", reason: "owner_ref_invalid" };
  return { status: "open", reason: null, authorizedByMessageId: reference };
}

export interface TodoTurnResponse {
  todo: Pick<TodoItemView, "id" | "status" | "revision">;
  reason: TodoSourceDecision["reason"];
}

export const TodoUpdate = TodoCreate.omit({ clientRequestId: true }).partial().extend({
  revision,
  status: z.enum(["open", "waiting"]).optional(),
  followUpAt: instant,
}).strict().refine((value) => Object.keys(value).length > 1);
export type TodoUpdate = z.infer<typeof TodoUpdate>;

const revisionOnly = z.object({ revision }).strict();
export const TodoActionInput = {
  accept: revisionOnly,
  snooze: revisionOnly.extend({ snoozeUntil: TodoInstant }),
  dismiss: revisionOnly,
  complete: revisionOnly.extend({ note: note.optional() }),
  restore: revisionOnly,
} as const;
export type TodoAction = z.infer<typeof TodoAction>;
export type TodoActionInput = { revision: number; snoozeUntil?: string; note?: string };

export const TodoBulkInput = z.union([
  z.object({ action: z.enum(["accept", "dismiss"]), items: z.object({ id: TodoId, revision }).strict().array().min(1).max(200) }).strict()
    .refine(({ items }) => new Set(items.map(({ id }) => id)).size === items.length),
  z.object({ action: z.literal("dismissBot"), botId: TodoId }).strict(),
]);
export type TodoBulkInput = z.infer<typeof TodoBulkInput>;

export const TodoListQuery = z.object({
  view: TodoView.optional(),
  tag: TodoTag.optional(),
  from: TodoInstant.optional(),
  to: TodoInstant.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: TodoId.optional(),
}).strict().refine(({ from, to }) => !from || !to || Date.parse(from) < Date.parse(to));
export type TodoListQuery = z.infer<typeof TodoListQuery>;

export type TodoStatus = "suggested" | "open" | "waiting" | "done" | "dismissed";
const TodoStatusInput = z.enum(["suggested", "open", "waiting", "done", "dismissed"]);
export const TodoToolListInput = z.object({ status: TodoStatusInput.optional(), cursor: TodoId.optional(), limit: z.number().int().min(1).max(200).optional() }).strict();
export const TodoToolUpdateInput = TodoCreate.omit({ urgency: true }).partial().extend({
  todoId: TodoId, revision, clientRequestId: TodoCreate.shape.clientRequestId,
  status: z.enum(["open", "waiting", "done"]).optional(), followUpAt: instant, completionNote: note.optional(),
}).strict().refine(({ todoId, revision, clientRequestId, ...changes }) =>
  Object.keys(changes).length > 0 && (changes.completionNote === undefined || changes.status === "done") && (changes.status !== "done" || changes.followUpAt === undefined));
export type TodoToolListInput = z.infer<typeof TodoToolListInput>;
export type TodoToolUpdateInput = z.infer<typeof TodoToolUpdateInput>;

export const TODO_TOOL_NAMES = ["CreateTodo", "SuggestTodo", "UpdateTodo", "ListTodos"] as const;
export type TodoToolName = typeof TODO_TOOL_NAMES[number];
export type TodoTurnMode = "owner" | "wake" | "automation";
export const todoTurnMode = (origin: string, inboxType?: string): TodoTurnMode | undefined => {
  if (origin === "routine" || origin === "event" || (origin === "user" && inboxType === "user.reaction")) return "automation";
  if (origin === "user") return "owner";
  if (["agent", "background_revival", "handoff_resume"].includes(origin)) return "wake";
  return undefined;
};
export const todoToolAllowed = (tool: TodoToolName, mode?: TodoTurnMode): boolean =>
  mode === "owner" || (mode === "wake" && tool !== "UpdateTodo") || (mode === "automation" && tool === "SuggestTodo");
export const isTodoTool = (name: string): name is TodoToolName => (TODO_TOOL_NAMES as readonly string[]).includes(name);
export const TODO_TOOL_INPUT = {
  CreateTodo: TodoCreateFromTurn.required({ ownerMessageRef: true }), SuggestTodo: TodoSuggest,
  UpdateTodo: TodoToolUpdateInput, ListTodos: TodoToolListInput,
};

const textSchema = (maxLength: number, minLength = 1) => ({ type: "string", minLength, maxLength });
const uuidSchema = { type: "string", format: "uuid" };
const optionalInstant = { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] };
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const todoFields = {
  title: textSchema(200), dueAt: optionalInstant, scheduledAt: optionalInstant,
  tags: { type: "array", items: textSchema(40), maxItems: 5 }, clientRequestId: textSchema(200),
};
const noteSchema = { anyOf: [textSchema(4000, 0), { type: "null" }] };
const sourceRefSchema = objectSchema({ kind: { ...textSchema(40), pattern: "^[^:]+$" }, id: textSchema(200), label: textSchema(120) }, ["kind", "id", "label"]);
const urgencySchema = { type: "string", enum: TodoUrgency.options };
const todoToolSpecs = {
  CreateTodo: {
    description: "Record an owner-requested todo. Use the owner message ID supplied with the turn or by ReadTranscript, not quoted text. Invalid or unauthorized references yield a suggestion. Times must be ISO 8601 with an offset. Reuse clientRequestId for an identical retry.",
    inputSchema: objectSchema({ ...todoFields, note: noteSchema, sourceRef: sourceRefSchema, urgency: urgencySchema, ownerMessageRef: uuidSchema }, ["title", "ownerMessageRef", "clientRequestId"]),
  },
  SuggestTodo: {
    description: "Propose a todo without owner authorization. Give a short summary and an opaque source reference: reuse its kind and id for the same item and use a different id for a distinct item. Do not include source body text or URLs. Times must be ISO 8601 with an offset. Reuse clientRequestId for an identical retry.",
    inputSchema: objectSchema({ ...todoFields, sourceRef: sourceRefSchema, urgency: urgencySchema, summary: textSchema(300) }, ["title", "summary", "sourceRef", "clientRequestId"]),
  },
  UpdateTodo: {
    description: "Apply the owner's explicit change to a todo in your own conversation scope. Use its latest revision. Waiting requires followUpAt; use done only when the owner confirms completion. Times must be ISO 8601 with an offset. Reuse clientRequestId for an identical retry.",
    inputSchema: objectSchema({ ...todoFields, note: noteSchema, todoId: uuidSchema, revision: { type: "integer", minimum: 1, maximum: 2_147_483_647 }, status: { type: "string", enum: ["open", "waiting", "done"] }, followUpAt: optionalInstant, completionNote: textSchema(4000, 0) }, ["todoId", "revision", "clientRequestId"]),
  },
  ListTodos: {
    description: "List the todos in your own conversation scope. Optionally filter by status or use nextCursor as cursor to get the next page.",
    inputSchema: objectSchema({ status: { type: "string", enum: TodoStatusInput.options }, cursor: uuidSchema, limit: { type: "integer", minimum: 1, maximum: 200 } }),
  },
};
export const TODO_TOOLS = TODO_TOOL_NAMES.map((name) => ({ name, ...todoToolSpecs[name] }));

export type TodoDisplayState = "suggested" | "today" | "this_week" | "upcoming" | "unscheduled" | "snoozed" | "follow_up" | "waiting" | "done" | "dismissed";

export interface TodoItemView {
  id: string;
  title: string;
  note: string | null;
  status: TodoStatus;
  executor: "owner" | "bot" | "external";
  createdVia: "owner_ui" | "owner_chat" | "agent_turn";
  createdBy: string;
  createdByRunId: string | null;
  createdByRoutineId: string | null;
  authorizedByMessageId: string | null;
  ownerMessagePreview: string | null;
  acceptedBy: "owner" | "rule" | null;
  autoAcceptRuleId: string | null;
  autoAcceptRuleName?: string | null;
  urgency: z.infer<typeof TodoUrgency>;
  sourceRef: TodoSourceRef | null;
  summary: string | null;
  botId: string | null;
  tags: string[];
  dueAt: string | null;
  scheduledAt: string | null;
  snoozeUntil: string | null;
  followUpAt: string | null;
  linkedOutcomeId: string | null;
  handoffBotId: string | null;
  handoffMessageId: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  completionNote: string | null;
  dismissedAt: string | null;
  dismissReason: "owner" | "expired" | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  displayState: TodoDisplayState;
  overdue: boolean;
}

export interface TodoListResponse {
  items: TodoItemView[];
  nextCursor: string | null;
}

export type TodoAttention = "overdue" | "today" | "follow_up" | "suggested";

export interface TodoDigest {
  date: string;
  counts: Record<TodoAttention, number>;
  titles: string[];
}

export interface TodoAttentionItem {
  key: string;
  attention: TodoAttention;
  urgency: TodoItemView["urgency"];
  since: string;
  todo: TodoItemView;
}

const ATTENTION_RANK: Record<TodoAttention, number> = { overdue: 0, today: 1, follow_up: 1, suggested: 2 };
const URGENCY_RANK: Record<TodoAttentionItem["urgency"], number> = { high: 0, normal: 1, low: 2 };

export function compareTodoAttention(left: Omit<TodoAttentionItem, "todo">, right: Omit<TodoAttentionItem, "todo">): number {
  return ATTENTION_RANK[left.attention] - ATTENTION_RANK[right.attention] ||
    URGENCY_RANK[left.urgency] - URGENCY_RANK[right.urgency] ||
    left.since.localeCompare(right.since) || left.key.localeCompare(right.key);
}

export function deriveTodoAttention(input: {
  status: TodoStatus;
  dueAt: Date | null;
  scheduledAt: Date | null;
  snoozeUntil: Date | null;
  followUpAt: Date | null;
  expiresAt: Date | null;
}, now: Date, timeZone: string): TodoAttention | null {
  const { status, dueAt, followUpAt, expiresAt } = input;
  if (input.snoozeUntil && input.snoozeUntil > now) return null;
  if (status === "suggested") return expiresAt && expiresAt <= now ? null : "suggested";
  if (status !== "open" && status !== "waiting") return null;
  if (isOverdue(dueAt, now, false)) return "overdue";
  if (status === "waiting" && followUpAt && followUpAt <= now) return "follow_up";
  const date = dueAt ?? (status === "open" ? input.scheduledAt : null);
  return date && localDateOf(date, timeZone) === localDateOf(now, timeZone) ? "today" : null;
}

export function deriveTodoDisplayState(input: {
  status: TodoStatus;
  dueAt: Date | null;
  scheduledAt: Date | null;
  snoozeUntil: Date | null;
  followUpAt: Date | null;
}, now: Date, timeZone: string): { displayState: TodoDisplayState; overdue: boolean } {
  const { status, dueAt, scheduledAt, snoozeUntil, followUpAt } = input;
  const overdue = isOverdue(dueAt, now, status !== "open" && status !== "waiting");
  if (status === "done" || status === "dismissed") return { displayState: status, overdue };
  if (snoozeUntil && snoozeUntil > now) return { displayState: "snoozed", overdue };
  if (status === "suggested") return { displayState: "suggested", overdue };
  if (status === "waiting") return { displayState: followUpAt && followUpAt <= now ? "follow_up" : "waiting", overdue };
  const date = dueAt ?? scheduledAt;
  if (!date) return { displayState: "unscheduled", overdue };
  const today = localDateOf(now, timeZone);
  const target = localDateOf(date, timeZone);
  const weekEnd = new Date(`${today}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + (7 - weekEnd.getUTCDay()) % 7);
  return { displayState: target <= today ? "today" : target <= weekEnd.toISOString().slice(0, 10) ? "this_week" : "upcoming", overdue };
}
