import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { OutcomeBrief, OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { useI18n } from "../../../../lib/i18n";
import { refreshOutcomeViews } from "../../../../lib/outcome-events";
import { OutcomeButton } from "../outcome-ui";
import { outcomeErrorMessage } from "../planning/outcome-client";
import { attentionVerbs, type AttentionRow } from "./dashboard-state";

export type GoalFocusClient = Partial<Pick<OutcomeClient, "get" | "brief" | "approve">>;

const CRITERIA_SHOWN = 3;

/**
 * What the owner needs to act on a goal that has no inbox decision: the proposed plan to approve, or the
 * reviewer's conclusion to accept. It reads the same saved goal and overview as the goal page, so the two
 * never disagree; whatever it cannot show falls back to the step's own text and the "open" button.
 */
export function GoalFocusDetail({
  row,
  outcomes,
  fallback,
  onOpen,
  onResolved,
}: {
  row: AttentionRow;
  outcomes: GoalFocusClient;
  /** The step's own lines, shown until (or instead of) richer content. */
  fallback: ReactNode;
  onOpen: () => void;
  onResolved: () => void;
}) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<OutcomeDetail | null>(null);
  const [brief, setBrief] = useState<OutcomeBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string>(crypto.randomUUID());
  useEffect(() => {
    if (!outcomes.get) return;
    let active = true;
    void outcomes.get(row.outcomeId).then(
      (detail) => {
        if (!active) return;
        setOutcome(detail);
        const revision = detail.currentRevisionView;
        if (revision?.status === "pending_approval" && outcomes.brief) {
          void outcomes.brief(row.outcomeId).then(
            (value) => {
              if (active && value.revisionId === revision.id) setBrief(value);
            },
            () => undefined,
          );
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [outcomes, row.outcomeId, row.since]);

  const revision = outcome?.currentRevisionView ?? null;
  const approving = outcome?.status === "pending_approval" && revision?.status === "pending_approval";
  const review = outcome?.prereview;
  const report = !approving && review && revision && review.revision === revision.revision ? review.report : undefined;

  async function approve() {
    if (!revision || !outcomes.approve || busy) return;
    setBusy(true);
    setError(null);
    try {
      await outcomes.approve(row.outcomeId, revision.revision, {
        expectedRevision: revision.revision,
        confirmationText: t("I approve the saved goals, acceptance criteria and scope."),
        clientRequestId: requestId.current,
      });
      requestId.current = crypto.randomUUID();
      toast.success(t("Plan approved"));
      refreshOutcomeViews();
      onResolved();
    } catch (cause) {
      setError(outcomeErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const openButton = (
    <OutcomeButton variant={approving && outcomes.approve ? "ghost" : "default"} onClick={onOpen}>
      {t(approving ? "View details" : attentionVerbs[row.category])}
      <ChevronRight aria-hidden="true" className="size-3.5" />
    </OutcomeButton>
  );

  let body: ReactNode = fallback;
  if (approving && revision) {
    const tasks = outcome?.plan?.tasks.length ?? 0;
    const criteria = revision.criteria;
    body = (
      <div className="outcome-dash-detail">
        <div className="outcome-plan-scope">
          <span className="outcome-plan-scope-label">{t("Proposed plan")}</span>
          <p>{brief?.intent.title ?? revision.goal[0]}</p>
        </div>
        {criteria.length > 0 && (
          <div className="outcome-dash-criteria">
            <span className="outcome-dash-criteria-label">
              {t("Acceptance criteria")} · {criteria.length}
              {tasks > 0 ? ` · ${t("{count} tasks", { count: tasks })}` : ""}
            </span>
            <ul>
              {criteria.slice(0, CRITERIA_SHOWN).map((criterion) => (
                <li key={criterion.id}>{criterion.statement}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  } else if (report) {
    body = (
      <div className="outcome-dash-detail">
        <p className="outcome-result-conclusion whitespace-pre-wrap">{report.summary}</p>
        {!!report.attention?.length && (
          <div className="outcome-result-attention">
            <strong className="outcome-result-attention-title">{t("Needs your attention")}</strong>
            <ul className="outcome-brief-list">
              {report.attention.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {body}
      {error && (
        <p role="alert" className="outcome-dash-quick-error">
          {error}
        </p>
      )}
      <div className="outcome-dash-focus-actions">
        {approving && outcomes.approve ? (
          <>
            <OutcomeButton variant="default" disabled={busy} onClick={() => void approve()}>
              {t(busy ? "Submitting…" : "Yes, approve")}
            </OutcomeButton>
            {openButton}
          </>
        ) : (
          openButton
        )}
      </div>
    </>
  );
}
