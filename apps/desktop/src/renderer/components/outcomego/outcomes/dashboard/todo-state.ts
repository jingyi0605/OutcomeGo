import type { OutcomeDetail, OutcomeSummary } from "@outcomego/contracts/outcomes";
import { deriveOutcomeTodoDisplayState } from "@outcomego/contracts/task-overview";
import type { OutcomeClient } from "../../../../client/outcome-api";

export type TodoSummary = Extract<OutcomeSummary, { kind: "todo" }>;
/** A to-do row. The note, source and completion note are there only when its detail was read. */
export type TodoOutcome = TodoSummary & Partial<Pick<OutcomeDetail, "description" | "sourceRef" | "closeSummary">>;
export type TodoClient = Pick<OutcomeClient, "list" | "get" | "create" | "act" | "update" | "convert" | "autoAcceptRules">;
export type TodoPanelView = "all" | "suggestions" | "history";

export const isTodoOutcome = <T extends { kind: OutcomeSummary["kind"] }>(outcome: T): outcome is T & { kind: "todo" } =>
  outcome.kind === "todo";

const date = (value: string | null) => (value ? new Date(value) : null);

/** Where a to-do sits on the timeline right now, in this device's time zone. */
export const todoSchedule = (item: TodoSummary, now = new Date()) =>
  deriveOutcomeTodoDisplayState({
    status: item.status,
    dueAt: date(item.dueAt),
    scheduledAt: date(item.scheduledAt),
    snoozeUntil: date(item.snoozeUntil),
    followUpAt: date(item.followUpAt),
  }, now, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

export const todoSuggestionQuery = (extra: Record<string, string> = {}) =>
  new URLSearchParams({ kinds: "todo", view: "suggestions", ...extra }).toString();

export async function listTodos(client: Pick<TodoClient, "list" | "get">, view: TodoPanelView, cursor?: string) {
  const query = new URLSearchParams({ kinds: "todo", ...(view === "all" ? { statuses: "open,waiting" } : { view }) });
  if (cursor) query.set("cursor", cursor);
  const page = await client.list(query.toString());
  // The list carries summaries; a row also shows the note, source and completion note.
  const items = await Promise.all(page.items.filter(isTodoOutcome).map(async (summary): Promise<TodoOutcome> => {
    const detail = await client.get(summary.id).catch(() => null);
    return detail && isTodoOutcome(detail) ? detail : summary;
  }));
  return { items, nextCursor: page.nextCursor };
}

/** The labels of a to-do's sources, whether it has one reference or several. */
export function todoSourceLabels(sourceRef: TodoOutcome["sourceRef"]): string[] {
  if (!sourceRef) return [];
  const references = (Array.isArray(sourceRef) ? sourceRef : [sourceRef]) as ReadonlyArray<Record<string, unknown>>;
  return references.flatMap((reference) => (typeof reference.label === "string" ? [reference.label] : []));
}
