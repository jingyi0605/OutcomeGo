import { useEffect, useState } from "react";
import type { ContractRevisionView, OutcomeResultSummary } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { translateCurrent } from "../../../../lib/i18n-catalog";
import { MessageResponse } from "../../../ai-elements/message";
import { OutcomeButton } from "../outcome-ui";
import { OutcomeResultChartView } from "./outcome-result-chart";

export function OutcomeResultReport({
  outcomeId,
  revision,
  load,
}: {
  outcomeId: string;
  revision: ContractRevisionView;
  load: NonNullable<OutcomeClient["resultSummary"]>;
}) {
  const [report, setReport] = useState<OutcomeResultSummary | null>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void load(outcomeId, revision.revision).then(
      (value) => {
        if (!active) return;
        if (value && (value.outcomeId !== outcomeId || value.revisionId !== revision.id)) {
          setFailed(true);
          return;
        }
        setReport(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => { active = false; };
  }, [load, outcomeId, revision.id, revision.revision, attempt]);

  if (failed) {
    return (
      <div className="outcome-now-line">
        <p role="status">{translateCurrent("The results summary is unavailable.")}</p>
        <OutcomeButton onClick={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}>
          {translateCurrent("Try again")}
        </OutcomeButton>
      </div>
    );
  }
  if (!report) {
    return (
      <p role="status">
        {report === null
          ? translateCurrent("No written results are available to summarize.")
          : translateCurrent("Summarizing the results…")}
      </p>
    );
  }
  return (
    <div className="outcome-result-report">
      {Boolean(report.charts?.length) && (
        <div className="outcome-result-charts">
          {report.charts?.map((chart, index) => <OutcomeResultChartView key={index} chart={chart} />)}
        </div>
      )}
      <MessageResponse textOnly>{report.summary}</MessageResponse>
      <details className="outcome-technical">
        <summary>{translateCurrent("Result details and sources")}</summary>
        {report.details && <MessageResponse textOnly>{report.details}</MessageResponse>}
        <ul className="outcome-brief-list">
          {report.sources.map(({ title, quote }, index) => (
            <li key={index}>
              <strong>{title}</strong>
              <blockquote className="whitespace-pre-wrap">{quote}</blockquote>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
