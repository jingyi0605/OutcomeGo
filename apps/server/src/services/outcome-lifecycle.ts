import { ApiError } from "@outcomego/contracts";
import type { ActOnOutcomeInput, CreateOutcomeInput, UpdateOutcomeInput } from "@outcomego/contracts/outcomes";
import type { OutcomePlanMode } from "@outcomego/contracts/outcome-plan";
import type { OutcomeThreadTurnView } from "@outcomego/contracts/outcome-thread";
import { OUTCOME_KINDS, outcomeKindRequiresBot, parseOffsetTimestamp, type OutcomeKind, type OutcomeStatus, type OutcomeSummary } from "@outcomego/contracts/outcome-view";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import { Prisma, type Outcome } from "@outcomego/db";
import { expireTodoRows, liveTodoSuggestionWhere, readFeatureSettings, type ActorRef } from "@outcomego/messaging";
import { lockTodoRules, matchTodoRule } from "./outcome-todo";
import { metadataRecord, toJson } from "./service-utils";

type Tx = Prisma.TransactionClient;
type OutcomeData = Prisma.OutcomeUncheckedUpdateInput;

export interface OutcomeActorContext {
  ownerId?: string;
  runId?: string;
}

export interface OutcomeLifecycleOptions {
  enqueuePlan?: (
    outcomeId: string,
    input: { mode: OutcomePlanMode; expectedRevision: number; clientRequestId: string },
    actor: ActorRef,
    context?: OutcomeActorContext,
  ) => Promise<OutcomeThreadTurnView>;
}

type Principal = { ownerId: string; actor: ActorRef; botId: string | null };

export function outcomePrincipal(actor: ActorRef, context: OutcomeActorContext = {}): Principal {
  const actorOwner = actor === "owner:local" ? "local" : actor.startsWith("user:") ? actor.slice(5) : null;
  if (actorOwner && context.ownerId && actorOwner !== context.ownerId) throw outcomeForbidden();
  return { ownerId: actorOwner ?? context.ownerId ?? "local", actor, botId: actor.startsWith("bot:") ? actor.slice(4) : null };
}

export const outcomeForbidden = () => new ApiError(403, "outcome_action_forbidden", "This actor cannot perform the requested Outcome operation");

export function assertOutcomeOwner(principal: Principal) {
  if (principal.actor !== "owner:local" && !principal.actor.startsWith("user:")) throw outcomeForbidden();
}

export function assertOutcomeAccess(row: Outcome, principal: Principal, editing = false) {
  if (row.ownerId !== principal.ownerId) throw new ApiError(404, "outcome_not_found", "Outcome not found");
  if (editing && principal.botId && row.botId !== principal.botId && !(row.botId === null && row.createdBy === principal.actor))
    throw outcomeForbidden();
}

export function assertOutcomeRevision(row: Outcome, expectedRevision?: number) {
  if (expectedRevision !== undefined && row.revision !== expectedRevision)
    throw new ApiError(409, "outcome_revision_conflict", "This Outcome changed elsewhere. Reload before retrying", { currentRevision: row.revision, currentStatus: row.status });
}

export function assertOutcomeKind(kind: OutcomeKind) {
  if (!OUTCOME_KINDS.includes(kind)) throw new ApiError(400, "invalid_outcome_kind", "Unknown Outcome kind");
}

export async function validateOutcomeBot(tx: Tx, kind: OutcomeKind, botId: string | null) {
  if (botId && await tx.bot.findFirst({ where: { id: botId, status: "active", subagentIdentity: { is: null } }, select: { id: true } })) return;
  if (botId || outcomeKindRequiresBot(kind)) throw new ApiError(400, "outcome_bot_required", `An active Bot is required for ${kind}`);
}

export const initialOutcomeStatus = {
  standard: "draft", tracked: "running", scheduled_once: "scheduled", todo: "open", explore_idea: "draft", note: "active",
} as const satisfies Record<OutcomeKind, OutcomeStatus>;

const conversionTargets: Record<OutcomeKind, readonly OutcomeKind[]> = {
  note: ["todo", "scheduled_once", "explore_idea", "standard"],
  todo: ["scheduled_once", "standard", "note"],
  explore_idea: ["standard", "todo", "note"],
  scheduled_once: ["standard", "todo"],
  tracked: ["standard"],
  standard: [],
};

