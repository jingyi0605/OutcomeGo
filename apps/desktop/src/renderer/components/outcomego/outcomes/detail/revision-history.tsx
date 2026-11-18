import type { OutcomeDetail } from "@outcomego/contracts/outcomes";

export function RevisionHistory({ outcome }: { outcome: OutcomeDetail }) {
  const byId = new Map(outcome.revisions.map((revision) => [revision.id, revision.revision]));
  return (
    <details>
      <summary>Revision history</summary>
      <ul className="space-y-3">
        {outcome.revisions.map((revision) => (
          <li key={revision.id} className="outcome-card">
            <p>
              Revision {revision.revision}: {revision.status} ·{" "}
              {revision.revision === outcome.currentRevision
                ? "Current contract"
                : "Historical contract"}
            </p>
            <p>
              {revision.changeSummary ?? "Initial contract"} · {revision.createdAt}
            </p>
            {revision.baseRevisionId && (
              <p className="break-all text-xs">
                Based on revision {byId.get(revision.baseRevisionId) ?? revision.baseRevisionId}
              </p>
            )}
            {revision.sourceDecisionId && (
              <p className="break-all text-xs">Source Decision: {revision.sourceDecisionId}</p>
            )}
            {revision.createdBy && (
              <p className="break-all text-xs">Created by {revision.createdBy}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs">
        Earlier outputs, evidence and reviews remain attached to their original contract. They do
        not satisfy the current contract automatically.
      </p>
    </details>
  );
}

export const revisionMaterialLabel = (revision: number | null, currentRevision: number | null) =>
  revision === null
    ? "Revision unavailable"
    : revision === currentRevision
      ? `Current revision ${revision}`
      : `Historical revision ${revision} · not used for current acceptance`;
