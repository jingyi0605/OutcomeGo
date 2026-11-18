import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DecisionState } from "./decision-state";
import { canResolveDecision, DecisionController } from "./decision-state";
import type { InboxClient } from "./inbox-api";
import type { OutcomeClient } from "../../../../client/outcome-api";
import type { OutcomeDetail, ContractRevisionView } from "@outcomego/contracts/outcomes";
import { useI18n } from "../../../../lib/i18n";
import { useOutcomeAttention } from "../../../../hooks/use-outcome-attention";
import { RecoveryDiagnostics } from "./recovery-diagnostics";

const control = "outcome-control";
export function DecisionCard({
  decisionId,
  client,
  outcomes,
  onOutcome,
  onResolved,
}: {
  decisionId: string;
  client: InboxClient;
  outcomes: OutcomeClient;
  onOutcome: (id: string) => void;
  onResolved?: () => void;
}) {
  const controller = useMemo(
    () => new DecisionController(client, decisionId),
    [client, decisionId]
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot
  );
  const attention = useOutcomeAttention({
    surface: "decision",
    outcomeId: state.decision?.outcomeId,
  });
  useEffect(() => {
    void controller.load();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    if (state.result) onResolved?.();
  }, [state.result, onResolved]);
  return (
    <section ref={attention.ref}>
      <DecisionCardView
        state={state}
        onEdit={(change) => controller.edit(change)}
        onRefresh={() => void controller.load()}
        onResolve={() => void controller.resolve()}
        outcomes={outcomes}
        onOutcome={onOutcome}
      />
    </section>
  );
}

