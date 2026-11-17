import { useEffect, useRef, useState } from "react";
import type { OutcomeDetail as OutcomeDetailView, ContractRevisionView } from "@outcomego/contracts/outcomes";
import { ContractConfirmation } from "../planning/contract-confirmation";
import { type OutcomeClient, OutcomeRequestIds, outcomeErrorMessage } from "../planning/outcome-client";
import { ContractEditor } from "./contract-editor";
import { ReviewPanel } from "./review-panel";
import { RevisionHistory, revisionMaterialLabel } from "./revision-history";
import { RecoveryDiagnostics } from "../inbox/recovery-diagnostics";
import { responseStatus } from "../inbox/decision-state";
import { translateCurrent } from "../../../../lib/i18n-catalog";

export const evidenceCredibilityLabels = {
  deterministic_check: "Deterministic check", human_confirmed: "Human confirmed", external_record: "External record",
  agent_report: "Agent report · advisory", ai_prereview: "AI prereview · advisory",
} as const;
export function OutcomeDetail({ outcomeId, client, initialOutcome, reviewRevision }: { outcomeId: string; client: OutcomeClient; initialOutcome?: OutcomeDetailView; reviewRevision?: number }) {
  const [outcome, setOutcome] = useState(initialOutcome ?? null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(""); const [transcript, setTranscript] = useState<unknown>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestIds = useRef(new OutcomeRequestIds());
  const generation = useRef(0);
  const [reviewView, setReviewView] = useState<ContractRevisionView | null>(null);
  const [reviewError, setReviewError] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewReload, setReviewReload] = useState(0);
  const historicalReview = reviewRevision !== undefined && outcome?.currentRevision !== reviewRevision;
  useEffect(() => {
    if (!historicalReview || reviewRevision === undefined) return;
    let active = true;
    setReviewView(null); setReviewLoading(true); setReviewError(false);
    if (!client.getRevision) { setReviewLoading(false); setReviewError(true); return; }
    void client.getRevision(outcomeId, reviewRevision).then(value => {
      if (active) {
        if (value.revision === reviewRevision) setReviewView(value);
        else setReviewError(true);
      }
    }, () => { if (active) setReviewError(true); }).finally(() => { if (active) setReviewLoading(false); });
    return () => { active = false; };
  }, [client, outcomeId, reviewRevision, historicalReview, refreshVersion, reviewReload]);
  useEffect(() => {
    const request = ++generation.current;
    void client.get(outcomeId).then(result => { if (generation.current === request) { setOutcome(result); setRefreshVersion(v => v + 1); } }, e => { if (generation.current === request) setError(outcomeErrorMessage(e)); });
    return () => { generation.current++; };
  }, [outcomeId, client]);
  async function mutate(action: string, input: unknown, operation: (key: string) => Promise<OutcomeDetailView>) {
    if (busy) return; generation.current++; setBusy(true); setError(null);
    try {
      const result = await operation(requestIds.current.for(`${action}:${outcomeId}`, input));
      setOutcome(result); setRefreshVersion(v => v + 1); requestIds.current.complete(`${action}:${outcomeId}`);
    } catch (e) {
      setError(outcomeErrorMessage(e));
      if (responseStatus(e) === 409) {
        try { setOutcome(await client.get(outcomeId)); setRefreshVersion(value => value + 1); }
        catch { /* Retain the conflict until an authenticated refresh succeeds. */ }
      }
    }
    finally { setBusy(false); }
  }
  if (!outcome) return <section>{error ? <p role="alert">{error}</p> : <p role="status">Loading Outcome…</p>}<button onClick={() => void mutate("refresh", {}, () => client.get(outcomeId))}>Retry</button></section>;
  const revision = outcome.currentRevisionView;
  const selectedReview = historicalReview ? reviewView?.revision === reviewRevision ? reviewView : null : revision;
  const terminal = ["accepted", "cancelled"].includes(outcome.status);
  return <article aria-label="Outcome details" aria-busy={busy} className="space-y-5">
    <header className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{outcome.title}</h2><p>{outcome.status} · revision {outcome.currentRevision}</p></div><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void mutate("refresh", {}, () => client.get(outcomeId))}>Refresh from server</button></header>
    {error && <p role="alert">{error}</p>}
    <p className="whitespace-pre-wrap">{outcome.description}</p>
    {revision && <ContractConfirmation revision={revision} busy={busy} confirmation={confirmation} onConfirmation={setConfirmation} onApprove={() => {
      const input = { expectedRevision: revision.revision, confirmationText: confirmation };
      void mutate("approve", input, clientRequestId => client.approve(outcomeId, revision.revision, { ...input, clientRequestId }));
    }} />}
    {revision && !terminal && <ContractEditor key={revision.id} revision={revision} busy={busy} onSave={input => void mutate("revision", input, clientRequestId => client.revise(outcomeId, { ...input, clientRequestId }))} />}
    <RevisionHistory outcome={outcome} />
    {revision?.status === "approved" && !terminal && !outcome.workItems.some(i => i.contractRevision === revision.revision) && <button className="rounded border px-3 py-2" disabled={busy} onClick={() => {
      const input = { expectedRevision: revision.revision }; void mutate("start", input, clientRequestId => client.start(outcomeId, { ...input, clientRequestId }));
    }}>Start approved Outcome</button>}
    <section className="space-y-2"><h3 className="font-medium">Work items</h3>{outcome.workItems.map(item => <div key={item.id} className="rounded border p-3"><p>{item.title} · {item.executorType} · {item.kind} · revision {item.contractRevision} · {item.status}</p>{item.statusReason && <p>{item.statusReason}</p>}<p className="break-all text-xs">WorkItem {item.id}{item.rootRunId && ` · Root Run ${item.rootRunId}`}</p>{item.runIds.length > 0 && <p className="break-all text-xs">Runs: {item.runIds.join(", ")}</p>}{item.reworkOfWorkItemId && <p className="break-all text-xs">Rework of {item.reworkOfWorkItemId}</p>}{item.executorType === "agent" && <button disabled={busy} onClick={() => { setError(null); void client.transcript(outcomeId, item.id).then(setTranscript, e => setError(outcomeErrorMessage(e))); }}>Show read-only transcript</button>}</div>)}</section>
    {transcript !== null && <details open><summary>Read-only transcript</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(transcript, null, 2)}</pre><button onClick={() => setTranscript(null)}>Close transcript</button></details>}
    <section className="space-y-2"><h3 className="font-medium">Outputs</h3>{outcome.outputs.map(output => <div key={output.id} className="rounded border p-3"><h4>{output.title} · {output.kind}</h4><p className="text-xs">{revisionMaterialLabel(outcome.workItems.find(item => item.id === output.workItemId)?.contractRevision ?? null, outcome.currentRevision)}</p>{output.content && <p className="whitespace-pre-wrap">{output.content}</p>}{output.contentRef && <p className="break-all">Source: {output.contentRef}</p>}<p className="break-all text-xs">WorkItem {output.workItemId}{output.runId && ` · Run ${output.runId}`}</p></div>)}</section>
    <section className="space-y-2"><h3 className="font-medium">Evidence</h3>{outcome.evidence.map(e => <div key={e.id} className="rounded border p-3"><span className="rounded bg-muted px-2 py-1 text-xs">{evidenceCredibilityLabels[e.credibility]}</span><p className="mt-2 whitespace-pre-wrap">{e.contentSummary}</p><p className="text-xs">{revisionMaterialLabel(e.contractRevision, outcome.currentRevision)}</p><p className="break-all text-xs">{e.sourceType}: {e.sourceRef} · revision {e.contractRevision} · {e.capturedBy} · {e.capturedAt}</p></div>)}</section>
    {historicalReview && <section aria-label={translateCurrent("Receipt Contract revision")} className="space-y-2 rounded border p-3">
      <p>{translateCurrent("Receipt review uses Contract revision {revision}. The current Contract stays at revision {current}.", { revision: reviewRevision, current: outcome.currentRevision })}</p>
      {reviewLoading && <p role="status">{translateCurrent("Loading the receipt's original Contract…")}</p>}
      {reviewError && <p role="alert">{translateCurrent("Could not load the receipt's Contract. Review is disabled until its actual criteria are available.")}</p>}
      <button className="rounded border px-3 py-2" disabled={reviewLoading} onClick={() => setReviewReload(value => value + 1)}>{translateCurrent("Reload receipt Contract")}</button>
    </section>}
    {selectedReview && <ReviewPanel key={`${selectedReview.id}:${refreshVersion}`} outcome={outcome} reviewRevisionView={selectedReview} busy={busy || reviewLoading} onSubmit={input => void mutate("review", input, clientRequestId => client.review(outcomeId, { ...input, clientRequestId }))} onRework={(criterionIds, comment) => {
      const input = { criterionIds, comment, expectedRevision: selectedReview.revision };
      void mutate("rework", input, clientRequestId => client.rework(outcomeId, { ...input, clientRequestId }));
    }} />}
    <details><summary>Review history</summary>{outcome.reviews.map(r => <p key={r.id}>{revisionMaterialLabel(r.contractRevision, outcome.currentRevision)} · {r.criterionId} · #{r.sequence} · {r.result} · {r.comment} · {r.reviewedBy}</p>)}</details>
    <RecoveryDiagnostics outcomeId={outcomeId} />
    {!terminal && <button className="rounded border px-3 py-2" disabled={busy} onClick={() => void mutate("cancel", {}, clientRequestId => client.cancel(outcomeId, { clientRequestId }))}>Cancel Outcome</button>}
  </article>;
}
