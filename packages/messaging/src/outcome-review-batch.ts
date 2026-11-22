import { createHash } from "node:crypto";
import { CREDENTIAL_ACCESS_REASON_CODE } from "@outcomego/contracts/outcome-inbox-categories";
import type { Prisma } from "@outcomego/db";

type Db = Pick<Prisma.TransactionClient, "outcomeOutput" | "outcomeEvidence" | "outcomeDecision">;

export const isReviewBatchEvidence = (row: { credibility: string; sourceType: string }) =>
  row.credibility !== "ai_prereview" && !(row.sourceType === "output" && row.credibility === "agent_report");

export const outcomeReviewDecisionFilter = {
  workItemId: { not: null }, reasonCode: { not: CREDENTIAL_ACCESS_REASON_CODE },
} satisfies Prisma.OutcomeDecisionWhereInput;

type RecordId = { id: string };

/** Saved sources are append-only. Generated reviews and copies of outputs are not new material. */
export function outcomeReviewBatchKey(
  revisionId: string, outputs: readonly RecordId[], evidence: readonly RecordId[], decisions: readonly (RecordId & { status: string })[],
): string {
  const ids = (rows: readonly RecordId[]) => rows.map(({ id }) => id).sort();
  const decisionStates = decisions.map(({ id, status }) => `${id}:${status === "presented" ? "open" : status}`).sort();
  const hash = createHash("sha256").update(JSON.stringify([ids(outputs), ids(evidence), decisionStates])).digest("hex");
  return `review-batch:v9:${revisionId}:${hash}`;
}

export async function readOutcomeReviewBatch(db: Db, outcomeId: string, revisionId: string) {
  const [outputs, evidence, decisions] = await Promise.all([
    db.outcomeOutput.findMany({ where: { outcomeId, workItem: { contractRevisionId: revisionId } }, select: { id: true } }),
    db.outcomeEvidence.findMany({ where: { outcomeId, contractRevisionId: revisionId }, select: { id: true, credibility: true, sourceType: true } }),
    db.outcomeDecision.findMany({ where: { outcomeId, contractRevisionId: revisionId, ...outcomeReviewDecisionFilter }, select: { id: true, status: true } }),
  ]);
  const sourceEvidence = evidence.filter(isReviewBatchEvidence);
  return {
    key: outcomeReviewBatchKey(revisionId, outputs, sourceEvidence, decisions),
    hasResults: outputs.length > 0 || sourceEvidence.length > 0 || decisions.length > 0,
  };
}
