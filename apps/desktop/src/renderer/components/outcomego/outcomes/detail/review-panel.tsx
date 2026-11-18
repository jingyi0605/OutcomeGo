import { useState } from "react";
import {
  REVIEW_RESULTS,
  type OutcomeDetail,
  type SubmitOutcomeReviewInput,
  type ReviewResult,
  type ContractRevisionView,
} from "@outcomego/contracts/outcomes";
import { useOutcomeAttention } from "../../../../hooks/use-outcome-attention";
import { translateCurrent } from "../../../../lib/i18n-catalog";
import { OutcomeAsset } from "../outcome-asset";
import { outcomeAssetId } from "../outcome-asset-resource";

type ReviewEntry = SubmitOutcomeReviewInput["results"][number];
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
  busy,
  onSubmit,
  onRework,
}: {
  outcome: OutcomeDetail;
  busy: boolean;
  reviewRevisionView?: ContractRevisionView | null;
  onSubmit: (input: Omit<SubmitOutcomeReviewInput, "clientRequestId">) => void;
  onRework: (ids: string[], comment: string) => void;
}) {
  const revision =
    reviewRevisionView === undefined ? outcome.currentRevisionView : reviewRevisionView;
  const [entries, setEntries] = useState(() => initialReviewEntries(outcome, revision));
  const attention = useOutcomeAttention({ surface: "review", outcomeId: outcome.id });
  const [references, setReferences] = useState<Record<string, string>>({});
  const [reworkIds, setReworkIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const criteria = revision?.criteria ?? [];
  const assetEvidence = outcome.evidence.filter(
    (e) =>
      e.contractRevision === revision?.revision &&
      e.sourceType === "asset" &&
      outcomeAssetId(e.sourceRef)
  );
  const current = revision?.revision === outcome.currentRevision;
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
  const update = (id: string, changes: Partial<ReviewEntry>) =>
    setEntries((current) => ({ ...current, [id]: { ...current[id]!, ...changes } }));
  return (
    <section ref={attention.ref} aria-label="Review and rework" className="space-y-4">
      <h3 className="font-medium">Acceptance review</h3>
      {revision && !current && (
        <p role="status">
          {translateCurrent(
            "Reviewing receipt Contract revision {revision}. The newer unapproved Contract remains separate; the server verifies whether this receipt is still actionable.",
            { revision: revision.revision }
          )}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Agent reports and AI prereviews are advisory. Required PASS needs independent evidence or
        your explicit confirmation.
      </p>
      {assetEvidence.length > 0 && (
        <section aria-label={translateCurrent("Attached review materials")} className="space-y-3">
          <h4 className="font-medium">{translateCurrent("Attached review materials")}</h4>
          {assetEvidence.map((e) => (
            <div key={e.id} className="space-y-2 outcome-card">
              <p>{e.contentSummary || e.sourceRef}</p>
              <OutcomeAsset sourceRef={e.sourceRef} />
            </div>
          ))}
        </section>
      )}
      <fieldset disabled={busy || !editable} className="space-y-4">
        {criteria.map((criterion) => {
          const entry = entries[criterion.id]!;
          const evidence = outcome.evidence.filter(
            (e) =>
              e.contractRevision === revision?.revision &&
              (!e.criterionId || e.criterionId === criterion.id)
          );
          return (
            <div key={criterion.id} className="space-y-2 outcome-card">
              <p>
                {criterion.ordinal}. {criterion.statement} ·{" "}
                {criterion.required ? "Required" : "Optional"} ·{" "}
                {criterion.latestResult ?? "UNVERIFIED"}
              </p>
              <label>
                Result
                <select
                  aria-label={`Result for criterion ${criterion.ordinal}`}
                  className="outcome-control ml-2"
                  value={entry.result}
                  onChange={(e) => update(criterion.id, { result: e.target.value as ReviewResult })}
                >
                  {REVIEW_RESULTS.map((result) => (
                    <option key={result}>{result}</option>
                  ))}
                </select>
              </label>
              {evidence.map((e) => (
                <label key={e.id} className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.evidenceIds.includes(e.id)}
                    onChange={(event) =>
                      update(criterion.id, {
                        evidenceIds: event.target.checked
                          ? [...entry.evidenceIds, e.id]
                          : entry.evidenceIds.filter((id) => id !== e.id),
                      })
                    }
                  />
                  <span>
                    [{e.credibility}] {e.contentSummary || e.sourceRef}
                  </span>
                </label>
              ))}
              {criterion.verificationMethod === "human_review" && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.userConfirmed ?? false}
                    onChange={(e) => update(criterion.id, { userConfirmed: e.target.checked })}
                  />
                  I personally verified this criterion.
                </label>
              )}
              <label className="block text-sm">
                Evidence URL (optional)
                <input
                  aria-label={`Evidence URL for criterion ${criterion.ordinal}`}
                  className="mt-1 w-full outcome-control"
                  type="url"
                  value={references[criterion.id] ?? ""}
                  onChange={(e) =>
                    setReferences((current) => ({ ...current, [criterion.id]: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                Review comment
                <textarea
                  aria-label={`Comment for criterion ${criterion.ordinal}`}
                  className="mt-1 w-full outcome-control"
                  maxLength={4000}
                  value={entry.comment}
                  onChange={(e) => update(criterion.id, { comment: e.target.value })}
                />
              </label>
              {current && ["FAIL", "UNVERIFIED"].includes(criterion.latestResult ?? "") && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reworkIds.includes(criterion.id)}
                    onChange={(e) =>
                      setReworkIds((current) =>
                        e.target.checked
                          ? [...current, criterion.id]
                          : current.filter((id) => id !== criterion.id)
                      )
                    }
                  />
                  Include in rework
                </label>
              )}
            </div>
          );
        })}
        <button
          className="outcome-control"
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
          Submit acceptance review
        </button>
        {current && (
          <div className="space-y-2 border-t pt-3">
            <label className="block">
              Rework feedback
              <textarea
                className="mt-1 w-full outcome-control"
                maxLength={4000}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </label>
            <p className="text-xs">
              Rework keeps the approved contract unchanged. Use a new revision to change scope,
              acceptance or boundaries.
            </p>
            <button
              className="outcome-control"
              disabled={!reworkIds.length || !feedback.trim()}
              onClick={() => onRework(reworkIds, feedback)}
            >
              Request rework
            </button>
          </div>
        )}
      </fieldset>
    </section>
  );
}
