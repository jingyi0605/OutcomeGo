import { useEffect, useRef, useState } from "react";
import type {
  OutcomeInboxCategory,
  OutcomeInboxItemView,
  OutcomeInboxPage,
} from "@outcomego/contracts/outcome-inbox";
import type { InboxClient } from "./inbox-api";
import { responseStatus } from "./decision-state";
import { useI18n } from "../../../../lib/i18n";
import { CheckCheck, ChevronRight, Inbox } from "lucide-react";
import { TodoPanel, type TodoHandoffActions } from "../dashboard/todo-panel";
import type { TodoClient } from "../dashboard/todo-state";
import { OutcomeButton, OutcomeEmptyState, OutcomeRefresh } from "../outcome-ui";

export const inboxCategoryLabels: Record<OutcomeInboxCategory, string> = {
  decision_pending: "Decisions",
  acceptance_pending: "Acceptance review",
  human_action_pending: "Human actions",
  completed: "Completed",
};
export function mergeInboxItems(previous: OutcomeInboxItemView[], next: OutcomeInboxItemView[]) {
  return [...new Map([...previous, ...next].map((item) => [item.id, item])).values()];
}
type InboxFilter = OutcomeInboxCategory | "pending" | "todos";

export function OutcomeInbox({
  client,
  todos,
  todoHandoff,
  onSelect,
  refreshVersion = 0,
  initialPage,
  showRefresh = true,
  onBusyChange,
}: {
  client: InboxClient;
  todos?: TodoClient;
  todoHandoff?: Omit<TodoHandoffActions, "change" | "client">;
  onSelect: (item: OutcomeInboxItemView) => void;
  refreshVersion?: number;
  initialPage?: OutcomeInboxPage;
  showRefresh?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [category, setCategory] = useState<InboxFilter>("pending");
  const [page, setPage] = useState<OutcomeInboxPage | null>(initialPage ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [todoRefreshVersion, setTodoRefreshVersion] = useState(0);
  const generation = useRef(0);
  async function load(cursor?: string) {
    if (category === "todos") return;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await client.list({
        status: category === "completed" ? "completed" : "pending",
        ...(category === "pending" ? {} : { category }),
        ...(cursor ? { cursor } : {}),
      });
      if (request !== generation.current) return;
      setPage((current) =>
        cursor
          ? {
              items: mergeInboxItems(current?.items ?? [], result.items),
              nextCursor: result.nextCursor,
            }
          : result
      );
      setUnavailable(false);
    } catch (cause) {
      if (request !== generation.current) return;
      if (responseStatus(cause) === 404) {
        setUnavailable(true);
        setPage(null);
      } else setError("Could not load the Inbox. Try again.");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (category === "todos") return;
    setPage(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [client, category, refreshVersion]);
  useEffect(() => {
    if (category === "todos") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [client, category]);
  useEffect(() => {
    onBusyChange?.(category === "todos" ? false : busy);
  }, [busy, category, onBusyChange]);
  const filters: readonly InboxFilter[] = todos
    ? ["pending", "decision_pending", "acceptance_pending", "human_action_pending", "todos", "completed"]
    : (["pending", ...Object.keys(inboxCategoryLabels)] as InboxFilter[]);
  const filterLabel = (value: InboxFilter) =>
    value === "pending" ? "All pending" : value === "todos" ? "To-dos" : inboxCategoryLabels[value];
  return (
    <section aria-label={t("Outcome Inbox")} aria-busy={busy} className="space-y-4">
      <div className="outcome-toolbar">
        <nav aria-label={t("Inbox categories")} className="outcome-filters">
          {filters.map((value) => (
            <button
              key={value}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {t(filterLabel(value))}
            </button>
          ))}
        </nav>
        {showRefresh && (
          <OutcomeRefresh
            busy={busy}
            onRefresh={() => {
              if (category === "todos") setTodoRefreshVersion((version) => version + 1);
              else void load();
            }}
          />
        )}
      </div>
      {category === "todos" && todos ? (
        <TodoPanel
          client={todos}
          showComposer={false}
          refreshVersion={refreshVersion + todoRefreshVersion}
          handoff={todoHandoff}
        />
      ) : (
        <>
          {busy && !page && <p role="status">{t("Loading Inbox…")}</p>}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {t(error)}{" "}
              <OutcomeButton variant="ghost" onClick={() => void load()}>
                {t("Retry")}
              </OutcomeButton>
            </p>
          )}
          {unavailable && <p role="status">{t("This server does not support the Outcome Inbox.")}</p>}
          {page?.items.length === 0 && (
            <OutcomeEmptyState
              icon={category === "completed" ? CheckCheck : Inbox}
              title={category === "completed" ? "No completed items yet." : "You're all caught up."}
              description={
                category === "completed"
                  ? "Completed decisions and reviews will appear here."
                  : "Decisions, reviews and human actions will appear here when they need you."
              }
            />
          )}
          <ul className={page?.items.length ? "outcome-rows" : undefined}>
            {page?.items.map((item) => (
              <li key={item.id}>
                <button className="outcome-row" onClick={() => onSelect(item)}>
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="outcome-row-title">{item.title}</span>
                    <span className="outcome-row-meta">
                      {t(inboxCategoryLabels[item.category] ?? "Outcome")} · {t("Revision")}{" "}
                      {item.contractRevision}
                    </span>
                    <span className="block text-xs text-foreground-secondary">
                      <span className="text-foreground">{t("Completed")}: </span>
                      {item.completed}
                    </span>
                    <span className="block text-xs text-foreground-secondary">
                      <span className="text-foreground">{t("Current problem")}: </span>
                      {item.problem || t("No unresolved problem.")}
                    </span>
                    <span className="block text-xs text-foreground-secondary">
                      <span className="text-foreground">{t("Next step")}: </span>
                      {item.next}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-foreground-tertiary"
                  />
                </button>
              </li>
            ))}
          </ul>
          {page?.nextCursor && (
            <OutcomeButton disabled={busy} onClick={() => void load(page.nextCursor!)}>
              {t("Load more")}
            </OutcomeButton>
          )}
        </>
      )}
    </section>
  );
}