export const scheduledOutcomeEditable = (row: Pick<Outcome, "status" | "kindMeta">) =>
  ["scheduled", "preparing", "paused"].includes(row.status) && !metadataRecord(row.kindMeta).startedAt;

export function assertOutcomeConversion(row: Outcome, targetKind: OutcomeKind) {
  assertOutcomeKind(targetKind);
  if (!conversionTargets[row.kind].includes(targetKind) || ["accepted", "cancelled", "archived", "failed"].includes(row.status) ||
    (row.kind === "scheduled_once" && !scheduledOutcomeEditable(row))) {
    throw new ApiError(409, "outcome_conversion_invalid", "This Outcome cannot be converted to the requested kind", { currentStatus: row.status });
  }
}

export const invalidTransition = (row: Pick<Outcome, "status">) =>
  new ApiError(409, "invalid_outcome_transition", "This action is unavailable in the current Outcome state", { currentStatus: row.status });

export function assertEditableOutcome(row: Outcome) {
  if (["accepted", "cancelled", "archived"].includes(row.status) || (row.kind === "scheduled_once" && !scheduledOutcomeEditable(row)))
    throw invalidTransition(row);
}

type Editable = Omit<UpdateOutcomeInput, "expectedRevision" | "clientRequestId">;
const instant = (value: string | null | undefined) => {
  if (value == null) return value;
  const result = parseOffsetTimestamp(value);
  if (!result) throw new ApiError(400, "invalid_request", "Expected an ISO 8601 timestamp with a UTC offset");
  return result;
};

export function editableOutcomeData(input: Editable) {
  return {
    title: input.title?.trim(), description: input.description, attachments: input.attachments === undefined ? undefined : toJson(input.attachments),
    tags: input.tags ? [...input.tags] : undefined, urgency: input.urgency, botId: input.botId,
    sourceRef: input.sourceRef === undefined ? undefined : input.sourceRef === null ? Prisma.DbNull : toJson(input.sourceRef),
    dueAt: instant(input.dueAt), scheduledAt: instant(input.scheduledAt), prepareAt: instant(input.prepareAt),
    prepareInstruction: input.prepareInstruction, followUpAt: instant(input.followUpAt), snoozeUntil: instant(input.snoozeUntil),
  };
}

export function validateOutcomeFields(kind: OutcomeKind, input: Editable, now: Date, row?: Outcome) {
  if (kind !== "scheduled_once" && (input.prepareAt !== undefined || input.prepareInstruction !== undefined))
    throw new ApiError(400, "invalid_outcome_kind", "Preparation fields are only supported for scheduled Outcomes");
  if ((kind !== "note" && input.syncToMemory !== undefined) || (kind !== "explore_idea" && input.budget !== undefined) ||
    (kind !== "todo" && (input.followUpAt !== undefined || input.snoozeUntil !== undefined)))
    throw new ApiError(400, "invalid_outcome_kind", "An edited field does not apply to this Outcome kind");
  if (input.snoozeUntil && new Date(input.snoozeUntil) <= now) throw new ApiError(400, "invalid_request", "Snooze time must be in the future");
  if (kind !== "scheduled_once") return;
  const scheduledAt = input.scheduledAt === undefined ? row?.scheduledAt : instant(input.scheduledAt);
  const prepareAt = input.prepareAt === undefined ? row?.prepareAt : instant(input.prepareAt);
  if (!scheduledAt || ((!row || input.scheduledAt !== undefined) && scheduledAt <= now))
    throw new ApiError(400, "invalid_request", "A future scheduledAt is required for scheduled_once");
  if (!(input.description ?? row?.description)?.trim()) throw new ApiError(400, "invalid_request", "An execution instruction is required for scheduled_once");
  if (prepareAt && prepareAt >= scheduledAt) throw new ApiError(400, "invalid_request", "prepareAt must be before scheduledAt");
}

export function outcomeSummary(row: Outcome, currentRevision: number | null): OutcomeSummary {
  return {
    id: row.id, title: row.title, kind: row.kind, status: row.status, botId: row.botId, revision: row.revision, currentRevision,
    parentOutcomeId: row.parentOutcomeId, attachments: row.attachments, tags: row.tags, urgency: row.urgency, executor: row.executor,
    kindMeta: row.kindMeta, updatedAt: row.updatedAt.toISOString(), dueAt: row.dueAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null, followUpAt: row.followUpAt?.toISOString() ?? null, snoozeUntil: row.snoozeUntil?.toISOString() ?? null,
  } as OutcomeSummary;
}

