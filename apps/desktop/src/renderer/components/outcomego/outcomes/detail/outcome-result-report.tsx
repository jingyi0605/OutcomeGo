import { useEffect, useRef, useState } from "react";
import type { ContractRevisionView, OutcomeResultSummary } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { translateCurrent } from "../../../../lib/i18n-catalog";
import { subscribeOutcomeRefresh } from "../../../../lib/outcome-events";
import { MessageResponse } from "../../../ai-elements/message";
import { OutcomeButton } from "../outcome-ui";
import { OutcomeResultChartView } from "./outcome-result-chart";
import { getCachedResultSummary, setCachedResultSummary } from "../inbox/outcome-card-cache";

export function OutcomeResultReport({
  outcomeId,
  revision,
  load,
  hideWhenEmpty = false,
  refreshOnOutcomeChange = false,
  useCache = false,
  onReady,
}: {
  outcomeId: string;
  revision: Pick<ContractRevisionView, "id" | "revision">;
  load: NonNullable<OutcomeClient["resultSummary"]>;
  hideWhenEmpty?: boolean;
  refreshOnOutcomeChange?: boolean;
  useCache?: boolean;
  onReady?: () => void;
}) {
  const targetKey = `${outcomeId}:${revision.id}`;
  const [state, setState] = useState<{
    key: string;
    report?: OutcomeResultSummary | null;
    failed: boolean;
  }>(() => {
    const cached = useCache ? getCachedResultSummary(outcomeId, revision.id) : undefined;
    return { key: targetKey, report: cached, failed: false };
  });
  const [attempt, setAttempt] = useState(0);
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = false;
  }, [targetKey]);
  useEffect(() => {
    if (refreshOnOutcomeChange) return subscribeOutcomeRefresh(outcomeId, () => setAttempt((value) => value + 1));
  }, [outcomeId, refreshOnOutcomeChange]);
  useEffect(() => {
    let active = true;
    const cached = useCache ? getCachedResultSummary(outcomeId, revision.id) : undefined;
    // Keep any already-loaded report for the same revision visible while refreshing in the background.
    setState((current) =>
      current.key === targetKey
        ? current.failed
          ? { ...current, failed: false }
          : current
        : { key: targetKey, report: cached, failed: false }
    );
    void load(outcomeId, revision.revision).then(
      (value) => {
        if (!active) return;
        if (value && (value.outcomeId !== outcomeId || value.revisionId !== revision.id)) {
          setState({ key: targetKey, failed: true });
          return;
        }
        if (useCache) setCachedResultSummary(outcomeId, revision.id, value);
        setState({ key: targetKey, report: value, failed: false });
      },
      () => {
        if (active) {
          setState((current) =>
            current.key === targetKey && current.report !== undefined
              ? current
              : { key: targetKey, failed: true }
          );
        }
      },
    );
    return () => { active = false; };
  }, [load, outcomeId, revision.id, revision.revision, targetKey, attempt, useCache]);

  useEffect(() => {
    if (!readyRef.current && state.key === targetKey && (state.report !== undefined || state.failed)) {
      readyRef.current = true;
      onReady?.();
    }
  }, [state.key, targetKey, state.report, state.failed, onReady]);

  const failed = state.key === targetKey && state.failed;
  const report = state.key === targetKey ? state.report : undefined;

  if (failed) {
    return (
      <div className="outcome-now-line">
        <p role="status">{translateCurrent("The results summary is unavailable.")}</p>
        <OutcomeButton onClick={() => {
          setState({ key: targetKey, failed: false });
          setAttempt((value) => value + 1);
        }}>
          {translateCurrent("Try again")}
        </OutcomeButton>
      </div>
    );
  }
  if (!report) {
    if (report === null && hideWhenEmpty) return null;
    return (
      <p role="status">
        {report === null
          ? translateCurrent("No written results are available to summarize.")
          : translateCurrent("Summarizing the results…")}
      </p>
    );
  }
  return <OutcomeResultReportContent report={report} />;
}

const sourceLabels = {
  deterministic_check: "Deterministic check",
  human_confirmed: "Human confirmed",
  external_record: "External record",
  agent_report: "Agent report · advisory",
  ai_prereview: "AI prereview · advisory",
};

export function OutcomeResultReportContent({ report }: { report: OutcomeResultSummary }) {
  const hasCharts = Boolean(report.charts?.length);
  return (
    <div className="outcome-result-report" data-has-charts={hasCharts ? "true" : undefined}>
      <p className="outcome-now-eyebrow">{translateCurrent(report.reviewTurnId ? "Reviewer’s conclusion · advisory" : "Results summary · not reviewed")}</p>
      <div className={hasCharts ? "outcome-result-split" : undefined}>
        <div className="outcome-result-copy">
          <MessageResponse textOnly>{report.summary}</MessageResponse>
          {!!report.attention?.length && (
            <section aria-label={translateCurrent("Needs your attention")} className="outcome-result-attention">
              <strong>{translateCurrent("Needs your attention")}</strong>
              <ul className="outcome-brief-list">
                {report.attention.map((question, index) => <li key={index}>{question}</li>)}
              </ul>
            </section>
          )}
        </div>
        {hasCharts && (
          <div className="outcome-result-charts">
            {report.charts?.map((chart, index) => <OutcomeResultChartView key={index} chart={chart} />)}
          </div>
        )}
      </div>
      {(report.details || report.sources.length > 0) && (
        <details className="outcome-technical">
          <summary>{translateCurrent("Result details and sources")}</summary>
          {report.details && <MessageResponse textOnly>{report.details}</MessageResponse>}
          <ul className="outcome-brief-list">
            {report.sources.map(({ title, quote, credibility }, index) => (
              <li key={index}>
                <strong>{translateCurrent(credibility ? sourceLabels[credibility] : title)}</strong>
                <blockquote className="whitespace-pre-wrap">{quote}</blockquote>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
