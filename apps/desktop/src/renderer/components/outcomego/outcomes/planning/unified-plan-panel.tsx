import type { OutcomePlanAdvice } from "@outcomego/contracts/outcome-plan";
import type { OutcomeThreadTurnView } from "@outcomego/contracts/outcome-thread";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeButton } from "../outcome-ui";

function latestAdvice(turns: readonly OutcomeThreadTurnView[], fallback?: OutcomePlanAdvice | null) {
  return [...turns].reverse().find((turn) => turn.planMode === "advice" && turn.result)?.result as OutcomePlanAdvice | undefined ?? fallback ?? null;
}

const MAX_L1_NEXT_STEPS = 2;

/** Shared progressive-disclosure Plan/advice surface for every Outcome kind. */
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

  const confirmRecommendations = result?.recommendations.filter((item) => item.needsOwnerConfirm) ?? [];
  const otherRecommendations = result?.recommendations.filter((item) => !item.needsOwnerConfirm) ?? [];
  const l1NextSteps = confirmRecommendations.length === 0 ? otherRecommendations.slice(0, MAX_L1_NEXT_STEPS) : [];
  const detailRecommendations = confirmRecommendations.length > 0
    ? [
        ...confirmRecommendations.filter((item) => Boolean(item.reason?.trim())),
        ...otherRecommendations,
      ]
    : [
        ...otherRecommendations.slice(0, MAX_L1_NEXT_STEPS).filter((item) => Boolean(item.reason?.trim())),
        ...otherRecommendations.slice(MAX_L1_NEXT_STEPS),
      ];
  const factsCount = result?.facts.length ?? 0;
  const gapsCount = result?.gaps.length ?? 0;
  const notesCount = detailRecommendations.length;
  const hasDetails = Boolean(result && (factsCount > 0 || gapsCount > 0 || notesCount > 0 || result.suggestedKind));
  const detailCounts = [
    factsCount > 0 ? t("{count} facts", { count: factsCount }) : null,
    gapsCount > 0 ? t("{count} gaps", { count: gapsCount }) : null,
    notesCount > 0 ? t("{count} notes", { count: notesCount }) : null,
  ].filter(Boolean);

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
          <p className="outcome-result-conclusion whitespace-pre-wrap break-words">{result.summary}</p>
          {confirmRecommendations.length > 0 && (
            <div className="outcome-result-attention">
              <strong className="outcome-result-attention-title">{t("Needs your confirmation")}</strong>
              <ul className="outcome-brief-list">
                {confirmRecommendations.map((item, index) => (
                  <li key={`confirm:${item.action}:${index}`}>{item.action}</li>
                ))}
              </ul>
            </div>
          )}
          {l1NextSteps.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-foreground-secondary">{t("Suggested next steps")}</h4>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {l1NextSteps.map((item, index) => (
                  <li key={`next:${item.action}:${index}`}>{item.action}</li>
                ))}
              </ul>
            </div>
          )}
          {hasDetails && (
            <details className="outcome-technical">
              <summary>
                {t("Evidence and details")}
                {detailCounts.length > 0 ? ` · ${detailCounts.join(" · ")}` : ""}
              </summary>
              <div className="mt-2 space-y-3">
                {detailRecommendations.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-foreground-secondary">{t("Recommendation details")}</h4>
                    <ul className="mt-1 list-disc space-y-1.5 pl-4">
                      {detailRecommendations.map((item, index) => (
                        <li key={`detail:${item.action}:${index}`}>
                          <span>{item.action}</span>
                          {item.needsOwnerConfirm && (
                            <span className="ml-1.5 text-xs text-foreground-secondary">· {t("Needs your confirmation")}</span>
                          )}
                          {item.reason && (
                            <p className="mt-0.5 text-xs text-foreground-secondary whitespace-pre-wrap break-words">{item.reason}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.gaps.length > 0 && <PlanList title={t("Gaps")} items={result.gaps} />}
                {result.facts.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-foreground-secondary">{t("Facts")}</h4>
                    <ul className="mt-1 list-disc space-y-1.5 pl-4">
                      {result.facts.map((fact, index) => (
                        <li key={`fact:${fact.statement}:${index}`}>
                          <span className="whitespace-pre-wrap break-words">{fact.statement}</span>
                          <p className="mt-0.5 text-xs text-foreground-secondary break-all">
                            {fact.source}{fact.verifiedAt ? ` · ${fact.verifiedAt}` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.suggestedKind && (
                  <p className="text-xs text-foreground-secondary">{t("Suggested type")}: {result.suggestedKind}</p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
      {!result && !pending && <p className="text-sm text-foreground-secondary">{t("No plan has been generated yet.")}</p>}
    </section>
  );
}

function PlanList({ title, items }: { title: string; items: readonly string[] }) {
  return <div><h4 className="text-xs font-medium text-foreground-secondary">{title}</h4><ul className="mt-1 list-disc space-y-1 pl-4">{items.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul></div>;
}
