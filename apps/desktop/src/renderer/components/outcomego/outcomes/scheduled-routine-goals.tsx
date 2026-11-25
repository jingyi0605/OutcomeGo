import { useEffect, useState } from "react";
import { ChevronRight, Clock3 } from "lucide-react";
import type { ScheduledGoalSummary } from "@outcomego/contracts";
import { api } from "../../../client/outcomego-api";
import { ClientError } from "../../../client/http";
import { useI18n } from "../../../lib/i18n";
import { subscribeOutcomeListRefresh } from "../../../lib/outcome-events";
import type { OutcomeExecutionBot } from "./outcome-execution-card";
import { OutcomeButton } from "./outcome-ui";
import { styleForActivity } from "./dashboard/activity-state";

export function ScheduledRoutineGoals({ bots, onOpen, refreshVersion }: {
  bots: readonly OutcomeExecutionBot[];
  onOpen: (id: string) => void;
  refreshVersion: number;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<ScheduledGoalSummary[]>([]);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    async function load() {
      const request = ++sequence;
      try {
        const result = await api.scheduledGoals();
        if (!active || request !== sequence) return;
        setItems(result);
        setError(false);
      } catch (cause) {
        if (!active || request !== sequence) return;
        if (cause instanceof ClientError && cause.status === 404) return;
        setError(true);
      }
    }
    void load();
    const refresh = () => { if (document.visibilityState !== "hidden") void load(); };
    const unsubscribe = subscribeOutcomeListRefresh(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [refreshVersion, retry]);
  if (!items.length && !error) return null;
  return (
    <section aria-label={t("Scheduled goals")} className="outcome-dash-section">
      <div className="outcome-dash-heading"><h2>{t("Scheduled goals")}</h2></div>
      {error && <p role="alert" className="text-xs text-destructive">
        {t("Could not load scheduled goals.")} <OutcomeButton onClick={() => setRetry((value) => value + 1)}>{t("Retry")}</OutcomeButton>
      </p>}
      <ul className="outcome-rows">
        {items.map((item) => <li key={item.id}>
          <button type="button" className="outcome-row" onClick={() => onOpen(item.id)}>
            <span className="outcome-row-icon"><Clock3 aria-hidden="true" className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="outcome-row-title">{item.name}</span>
              <span className="outcome-row-meta">
                {bots.find((bot) => bot.id === item.botId)?.name ?? t("Bot")}
                {item.runAt && <> · <time dateTime={item.runAt}>{new Date(item.runAt).toLocaleString()}</time></>}
              </span>
            </span>
            <span className="outcome-status">{t(styleForActivity(item.state).label)}</span>
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
          </button>
        </li>)}
      </ul>
    </section>
  );
}
