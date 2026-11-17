import { useState } from "react";
import type { ContractRevisionView, CreateContractRevisionInput } from "@outcomego/contracts/outcomes";

const lines = (text: string) => text.split("\n").map(line => line.trim()).filter(Boolean);
export function ContractEditor({ revision, busy, onSave }: {
  revision: ContractRevisionView; busy: boolean; onSave: (input: Omit<CreateContractRevisionInput, "clientRequestId">) => void;
}) {
  const [goal, setGoal] = useState(revision.goal.join("\n"));
  const [included, setIncluded] = useState(revision.boundaries.included.join("\n"));
  const [excluded, setExcluded] = useState(revision.boundaries.excluded.join("\n"));
  const [acceptance, setAcceptance] = useState(revision.criteria.map(c => ({ statement: c.statement, required: c.required })));
  const [summary, setSummary] = useState("");
  return <details className="rounded border p-3"><summary>Edit contract as a new revision</summary><fieldset disabled={busy} className="mt-3 space-y-3">
    <p className="text-xs">Approved snapshots and their evidence remain in history.</p>
    <label className="block">Goals (one per line)<textarea className="mt-1 w-full rounded border bg-background p-2" value={goal} onChange={e => setGoal(e.target.value)} /></label>
    <p>Acceptance criteria</p>{acceptance.map((c, index) => <div key={index} className="flex gap-2"><input aria-label={`Criterion ${index + 1} statement`} className="min-w-0 flex-1 rounded border bg-background p-2" value={c.statement} onChange={e => setAcceptance(current => current.map((entry, i) => i === index ? { ...entry, statement: e.target.value } : entry))} /><label className="flex items-center gap-1"><input type="checkbox" checked={c.required} onChange={e => setAcceptance(current => current.map((entry, i) => i === index ? { ...entry, required: e.target.checked } : entry))} />Required</label><button onClick={() => setAcceptance(current => current.filter((_, i) => i !== index))}>Remove</button></div>)}
    <button disabled={acceptance.length >= 20} onClick={() => setAcceptance(current => [...current, { statement: "", required: true }])}>Add criterion</button>
    <label className="block">Included boundaries<textarea className="mt-1 w-full rounded border bg-background p-2" value={included} onChange={e => setIncluded(e.target.value)} /></label>
    <label className="block">Excluded boundaries<textarea className="mt-1 w-full rounded border bg-background p-2" value={excluded} onChange={e => setExcluded(e.target.value)} /></label>
    <label className="block">Change summary<textarea className="mt-1 w-full rounded border bg-background p-2" value={summary} maxLength={2000} onChange={e => setSummary(e.target.value)} /></label>
    <button className="rounded border px-3 py-2" disabled={!goal.trim() || !acceptance.some(c => c.required && c.statement.trim()) || !summary.trim()} onClick={() => onSave({ baseRevision: revision.revision, contract: { goal: lines(goal), acceptance: acceptance.filter(c => c.statement.trim()), boundaries: { included: lines(included), excluded: lines(excluded) }, budget: revision.budget }, changeSummary: summary })}>Save new contract revision</button>
  </fieldset></details>;
}
