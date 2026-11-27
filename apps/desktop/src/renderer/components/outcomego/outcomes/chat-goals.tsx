import { useEffect, useRef, useState } from "react";
import { ChevronRight, Clock3, Plus, Target } from "lucide-react";
import type { BotView } from "@outcomego/contracts";
import type { OutcomeStatus } from "@outcomego/contracts/outcome-view";
import type { OutcomeListPage } from "@outcomego/contracts/outcomes";
import { api } from "../../../client/outcomego-api";
import { useI18n } from "../../../lib/i18n";
import { subscribeOutcomeListRefresh } from "../../../lib/outcome-events";
import { GOAL_OUTCOME_KINDS, GOAL_OUTCOME_STATUSES } from "../../../lib/outcome-kinds";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog";
import { Switch } from "../../ui/switch";
import { OutcomeButton, OutcomeEmptyState } from "./outcome-ui";
import { outcomeStatusLabels } from "./outcome-list";
import { NewOutcomeForm } from "./thread/new-outcome-form";
import { OutcomeRouteView, type OutcomeDetailRoute } from "./inbox/outcome-route-view";
import "./outcome-ui.css";

const FINISHED_GOAL_STATUSES: ReadonlySet<OutcomeStatus> = new Set(["accepted", "cancelled"]);
const OPEN_GOAL_STATUSES = GOAL_OUTCOME_STATUSES.filter((status) => !FINISHED_GOAL_STATUSES.has(status));

export default function ChatGoals({
  bot,
  bots,
  onClose,
  onNewGoal,
}: {
  bot: BotView;
  bots: BotView[];
  onClose: () => void;
  onNewGoal?: () => void;
}) {
  const { t } = useI18n();
  const [route, setRoute] = useState<OutcomeDetailRoute>();
  const [creating, setCreating] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [page, setPage] = useState<OutcomeListPage>();
  const [cursor, setCursor] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  const movingToComposer = useRef(false);
  const listing = !route && !creating;

  useEffect(() => {
    if (!listing) return;
    return subscribeOutcomeListRefresh(() => {
      setCursor(undefined);
      setRetry((n) => n + 1);
    });
  }, [listing]);

  useEffect(() => {
    if (!listing) return;
    let active = true;
    const query = new URLSearchParams({ botId: bot.id, kinds: GOAL_OUTCOME_KINDS.join(",") });
    if (!showCompleted) query.set("statuses", OPEN_GOAL_STATUSES.join(","));
    if (cursor) query.set("cursor", cursor);
    setError(false);
    void api.outcomes.list(query.toString()).then(
      (next) => {
        if (!active) return;
        setPage((previous) => ({
          ...next,
          items: cursor
            ? [...new Map([...(previous?.items ?? []), ...next.items].map((item) => [item.id, item])).values()]
            : next.items,
        }));
      },
      () => {
        if (active) setError(true);
      }
    );
    return () => {
      active = false;
    };
  }, [bot.id, cursor, listing, retry, showCompleted]);

  const back = () => {
    setCursor(undefined);
    setRoute(undefined);
    setCreating(false);
  };

  const handleNewGoal = () => {
    if (onNewGoal) {
      movingToComposer.current = true;
      onNewGoal();
      onClose();
      return;
    }
    setCreating(true);
  };

  const visibleItems =
    page?.items.filter((goal) => showCompleted || !FINISHED_GOAL_STATUSES.has(goal.status)) ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="outcome-modal outcome-page"
        overlayClassName="outcome-modal-overlay"
        onCloseAutoFocus={(event) => {
          if (movingToComposer.current) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">{t("Goals with {name}", { name: bot.name })}</DialogTitle>
        <DialogDescription className="sr-only">{t("Review the goal and handle current decisions.")}</DialogDescription>
        <div className="outcome-page-content outcome-modal-body space-y-4">
          {listing ? (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 pr-8">
                <h2 className="text-base font-medium">{t("Goals with {name}", { name: bot.name })}</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground-secondary select-none">
                    <Switch
                      checked={showCompleted}
                      onCheckedChange={(checked) => {
                        setCursor(undefined);
                        setPage(undefined);
                        setShowCompleted(checked);
                      }}
                    />
                    <span>{t("Show completed goals")}</span>
                  </label>
                  <OutcomeButton variant="default" onClick={handleNewGoal}>
                    <Plus aria-hidden="true" className="size-3.5" />
                    {t("New Outcome")}
                  </OutcomeButton>
                </div>
              </header>
              {!page && !error && <p role="status">{t("Loading goals…")}</p>}
              {error && (
                <p role="alert">
                  {t("Could not load goals. Try again.")}{" "}
                  <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
                    {t("Retry")}
                  </button>
                </p>
              )}
              {page && visibleItems.length === 0 && (
                <OutcomeEmptyState
                  icon={Target}
                  title={showCompleted ? "No goals yet." : "No goals in progress."}
                  description={
                    showCompleted
                      ? "Turn a task into a clear goal. Plan it with your Bot and follow its progress here."
                      : 'Turn on "Show completed goals" to view accepted or cancelled goals.'
                  }
                >
                  <OutcomeButton variant="default" onClick={handleNewGoal}>
                    <Plus aria-hidden="true" className="size-3.5" />
                    {t("New Outcome")}
                  </OutcomeButton>
                </OutcomeEmptyState>
              )}
              {visibleItems.length > 0 && (
                <ul className="outcome-rows">
                  {visibleItems.map((goal) => (
                    <li key={goal.id}>
                      <button
                        type="button"
                        className="outcome-row"
                        onClick={() => setRoute({ kind: "outcome", id: goal.id })}
                      >
                        <span className="outcome-row-icon">
                          <Target aria-hidden="true" className="size-4" strokeWidth={1.6} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="outcome-row-title">{goal.title}</span>
                          <span className="outcome-row-meta inline-flex flex-wrap items-center gap-1.5">
                            <Clock3 aria-hidden="true" className="size-3 shrink-0 opacity-75" strokeWidth={1.7} />
                            <span>{new Date(goal.updatedAt).toLocaleString()}</span>
                            {goal.currentRevision !== null && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {t("Revision")} {goal.currentRevision}
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                        <span
                          className="outcome-status chat-goal-status-badge shrink-0"
                          data-outcome-status={goal.status}
                        >
                          {t(outcomeStatusLabels[goal.status])}
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-foreground-tertiary"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {page?.nextCursor && (
                <OutcomeButton
                  disabled={page.nextCursor === cursor}
                  onClick={() => setCursor(page.nextCursor!)}
                >
                  {t("Load more")}
                </OutcomeButton>
              )}
            </>
          ) : (
            <>
              <OutcomeButton variant="ghost" onClick={back}>{t("Back to all goals")}</OutcomeButton>
              {creating ? (
                <NewOutcomeForm client={api.outcomes} bots={[bot]} botId={bot.id} onCreated={onClose} />
              ) : (
                route && <OutcomeRouteView route={route} bots={bots} onOpen={setRoute} />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
