import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OutcomeGoClientError } from "@outcomego/client-core";
import { TodoActionInput, TodoBulkInput, TodoCreate, type TodoAction, type TodoItemView, type TodoListResponse } from "@outcomego/contracts/todo";
import type { TodoClient } from "../../../../client/todo-api";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeButton } from "../outcome-button";

const groups = {
  overdue: "Overdue",
  today: "Today",
  follow_up: "Needs follow-up",
  this_week: "This week",
  upcoming: "Upcoming",
  unscheduled: "No date",
} as const;
const emptyPage: TodoListResponse = { items: [], nextCursor: null };
const inputClass = "min-w-0 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground";
type PanelView = "all" | "history" | "suggestions";

function localInstant(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function TodoComposer({ create, disabled }: { create: TodoClient["create"]; disabled: boolean }) {
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
    const parsed = TodoCreate.safeParse({ ...draft, clientRequestId: id });
    if ((due && !dueAt) || !parsed.success) {
      setError("Check the to-do title, date, and tags.");
      return;
    }
    retry.current = { draft: serialized, id };
    setSaving(true);
    setError(null);
    try {
      await create(parsed.data);
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

function TodoRow({ item, disabled, act, selection, dismissBot }: {
  item: TodoItemView;
  disabled: boolean;
  act: (item: TodoItemView, action: TodoAction, options?: { snoozeUntil?: string; note?: string }) => Promise<boolean>;
  selection?: { checked: boolean; toggle: (checked: boolean) => void };
  dismissBot?: () => void;
}) {
  const { t, locale } = useI18n();
  const [snooze, setSnooze] = useState("");
  const [note, setNote] = useState("");
  const [snoozeError, setSnoozeError] = useState(false);
  const history = item.status === "done" || item.status === "dismissed";
  const suggested = item.status === "suggested";
  const date = item.displayState === "snoozed" ? item.snoozeUntil
    : item.displayState === "follow_up" || item.displayState === "waiting" ? item.followUpAt
      : item.dueAt ?? item.scheduledAt;
  const complete = () => void act(item, "complete", note.trim() ? { note: note.trim() } : undefined);
  async function snoozeUntil() {
    const instant = localInstant(snooze);
    if (!instant || Date.parse(instant) <= Date.now()) {
      setSnoozeError(true);
      return;
    }
    setSnoozeError(false);
    if (await act(item, "snooze", { snoozeUntil: instant })) setSnooze("");
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
        {item.createdVia !== "owner_ui" && <span className="outcome-row-meta">{t("Written by the bot")}</span>}
        {(item.note || item.summary) && <p className="whitespace-pre-wrap break-words text-xs text-foreground-secondary">{[item.note, item.summary].filter(Boolean).join("\n")}</p>}
        {item.sourceRef && <span className="outcome-row-meta break-words">{item.sourceRef.label}</span>}
        {date && <time className="outcome-row-meta" dateTime={date}>{new Date(date).toLocaleString(locale)}</time>}
        {item.tags.length > 0 && <span className="outcome-row-meta break-words">{item.tags.join(" · ")}</span>}
        {item.ownerMessagePreview && <div className="text-xs text-foreground-secondary">
          <span>{t("Your original message")}</span>
          <blockquote className="whitespace-pre-wrap break-words border-s border-border ps-2">{item.ownerMessagePreview}</blockquote>
        </div>}
        {history && <span className="outcome-row-meta">{item.status === "done" ? t("Completed to-do") : t("Dismissed to-do")}{item.completionNote ? ` · ${item.completionNote}` : ""}</span>}
      </div>
      {history ? (
        <OutcomeButton type="button" disabled={disabled} onClick={() => void act(item, "restore")}>{t("Restore")}</OutcomeButton>
      ) : (
        <>
          {suggested
            ? <OutcomeButton type="button" disabled={disabled} onClick={() => void act(item, "accept")}>{t("Accept suggestion")}</OutcomeButton>
            : <OutcomeButton type="button" disabled={disabled} onClick={complete}>{t("Complete")}</OutcomeButton>}
          <details className="w-full text-xs text-foreground-secondary">
            <summary className="w-fit cursor-pointer">{t("More to-do actions")}</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              {!suggested && <label className="flex flex-col gap-1">
                {t("Completion note (optional)")}
                <input className={inputClass} type="text" value={note} onChange={(event) => setNote(event.target.value)} disabled={disabled} />
              </label>}
              <label className="flex flex-col gap-1">
                {t("Snooze until")}
                <input className={inputClass} type="datetime-local" value={snooze} onChange={(event) => setSnooze(event.target.value)} disabled={disabled} />
              </label>
              <OutcomeButton type="button" disabled={disabled || !snooze} onClick={() => void snoozeUntil()}>{t("Snooze to-do")}</OutcomeButton>
              <OutcomeButton type="button" disabled={disabled} onClick={() => void act(item, "dismiss")}>{t("Dismiss to-do")}</OutcomeButton>
              {dismissBot && <OutcomeButton type="button" disabled={disabled} onClick={dismissBot}>{t("Dismiss all suggestions from this bot")}</OutcomeButton>}
            </div>
            {snoozeError && <p role="alert" className="mt-2 text-destructive">{t("Choose a future snooze time.")}</p>}
          </details>
        </>
      )}
    </li>
  );
}

export function TodoPanel({ client }: { client: TodoClient }) {
  const { t } = useI18n();
  const [view, setView] = useState<PanelView>("all");
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
      const result = await client.list({ view, ...(cursor && { cursor }) });
      if (request.current !== current) return;
      if (!Array.isArray(result?.items)) {
        setError("Could not load to-dos. Try again.");
        return;
      }
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

  async function mutate(write: () => Promise<TodoItemView[]>) {
    if (acting) return false;
    setActing(true);
    setError(null);
    try {
      const updated = new Map((await write()).map((item) => [item.id, item]));
      request.current++;
      setLoading(false);
      setPage((previous) => ({
        ...previous,
        items: previous.items.map((item) => updated.get(item.id) ?? item),
      }));
      setSelected((previous) => new Set([...previous].filter((id) => !updated.has(id))));
      return true;
    } catch (failure) {
      if (failure instanceof OutcomeGoClientError && failure.code === "todo_conflict") {
        await load();
        setSelected(new Set());
        setError("This to-do changed. Review it and try again.");
      } else setError("Could not update the to-do. Try again.");
      return false;
    } finally {
      setActing(false);
    }
  }

  async function change(item: TodoItemView, action: TodoAction, options = {}) {
    const input = TodoActionInput[action].safeParse({ revision: item.revision, ...options });
    if (!input.success) {
      setError("Check the to-do details and try again.");
      return false;
    }
    return mutate(async () => [await client.act(item.id, action, input.data)]);
  }

  function bulkChange(input: TodoBulkInput) {
    const batch = TodoBulkInput.safeParse(input);
    if (!batch.success) {
      setError("Select fewer suggestions and try again.");
      return;
    }
    void mutate(async () => (await client.bulk(batch.data)).items);
  }

  const items = page.items.filter((item) => {
    if (view === "history") return item.status === "done" || item.status === "dismissed";
    if (view === "suggestions") return item.status === "suggested" && item.displayState === "suggested";
    return item.status === "open" || item.status === "waiting";
  });
  const selection = items.filter((item) => selected.has(item.id)).map(({ id, revision }) => ({ id, revision }));
  const busy = loading || acting || creating;
  const changeView = (next: PanelView) => {
    setPage(emptyPage);
    setSelected(new Set());
    setView(next);
  };
  const rows = (entries: TodoItemView[]) => <ul className="outcome-rows">{entries.map((item) => (
    <TodoRow key={item.id} item={item} disabled={busy} act={change}
      selection={view === "suggestions" ? {
        checked: selected.has(item.id),
        toggle: (checked) => setSelected((previous) => checked ? new Set([...previous, item.id]) : new Set([...previous].filter((id) => id !== item.id))),
      } : undefined}
      dismissBot={view === "suggestions" && item.botId ? () => bulkChange({ action: "dismissBot", botId: item.botId! }) : undefined}
    />
  ))}</ul>;
  const bucket = (item: TodoItemView) => item.displayState === "snoozed" || item.displayState === "waiting"
    ? item.displayState
    : item.overdue && item.dueAt ? "overdue" : item.displayState;
  const deferred = items.filter((item) => bucket(item) === "snoozed" || bucket(item) === "waiting");
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
      {view === "all" && <TodoComposer disabled={acting} create={async (input) => {
        setCreating(true);
        try {
          const added = await client.create(input);
          setPage((previous) => ({ ...previous, items: [added, ...previous.items.filter((item) => item.id !== added.id)] }));
          void load();
          return added;
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
        <OutcomeButton type="button" disabled={busy || selection.length === 0} onClick={() => bulkChange({ action: "accept", items: selection })}>{t("Accept selected suggestions")}</OutcomeButton>
        <OutcomeButton type="button" disabled={busy || selection.length === 0} onClick={() => bulkChange({ action: "dismiss", items: selection })}>{t("Dismiss selected suggestions")}</OutcomeButton>
      </div>}
      {view !== "all" ? rows(items) : (
        <div className="space-y-3" role="group" aria-label={t("To-do timeline")}>
          {Object.entries(groups).map(([group, label]) => {
            const entries = items.filter((item) => bucket(item) === group);
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
