import { useEffect, useRef, useState } from "react";
import { OUTCOME_STATUSES, type OutcomeStatus } from "@outcomego/contracts/outcome-view";
import type { OutcomeListPage } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../client/outcome-api";
import { useI18n } from "../../../lib/i18n";
import { ChevronRight, Plus, Target } from "lucide-react";
import { OutcomeButton, OutcomeEmptyState, OutcomeRefresh } from "./outcome-ui";
import { OutcomeExecutionListAction, type OutcomeExecutionBot } from "./outcome-execution-card";

/** Goals that never reached execution have no Run, so there are no messages to observe. */
const unexecutedStatuses: ReadonlySet<OutcomeStatus> = new Set([
  "draft",
  "planning",
  "pending_approval",
  "approved",
]);

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
};

export function OutcomeList({
  client,
  bots,
  onSelect,
  onCreate,
  refreshVersion = 0,
}: {
  client: OutcomeClient;
  bots: OutcomeExecutionBot[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  refreshVersion?: number;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<OutcomeListPage | null>(null);
  const [status, setStatus] = useState<OutcomeStatus | "all">("all");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  async function load(cursor?: string) {
    const request = ++generation.current;
    setBusy(true);
    setError(false);
    const query = new URLSearchParams();
    if (status !== "all") query.set("status", status);
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
  useEffect(() => {
    setPage(null);
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      generation.current++;
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [client, status]);
  useEffect(() => {
    if (refreshVersion > 0) void load();
  }, [refreshVersion]);
  return (
    <section aria-label={t("All goals")} aria-busy={busy}>
      <div className="outcome-toolbar">
        <p className="outcome-toolbar-description">
          {t("Your goals, from planning to completion.")}
        </p>
        <div className="outcome-toolbar-controls">
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
            {OUTCOME_STATUSES.map((value) => (
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
          {t("Loading goals…")}
        </p>
      )}
      {page?.items.length === 0 && (
        <OutcomeEmptyState
          icon={Target}
          title={status === "all" ? "No goals yet." : "No goals with this status."}
          description={
            status === "all"
              ? "Turn a task into a clear goal. Plan it with your Bot and follow its progress here."
              : "Choose another status to see your other goals."
          }
        >
          {status === "all" && (
            <OutcomeButton onClick={onCreate}>
              <Plus className="size-3.5" />
              {t("New Outcome")}
            </OutcomeButton>
          )}
        </OutcomeEmptyState>
      )}
      <ul className={page?.items.length ? "outcome-rows" : undefined}>
        {page?.items.map((outcome) => (
          <li key={outcome.id}>
            <button className="outcome-row" onClick={() => onSelect(outcome.id)}>
              <span className="outcome-row-icon">
                <Target aria-hidden="true" className="size-4" strokeWidth={1.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="outcome-row-title">{outcome.title}</span>
                <span className="outcome-row-meta">
                  {bots.find((bot) => bot.id === outcome.botId)?.name ?? t("Bot")} · {t("Revision")}{" "}
                  {outcome.currentRevision ?? "—"} · {new Date(outcome.updatedAt).toLocaleString()}
                </span>
              </span>
              <span className="outcome-status" data-outcome-status={outcome.status}>
                {t(outcomeStatusLabels[outcome.status])}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-foreground-tertiary"
              />
            </button>
            {!unexecutedStatuses.has(outcome.status) && (
              <OutcomeExecutionListAction
                outcomeId={outcome.id}
                title={outcome.title}
                client={client}
                bot={bots.find((bot) => bot.id === outcome.botId)}
              />
            )}
          </li>
        ))}
      </ul>
      {page?.nextCursor && (
        <OutcomeButton className="mt-4" disabled={busy} onClick={() => void load(page.nextCursor!)}>
          {t("Load more")}
        </OutcomeButton>
      )}
    </section>
  );
}
