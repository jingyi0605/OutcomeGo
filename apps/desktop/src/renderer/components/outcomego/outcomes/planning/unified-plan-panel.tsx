import type { OutcomePlanAdvice } from "@outcomego/contracts/outcome-plan";
import type { OutcomeThreadTurnView } from "@outcomego/contracts/outcome-thread";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeButton } from "../outcome-ui";

function latestAdvice(turns: readonly OutcomeThreadTurnView[], fallback?: OutcomePlanAdvice | null) {
  return [...turns].reverse().find((turn) => turn.planMode === "advice" && turn.result)?.result as OutcomePlanAdvice | undefined ?? fallback ?? null;
}

/** Shared structured Plan/advice surface for every Outcome kind. */
export function UnifiedPlanPanel({
  turns = [],
  advice,
  pending = false,
  busy = false,
  canPlan = true,
  scheduled = false,
  onPlan,
}: {
  turns?: readonly OutcomeThreadTurnView[];
  advice?: OutcomePlanAdvice | null;
  pending?: boolean;
  busy?: boolean;
  canPlan?: boolean;
  scheduled?: boolean;
  onPlan: () => void;
}) {
  const { t } = useI18n();
  const result = latestAdvice(turns, advice);
  if (!canPlan && !result && !pending) return null;
  return (
    <section aria-label={t(scheduled ? "Run advice" : "Plan")} className="outcome-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{t(scheduled ? "Run advice" : "Plan")}</h3>
          <p className="text-xs text-foreground-secondary">{t("A structured brief from the Outcome planner.")}</p>
        </div>
        {canPlan && !pending && <OutcomeButton variant="secondary" disabled={busy} onClick={onPlan}>
          {t(result ? "Refresh plan" : scheduled ? "Generate run advice" : "Plan")}
        </OutcomeButton>}
      </div>
      {pending && <p role="status" aria-live="polite">{t(scheduled ? "Advice queued…" : "Plan queued…")}</p>}
      {result && (
        <div className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap break-words">{result.summary}</p>
          {result.facts.length > 0 && <PlanList title={t("Facts")} items={result.facts.map((fact) => `${fact.statement} · ${fact.source}`)} />}
          {result.gaps.length > 0 && <PlanList title={t("Gaps")} items={result.gaps} />}
          {result.recommendations.length > 0 && <PlanList title={t("Recommendations")} items={result.recommendations.map((item) => `${item.action}${item.needsOwnerConfirm ? ` · ${t("Needs your confirmation")}` : ""}${item.reason ? ` — ${item.reason}` : ""}`)} />}
          {result.suggestedKind && <p className="text-xs text-foreground-secondary">{t("Suggested type")}: {result.suggestedKind}</p>}
        </div>
      )}
      {!result && !pending && <p className="text-sm text-foreground-secondary">{t("No plan has been generated yet.")}</p>}
    </section>
  );
}

function PlanList({ title, items }: { title: string; items: readonly string[] }) {
  return <div><h4 className="text-xs font-medium text-foreground-secondary">{title}</h4><ul className="mt-1 list-disc space-y-1 pl-4">{items.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul></div>;
}
