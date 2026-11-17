import { useRef, useState } from "react";
import { OUTCOME_PLANNING_DIMENSIONS, hasBlockingConflict, type PlanningDraftView, type OutcomeDetail } from "@outcomego/contracts/outcomes";
import { ContractConfirmation } from "./contract-confirmation";
import { type OutcomeClient, OutcomeRequestIds, outcomeErrorMessage } from "./outcome-client";
import { customPlanningEntries, emptySelections, planningConflicts, selectPlanningOption, selectionsFromPlan } from "./planning-state";

export function PlanningWizard({ botId, client, initialPlan, onSaved, onDone }: {
  botId: string; client: OutcomeClient; initialPlan?: PlanningDraftView;
  onSaved?: (value: { planId?: string; outcomeId?: string }) => void;
  onDone: (outcome: OutcomeDetail) => void;
}) {
  const [sourceText, setSourceText] = useState(initialPlan?.sourceText ?? "");
  const [title, setTitle] = useState(initialPlan?.sourceText.slice(0, 200) ?? "");
  const [draft, setDraft] = useState(initialPlan ?? null);
  const [selections, setSelections] = useState(initialPlan ? selectionsFromPlan(initialPlan) : emptySelections());
  const [step, setStep] = useState(0);
  const [time, setTime] = useState(""); const [cost, setCost] = useState("");
  const [outcome, setOutcome] = useState<OutcomeDetail | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const requestIds = useRef(new OutcomeRequestIds());
  const budget = !time && !cost ? null : { timeLimitMinutes: time ? Number(time) : null, costLimit: cost ? Number(cost) : null };
  const validBudget = (!time || Number.isInteger(Number(time)) && Number(time) > 0) && (!cost || Number.isFinite(Number(cost)) && Number(cost) > 0);
  const conflicts = draft ? planningConflicts(draft, selections, budget) : [];
  async function submit(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(null); try { await action(); } catch (e) { setError(outcomeErrorMessage(e)); } finally { setBusy(false); } }
  const dimension = OUTCOME_PLANNING_DIMENSIONS[Math.min(step, 2)]!;
  return <section aria-label="Outcome planning" className="space-y-4" aria-busy={busy}>
    <h2 className="text-lg font-semibold">Plan an Outcome</h2>
    {error && <p role="alert">{error}</p>}
    {!draft && <>
      <label className="block">Task description<textarea className="mt-1 min-h-24 w-full rounded border bg-background p-2" value={sourceText} maxLength={8000} disabled={busy} onChange={e => setSourceText(e.target.value)} /></label>
      <button className="rounded border px-3 py-2" disabled={busy || !sourceText.trim()} onClick={() => void submit(async () => {
        const plan = await client.plan({ sourceText, context: { botId }, clientRequestId: `plan:${crypto.randomUUID()}` });
        setDraft(plan); setSelections(selectionsFromPlan(plan)); setTitle(sourceText.trim().slice(0, 200)); onSaved?.({ planId: plan.planId });
      })}>{busy ? "Generating…" : "Generate planning options"}</button>
    </>}
    {draft && !outcome && <>
      <p className="text-sm text-muted-foreground">Step {step + 1} of 4 · {step < 3 ? dimension : "Contract and optional budget"}</p>
      {step < 3 ? <fieldset disabled={busy || draft.status !== "ready"} className="space-y-3">
        <legend className="mb-2 font-medium capitalize">{dimension}</legend>
        {draft[dimension].options.map(option => <div key={option.id} className="rounded border p-3">
          <label className="flex items-start gap-2"><input type="checkbox" checked={selections[dimension].selectedOptionIds.includes(option.id)} onChange={() => setSelections(current => selectPlanningOption(current, dimension, option.id))} /><span>{option.text}{option.kind === "excluded" ? " (excluded)" : ""}{option.required === false ? " (optional)" : ""}</span></label>
          {option.reason && <details className="mt-2 text-xs"><summary>Why recommended</summary>{option.reason}</details>}
        </div>)}
        <label className="block">Custom {dimension} entries (one per line, up to four)<textarea aria-label={`Custom ${dimension}`} className="mt-1 min-h-20 w-full rounded border bg-background p-2" maxLength={8000} value={selections[dimension].customEntries.join("\n")} onChange={e => setSelections(current => customPlanningEntries(current, dimension, e.target.value))} /></label>
      </fieldset> : <>
        <label className="block">Outcome title<input className="mt-1 w-full rounded border bg-background p-2" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} disabled={busy} /></label>
        <label className="block">Time limit in minutes (optional)<input aria-label="Time limit in minutes" className="m-2 rounded border bg-background p-2" type="number" min="1" step="1" value={time} onChange={e => setTime(e.target.value)} disabled={busy} /></label>
        <label className="block">Cost limit (optional)<input aria-label="Cost limit" className="m-2 rounded border bg-background p-2" type="number" min="0.01" step="any" value={cost} onChange={e => setCost(e.target.value)} disabled={busy} /></label>
        <p className="text-xs">Leave budget blank to skip. Budget does not automatically stop execution.</p>
        {conflicts.map((conflict, i) => <p key={i} role={conflict.severity === "blocking" ? "alert" : "status"}>{conflict.message}</p>)}
        <button className="rounded border px-3 py-2" disabled={busy || !title.trim() || !validBudget || hasBlockingConflict(conflicts) || draft.status !== "ready"} onClick={() => void submit(async () => {
          const input = { planId: draft.planId, title, ...selections, budget };
          const result = await client.create({ ...input, clientRequestId: requestIds.current.for("create", input) });
          setOutcome(result); onSaved?.({ outcomeId: result.id });
        })}>Create contract for confirmation</button>
      </>}
      {draft.status !== "ready" && <p role="alert">This plan is {draft.status}. Generate a new plan.</p>}
      <div className="flex gap-2"><button className="rounded border px-3 py-2" disabled={busy || step === 0} onClick={() => setStep(s => s - 1)}>Back</button><button className="rounded border px-3 py-2" disabled={busy || step === 3} onClick={() => setStep(s => s + 1)}>Next</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => { setDraft(null); setStep(0); }}>Start over</button></div>
    </>}
    {outcome?.currentRevisionView && <>
      <ContractConfirmation revision={outcome.currentRevisionView} busy={busy} confirmation={confirmation} onConfirmation={setConfirmation} onApprove={() => void submit(async () => {
        const input = { expectedRevision: outcome.currentRevision!, confirmationText: confirmation };
        const approved = await client.approve(outcome.id, outcome.currentRevision!, { ...input, clientRequestId: requestIds.current.for("approve", input) });
        setOutcome(approved); onDone(approved);
      })} />
      <button className="rounded border px-3 py-2" disabled={busy} onClick={() => onDone(outcome)}>Open Outcome details</button>
    </>}
  </section>;
}