export async function todoPolicy(tx: Pick<Tx, "featureSettings">) {
  const settings = await readFeatureSettings(tx);
  if (!settings.outcomesEnabled) throw new ApiError(403, "outcomes_disabled", "Goal management is turned off");
  return resolveTaskPolicy(settings.taskPolicy);
}

const dayMs = 86_400_000;
const hourMs = 3_600_000;

export async function resolveTodoCreation(tx: Tx, input: CreateOutcomeInput, principal: Principal, context: OutcomeActorContext, now: Date) {
  const policy = await todoPolicy(tx);
  if (!principal.botId) return { status: (input.followUpAt ? "waiting" : "open") as OutcomeStatus, meta: { acceptedBy: "owner" }, dedupeKey: null };
  const botId = principal.botId;
  const ownerId = principal.ownerId;
  await lockTodoRules(tx, ownerId);
  const source = metadataRecord(Array.isArray(input.sourceRef) ? input.sourceRef[0] : input.sourceRef);
  const sourceKind = typeof source.kind === "string" ? source.kind : null;
  const dedupeKey = sourceKind && sourceKind !== "owner_message_ref" && typeof source.id === "string" && source.id ? `${sourceKind}:${source.id}` : null;
  const run = context.runId ? await tx.run.findFirst({ where: { id: context.runId, botId }, select: {
    id: true, origin: true, conversationId: true, channelId: true, deliveryId: true, outcomeWorkItemId: true, outcomeThreadId: true,
    bot: { select: { conversation: { select: { id: true } }, subagentIdentity: { select: { id: true } } } },
  } }) : null;
  if (context.runId && (!run || run.bot.conversation?.id !== run.conversationId || run.bot.subagentIdentity || run.deliveryId ||
    run.outcomeWorkItemId || run.outcomeThreadId || (run.channelId && !await tx.channel.findFirst({
      where: { id: run.channelId, kind: { in: ["bot_dm", "agent_dm"] } }, select: { id: true },
    })))) throw outcomeForbidden();
  await expireTodoRows(tx, now, { ownerId, OR: [{ botId }, ...(dedupeKey ? [{ dedupeKey }] : [])] });
  const existing = dedupeKey ? await tx.outcome.findUnique({ where: { ownerId_dedupeKey: { ownerId, dedupeKey } } }) : null;
  if (existing) {
    assertOutcomeAccess(existing, principal, true);
    return { existing, status: existing.status, meta: {}, dedupeKey };
  }
  const reference = sourceKind === "owner_message_ref" && typeof source.id === "string" ? source.id : null;
  const cutoff = new Date(now.getTime() - Number(policy["todo.ownerRef.maxAgeHours"]) * hourMs);
  const authorized = run?.origin === "user" && reference && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reference) &&
    await tx.message.findFirst({ where: { id: reference, role: "user", conversationId: run.conversationId, botId, createdAt: { gte: cutoff, lte: now } }, select: { id: true } }) &&
    await tx.run.findFirst({ where: { userMessageId: reference, botId, conversationId: run.conversationId, origin: "user", inboxEvents: { none: { type: "user.reaction" } } }, select: { id: true } }) &&
    (typeof policy["todo.ownerRef.maxTodosPerMessage"] !== "number" || await tx.outcome.count({
      where: { ownerId, kind: "todo", kindMeta: { path: ["authorizedByMessageId"], equals: reference } },
    }) < Number(policy["todo.ownerRef.maxTodosPerMessage"]));
  const routine = run ? await tx.routineExecution.findUnique({ where: { runId: run.id }, select: { routineId: true } }) : null;
  const routineId = routine?.routineId ?? null;
  const match = !authorized && run && sourceKind ? await matchTodoRule(tx, ownerId, { botId, routineId, sourceKind }, policy["todo.autoAccept.maxPerRulePerDay"], now) : null;
  const rule = match && !match.limited ? match : null;
  const cap = policy["todo.maxPendingSuggestionsPerBot"];
  if (!authorized && !rule && typeof cap === "number" && await tx.outcome.count({ where: {
    ownerId, createdBy: principal.actor, ...liveTodoSuggestionWhere(now),
  } }) >= cap) throw new ApiError(429, "suggestion_limit_reached", "This Bot has reached its pending suggestion limit");
  if (rule) await tx.outcomeAutoAcceptRule.update({ where: { id: rule.id }, data: { matchCount: { increment: 1 }, lastMatchedAt: now } });
  const ttl = Number(policy["todo.suggestionTtlDays"]);
  const accepted = Boolean(authorized || rule);
  return {
    status: (accepted ? input.followUpAt ? "waiting" : "open" : "suggested") as OutcomeStatus, dedupeKey,
    meta: { createdByRunId: run?.id ?? null, createdByRoutineId: routineId,
      createdVia: authorized ? "owner_chat" : "agent_turn", authorizedByMessageId: authorized ? reference : null,
      acceptedBy: authorized ? "owner" : rule ? "rule" : null, autoAcceptRuleId: rule?.id ?? null, autoAcceptRuleName: rule?.name ?? null,
      expiresAt: !accepted && ttl > 0 ? new Date(now.getTime() + ttl * dayMs).toISOString() : null },
  };
}

