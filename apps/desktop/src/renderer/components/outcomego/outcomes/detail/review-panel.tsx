import { useState } from "react";
import { REVIEW_RESULTS, type OutcomeDetail, type SubmitOutcomeReviewInput, type ReviewResult } from "@outcomego/contracts/outcomes";

type ReviewEntry = SubmitOutcomeReviewInput["results"][number];
export function initialReviewEntries(outcome: OutcomeDetail): Record<string, ReviewEntry> {
  return Object.fromEntries((outcome.currentRevisionView?.criteria ?? []).map(criterion => {
    const latest = outcome.reviews.filter(r => r.criterionId === criterion.id).sort((a, b) => b.sequence - a.sequence)[0];
    return [criterion.id, { criterionId: criterion.id, result: latest?.result ?? "UNVERIFIED", evidenceIds: latest?.evidenceIds ?? [], comment: latest?.comment ?? "", userConfirmed: false }];
  }));
}
export function ReviewPanel({ outcome, busy, onSubmit, onRework }: {
  outcome: OutcomeDetail; busy: boolean;
  onSubmit: (input: Omit<SubmitOutcomeReviewInput, "clientRequestId">) => void;
  onRework: (ids: string[], comment: string) => void;
}) {
  const [entries, setEntries] = useState(() => initialReviewEntries(outcome));
  const [references, setReferences] = useState<Record<string, string>>({});
  const [reworkIds, setReworkIds] = useState<string[]>([]); const [feedback, setFeedback] = useState("");
  const criteria = outcome.currentRevisionView?.criteria ?? [];
  const editable = outcome.currentRevisionView?.status === "approved" && !["accepted", "cancelled"].includes(outcome.status);
  const update = (id: string, changes: Partial<ReviewEntry>) => setEntries(current => ({ ...current, [id]: { ...current[id]!, ...changes } }));
  return <section aria-label="Review and rework" className="space-y-4">
    <h3 className="font-medium">Acceptance review</h3>
    <p className="text-sm text-muted-foreground">Agent reports and AI prereviews are advisory. Required PASS needs independent evidence or your explicit confirmation.</p>
    <fieldset disabled={busy || !editable} className="space-y-4">
      {criteria.map(criterion => {
        const entry = entries[criterion.id]!;
        const evidence = outcome.evidence.filter(e => e.contractRevision === outcome.currentRevision && (!e.criterionId || e.criterionId === criterion.id));
        return <div key={criterion.id} className="space-y-2 rounded-lg border p-3">
          <p>{criterion.ordinal}. {criterion.statement} · {criterion.required ? "Required" : "Optional"} · {criterion.latestResult ?? "UNVERIFIED"}</p>
          <label>Result<select aria-label={`Result for criterion ${criterion.ordinal}`} className="m-2 rounded border bg-background p-2" value={entry.result} onChange={e => update(criterion.id, { result: e.target.value as ReviewResult })}>{REVIEW_RESULTS.map(result => <option key={result}>{result}</option>)}</select></label>
          {evidence.map(e => <label key={e.id} className="flex gap-2 text-sm"><input type="checkbox" checked={entry.evidenceIds.includes(e.id)} onChange={event => update(criterion.id, { evidenceIds: event.target.checked ? [...entry.evidenceIds, e.id] : entry.evidenceIds.filter(id => id !== e.id) })} /><span>[{e.credibility}] {e.contentSummary || e.sourceRef}</span></label>)}
          {criterion.verificationMethod === "human_review" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={entry.userConfirmed ?? false} onChange={e => update(criterion.id, { userConfirmed: e.target.checked })} />I personally verified this criterion.</label>}
          <label className="block text-sm">Evidence URL (optional)<input aria-label={`Evidence URL for criterion ${criterion.ordinal}`} className="mt-1 w-full rounded border bg-background p-2" type="url" value={references[criterion.id] ?? ""} onChange={e => setReferences(current => ({ ...current, [criterion.id]: e.target.value }))} /></label>
          <label className="block text-sm">Review comment<textarea aria-label={`Comment for criterion ${criterion.ordinal}`} className="mt-1 w-full rounded border bg-background p-2" maxLength={4000} value={entry.comment} onChange={e => update(criterion.id, { comment: e.target.value })} /></label>
          {["FAIL", "UNVERIFIED"].includes(criterion.latestResult ?? "") && <label className="flex gap-2 text-sm"><input type="checkbox" checked={reworkIds.includes(criterion.id)} onChange={e => setReworkIds(current => e.target.checked ? [...current, criterion.id] : current.filter(id => id !== criterion.id))} />Include in rework</label>}
        </div>;
      })}
      <button className="rounded border px-3 py-2" disabled={!criteria.length} onClick={() => onSubmit({ expectedRevision: outcome.currentRevision!, results: criteria.map(c => entries[c.id]!), newEvidence: Object.entries(references).filter(([, ref]) => ref.trim()).map(([criterionId, sourceRef]) => ({ criterionId, sourceType: "url", sourceRef: sourceRef.trim(), contentSummary: "Source submitted by the owner during review" })) })}>Submit acceptance review</button>
      <div className="space-y-2 border-t pt-3"><label className="block">Rework feedback<textarea className="mt-1 w-full rounded border bg-background p-2" maxLength={4000} value={feedback} onChange={e => setFeedback(e.target.value)} /></label>
        <p className="text-xs">Rework keeps the approved contract unchanged. Use a new revision to change scope, acceptance or boundaries.</p>
        <button className="rounded border px-3 py-2" disabled={!reworkIds.length || !feedback.trim()} onClick={() => onRework(reworkIds, feedback)}>Request rework</button>
      </div>
    </fieldset>
  </section>;
}
