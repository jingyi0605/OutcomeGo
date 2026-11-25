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
