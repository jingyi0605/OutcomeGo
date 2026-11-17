import type { ContractRevisionView } from "@outcomego/contracts/outcomes";

export function ContractConfirmation({ revision, busy, confirmation, onConfirmation, onApprove }: {
  revision: ContractRevisionView; busy: boolean; confirmation: string;
  onConfirmation: (value: string) => void; onApprove: () => void;
}) {
  return <section aria-label="Contract confirmation" className="space-y-3 rounded-lg border p-4">
    <h3 className="font-medium">Contract revision {revision.revision} · {revision.status}</h3>
    <div><h4>Goals</h4><ul className="list-inside list-disc">{revision.goal.map((goal, i) => <li key={i}>{goal}</li>)}</ul></div>
    <div><h4>Acceptance</h4><ul className="list-inside list-disc">{revision.criteria.map(c => <li key={c.id}>{c.required ? "Required" : "Optional"}: {c.statement}</li>)}</ul></div>
    <div><h4>Boundaries</h4><ul className="list-inside list-disc">{revision.boundaries.included.map((text, i) => <li key={`in${i}`}>Included: {text}</li>)}{revision.boundaries.excluded.map((text, i) => <li key={`out${i}`}>Excluded: {text}</li>)}</ul></div>
    <p>Budget: {revision.budget?.timeLimitMinutes == null ? "No time limit specified" : `${revision.budget.timeLimitMinutes} minutes`}; {revision.budget?.costLimit == null ? "no cost limit specified" : `cost limit ${revision.budget.costLimit}`}.</p>
    <p className="text-xs text-muted-foreground">Budget is execution context. Automatic stopping is not enabled.</p>
    {revision.conflicts.map((c, i) => <p key={i} role={c.severity === "blocking" ? "alert" : "status"}>{c.severity}: {c.message}</p>)}
    {revision.status === "pending_approval" && <>
      <label className="block">Approval confirmation<input aria-label="Approval confirmation" className="mt-1 w-full rounded border bg-background p-2" maxLength={500} value={confirmation} onChange={e => onConfirmation(e.target.value)} disabled={busy} placeholder="I confirm these goals, acceptance criteria and boundaries." /></label>
      <button className="rounded border px-3 py-2" disabled={busy || !confirmation.trim()} onClick={onApprove}>{busy ? "Submitting…" : "Approve contract"}</button>
    </>}
    {revision.approvedAt && <p>Approved by {revision.approvedBy} at {new Date(revision.approvedAt).toLocaleString()}.</p>}
  </section>;
}
