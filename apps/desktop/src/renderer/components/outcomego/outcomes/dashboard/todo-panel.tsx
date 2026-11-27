import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OutcomeGoClientError } from "@outcomego/client-core";
import type { ActOnOutcomeInput, CreateOutcomeInput, OutcomeDetail } from "@outcomego/contracts/outcomes";
import { OUTCOME_LIMITS } from "@outcomego/contracts/outcome-state";
import type { OutcomeTodoAttention } from "@outcomego/contracts/task-overview";
import type { OutcomeAutoAcceptRulesClient } from "../../../../client/outcome-api";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeButton } from "../outcome-button";
import { OutcomeRequestIds } from "../planning/outcome-client";
import { toLocalInput } from "../timeline/schedule-edit";
import {
  isTodoOutcome, listTodos, todoSchedule, todoSourceLabels, todoSuggestionQuery,
  type TodoClient, type TodoOutcome, type TodoPanelView,
} from "./todo-state";

export interface TodoHandoffActions {
  bots: readonly { id: string; name: string }[];
  client: Pick<TodoClient, "act" | "convert">;
  change: (write: () => Promise<OutcomeDetail>) => Promise<boolean>;
  onSelectOutcome?: (id: string) => void;
}

export function TodoHandoffProgress({ item }: { item: TodoOutcome }) {
  const { t } = useI18n();
  const open = item.status === "open" || item.status === "waiting";
  if (!open || item.executor !== "bot" || !item.kindMeta.handoffBotId) return null;
  return <p className="text-xs text-foreground-secondary">{t("Handed to bot")}</p>;
}

