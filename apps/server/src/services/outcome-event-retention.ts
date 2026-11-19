import { Prisma } from "@outcomego/db";

export const OUTCOME_EVIDENCE_EVENT_SCOPE = "outcome-event:output-evidence";

/** The fixed `event` alias is shared by backlog reads and retention deletes. */
export const pendingOutcomeEvidenceEventSql: Prisma.Sql = Prisma.sql`
  (
    (
      event."topic" = 'outcome.output.recorded'
      OR (
        event."topic" = 'outcome.work_item.updated'
        AND event."payload" #>> '{payload,to}' = 'completed'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "outcomego_idempotency_record" receipt
      WHERE receipt."scope" = ${OUTCOME_EVIDENCE_EVENT_SCOPE}
        AND receipt."key" = COALESCE(
          event."payload" ->> 'eventId',
          event."sequence"::text
        )
    )
  )
`;
