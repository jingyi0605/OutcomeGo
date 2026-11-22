import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useI18n } from "../../../../lib/i18n";
import { refreshOutcomeViews } from "../../../../lib/outcome-events";
import { DecisionController } from "../inbox/decision-state";
import type { InboxClient } from "../inbox/inbox-api";
import { OutcomeButton } from "../outcome-ui";
import { quickDecisionMode, recommendedOptionId } from "./dashboard-state";

/**
 * Answers a pending decision in place. Approvals are one click per answer; a choice among a few options
 * starts on the recommended one and needs one confirmation. It reuses the full card's controller, so the
 * request ID, revision check and conflict handling are identical. Anything it cannot answer safely
 * (see `quickDecisionMode`) renders nothing and the card's "View details" button stays the way in.
 */
export function QuickDecision({
  decisionId,
  client,
  onResolved,
}: {
  decisionId: string;
  client: Pick<InboxClient, "decision" | "resolve">;
  onResolved: () => void;
}) {
  const { t } = useI18n();
  const controller = useMemo(() => new DecisionController(client, decisionId), [client, decisionId]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    void controller.load();
    return () => controller.dispose();
  }, [controller]);
  const resolvedCallback = useRef(onResolved);
  resolvedCallback.current = onResolved;
  useEffect(() => {
    if (!state.result) return;
    toast.success(t("Choice recorded"));
    // The sidebar badges and every other list reload together with this one.
    refreshOutcomeViews();
    resolvedCallback.current();
  }, [state.result]);

  const decision = state.decision;
  const mode = state.phase === "resolved" ? "none" : quickDecisionMode(decision);
  const recommended = decision ? recommendedOptionId(decision) : undefined;
  useEffect(() => {
    if (mode === "choice" && !state.optionId && recommended) controller.edit({ optionId: recommended });
  }, [controller, mode, recommended, state.optionId]);

  const busy = state.phase === "resolving" || state.phase === "loading";
  if (!decision && state.phase === "loading")
    return <span className="outcome-dash-quick-loading" role="status" aria-label={t("Loading Decision…")} />;
  const error = state.error ? <p role="alert" className="outcome-dash-quick-error">{t(state.error)}</p> : null;
  if (!decision || mode === "none") return error;
  const options = decision.options.slice(0, 4);
  const marked = (id: string) => id === recommended;

  if (mode === "approval")
    return (
      <div className="outcome-dash-quick" aria-busy={busy}>
        {error}
        <div className="outcome-dash-quick-buttons">
          {options.map((option) => (
            <OutcomeButton
              key={option.id}
              type="button"
              disabled={busy}
              variant={marked(option.id) ? "default" : "secondary"}
              title={t(option.consequence)}
              onClick={() => void controller.resolve(option.id)}
            >
              {t(option.label)}
            </OutcomeButton>
          ))}
        </div>
      </div>
    );

  const chosen = options.find((option) => option.id === state.optionId);
  return (
    <div className="outcome-dash-quick" aria-busy={busy}>
      {error}
      <div role="radiogroup" aria-label={t("Choose the next step")} className="outcome-dash-options">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            data-dash=""
            aria-checked={state.optionId === option.id}
            disabled={busy}
            className="outcome-dash-option"
            // The consequence is a tooltip, not a second line: the card stays one row per option.
            title={t(option.consequence)}
            onClick={() => controller.edit({ optionId: option.id })}
          >
            <span className="outcome-dash-option-label">{t(option.label)}</span>
            {marked(option.id) && <em>{t("Recommended")}</em>}
          </button>
        ))}
      </div>
      <OutcomeButton
        type="button"
        variant="default"
        disabled={busy || !chosen}
        onClick={() => void controller.resolve(chosen!.id)}
      >
        {state.phase === "resolving"
          ? t("Submitting choice…")
          : chosen
            ? t("Confirm: {choice}", { choice: t(chosen.label) })
            : t("Submit choice")}
      </OutcomeButton>
    </div>
  );
}