export function TodoHandoffControls({ item, actions, disabled }: { item: TodoOutcome; actions: TodoHandoffActions; disabled: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"send" | "upgrade" | null>(null);
  const [chosen, setChosen] = useState("");
  const [instruction, setInstruction] = useState(() => t("Please handle this to-do."));
  const ids = useRef(new OutcomeRequestIds());
  const botId = actions.bots.find((bot) => bot.id === (chosen || item.kindMeta.handoffBotId || item.botId))?.id ?? actions.bots[0]?.id;

  async function submit() {
    if (disabled || !botId) return;
    const key = `${mode}:${item.id}`;
    const intent = { expectedRevision: item.revision, botId, instruction: instruction.trim() };
    const clientRequestId = ids.current.for(key, intent);
    let upgraded = false;
    const done = await actions.change(async () => {
      if (mode === "send") {
        return actions.client.act(item.id, {
          action: "handoff_to_bot", payload: { botId, instruction: intent.instruction }, expectedRevision: item.revision, clientRequestId,
        });
      }
      const result = await actions.client.convert(item.id, { targetKind: "standard", botId, expectedRevision: item.revision, clientRequestId });
      upgraded = true;
      return result.outcome;
    });
    if (!done) return;
    ids.current.complete(key);
    setMode(null);
    if (upgraded) actions.onSelectOutcome?.(item.id);
  }

  return <div className="mt-2 space-y-2">
    {mode !== "send" && <OutcomeButton type="button" disabled={disabled || !botId} onClick={() => setMode("send")}>{t("Hand to the bot")}</OutcomeButton>}
    {mode !== "upgrade" && <OutcomeButton type="button" disabled={disabled || !botId} onClick={() => setMode("upgrade")}>{t("Upgrade to goal")}</OutcomeButton>}
    {mode && botId && <form className="mt-2 space-y-2" onSubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
      <label className="block">{t("Execution Bot")}
        <select className="outcome-control ml-2" value={botId} onChange={(event) => setChosen(event.target.value)} disabled={disabled}>
          {actions.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
        </select>
      </label>
      {mode === "send" && <label className="block">{t("Instructions for the bot")}
        <textarea className="outcome-control mt-1 block w-full" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={4000} disabled={disabled} />
      </label>}
      <OutcomeButton type="submit" disabled={disabled || (mode === "send" && !instruction.trim())}>
        {t(mode === "send" ? "Send to bot" : "Hand to a bot to plan")}
      </OutcomeButton>
    </form>}
    {mode && <OutcomeButton type="button" variant="ghost" disabled={disabled} onClick={() => setMode(null)}>{t("Cancel")}</OutcomeButton>}
  </div>;
}

const groups = {
  overdue: "Overdue",
  today: "Today",
  follow_up: "Needs follow-up",
  this_week: "This week",
  upcoming: "Upcoming",
  unscheduled: "No date",
} as const;
export const todoAttentionLabels: Record<OutcomeTodoAttention, string> = {
  overdue: "Overdue", today: "Today", follow_up: "Needs follow-up", suggested: "To-do suggestions",
};
type TodoPage = { items: TodoOutcome[]; nextCursor: string | null };
const emptyPage: TodoPage = { items: [], nextCursor: null };
const inputClass = "min-w-0 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground";
type WithoutRequest<T> = T extends unknown ? Omit<T, "clientRequestId" | "expectedRevision"> : never;
export type TodoActionRequest = WithoutRequest<ActOnOutcomeInput>;

/** One owner action on a to-do, guarded by the revision the owner was looking at. */
export const actOnTodoItem = (client: Pick<TodoClient, "act">, item: TodoOutcome, request: TodoActionRequest) =>
  client.act(item.id, { ...request, expectedRevision: item.revision, clientRequestId: crypto.randomUUID() });

export const updateTodoFollowUp = (client: Pick<TodoClient, "update">, item: TodoOutcome, followUpAt: string | null) =>
  client.update(item.id, { followUpAt, expectedRevision: item.revision, clientRequestId: crypto.randomUUID() });

function localInstant(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function TodoComposer({ create, disabled }: { create: (input: CreateOutcomeInput) => Promise<unknown>; disabled: boolean }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<{ draft: string; id: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || saving) return;
    const dueAt = due ? localInstant(due) : undefined;
    const tagList = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    const draft = { title: title.trim(), ...(dueAt && { dueAt }), ...(tagList.length && { tags: tagList }) };
    const serialized = JSON.stringify(draft);
    const id = retry.current?.draft === serialized ? retry.current.id : crypto.randomUUID();
    const valid = draft.title.length > 0 && draft.title.length <= OUTCOME_LIMITS.titleChars && tagList.every((tag) => tag.length <= 40);
    if ((due && !dueAt) || !valid) {
      setError("Check the to-do title, date, and tags.");
      return;
    }
    retry.current = { draft: serialized, id };
    setSaving(true);
    setError(null);
    try {
      await create({ kind: "todo", ...draft, clientRequestId: id });
      retry.current = null;
      setTitle("");
      setDue("");
      setTags("");
    } catch {
      setError("Could not add the to-do. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={disabled || saving} className="flex min-w-0 flex-wrap items-end gap-2">
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs text-foreground-secondary">
          {t("New to-do")}
          <input aria-label={t("New to-do")} className={inputClass} type="text" required value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
          {t("Due date")}
          <input aria-label={t("Due date")} className={inputClass} type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
          {t("Tags (comma-separated)")}
          <input aria-label={t("To-do tags")} className={inputClass} type="text" value={tags} onChange={(event) => setTags(event.target.value)} />
        </label>
        <OutcomeButton type="submit" disabled={!title.trim() || saving}>{t("Add to-do")}</OutcomeButton>
      </fieldset>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{t(error)}</p>}
    </form>
  );
}

function AutoAcceptShortcut({ routineId, client, disabled }: { routineId: string; client: OutcomeAutoAcceptRulesClient; disabled: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "confirm" | "saving" | "saved" | "error">("idle");
  async function create() {
    if (disabled || state === "saving") return;
    setState("saving");
    try {
      await client.create({ name: t("Auto-accept from this routine"), routineId });
      setState("saved");
    } catch {
      setState("error");
    }
  }

  if (state === "saved") return <p role="status" className="text-xs">{t("Auto-accept rule created.")}</p>;
  if (state === "idle") return <OutcomeButton type="button" disabled={disabled} onClick={() => setState("confirm")}>{t("Auto-accept from this routine")}</OutcomeButton>;
  return <div className="space-y-2 text-xs">
    <p>{t("Future suggestions from this routine will become to-dos without review.")}</p>
    {state === "error" && <p role="alert" className="text-destructive">{t("Could not save the auto-accept rule. Try again.")}</p>}
    <div className="flex flex-wrap gap-2">
      <OutcomeButton type="button" disabled={disabled || state === "saving"} onClick={() => void create()}>{t("Confirm auto-accept rule")}</OutcomeButton>
      <OutcomeButton type="button" disabled={state === "saving"} onClick={() => setState("idle")}>{t("Cancel")}</OutcomeButton>
    </div>
  </div>;
}

export function TodoRow({ item, disabled, act, update, attention, selection, dismissBot, autoAcceptRules, handoff }: {
  item: TodoOutcome;
  disabled: boolean;
  act: (item: TodoOutcome, request: TodoActionRequest) => Promise<boolean>;
  /** Sets the follow-up time, which marks the to-do as waiting; `null` reopens it. */
  update?: (item: TodoOutcome, followUpAt: string | null) => Promise<boolean>;
  attention?: OutcomeTodoAttention;
  selection?: { checked: boolean; toggle: (checked: boolean) => void };
  dismissBot?: () => void;
  autoAcceptRules?: OutcomeAutoAcceptRulesClient;
  handoff?: TodoHandoffActions;
}) {
  const { t, locale } = useI18n();
  const [snooze, setSnooze] = useState("");
  const [note, setNote] = useState("");
  const [snoozeError, setSnoozeError] = useState(false);
  const [followUp, setFollowUp] = useState(() => toLocalInput(item.followUpAt));
  const [followUpError, setFollowUpError] = useState(false);
  const history = item.status === "accepted" || item.status === "cancelled";
  const suggested = item.status === "suggested";
  const { displayState } = todoSchedule(item);
  const date = displayState === "snoozed" ? item.snoozeUntil
    : displayState === "follow_up" || displayState === "waiting" ? item.followUpAt
      : item.dueAt ?? item.scheduledAt;
  const { acceptedBy, createdVia, createdByRoutineId, ownerMessagePreview, summary } = item.kindMeta;
  const complete = () => void act(item, { action: "complete", ...(note.trim() && { payload: { note: note.trim() } }) });
  const dismiss = () => void act(item, { action: "dismiss" });
  async function snoozeUntil() {
    const instant = localInstant(snooze);
    if (!instant || Date.parse(instant) <= Date.now()) {
      setSnoozeError(true);
      return;
    }
    setSnoozeError(false);
    if (await act(item, { action: "snooze", payload: { snoozeUntil: instant } })) setSnooze("");
  }

  function markWaiting() {
    const followUpAt = localInstant(followUp);
    setFollowUpError(!followUpAt);
    if (followUpAt) void update?.(item, followUpAt);
  }

  return (
    <li className="outcome-row flex-wrap">
      {selection && <input
        aria-label={t("Select suggestion {title}", { title: item.title })}
        type="checkbox" checked={selection.checked} disabled={disabled}
        onChange={(event) => selection.toggle(event.target.checked)}
      />}
      <div className="min-w-0 flex-1 space-y-1">
        <span className="outcome-row-title">{item.title}</span>
        {attention && <span className="outcome-row-meta">{t(todoAttentionLabels[attention])}</span>}
        {acceptedBy === "rule" && <span className="outcome-row-meta">{t("Auto-accepted")}</span>}
        {item.urgency !== "normal" && <span className="outcome-row-meta">{item.urgency === "high" ? t("High urgency") : t("Low urgency")}</span>}
        {(createdVia === "owner_chat" || createdVia === "agent_turn") && <span className="outcome-row-meta">{t("Written by the bot")}</span>}
        {(item.description || summary) && <p className="whitespace-pre-wrap break-words text-xs text-foreground-secondary">{[item.description, summary].filter(Boolean).join("\n")}</p>}
        {todoSourceLabels(item.sourceRef).map((label, index) => <span key={index} className="outcome-row-meta break-words">{label}</span>)}
        {date && <time className="outcome-row-meta" dateTime={date}>{new Date(date).toLocaleString(locale)}</time>}
        {item.tags.length > 0 && <span className="outcome-row-meta break-words">{item.tags.join(" · ")}</span>}
        {ownerMessagePreview && <div className="text-xs text-foreground-secondary">
          <span>{t("Your original message")}</span>
          <blockquote className="whitespace-pre-wrap break-words border-s border-border ps-2">{ownerMessagePreview}</blockquote>
        </div>}
        {history && <span className="outcome-row-meta">{item.status === "accepted" ? t("Completed to-do") : t("Dismissed to-do")}{item.closeSummary ? ` · ${item.closeSummary}` : ""}</span>}
        <TodoHandoffProgress item={item} />
      </div>
      {history ? (
        <OutcomeButton type="button" disabled={disabled} onClick={() => void act(item, { action: "restore" })}>{t("Restore")}</OutcomeButton>
      ) : (
        <>
          {suggested
            ? <OutcomeButton type="button" disabled={disabled} onClick={() => void act(item, { action: "accept_todo" })}>{t("Accept suggestion")}</OutcomeButton>
            : <OutcomeButton type="button" disabled={disabled} onClick={complete}>{t("Complete")}</OutcomeButton>}
          {acceptedBy === "rule" && <OutcomeButton type="button" disabled={disabled} onClick={dismiss}>{t("Dismiss to-do")}</OutcomeButton>}
          <details className="w-full text-xs text-foreground-secondary">
            <summary className="w-fit cursor-pointer">{t("More to-do actions")}</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              {!suggested && <label className="flex flex-col gap-1">
                {t("Completion note (optional)")}
                <input className={inputClass} type="text" maxLength={OUTCOME_LIMITS.commentChars} value={note} onChange={(event) => setNote(event.target.value)} disabled={disabled} />
              </label>}
              <label className="flex flex-col gap-1">
                {t("Snooze until")}
                <input className={inputClass} type="datetime-local" value={snooze} onChange={(event) => setSnooze(event.target.value)} disabled={disabled} />
              </label>
              <OutcomeButton type="button" disabled={disabled || !snooze} onClick={() => void snoozeUntil()}>{t("Snooze to-do")}</OutcomeButton>
              {acceptedBy !== "rule" && <OutcomeButton type="button" disabled={disabled} onClick={dismiss}>{t("Dismiss to-do")}</OutcomeButton>}
              {dismissBot && <OutcomeButton type="button" disabled={disabled} onClick={dismissBot}>{t("Dismiss all suggestions from this bot")}</OutcomeButton>}
            </div>
            {snoozeError && <p role="alert" className="mt-2 text-destructive">{t("Choose a future snooze time.")}</p>}
            {!suggested && update && <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                {t("Follow-up time")}
                <input aria-label={t("Follow-up time")} className={inputClass} type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} disabled={disabled} />
              </label>
              <OutcomeButton type="button" disabled={disabled || !followUp} onClick={markWaiting}>{item.status === "waiting" ? t("Update follow-up time") : t("Mark as waiting")}</OutcomeButton>
              {item.status === "waiting" && <OutcomeButton type="button" disabled={disabled} onClick={() => void update(item, null)}>{t("Stop waiting")}</OutcomeButton>}
            </div>}
            {followUpError && <p role="alert" className="mt-2 text-destructive">{t("Choose a follow-up time.")}</p>}
            {!suggested && handoff && <TodoHandoffControls item={item} actions={handoff} disabled={disabled} />}
          </details>
          {suggested && createdByRoutineId && autoAcceptRules && <AutoAcceptShortcut
            routineId={createdByRoutineId} client={autoAcceptRules} disabled={disabled}
          />}
        </>
      )}
    </li>
  );
}

export function TodoPanel({ client, hiddenIds, onChanged, refreshVersion = 0, handoff, showComposer = true }: {
  client: TodoClient;
  hiddenIds?: ReadonlySet<string>;
  onChanged?: () => void;
  refreshVersion?: number;
  handoff?: Omit<TodoHandoffActions, "change" | "client">;
  showComposer?: boolean;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<TodoPanelView>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [creating, setCreating] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (cursor?: string) => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listTodos(client, view, cursor);
      if (request.current !== current) return;
      setUnavailable(false);
      setPage((previous) => cursor ? {
        items: [...new Map([...previous.items, ...result.items].map((item) => [item.id, item])).values()],
        nextCursor: result.nextCursor,
      } : result);
    } catch (failure) {
      if (request.current !== current) return;
      if (failure instanceof OutcomeGoClientError && (failure.status === 404 || failure.code === "outcomes_disabled")) setUnavailable(true);
      else setError("Could not load to-dos. Try again.");
    } finally {
      if (request.current === current) setLoading(false);
    }
  }, [client, view]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => {
      request.current++;
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  useEffect(() => {
    if (refreshVersion > 0) void load();
  }, [refreshVersion]);

  async function mutate(write: () => Promise<OutcomeDetail[]>) {
    if (acting) return false;
    setActing(true);
    setError(null);
    try {
      const updated = new Map((await write()).map((item) => [item.id, item]));
      request.current++;
      setLoading(false);
      setPage((previous) => ({
        ...previous,
        // An item that became another kind of Outcome leaves the list.
        items: previous.items.map((item): OutcomeDetail | TodoOutcome => updated.get(item.id) ?? item).filter(isTodoOutcome),
      }));
      setSelected((previous) => new Set([...previous].filter((id) => !updated.has(id))));
      onChanged?.();
      return true;
    } catch (failure) {
      // A batch may have changed some items before it failed, so the list is read again either way.
      await load();
      setSelected(new Set());
      setError(failure instanceof OutcomeGoClientError && failure.code === "outcome_revision_conflict"
        ? "This to-do changed. Review it and try again."
        : "Could not update the to-do. Try again.");
      return false;
    } finally {
      setActing(false);
    }
  }

  function update(item: TodoOutcome, followUpAt: string | null) {
    return mutate(async () => [await updateTodoFollowUp(client, item, followUpAt)]);
  }

  function change(item: TodoOutcome, request: TodoActionRequest) {
    return mutate(async () => [await actOnTodoItem(client, item, request)]);
  }

  async function actOnEach(entries: readonly TodoOutcome[], action: "accept_todo" | "dismiss") {
    const updated: OutcomeDetail[] = [];
    for (const item of entries) updated.push(await actOnTodoItem(client, item, { action }));
    return updated;
  }

  function dismissBotSuggestions(botId: string) {
    void mutate(async () => {
      // Read every page first: dismissing while paging would move the cursor under the loop.
      const suggestions: TodoOutcome[] = [];
      let cursor: string | null = null;
      do {
        const next = await client.list(todoSuggestionQuery({ botId, limit: String(OUTCOME_LIMITS.listPageSizeMax), ...(cursor && { cursor }) }));
        suggestions.push(...next.items.filter(isTodoOutcome));
        cursor = next.nextCursor;
      } while (cursor);
      return actOnEach(suggestions, "dismiss");
    });
  }

  const items = page.items.filter((item) => {
    if (view === "history") return item.status === "accepted" || item.status === "cancelled";
    if (view === "suggestions") return item.status === "suggested" && todoSchedule(item).displayState === "suggested";
    return item.status === "open" || item.status === "waiting";
  });
  const selection = items.filter((item) => selected.has(item.id));
  const busy = loading || acting || creating;
  const changeView = (next: TodoPanelView) => {
    setPage(emptyPage);
    setSelected(new Set());
    setView(next);
  };
  const rows = (entries: TodoOutcome[]) => <ul className="outcome-rows">{entries.map((item) => (
    <TodoRow key={item.id} item={item} disabled={busy} act={change} update={update}
      handoff={handoff && { ...handoff, client, change: (write) => mutate(async () => [await write()]) }}
      selection={view === "suggestions" ? {
        checked: selected.has(item.id),
        toggle: (checked) => setSelected((previous) => checked ? new Set([...previous, item.id]) : new Set([...previous].filter((id) => id !== item.id))),
      } : undefined}
      dismissBot={view === "suggestions" && item.botId ? () => dismissBotSuggestions(item.botId!) : undefined}
      autoAcceptRules={view === "suggestions" ? client.autoAcceptRules : undefined}
    />
  ))}</ul>;
  const bucket = (item: TodoOutcome) => {
    const { displayState, overdue } = todoSchedule(item);
    if (displayState === "snoozed" || displayState === "waiting") return displayState;
    return overdue && item.dueAt ? "overdue" : displayState;
  };
  const timeline = items.filter((item) => !hiddenIds?.has(item.id));
  const deferred = timeline.filter((item) => bucket(item) === "snoozed" || bucket(item) === "waiting");
  if (unavailable) return null;

  return (
    <section aria-label={t("To-dos")} aria-busy={loading} className="outcome-dash-section space-y-3">
      <div className="outcome-dash-heading">
        <h2>{view === "suggestions" ? t("To-do suggestions") : t("To-dos")}</h2>
        <div className="flex flex-wrap gap-1">
          {view !== "all" && <OutcomeButton type="button" variant="ghost" disabled={busy} onClick={() => changeView("all")}>{t("Show current to-dos")}</OutcomeButton>}
          {view !== "suggestions" && <OutcomeButton type="button" variant="ghost" disabled={busy} onClick={() => changeView("suggestions")}>{t("To-do suggestions")}</OutcomeButton>}
          {view !== "history" && <OutcomeButton type="button" variant="ghost" disabled={busy} onClick={() => changeView("history")}>{t("Show to-do history")}</OutcomeButton>}
        </div>
      </div>
      {showComposer && view === "all" && <TodoComposer disabled={acting} create={async (input) => {
        setCreating(true);
        try {
          const { outcome } = await client.create(input);
          if (isTodoOutcome(outcome))
            setPage((previous) => ({ ...previous, items: [outcome, ...previous.items.filter((item) => item.id !== outcome.id)] }));
          void load();
          onChanged?.();
        } finally {
          setCreating(false);
        }
      }} />}
      {error && <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
        {t(error)} <OutcomeButton type="button" variant="ghost" onClick={() => void load()}>{t("Retry")}</OutcomeButton>
      </div>}
      {view === "suggestions" && items.length > 0 && <div className="flex flex-wrap items-center gap-2">
        <OutcomeButton type="button" variant="ghost" disabled={busy} onClick={() => setSelected(
          selection.length === items.length ? new Set() : new Set(items.map((item) => item.id))
        )}>{selection.length === items.length ? t("Clear suggestion selection") : t("Select visible suggestions")}</OutcomeButton>
        <OutcomeButton type="button" disabled={busy || selection.length === 0} onClick={() => void mutate(() => actOnEach(selection, "accept_todo"))}>{t("Accept selected suggestions")}</OutcomeButton>
        <OutcomeButton type="button" disabled={busy || selection.length === 0} onClick={() => void mutate(() => actOnEach(selection, "dismiss"))}>{t("Dismiss selected suggestions")}</OutcomeButton>
      </div>}
      {view !== "all" ? rows(items) : (
        <div className="space-y-3" role="group" aria-label={t("To-do timeline")}>
          {Object.entries(groups).map(([group, label]) => {
            const entries = timeline.filter((item) => bucket(item) === group);
            return entries.length > 0 && <section key={group} aria-label={t(label)}>
              <h3 className="mb-1 text-xs font-semibold text-foreground-secondary">{t(label)}</h3>
              {rows(entries)}
            </section>;
          })}
        </div>
      )}
      {view === "all" && deferred.length > 0 && <details>
        <summary className="cursor-pointer text-xs text-foreground-secondary">{t("Waiting or snoozed to-dos")}</summary>
        {rows(deferred)}
      </details>}
      {!loading && !error && items.length === 0 && <p className="text-xs text-foreground-secondary">
        {view === "history" ? t("No to-do history.") : view === "suggestions" ? t("No suggestions to review.") : t("No current to-dos.")}
      </p>}
      {page.nextCursor && <OutcomeButton type="button" disabled={busy} onClick={() => void load(page.nextCursor!)}>{t("Load more")}</OutcomeButton>}
    </section>
  );
}