export async function outcomeActionData(tx: Tx, row: Outcome, input: ActOnOutcomeInput, now: Date): Promise<OutcomeData> {
  const meta = metadataRecord(row.kindMeta);
  const activeTodo = row.kind === "todo" && (row.status === "open" || row.status === "waiting");
  const suggestedTodo = row.kind === "todo" && row.status === "suggested";
  const endTodo = { followUpAt: null, snoozeUntil: null, kindMeta: toJson({ ...meta, expiresAt: null }) };
  switch (input.action) {
    case "accept_todo":
      if (suggestedTodo) return { status: "open", snoozeUntil: null, kindMeta: toJson({ ...meta, acceptedBy: "owner", expiresAt: null }) };
      break;
    case "snooze":
      if (activeTodo || suggestedTodo) {
        const snoozeUntil = instant(input.payload.snoozeUntil)!;
        if (snoozeUntil <= now) throw new ApiError(400, "invalid_request", "Snooze time must be in the future");
        return { snoozeUntil };
      }
      break;
    case "complete":
      if (activeTodo) return { ...endTodo, status: "accepted", acceptedAt: now, closeSummary: input.payload?.note ?? null };
      break;
    case "dismiss":
      if (activeTodo || suggestedTodo) return { ...endTodo, status: "cancelled", cancelledAt: now, closeSummary: input.payload?.reason ?? null, kindMeta: toJson({ ...meta, expiresAt: null, dismissReason: "owner" }) };
      if (row.kind === "explore_idea" && ["draft", "exploring"].includes(row.status)) return { status: "cancelled", cancelledAt: now, closeSummary: input.payload?.reason ?? null };
      break;
    case "restore": {
      const ended = row.kind === "todo" && (row.status === "accepted" ? row.acceptedAt : row.status === "cancelled" ? row.cancelledAt : null);
      if (ended && now.getTime() - ended.getTime() <= Number((await todoPolicy(tx))["todo.restoreRetentionDays"]) * dayMs)
        return { ...endTodo, status: "open", acceptedAt: null, cancelledAt: null, closeSummary: null, kindMeta: toJson({ ...meta, acceptedBy: meta.acceptedBy ?? "owner", expiresAt: null, dismissReason: null }) };
      break;
    }
    case "handoff_to_bot":
      if (activeTodo) return { botId: input.payload.botId, executor: "bot" };
      break;
    case "pause":
      if (row.kind === "scheduled_once" && row.status !== "paused" && scheduledOutcomeEditable(row)) return { status: "paused" };
      break;
    case "resume":
      if (row.kind === "scheduled_once" && row.status === "paused" && scheduledOutcomeEditable(row)) return { status: "scheduled" };
      if (row.kind === "explore_idea" && row.status === "draft") return { status: "exploring" };
      break;
    case "archive":
      if (row.kind === "note" && row.status === "active") return { status: "archived" };
      break;
    case "unarchive":
      if (row.kind === "note" && row.status === "archived") return { status: "active" };
      break;
    case "cancel":
      if (activeTodo || suggestedTodo) return { ...endTodo, status: "cancelled", cancelledAt: now, kindMeta: toJson({ ...meta, expiresAt: null, dismissReason: "owner" }) };
      if ((row.kind === "note" && ["active", "archived"].includes(row.status)) ||
        (row.kind === "explore_idea" && ["draft", "exploring"].includes(row.status)) ||
        (row.kind === "scheduled_once" && scheduledOutcomeEditable(row))) return { status: "cancelled", cancelledAt: now };
      break;
  }
  throw invalidTransition(row);
}
