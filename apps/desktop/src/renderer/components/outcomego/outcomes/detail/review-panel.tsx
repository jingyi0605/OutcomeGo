import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  FileText,
  ListChecks,
  Paperclip,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import {
  ADVISORY_EVIDENCE_CREDIBILITY,
  REVIEW_RESULTS,
  OUTCOME_LIMITS,
  requiredCriteriaSatisfied,
} from "@outcomego/contracts/outcome-view";
import {
  OUTCOME_THREAD_TEXT_CHARS,
  type OutcomeThreadTurnView,
} from "@outcomego/contracts/outcome-thread";
import type {
  ContractRevisionView,
  EvidenceCredibility,
  EvidenceView,
  OutcomeDetail,
  OutputView,
  ReviewResult,
  SubmitOutcomeReviewInput,
} from "@outcomego/contracts/outcomes";
import { useOutcomeAttention } from "../../../../hooks/use-outcome-attention";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { translateCurrent } from "../../../../lib/i18n-catalog";
import { MessageResponse } from "../../../ai-elements/message";
import { OutcomeAsset } from "../outcome-asset";
import { outcomeAssetId } from "../outcome-asset-resource";
import { OutcomeSourceInfo } from "../outcome-source-info";
import { OutcomeButton } from "../outcome-ui";
import { OutcomeResultReport, OutcomeResultReportContent } from "./outcome-result-report";

type ReviewEntry = SubmitOutcomeReviewInput["results"][number];

const REVIEW_RESULT_LABELS: Record<ReviewResult, string> = {
  PASS: "PASS",
  FAIL: "FAIL",
  UNVERIFIED: "UNVERIFIED",
  WAIVED_BY_APPROVED_CHANGE: "WAIVED_BY_APPROVED_CHANGE",
};

const CREDIBILITY_LABELS: Record<EvidenceCredibility, string> = {
  deterministic_check: "Deterministic check",
  human_confirmed: "Human confirmed",
  external_record: "External record",
  agent_report: "Agent report · advisory",
  ai_prereview: "AI prereview · advisory",
};

type PrereviewSuggestion = "likely_pass" | "likely_fail" | "unclear";

const PREREVIEW_LABELS: Record<PrereviewSuggestion, string> = {
  likely_pass: "AI prereview: likely pass",
  likely_fail: "AI prereview: likely fail",
  unclear: "AI prereview: needs check",
};

const isAdvisoryCredibility = (credibility: EvidenceCredibility): boolean =>
  (ADVISORY_EVIDENCE_CREDIBILITY as readonly string[]).includes(credibility);

