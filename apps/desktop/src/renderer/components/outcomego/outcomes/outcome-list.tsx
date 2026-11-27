import { useEffect, useRef, useState } from "react";
import type { OutcomeKind, OutcomeStatus } from "@outcomego/contracts/outcome-view";
import type { OutcomeListPage } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../client/outcome-api";
import { useI18n } from "../../../lib/i18n";
import { subscribeOutcomeListRefresh } from "../../../lib/outcome-events";
import { ALL_OUTCOME_STATUSES } from "../../../lib/outcome-kinds";
import { CheckSquare, ChevronRight, Clock, Lightbulb, Plus, StickyNote, Target } from "lucide-react";
import { OutcomeButton, OutcomeEmptyState, OutcomeRefresh } from "./outcome-ui";
import type { OutcomeExecutionBot } from "./outcome-execution-card";

type KindCategory = "all" | "goals" | "scheduled_once" | "todo" | "explore_idea" | "note";

const KIND_CATEGORIES: ReadonlyArray<{ id: KindCategory; label: string; queryKinds?: string }> = [
  { id: "all", label: "All" },
  { id: "goals", label: "Goals", queryKinds: "standard,tracked" },
  { id: "scheduled_once", label: "Scheduled", queryKinds: "scheduled_once" },
  { id: "todo", label: "To-dos", queryKinds: "todo" },
  { id: "explore_idea", label: "Ideas", queryKinds: "explore_idea" },
  { id: "note", label: "Notes", queryKinds: "note" },
];

const KIND_LABELS: Record<OutcomeKind, string> = {
  standard: "Goals",
  tracked: "Bot-registered",
  scheduled_once: "Scheduled",
  todo: "To-dos",
  explore_idea: "Ideas",
  note: "Notes",
};

const KIND_ICONS: Record<OutcomeKind, typeof Target> = {
  standard: Target,
  tracked: Target,
  scheduled_once: Clock,
  todo: CheckSquare,
  explore_idea: Lightbulb,
  note: StickyNote,
};

export const outcomeStatusLabels: Record<OutcomeStatus, string> = {
  draft: "Draft",
  planning: "Planning",
  pending_approval: "Awaiting approval",
  approved: "Starting execution",
  running: "Running",
  review_pending: "Awaiting review",
  accepted: "Accepted",
  decision_pending: "Awaiting decision",
  human_action_pending: "Awaiting human action",
  paused: "Paused",
  failed: "Failed",
  cancelled: "Cancelled",
  scheduled: "Scheduled",
  preparing: "Preparing",
  suggested: "Suggested",
  open: "Open",
  waiting: "Waiting",
  exploring: "Exploring",
  active: "Active",
  archived: "Archived",
};