export function DecisionCardView({
  state,
  onEdit,
  onRefresh,
  onResolve,
  outcomes,
  onOutcome,
}: {
  state: DecisionState;
  onEdit: (value: Partial<Pick<DecisionState, "optionId" | "customText">>) => void;
  onRefresh: () => void;
  onResolve: () => void;
  outcomes: OutcomeClient;
  onOutcome: (id: string) => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<OutcomeDetail | null>(null);
  const [contract, setContract] = useState<ContractRevisionView | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [transcript, setTranscript] = useState<unknown>();
  const [loadingDetails, setLoadingDetails] = useState(false);
  const decision = state.decision;
  const busy = state.phase === "resolving" || state.phase === "loading";
  const allowed = canResolveDecision(decision) && state.phase !== "resolved";
  const validChoice =
    state.optionId === "custom"
      ? decision?.customEntryAllowed && Boolean(state.customText.trim())
      : decision?.options.some((option) => option.id === state.optionId);
  const loadDetails = async () => {
    if (!decision || loadingDetails) return;
    setLoadingDetails(true);
    setDetailError(false);
    try {
      const detail = await outcomes.get(decision.outcomeId);
      setDetail(detail);
      const contract = outcomes.getRevision
        ? await outcomes.getRevision(decision.outcomeId, decision.contractRevision)
        : detail.currentRevisionView?.revision === decision.contractRevision
          ? detail.currentRevisionView
          : null;
      setContract(contract);
    } catch {
      setDetailError(true);
    } finally {
      setLoadingDetails(false);
    }
  };
  return (
    <article aria-label={t("Decision")} aria-busy={busy} className="space-y-4">
      <div className="flex justify-between gap-3">
        <h2 className="font-semibold">{t("Decision")}</h2>
        <button className={control} disabled={busy} onClick={onRefresh}>
          {t("Refresh from server")}
        </button>
      </div>
      {state.error && <p role="alert">{t(state.error)}</p>}
      {state.phase === "loading" && <p role="status">{t("Loading Decision…")}</p>}
      {decision && (
        <>
          <p role="status">
            {t("Status")}: {t(decision.status)} · {t("Revision")} {decision.contractRevision}
          </p>
          <dl className="space-y-2">
            <dt className="font-medium">{t("Completed")}</dt>
            <dd className="whitespace-pre-wrap">{decision.completedSummary}</dd>
            <dt className="font-medium">{t("Current problem")}</dt>
            <dd className="whitespace-pre-wrap">
              {decision.problemSummary || t("No unresolved problem.")}
            </dd>
            <dt className="font-medium">{t("Next step")}</dt>
            <dd className="whitespace-pre-wrap">{decision.nextStepSummary}</dd>
          </dl>
          {state.phase === "expired" && (
            <p role="alert">
              {t(
                "This Decision is expired, withdrawn, or unavailable for action. Refresh the Outcome to continue."
              )}
            </p>
          )}
          {state.phase === "conflict" && (
            <p role="alert">
              {t(
                "Your selection was kept. Check the current revision and options before resubmitting."
              )}
            </p>
          )}
          {state.phase === "resolved" && (
            <p role="status">
              {t("Decision recorded.")} {t(state.result?.resume.status ?? decision.status)}
            </p>
          )}
          {decision.expiresAt && (
            <p>
              {t("Expires")}: {new Date(decision.expiresAt).toLocaleString()}
            </p>
          )}
          <fieldset disabled={busy || !allowed} className="space-y-3">
            <legend>{t("Choose the next step")}</legend>
            {decision.options.map((option) => (
              <label key={option.id} className="block outcome-card">
                <input
                  type="radio"
                  name={`decision-${decision.id}`}
                  value={option.id}
                  checked={state.optionId === option.id}
                  onChange={() => onEdit({ optionId: option.id })}
                />
                <span className="ml-2">
                  {option.label}
                  {option.recommended && ` · ${t("Recommended")}`}
                </span>
                <span className="mt-1 block text-sm">{option.consequence}</span>
              </label>
            ))}
            {state.optionId &&
              state.optionId !== "custom" &&
              !decision.options.some((option) => option.id === state.optionId) && (
                <p role="alert">
                  {t("The previous option is no longer available. Choose a current option.")}
                </p>
              )}
            {decision.customEntryAllowed && (
              <label className="block">
                <input
                  type="radio"
                  name={`decision-${decision.id}`}
                  checked={state.optionId === "custom"}
                  onChange={() => onEdit({ optionId: "custom" })}
                />{" "}
                {t("Custom choice")}
                <textarea
                  aria-label={t("Custom choice")}
                  maxLength={4000}
                  className={`${control} mt-2 w-full`}
                  value={state.customText}
                  onChange={(event) =>
                    onEdit({ customText: event.target.value, optionId: "custom" })
                  }
                />
              </label>
            )}
            <button className={control} disabled={!validChoice} onClick={onResolve}>
              {t(
                state.phase === "resolving"
                  ? "Submitting choice…"
                  : state.phase === "conflict"
                    ? "Submit against current revision"
                    : "Submit choice"
              )}
            </button>
          </fieldset>
          <details
            onToggle={(event) => {
              if (event.currentTarget.open && !detail) void loadDetails();
            }}
          >
            <summary>{t("Recommendation, impact and evidence")}</summary>
            {decision.recommendation && <p>{decision.recommendation.reason}</p>}
            {decision.options.map((option) => (
              <p key={option.id}>
                {option.label}: {option.reason ?? option.consequence} · {option.source}
              </p>
            ))}
            {decision.truncatedOptionCount > 0 && (
              <p>{t("Additional options were omitted by the server.")}</p>
            )}
            {loadingDetails && <p role="status">{t("Loading details…")}</p>}
            {detailError && (
              <p role="alert">
                {t("Could not load details.")}{" "}
                <button onClick={() => void loadDetails()}>{t("Retry")}</button>
              </p>
            )}
            {detail && (
              <>
                <p>
                  {t("Current revision")}: {detail.currentRevision}
                </p>
                {detail.currentRevision !== decision.contractRevision && (
                  <p role="alert">{t("This card belongs to a previous Contract revision.")}</p>
                )}
                {contract && (
                  <section className="my-3 space-y-2 outcome-card">
                    <h3 className="font-medium">
                      {t("Decision Contract")}: {contract.revision} · {t(contract.status)}
                    </h3>
                    {contract.changeSummary && <p>{contract.changeSummary}</p>}
                    <h4>{t("Goals")}</h4>
                    <ul>
                      {contract.goal.map((goal, index) => (
                        <li key={index}>{goal}</li>
                      ))}
                    </ul>
                    <h4>{t("Acceptance criteria")}</h4>
                    <ul>
                      {contract.criteria.map((criterion) => (
                        <li key={criterion.id}>
                          {criterion.ordinal}. {criterion.statement} ·{" "}
                          {criterion.latestResult ?? "UNVERIFIED"}
                        </li>
                      ))}
                    </ul>
                    <h4>{t("Scope boundaries")}</h4>
                    <ul>
                      {contract.boundaries.included.map((text, index) => (
                        <li key={`include:${index}`}>+ {text}</li>
                      ))}
                      {contract.boundaries.excluded.map((text, index) => (
                        <li key={`exclude:${index}`}>− {text}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {detail.workItems
                  .filter((item) => item.id === decision.workItemId)
                  .map((item) => (
                    <p key={item.id}>
                      {item.title} · {t(item.status)} · {t("Revision")} {item.contractRevision}
                    </p>
                  ))}
                {detail.evidence
                  .filter((evidence) => evidence.contractRevision === decision.contractRevision)
                  .map((evidence) => (
                    <div key={evidence.id} className="my-2 outcome-card">
                      <p>{evidence.contentSummary}</p>
                      <p className="break-all text-xs">
                        {evidence.sourceType}: {evidence.sourceRef} · {evidence.credibility}
                      </p>
                    </div>
                  ))}
                <details onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
                  <summary>{t("Advanced run and audit details")}</summary>
                  <p className="break-all">
                    Decision {decision.id} · Outcome {decision.outcomeId} · Contract{" "}
                    {decision.contractRevisionId}
                  </p>
                  <p>
                    {t("Reason")}: {decision.reasonCode}
                  </p>
                  <p className="break-all">
                    WorkItem {decision.workItemId ?? "—"} · Run {decision.runId ?? "—"}
                  </p>
                  {decision.workItemId && (
                    <button
                      className={control}
                      onClick={() =>
                        void outcomes
                          .transcript(decision.outcomeId, decision.workItemId!)
                          .then(setTranscript, () => setDetailError(true))
                      }
                    >
                      {t("Read-only transcript")}
                    </button>
                  )}
                  {transcript !== undefined && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(transcript, null, 2)}
                    </pre>
                  )}
                  {advancedOpen && <RecoveryDiagnostics outcomeId={decision.outcomeId} />}
                </details>
              </>
            )}
          </details>
          <button className={control} onClick={() => onOutcome(decision.outcomeId)}>
            {t("Open Outcome and acceptance review")}
          </button>
        </>
      )}
    </article>
  );
}
