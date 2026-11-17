import { outcomeDecisionRevisionActiveSql, outcomeReviewNotificationFactsSql } from "@outcomego/messaging";
import { ApiError } from "@outcomego/contracts";
import { encodeOutcomeInboxCursor, type OutcomeInboxItemView, type OutcomeInboxPage, type OutcomeInboxQuery } from "@outcomego/contracts/outcome-inbox";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { serviceEffect } from "./service-utils";

type InboxRow = Omit<OutcomeInboxItemView, "availableAt" | "createdAt"> & { availableAt: Date; createdAt: Date };

/** A bounded UNION of current business facts, without a second inbox table or per-card queries. */
export class OutcomeInboxService {
  constructor(private readonly prisma: PrismaClient) {}
  list = (query: OutcomeInboxQuery, outcomeId?: string) => serviceEffect(async (): Promise<OutcomeInboxPage> => {
    if (outcomeId && !await this.prisma.outcome.findUnique({ where: { id: outcomeId }, select: { id: true } })) throw new ApiError(404, "outcome_not_found", "Outcome not found");
    const snapshotAt = query.cursor?.snapshotAt ?? new Date().toISOString();
    const cursorCreatedAt = query.cursor?.createdAt ?? query.cursor?.availableAt;
    const rows = await this.prisma.$queryRaw<InboxRow[]>(Prisma.sql`
      WITH facts AS (
        SELECT 'decision_pending:' || d.id::text AS id, o.id AS "outcomeId", r.revision AS "contractRevision", d.id::text AS "decisionId", d."workItemId"::text AS "workItemId", NULL::jsonb AS "criterionIds",
          'decision_pending' AS category, CASE WHEN d."reasonCode" = 'external_result_unknown' THEN 4 ELSE 3 END AS priority,
          o.title, d."completedSummary" AS completed, d."problemSummary" AS problem, d."nextStepSummary" AS next, true AS "requiresAction",
          d."createdAt" AS "availableAt", d."createdAt", 'decision.required:' || d.id::text AS "factKey"
        FROM "outcomego_outcome_decision" d
          JOIN "outcomego_outcome" o ON o.id = d."outcomeId"
          JOIN "outcomego_outcome_contract_revision" r ON r.id = d."contractRevisionId"
        WHERE ${outcomeDecisionRevisionActiveSql(Prisma.sql`o.id`, Prisma.sql`d."contractRevisionId"`, Prisma.sql`d."workItemId"`)}
          AND d.status IN ('open', 'presented') AND (d."expiresAt" IS NULL OR d."expiresAt" > CURRENT_TIMESTAMP)
          AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL
        UNION ALL
        SELECT 'acceptance_pending:' || o.id::text, o.id, review."contractRevision", NULL, NULL, review."criterionIds",
          'acceptance_pending', 1, o.title, 'Results are ready for review.', 'Acceptance needs your review.', 'Review the criteria on Desktop.', true,
          review."availableAt", review."availableAt", review."factKey"
        FROM (${outcomeReviewNotificationFactsSql}) review JOIN "outcomego_outcome" o ON o.id = review."outcomeId"
        UNION ALL
        SELECT 'human_action_pending:' || w.id::text, o.id, r.revision, NULL, w.id::text, NULL,
          'human_action_pending', 2, w.title, 'The next action requires a person.', 'A manual action is pending.', 'Open the action card on Desktop.', true,
          w."createdAt", w."createdAt", 'human_action.required:' || w.id::text
        FROM "outcomego_outcome_work_item" w
          JOIN "outcomego_outcome" o ON o.id = w."outcomeId"
          JOIN "outcomego_outcome_contract_revision" r ON r.id = w."contractRevisionId"
          LEFT JOIN "outcomego_outcome_human_action_card" card ON card."workItemId" = w.id
        WHERE ${outcomeDecisionRevisionActiveSql(Prisma.sql`o.id`, Prisma.sql`r.id`, Prisma.sql`card."requestedByWorkItemId"`)}
          AND w."executorType" = 'human' AND w.status IN ('pending', 'ready', 'in_progress', 'paused', 'rejected')
          AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL
        UNION ALL
        SELECT 'completed:' || o.id::text, o.id, r.revision, NULL, NULL, NULL,
          'completed', 0, o.title, 'All required criteria have been accepted.', 'No unresolved issue.', 'View the accepted results.', false,
          o."acceptedAt", o."createdAt", 'outcome.completed:' || o.id::text || ':' || r.revision::text
        FROM "outcomego_outcome" o JOIN "outcomego_outcome_contract_revision" r ON r.id = o."currentRevisionId"
        WHERE o.status = 'accepted' AND o."acceptedAt" >= ${new Date(Date.parse(snapshotAt) - 7 * 86400_000)}
      )
      SELECT f.id, f."outcomeId", f."contractRevision", f."decisionId", f."workItemId", f."criterionIds", f.category, f.priority,
        f.title, f.completed, f.problem, f.next, f."requiresAction", f."availableAt", f."createdAt",
        COALESCE((SELECT n.sequence <= COALESCE(s."lastReadNotificationSequence", 0)
          FROM "outcomego_channel_notification" n LEFT JOIN "outcomego_channel_read_state" s ON s."channelId" = n."channelId"
          WHERE n.key = f."factKey"), false) AS read
      FROM facts f
      WHERE f."availableAt" <= ${new Date(snapshotAt)} AND f."createdAt" <= ${new Date(snapshotAt)}
        ${outcomeId ? Prisma.sql`AND f."outcomeId" = ${outcomeId}::uuid` : Prisma.empty}
        ${query.status === "pending" ? Prisma.sql`AND f.category <> 'completed'` : query.status === "completed" ? Prisma.sql`AND f.category = 'completed'` : Prisma.empty}
        ${query.category ? Prisma.sql`AND f.category = ${query.category}` : Prisma.empty}
        ${query.cursor ? Prisma.sql`AND (f.priority < ${query.cursor.priority}
          OR (f.priority = ${query.cursor.priority} AND f."availableAt" > ${new Date(query.cursor.availableAt)})
          OR (f.priority = ${query.cursor.priority} AND f."availableAt" = ${new Date(query.cursor.availableAt)} AND f."createdAt" > ${new Date(cursorCreatedAt!)})
          OR (f.priority = ${query.cursor.priority} AND f."availableAt" = ${new Date(query.cursor.availableAt)} AND f."createdAt" = ${new Date(cursorCreatedAt!)} AND f.id > ${query.cursor.id}))` : Prisma.empty}
      ORDER BY f.priority DESC, f."availableAt" ASC, f."createdAt" ASC, f.id ASC LIMIT ${query.limit + 1}
    `);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(row => ({ ...row, availableAt: row.availableAt.toISOString(), createdAt: row.createdAt.toISOString() })),
      nextCursor: rows.length > query.limit && last ? encodeOutcomeInboxCursor({ priority: last.priority, availableAt: last.availableAt.toISOString(), createdAt: last.createdAt.toISOString(), id: last.id, snapshotAt }) : null,
    };
  });
}
