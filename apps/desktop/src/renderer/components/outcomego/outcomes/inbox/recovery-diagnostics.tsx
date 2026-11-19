import { useEffect, useRef, useState } from "react";
import type { OutcomeRecoveryPage } from "@outcomego/contracts/outcome-runtime";
import { outcomeDecisionDeepLink } from "@outcomego/contracts/app-deep-links";
import { OutcomeRequestIds } from "../planning/outcome-client";
import { OUTCOMEGO_DEEP_LINK_EVENT } from "../../../../lib/app-deep-links";
import { useI18n } from "../../../../lib/i18n";

export type RecoveryState = OutcomeRecoveryPage;
const defaultClient = {
  get: (id: string): Promise<RecoveryState> =>
    import("../../../../client/outcomego-api").then(({ api }) => api.outcomeRecovery(id)),
  reconcile: (id: string, clientRequestId: string): Promise<RecoveryState> =>
    import("../../../../client/outcomego-api").then(({ api }) =>
      api.reconcileOutcome(id, clientRequestId)
    ),
};
const reasons: Record<string, string> = {
  state_inconsistent:
    "Stored execution facts disagree. Review the current state before continuing.",
  retry_exhausted: "Automatic retries have reached their limit. Human review is required.",
  unknown_side_effect:
    "The previous action may have changed an external system. Confirm the result before retrying.",
  unknown_side_effect_result:
    "The previous action may have changed an external system. Confirm the result before retrying.",
  worker_disconnected:
    "The worker disconnected. Recovery uses the latest persisted execution facts.",
  computer_disconnected: "The computer disconnected. Check its connection before continuing.",
};
export function RecoveryDiagnostics({
  outcomeId,
  client = defaultClient,
  initialState,
}: {
  outcomeId: string;
  client?: typeof defaultClient;
  initialState?: RecoveryState;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<RecoveryState | null>(initialState ?? null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const ids = useRef(new OutcomeRequestIds());
  async function load(reconcile = false) {
    if (busy) return;
    const request = ++generation.current;
    setBusy(true);
    setError(false);
    try {
      const value = reconcile
        ? await client.reconcile(outcomeId, ids.current.for(`reconcile:${outcomeId}`, {}))
        : await client.get(outcomeId);
      if (request !== generation.current) return;
      if (reconcile) ids.current.complete(`reconcile:${outcomeId}`);
      setState(value);
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [outcomeId, client]);
  return (
    <section
      aria-label={t("Recovery and delivery diagnostics")}
      aria-busy={busy}
      className="space-y-3 outcome-card"
    >
      <h3 className="font-medium">{t("Recovery and delivery diagnostics")}</h3>
      <p className="text-sm">
        {t(
          "Recovery rereads committed facts. It does not force success or repeat an uncertain external action."
        )}
      </p>
      {error && (
        <p role="alert">{t("Could not load recovery diagnostics. Retry when connected.")}</p>
      )}
      {!state && busy && <p role="status">{t("Loading recovery state…")}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className="outcome-control" onClick={() => void load()}>
          {t("Refresh diagnostics")}
        </button>
        <button disabled={busy} className="outcome-control" onClick={() => void load(true)}>
          {t("Reconcile persisted facts")}
        </button>
      </div>
      {state?.items.length === 0 && <p>{t("No recovery checkpoints recorded.")}</p>}
      {state?.items.map((item) => (
        <details
          key={item.id}
          open={["needs_review", "failed"].includes(item.status)}
          className="outcome-card"
        >
          <summary>
            {t(item.status)} · {t("Revision")} {item.contractRevision} · {t("Retries")}:{" "}
            {item.retryCount} · {t("Recoveries")}: {item.recoveryCount}
          </summary>
          {item.reasonCode && (
            <p
              role={item.status === "needs_review" || item.status === "failed" ? "alert" : "status"}
            >
              {t(
                reasons[item.reasonCode] ??
                  "Review this recovery reason and the latest server state before taking action."
              )}{" "}
              <code>{item.reasonCode}</code>
            </p>
          )}
          {item.nextAction && (
            <p>
              {t("Next step")}: {item.nextAction.summary} · {item.nextAction.type}
            </p>
          )}
          {item.decisionId && (
            <button
              className="outcome-control"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(OUTCOMEGO_DEEP_LINK_EVENT, {
                    detail: { url: outcomeDecisionDeepLink(item.decisionId!) },
                  })
                )
              }
            >
              {t("Open Decision")}
            </button>
          )}
          <p className="break-all text-xs">
            Checkpoint {item.id} · WorkItem {item.workItemId} · Run {item.runId ?? "—"} · #
            {item.sequence} · {item.createdAt}
          </p>
          <p className="break-all text-xs">
            {t("Outputs")}: {item.outputRefs.join(", ") || "—"} · {t("Evidence")}:{" "}
            {item.evidenceRefs.join(", ") || "—"}
          </p>
        </details>
      ))}
      {(state?.notificationFailures?.length ?? 0) > 0 && (
        <section aria-label={t("Notification delivery failures")} className="space-y-2">
          <h4 className="font-medium">{t("Notification delivery failures")}</h4>
          {state!.notificationFailures.map((failure) => (
            <div key={failure.id} className="outcome-card">
              <p role="alert">
                {t(
                  failure.errorCode === "notification_retry_exhausted"
                    ? "Notification retries are exhausted. The business result remains available in the Inbox."
                    : "Notification delivery failed. The business result remains available in the Inbox."
                )}
              </p>
              <p>
                {t("Status")}: {t(failure.status)} · {t("Attempts")}: {failure.attempts}
              </p>
              <p className="break-all text-xs">
                Outbox {failure.id} · {failure.errorCode ?? "—"}
              </p>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