/** Extracts a concise plain-text preview from Markdown output without truncating with CSS. */
export function summarizeOutputContent(
  content: string | null | undefined,
  maxLength = 180
): { preview: string; truncated: boolean } {
  if (!content) return { preview: "", truncated: false };
  const cleaned = content
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^[-_=]{3,}$/.test(line) &&
        !/^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?$/.test(line)
    )
    .map((line) =>
      line
        .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+|\d+\.\s+)/, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^\|+|\|+$/g, "")
        .replace(/\s*\|\s*/g, " · ")
        .replace(/[`*_~]/g, "")
        .trim()
    )
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { preview: "", truncated: false };
  if (cleaned.length <= maxLength) return { preview: cleaned, truncated: false };
  const slice = cleaned.slice(0, maxLength);
  const boundary = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("。"), slice.lastIndexOf("，"));
  const cut = boundary > maxLength * 0.55 ? slice.slice(0, boundary) : slice;
  return { preview: `${cut.trim()}…`, truncated: true };
}

/** Parses server-stored `suggestion: reason` AI prereview summaries. */
export function parsePrereviewSummary(contentSummary: string): {
  suggestion: PrereviewSuggestion | null;
  reason: string;
} {
  const match = contentSummary.match(/^(likely_pass|likely_fail|unclear)\s*:\s*([\s\S]*)$/);
  if (!match) return { suggestion: null, reason: contentSummary };
  return {
    suggestion: match[1] as PrereviewSuggestion,
    reason: match[2]!.trim(),
  };
}

function resultState(result: ReviewResult): "met" | "unmet" | "unknown" {
  if (result === "PASS" || result === "WAIVED_BY_APPROVED_CHANGE") return "met";
  if (result === "FAIL") return "unmet";
  return "unknown";
}

function ResultIcon({ result }: { result: ReviewResult }) {
  const Icon = result === "PASS" ? Check : result === "FAIL" ? CircleAlert : Circle;
  return (
    <span className="outcome-brief-status" data-state={resultState(result)} data-result={result}>
      <Icon size={12} aria-hidden="true" />
      {translateCurrent(REVIEW_RESULT_LABELS[result])}
    </span>
  );
}

/** Every section stays mounted in the DOM so draft review edits survive collapsing. */
function ReviewSection({
  icon: Icon,
  label,
  preview,
  open,
  wideLabel = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  preview: ReactNode;
  open?: boolean;
  wideLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="outcome-brief-section" open={open}>
      <summary className={wideLabel ? "outcome-review-criterion-summary" : undefined}>
        <Icon size={15} aria-hidden="true" />
        <span className={wideLabel ? "outcome-review-criterion-title" : "outcome-brief-label"}>
          {label}
        </span>
        <span className="outcome-brief-preview">{preview}</span>
        <ChevronRight size={13} className="outcome-brief-chevron" aria-hidden="true" />
      </summary>
      <div className="outcome-brief-body">{children}</div>
    </details>
  );
}

function OutputDetails({ output, defaultOpen = false }: { output: OutputView; defaultOpen?: boolean }) {
  const kindLabel = translateCurrent(output.kind === "final_result" ? "Final deliverable" : "Generated file");
  return (
    <details className="outcome-review-output" open={defaultOpen}>
      <summary>
        <span className="outcome-review-output-title">{output.title}</span>
        <span className="outcome-review-output-kind">{kindLabel}</span>
      </summary>
      <div className="outcome-review-output-body space-y-2">
        {output.content && (
          <div className="outcome-source-content">
            <MessageResponse>{output.content}</MessageResponse>
          </div>
        )}
        <details className="outcome-technical">
          <summary>{translateCurrent("Source and execution records")}</summary>
          <p>{kindLabel}</p>
          {output.contentRef && <p className="break-all">{translateCurrent("Source")}: {output.contentRef}</p>}
          <p className="break-all text-xs">
            WorkItem {output.workItemId}
            {output.runId && ` · Run ${output.runId}`}
          </p>
        </details>
      </div>
    </details>
  );
}

function EvidenceChecklist({
  items,
  selectedIds,
  onToggle,
}: {
  items: EvidenceView[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="outcome-review-evidence-list">
      {items.map((e) => {
        const rawSummary = e.contentSummary || e.sourceRef;
        const snippet = summarizeOutputContent(rawSummary, 110);
        const sourceDetail = [
          rawSummary,
          "---",
          `${e.sourceType}: ${e.sourceRef}`,
          `Revision ${e.contractRevision} · ${e.capturedBy} · ${e.capturedAt}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        return (
          <li key={e.id} className="outcome-review-evidence-item" data-credibility={e.credibility}>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={selectedIds.includes(e.id)}
                onChange={() => onToggle(e.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="outcome-review-credibility">
                  {translateCurrent(CREDIBILITY_LABELS[e.credibility])}
                </span>{" "}
                <span>{snippet.preview || rawSummary}</span>
                {snippet.truncated && <OutcomeSourceInfo text={sourceDetail} name={translateCurrent("Evidence")} />}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function initialReviewEntries(
  outcome: OutcomeDetail,
  revision = outcome.currentRevisionView
): Record<string, ReviewEntry> {
  return Object.fromEntries(
    (revision?.criteria ?? []).map((criterion) => {
      const latest = outcome.reviews
        .filter((r) => r.criterionId === criterion.id && r.contractRevision === revision?.revision)
        .sort((a, b) => b.sequence - a.sequence)[0];
      return [
        criterion.id,
        {
          criterionId: criterion.id,
          result: latest?.result ?? "UNVERIFIED",
          evidenceIds: latest?.evidenceIds ?? [],
          comment: latest?.comment ?? "",
          userConfirmed: false,
        },
      ];
    })
  );
}

export function ReviewPanel({
  outcome,
  reviewRevisionView,
  loadResultSummary,
  busy,
  onSubmit,
  onAdoptPrereview,
  onRework,
  onClose,
  receiptReview = false,
  onApprove,
  onReject,
  onSendApprovalText,
  plannerWaiting = false,
  latestPlannerTurn = null,
  useCache = false,
  onReady,
}: {
  outcome: OutcomeDetail;
  busy: boolean;
  reviewRevisionView?: ContractRevisionView | null;
  loadResultSummary?: OutcomeClient["resultSummary"];
  onSubmit: (input: Omit<SubmitOutcomeReviewInput, "clientRequestId">) => void;
  onAdoptPrereview?: (turnId: string) => void;
  onRework: (ids: string[], comment: string) => void;
  onClose?: () => void;
  receiptReview?: boolean;
  onApprove?: () => void;
  onReject?: (reason: string) => void;
  onSendApprovalText?: (text: string) => Promise<boolean> | boolean | void;
  plannerWaiting?: boolean;
  latestPlannerTurn?: OutcomeThreadTurnView | null;
  useCache?: boolean;
  onReady?: () => void;
}) {
  const revision =
    reviewRevisionView === undefined ? outcome.currentRevisionView : reviewRevisionView;
  const [entries, setEntries] = useState(() => initialReviewEntries(outcome, revision));
  const attention = useOutcomeAttention({ surface: "review", outcomeId: outcome.id });
  const [references, setReferences] = useState<Record<string, string>>({});
  const [reworkIds, setReworkIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const hasApprovalText = Boolean(rejectionReason.trim());
  async function submitApprovalText() {
    if (!onSendApprovalText || busy || !hasApprovalText) return;
    const sent = await onSendApprovalText(rejectionReason);
    if (sent !== false) setRejectionReason("");
  }
  const criteria = revision?.criteria ?? [];
  const revisionWorkItems = outcome.workItems.filter(
    (item) => item.contractRevision === revision?.revision
  );
  const revisionOutputs = outcome.outputs.filter((output) =>
    revisionWorkItems.some((item) => item.id === output.workItemId)
  );
  const primaryOutput =
    [...revisionOutputs].reverse().find((output) => output.kind === "final_result") ??
    revisionOutputs[revisionOutputs.length - 1] ??
    null;
  const secondaryOutputs = primaryOutput
    ? revisionOutputs.filter((output) => output.id !== primaryOutput.id)
    : [];
  const revisionEvidence = outcome.evidence.filter(
    (e) => e.contractRevision === revision?.revision
  );
  const revisionEvidenceById = new Map(revisionEvidence.map((e) => [e.id, e]));
  const assetEvidence = revisionEvidence.filter(
    (e) => e.sourceType === "asset" && outcomeAssetId(e.sourceRef)
  );

  const prereviewByCriterion = new Map<
    string,
    { suggestion: PrereviewSuggestion | null; reason: string }
  >();
  for (const criterion of criteria) {
    const latestPrereview = [...revisionEvidence]
      .reverse()
      .find((e) => e.criterionId === criterion.id && e.credibility === "ai_prereview" && e.capturedBy === "system:outcome-prereview");
    if (latestPrereview) {
      prereviewByCriterion.set(
        criterion.id,
        parsePrereviewSummary(latestPrereview.contentSummary)
      );
    }
  }
  const reviewStates = criteria.map((criterion) => {
    const entry = entries[criterion.id]!;
    const evidenceCredibility = entry.evidenceIds
      .map((id) => revisionEvidenceById.get(id)?.credibility)
      .filter((credibility): credibility is EvidenceCredibility => Boolean(credibility));
    if (references[criterion.id]?.trim()) evidenceCredibility.push("human_confirmed");
    return {
      criterionId: criterion.id,
      required: criterion.required,
      result: entry.result,
      evidenceCredibility,
      userConfirmed: criterion.verificationMethod === "human_review" && entry.userConfirmed,
      waiverRevisionApproved:
        entry.result === "WAIVED_BY_APPROVED_CHANGE" && revision?.status === "approved",
    };
  });
  const allRequiredCriteriaSatisfied = requiredCriteriaSatisfied(reviewStates);

  const current = revision?.revision === outcome.currentRevision;
  const currentReview = outcome.prereview?.revision === revision?.revision ? outcome.prereview : undefined;
  const reviewStatus = current ? outcome.prereviewStatus : undefined;
  const suggestions = criteria.flatMap((criterion) => {
    const result = currentReview?.results.find((item) => item.criterionId === criterion.id);
    return result ? [{ criterion, result }] : [];
  });
  const needsAttention = ({ criterion, result }: (typeof suggestions)[number]) =>
    criterion.required && result.suggestion !== "likely_pass";
  const attentionResults = suggestions.filter(needsAttention);
  const otherSuggestions = suggestions.filter((item) => !needsAttention(item));
  const renderSuggestions = (items: typeof suggestions) => (
    <ul className="outcome-brief-list">
      {items.map(({ criterion, result }) => (
        <li key={criterion.id}>
          <strong className="outcome-criterion-title">{criterion.statement}</strong>
          <p className="outcome-prereview-note">
            <span className="outcome-prereview-badge" data-suggestion={result.suggestion}>
              {translateCurrent(PREREVIEW_LABELS[result.suggestion])}
            </span>
            {result.reason}
          </p>
        </li>
      ))}
    </ul>
  );
  const pendingSuccessor =
    ["draft", "pending_approval"].includes(outcome.currentRevisionView?.status ?? "") &&
    outcome.workItems.some(
      (item) =>
        item.executorType === "human" &&
        item.contractRevision === revision?.revision &&
        ["submitted", "review_pending"].includes(item.status)
    );
  const editable =
    revision?.status === "approved" &&
    (current || pendingSuccessor) &&
    !["accepted", "cancelled"].includes(outcome.status);
  const canReworkAny = criteria.some((c) => ["FAIL", "UNVERIFIED"].includes(c.latestResult ?? ""));
  const update = (id: string, changes: Partial<ReviewEntry>) =>
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id]!, ...changes } }));
  return (
    <section
      ref={attention.ref}
      aria-label={translateCurrent("Review and rework")}
      className="outcome-brief"
    >
      <div className="outcome-now">
        <div className="outcome-review-header">
          <p className="outcome-now-eyebrow" data-tone="action">{translateCurrent("Acceptance summary")}</p>
          {onClose && (
            <OutcomeButton variant="ghost" onClick={onClose}>
              {translateCurrent("Hide review")}
            </OutcomeButton>
          )}
        </div>
        {revision && !current && (
          <p role="status">
            {translateCurrent(
              "Reviewing receipt Contract revision {revision}. The newer unapproved Contract remains separate; the server verifies whether this receipt is still actionable.",
              { revision: revision.revision }
            )}
          </p>
        )}
        {reviewStatus === "pending" && <p role="status">{translateCurrent("The reviewer is checking the latest results.")}</p>}
        {reviewStatus === "stale" && <p role="status">{translateCurrent("The results changed. Suggestions from the previous review can no longer be adopted.")}</p>}
        {reviewStatus === "unreviewed" && <p role="status">{translateCurrent("The reviewer did not finish. You can still review the results yourself.")}</p>}
        {currentReview?.report ? <OutcomeResultReportContent report={currentReview.report} /> :
          !currentReview && reviewStatus !== "pending" && revision && loadResultSummary ? (
            <OutcomeResultReport outcomeId={outcome.id} revision={revision} load={loadResultSummary} useCache={useCache} onReady={onReady} hideWhenEmpty={reviewStatus === "stale"} />
          ) : null}
        {outcome.prereview && revision && (
          <section
            aria-label={translateCurrent("Preliminary review summary")}
            className="outcome-card mt-3 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="outcome-prereview-title">
                {translateCurrent("Preliminary review (revision {revision})", {
                  revision: outcome.prereview.revision,
                })}
              </p>
              {outcome.prereview.revision === revision.revision &&
                editable &&
                outcome.status === "review_pending" &&
                onAdoptPrereview &&
                outcome.prereview.results.some((r) => r.suggestion === "likely_pass") && (
                  <OutcomeButton
                    variant="default"
                    disabled={busy}
                    onClick={() => onAdoptPrereview(outcome.prereview!.turnId)}
                  >
                    {translateCurrent("Adopt likely-pass items")}
                  </OutcomeButton>
                )}
            </div>
            {outcome.prereview.revision !== revision.revision ? (
              <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
                {translateCurrent(
                  "This preliminary review is from revision {prerev} and cannot be adopted on revision {rev}. Review criteria individually.",
                  { prerev: outcome.prereview.revision, rev: revision.revision }
                )}
              </p>
            ) : (
              <>
                {!currentReview?.report && <p className="outcome-result-conclusion whitespace-pre-wrap">{outcome.prereview.summary}</p>}
                {attentionResults.length > 0 && renderSuggestions(attentionResults)}
                {otherSuggestions.length > 0 && (
                  <details className="outcome-technical">
                    <summary>{translateCurrent("Other review suggestions")}</summary>
                    {renderSuggestions(otherSuggestions)}
                  </details>
                )}
                {!currentReview?.report && outcome.prereview.attention.length > 0 && (
                  <div className="outcome-result-attention">
                    <strong className="outcome-result-attention-title">
                      {translateCurrent("Needs your attention")}
                    </strong>
                    <ul className="outcome-brief-list">
                      {outcome.prereview.attention.map((item, idx) => (
                        <li key={`${item.criterionId ?? "item"}-${idx}`}>{item.question}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {!receiptReview &&
          reviewStatus !== "pending" &&
          current &&
          editable &&
          outcome.status === "review_pending" &&
          (onApprove || onSendApprovalText || onReject) && (
            <section
              aria-label={translateCurrent("Result decision")}
              className="outcome-approval mt-4"
            >
              <label className="outcome-approval-comment">
                {translateCurrent(
                  onSendApprovalText ? "Approval feedback" : "Rejection reason (required to reject)"
                )}
                <textarea
                  aria-label={translateCurrent(
                    onSendApprovalText ? "Approval feedback" : "Rejection reason (required to reject)"
                  )}
                  className="outcome-control"
                  placeholder={translateCurrent(
                    onSendApprovalText
                      ? "Confirm completion or tell the planner what to fix, continue, or stop."
                      : "Tell the bot what to fix."
                  )}
                  maxLength={onSendApprovalText ? OUTCOME_THREAD_TEXT_CHARS : OUTCOME_LIMITS.commentChars}
                  rows={onSendApprovalText ? 2 : 1}
                  value={rejectionReason}
                  disabled={busy}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      onSendApprovalText &&
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey) &&
                      rejectionReason.trim() &&
                      !busy
                    ) {
                      event.preventDefault();
                      void submitApprovalText();
                    }
                  }}
                />
              </label>
              <div className="outcome-direct-buttons">
                {onApprove && (
                  <OutcomeButton
                    variant={onSendApprovalText && hasApprovalText ? "secondary" : "default"}
                    disabled={busy || plannerWaiting || (Boolean(onSendApprovalText) && hasApprovalText)}
                    onClick={onApprove}
                  >
                    {translateCurrent("Approve")}
                  </OutcomeButton>
                )}
                {onSendApprovalText ? (
                  <OutcomeButton
                    variant={hasApprovalText ? "default" : "secondary"}
                    disabled={busy || !hasApprovalText}
                    onClick={() => void submitApprovalText()}
                  >
                    {translateCurrent("Send to planner")}
                  </OutcomeButton>
                ) : onReject ? (
                  <OutcomeButton
                    disabled={busy || !hasApprovalText}
                    onClick={() => onReject(rejectionReason.trim())}
                  >
                    {translateCurrent("Reject")}
                  </OutcomeButton>
                ) : null}
              </div>
              {onSendApprovalText && hasApprovalText && !plannerWaiting && (
                <p className="outcome-approval-status">
                  {translateCurrent(
                    "Approval text will be sent to the planner to decide the next step. Clear the text to approve immediately."
                  )}
                </p>
              )}
              {plannerWaiting && (
                <p role="status" className="outcome-approval-status">
                  {translateCurrent("The planner is processing your approval feedback…")}
                </p>
              )}
              {!plannerWaiting && latestPlannerTurn?.status === "completed" && latestPlannerTurn.reply && (
                <div
                  className="outcome-card mt-2 space-y-1 text-xs"
                  aria-label={translateCurrent("Planner reply")}
                >
                  <p className="font-medium text-foreground-secondary">
                    {translateCurrent("Planner reply")}
                  </p>
                  <p className="whitespace-pre-wrap">{latestPlannerTurn.reply}</p>
                </div>
              )}
              {!plannerWaiting && latestPlannerTurn?.status === "failed" && (
                <p role="alert" className="outcome-approval-status text-destructive">
                  {latestPlannerTurn.error?.message ||
                    translateCurrent("The planner could not process your message.")}
                </p>
              )}
            </section>
          )}
        {!receiptReview && outcome.status === "accepted" && (
          <p>{translateCurrent("You accepted the result. Its outputs remain available.")}</p>
        )}
      </div>

      <div className="outcome-brief-facts">
        {revisionOutputs.length > 0 && (
          <ReviewSection
            icon={FileText}
            label={translateCurrent("Deliverables")}
            preview={translateCurrent("{count} outputs", { count: revisionOutputs.length })}
          >
            {primaryOutput && <OutputDetails output={primaryOutput} defaultOpen />}
            {secondaryOutputs.length > 0 && (
              <details className="outcome-technical">
                <summary>
                  {translateCurrent("Other outputs ({count})", { count: secondaryOutputs.length })}
                </summary>
                <div className="outcome-review-deliverable-list space-y-2">
                  {secondaryOutputs.map((output) => (
                    <OutputDetails key={output.id} output={output} />
                  ))}
                </div>
              </details>
            )}
          </ReviewSection>
        )}

        {assetEvidence.length > 0 && (
          <ReviewSection
            icon={Paperclip}
            label={translateCurrent("Attached review materials")}
            preview={translateCurrent("{count} attachments", { count: assetEvidence.length })}
          >
            <section aria-label={translateCurrent("Attached review materials")} className="space-y-3">
              {assetEvidence.map((e) => (
                <div key={e.id} className="space-y-2 outcome-card">
                  <p>{e.contentSummary || e.sourceRef}</p>
                  <OutcomeAsset sourceRef={e.sourceRef} />
                </div>
              ))}
            </section>
          </ReviewSection>
        )}
        {receiptReview && (
          <ReviewSection
            icon={ListChecks}
            label={translateCurrent("Review acceptance criteria")}
            preview={null}
            wideLabel
          >
            <fieldset disabled={busy || !editable}>
              <p className="text-muted-foreground">
                {translateCurrent(
                  "Agent reports and AI prereviews are advisory. Required PASS needs independent evidence or your explicit confirmation."
                )}
              </p>
              <div>
                {criteria.map((criterion) => {
                  const entry = entries[criterion.id]!;
                  const evidence = revisionEvidence.filter(
                    (e) => !e.criterionId || e.criterionId === criterion.id
                  );
                  const independentEvidence = evidence.filter(
                    (e) => !isAdvisoryCredibility(e.credibility)
                  );
                  const advisoryEvidence = evidence.filter((e) => isAdvisoryCredibility(e.credibility) &&
                    (e.credibility !== "ai_prereview" || e.capturedBy === "system:outcome-prereview"));
                  const prereviewSuggestion =
                    outcome.prereview?.revision === revision?.revision
                      ? outcome.prereview?.results.find((r) => r.criterionId === criterion.id)
                      : undefined;
                  const prereview = prereviewSuggestion
                    ? { suggestion: prereviewSuggestion.suggestion, reason: prereviewSuggestion.reason }
                    : !reviewStatus ? prereviewByCriterion.get(criterion.id) : undefined;
                  const hasAttentionPrereview =
                    prereview?.suggestion === "likely_fail" || prereview?.suggestion === "unclear";
                  const hasExtraInputs =
                    entry.result === "FAIL" ||
                    Boolean(references[criterion.id]?.trim()) ||
                    Boolean(entry.comment.trim()) ||
                    reworkIds.includes(criterion.id);
                  const CriterionIcon =
                    entry.result === "PASS" || entry.result === "WAIVED_BY_APPROVED_CHANGE"
                      ? Check
                      : entry.result === "FAIL"
                        ? CircleAlert
                        : Circle;

                  return (
                    <ReviewSection
                      key={criterion.id}
                      icon={CriterionIcon}
                      wideLabel
                      open={hasAttentionPrereview ? true : undefined}
                      label={`${criterion.ordinal}. ${criterion.statement}`}
                      preview={
                        <>
                          <span>{translateCurrent(criterion.required ? "Required" : "Optional")}</span>
                          <ResultIcon result={entry.result} />
                          {prereview?.suggestion && (
                            <span>{translateCurrent(PREREVIEW_LABELS[prereview.suggestion])}</span>
                          )}
                          {entry.userConfirmed && <span>{translateCurrent("Confirmed")}</span>}
                          {reworkIds.includes(criterion.id) && (
                            <span>{translateCurrent("Selected for rework")}</span>
                          )}
                        </>
                      }
                    >
                      <div className="space-y-3">
                        {prereview && (
                          <div className="outcome-review-prereview">
                            <span className="outcome-review-credibility">
                              {translateCurrent(
                                prereview.suggestion
                                  ? PREREVIEW_LABELS[prereview.suggestion]
                                  : "AI prereview · advisory"
                              )}
                            </span>
                            {prereview.reason && <p>{prereview.reason}</p>}
                          </div>
                        )}
                        <div className="outcome-review-controls">
                          <label>
                            {translateCurrent("Result")}
                            <select
                              aria-label={`Result for criterion ${criterion.ordinal}`}
                              className="outcome-control"
                              value={entry.result}
                              onChange={(e) =>
                                update(criterion.id, { result: e.target.value as ReviewResult })
                              }
                            >
                              {REVIEW_RESULTS.map((result) => (
                                <option key={result} value={result}>
                                  {translateCurrent(REVIEW_RESULT_LABELS[result])}
                                </option>
                              ))}
                            </select>
                          </label>
                          {criterion.verificationMethod === "human_review" && (
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={entry.userConfirmed ?? false}
                                onChange={() =>
                                  update(criterion.id, { userConfirmed: !(entry.userConfirmed ?? false) })
                                }
                              />
                              {translateCurrent("I personally verified this criterion.")}
                            </label>
                          )}
                        </div>

                        {independentEvidence.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-foreground-secondary">
                              {translateCurrent("Independent evidence")}
                            </p>
                            <EvidenceChecklist
                              items={independentEvidence}
                              selectedIds={entry.evidenceIds}
                              onToggle={(id) =>
                                update(criterion.id, {
                                  evidenceIds: entry.evidenceIds.includes(id)
                                    ? entry.evidenceIds.filter((item) => item !== id)
                                    : [...entry.evidenceIds, id],
                                })
                              }
                            />
                          </div>
                        )}

                        {advisoryEvidence.length > 0 && (
                          <details
                            className="outcome-technical"
                            open={advisoryEvidence.some((e) => entry.evidenceIds.includes(e.id))}
                          >
                            <summary>
                              {translateCurrent("Advisory reports and AI prereview ({count})", {
                                count: advisoryEvidence.length,
                              })}
                            </summary>
                            <EvidenceChecklist
                              items={advisoryEvidence}
                              selectedIds={entry.evidenceIds}
                              onToggle={(id) =>
                                update(criterion.id, {
                                  evidenceIds: entry.evidenceIds.includes(id)
                                    ? entry.evidenceIds.filter((item) => item !== id)
                                    : [...entry.evidenceIds, id],
                                })
                              }
                            />
                          </details>
                        )}

                        <details className="outcome-technical" open={hasExtraInputs}>
                          <summary>{translateCurrent("Comment, evidence link or rework")}</summary>
                          <div className="mt-2 space-y-2.5">
                            <label className="block text-xs">
                              {translateCurrent("Evidence URL (optional)")}
                              <input
                                aria-label={`Evidence URL for criterion ${criterion.ordinal}`}
                                className="mt-1 w-full outcome-control"
                                type="url"
                                value={references[criterion.id] ?? ""}
                                onChange={(e) =>
                                  setReferences((prev) => ({
                                    ...prev,
                                    [criterion.id]: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="block text-xs">
                              {translateCurrent("Review comment")}
                              <textarea
                                aria-label={`Comment for criterion ${criterion.ordinal}`}
                                className="mt-1 w-full outcome-control"
                                maxLength={4000}
                                value={entry.comment}
                                onChange={(e) => update(criterion.id, { comment: e.target.value })}
                              />
                            </label>
                            {current && ["FAIL", "UNVERIFIED"].includes(criterion.latestResult ?? "") && (
                              <label className="flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={reworkIds.includes(criterion.id)}
                                  onChange={() =>
                                    setReworkIds((prev) =>
                                      prev.includes(criterion.id)
                                        ? prev.filter((id) => id !== criterion.id)
                                        : [...prev, criterion.id]
                                    )
                                  }
                                />
                                {translateCurrent("Include in rework")}
                              </label>
                            )}
                          </div>
                        </details>
                      </div>
                    </ReviewSection>
                  );
                })}

                {current && (
                  <ReviewSection
                    icon={RotateCcw}
                    label={translateCurrent("Rework")}
                    open={reworkIds.length > 0}
                    preview={
                      reworkIds.length > 0
                        ? translateCurrent("{count} criteria selected for rework", {
                            count: reworkIds.length,
                          })
                        : translateCurrent(
                            canReworkAny
                              ? "Select failed or unverified criteria to request rework"
                              : "Submit FAIL or UNVERIFIED review first to enable rework"
                          )
                    }
                  >
                    <div className="space-y-2.5">
                      <label className="block text-xs">
                        {translateCurrent("Rework feedback")}
                        <textarea
                          className="mt-1 w-full outcome-control"
                          maxLength={4000}
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {translateCurrent(
                          "Rework keeps the approved contract unchanged. Use a new revision to change scope, acceptance or boundaries."
                        )}
                      </p>
                      <OutcomeButton
                        variant="secondary"
                        disabled={!reworkIds.length || !feedback.trim()}
                        onClick={() => onRework(reworkIds, feedback)}
                      >
                        {translateCurrent("Request rework")}
                      </OutcomeButton>
                    </div>
                  </ReviewSection>
                )}
              </div>

              <footer className="outcome-review-footer">
                <p className="text-xs text-muted-foreground">
                  {editable
                    ? translateCurrent(
                        allRequiredCriteriaSatisfied
                          ? "All required criteria are satisfied. Submit to record your review."
                          : "Required criteria still need PASS with independent evidence or your confirmation."
                      )
                    : outcome.status === "accepted"
                      ? translateCurrent("You accepted the result. Its outputs remain available.")
                      : outcome.status === "cancelled"
                        ? translateCurrent("This goal has stopped. Its records remain available.")
                        : ""}
                </p>
                <OutcomeButton
                  variant="default"
                  disabled={!criteria.length}
                  onClick={() =>
                    onSubmit({
                      expectedRevision: revision!.revision,
                      results: criteria.map((c) => entries[c.id]!),
                      newEvidence: Object.entries(references)
                        .filter(([, ref]) => ref.trim())
                        .map(([criterionId, sourceRef]) => ({
                          criterionId,
                          sourceType: "url",
                          sourceRef: sourceRef.trim(),
                          contentSummary: "Source submitted by the owner during review",
                        })),
                    })
                  }
                >
                  {translateCurrent("Submit acceptance review")}
                </OutcomeButton>
              </footer>
            </fieldset>
          </ReviewSection>
        )}
      </div>
    </section>
  );
}