export function OutcomeList({
  client,
  bots,
  onSelect,
  onCreate,
  fixedKind,
  refreshVersion = 0,
}: {
  client: OutcomeClient;
  bots: OutcomeExecutionBot[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  fixedKind?: "note";
  refreshVersion?: number;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<OutcomeListPage | null>(null);
  const [status, setStatus] = useState<OutcomeStatus | "all">("all");
  const [category, setCategory] = useState<KindCategory>(fixedKind ?? "all");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const effectiveCategory: KindCategory = fixedKind ?? category;
  const queryKinds = KIND_CATEGORIES.find((entry) => entry.id === effectiveCategory)?.queryKinds;
  const loadRef = useRef<(cursor?: string) => Promise<void>>(async () => {});
  async function load(cursor?: string) {
    const request = ++generation.current;
    setBusy(true);
    setError(false);
    const query = new URLSearchParams();
    if (queryKinds) query.set("kinds", queryKinds);
    if (status !== "all") query.set("statuses", status);
    if (cursor) query.set("cursor", cursor);
    try {
      const result = await client.list(query.toString());
      if (generation.current !== request) return;
      setPage((current) =>
        cursor
          ? {
              items: [
                ...new Map(
                  [...(current?.items ?? []), ...result.items].map((item) => [item.id, item])
                ).values(),
              ],
              nextCursor: result.nextCursor,
            }
          : result
      );
    } catch {
      if (generation.current === request) setError(true);
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  loadRef.current = load;
  useEffect(() => {
    setPage(null);
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void loadRef.current();
    };
    const unsubscribe = subscribeOutcomeListRefresh(() => void loadRef.current());
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      generation.current++;
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [client, status, queryKinds]);
  useEffect(() => {
    if (refreshVersion > 0) void load();
  }, [refreshVersion]);
  const items = page?.items;
  const isNotesOnly = fixedKind === "note";
  const statusOptions: readonly OutcomeStatus[] = isNotesOnly
    ? ["active", "archived", "cancelled"]
    : ALL_OUTCOME_STATUSES;
  return (
    <section aria-label={t(isNotesOnly ? "Notes" : "All")} aria-busy={busy} className="space-y-4">
      <div className="outcome-toolbar flex-wrap gap-2">
        {isNotesOnly ? (
          <p className="outcome-toolbar-description">
            {t("Notes stay synced with shared memory and can be evolved into tasks or goals anytime.")}
          </p>
        ) : (
          <nav aria-label={t("Outcome type")} className="outcome-filters">
            {KIND_CATEGORIES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={effectiveCategory === entry.id}
                onClick={() => setCategory(entry.id)}
              >
                {t(entry.label)}
              </button>
            ))}
          </nav>
        )}
        <div className="outcome-toolbar-controls flex-wrap">
          <label className="sr-only" htmlFor="outcome-status-filter">
            {t("Execution status")}
          </label>
          <select
            id="outcome-status-filter"
            className="outcome-control"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">{t("All statuses")}</option>
            {statusOptions.map((value) => (
              <option key={value} value={value}>
                {t(outcomeStatusLabels[value])}
              </option>
            ))}
          </select>
          <OutcomeRefresh busy={busy} onRefresh={() => void load()} />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t("Could not load goals. Try again.")}{" "}
          <OutcomeButton variant="ghost" onClick={() => void load()}>
            {t("Retry")}
          </OutcomeButton>
        </p>
      )}
      {busy && !page && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(isNotesOnly ? "Loading notes…" : "Loading goals…")}
        </p>
      )}
      {items?.length === 0 && !page?.nextCursor && (
        <OutcomeEmptyState
          icon={isNotesOnly ? StickyNote : Target}
          title={
            status !== "all"
              ? "No Outcomes with this status."
              : isNotesOnly
                ? "No notes yet."
                : "No Outcomes yet."
          }
          description={
            status !== "all"
              ? "Choose another status to see your other goals."
              : isNotesOnly
                ? "Use Go to jot down anything — notes stay here and sync with shared memory."
                : "Send anything through Go, then follow its progress here."
          }
        >
          {status === "all" && (
            <OutcomeButton onClick={onCreate}>
              <Plus className="size-3.5" />
              {t("Go")}
            </OutcomeButton>
          )}
        </OutcomeEmptyState>
      )}
      <ul className={items?.length ? "outcome-rows" : undefined}>
        {items?.map((outcome) => {
          const Icon = KIND_ICONS[outcome.kind] ?? Target;
          const botName = outcome.botId ? bots.find((bot) => bot.id === outcome.botId)?.name : null;
          return (
            <li key={outcome.id}>
              <button className="outcome-row" onClick={() => onSelect(outcome.id)}>
                <span className="outcome-row-icon">
                  <Icon aria-hidden="true" className="size-4" strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="outcome-row-title">{outcome.title}</span>
                  <span className="outcome-row-meta">
                    {t(KIND_LABELS[outcome.kind])}
                    {botName && <> · {botName}</>}
                    {outcome.kind === "scheduled_once" && outcome.scheduledAt ? (
                      <> · {t("Scheduled time")} <time dateTime={outcome.scheduledAt}>{new Date(outcome.scheduledAt).toLocaleString()}</time></>
                    ) : outcome.kind === "standard" || outcome.kind === "tracked" ? (
                      <> · {t("Revision")} {outcome.currentRevision ?? "—"} · {new Date(outcome.updatedAt).toLocaleString()}</>
                    ) : (
                      <>
                        {outcome.tags.length > 0 && <> · {outcome.tags.map((tag) => `#${tag}`).join(" ")}</>}
                        {" · "}
                        {new Date(outcome.updatedAt).toLocaleString()}
                      </>
                    )}
                  </span>
                </span>
                <span className="outcome-status" data-outcome-status={outcome.status}>
                  {t(outcome.status === "review_pending" && outcome.prereviewStatus === "pending" ? "Preliminary review in progress" : outcomeStatusLabels[outcome.status])}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-foreground-tertiary"
                />
              </button>
            </li>
          );
        })}
      </ul>
      {page?.nextCursor && (
        <OutcomeButton className="mt-4" disabled={busy} onClick={() => void load(page.nextCursor!)}>
          {t("Load more")}
        </OutcomeButton>
      )}
    </section>
  );
}
