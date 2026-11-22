import { outcomeNotificationPayload, type OutcomeNotificationPayload, type OutcomeNotificationType } from "@outcomego/contracts/notification-content";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { publishOutcomeNotification } from "./notifications";
import { outcomeDecisionRevisionActiveSql, revokeOutcomeDecisionNotification } from "./outcome-decisions";
import { postOutcomeUpdateCard } from "./outcome-update-cards";

export const OUTCOME_INBOX_EVENT_SCOPE = "outcome-event:inbox";
export const OUTCOME_INBOX_EVENT_TOPICS = ["outcome.decision.required", "outcome.review.required", "outcome.human_action.required", "outcome.accepted", "outcome.decision.closed"] as const;
interface Fact {
  factKey: string; type: OutcomeNotificationType; outcomeId: string; botId: string; contractRevision: number;
  decisionId: string | null; workItemId: string | null; urgent: boolean; availableAt: Date;
}

/** A criterion group changes only when a different result/receipt becomes ready, never on Event replay. */
export const outcomeReviewNotificationFactsSql = Prisma.sql`
  SELECT o.id AS "outcomeId", o."botId", r.id AS "contractRevisionId", r.revision AS "contractRevision",
    'review.required:' || o.id::text || ':' || r.revision::text || ':' ||
      md5(criteria.ids || ':' || COALESCE(ready.ids, 'all')) AS "factKey",
    COALESCE(ready."availableAt", r."createdAt") AS "availableAt", criteria."criterionIds"
  FROM "outcomego_outcome" o JOIN "outcomego_outcome_contract_revision" r ON r."outcomeId" = o.id
  CROSS JOIN LATERAL (
    SELECT COALESCE(string_agg(c.id::text, ',' ORDER BY c.ordinal), '') AS ids,
      COALESCE(jsonb_agg(c.id ORDER BY c.ordinal), '[]'::jsonb) AS "criterionIds"
    FROM "outcomego_outcome_acceptance_criterion" c WHERE c."contractRevisionId" = r.id
  ) criteria
  CROSS JOIN LATERAL (
    SELECT string_agg(result.id, ',' ORDER BY result.id) AS ids, MAX(result."availableAt") AS "availableAt"
    FROM (
      SELECT w.id::text AS id, COALESCE(w."completedAt", w."createdAt") AS "availableAt"
      FROM "outcomego_outcome_work_item" w
      WHERE w."contractRevisionId" = r.id AND w."executorType" = 'agent' AND w.status = 'completed'
        AND EXISTS (SELECT 1 FROM "outcomego_outcome_output" output WHERE output."workItemId" = w.id)
        AND NOT EXISTS (SELECT 1 FROM "outcomego_outcome_work_item" rework
          WHERE rework."reworkOfWorkItemId" = w.id AND rework.status <> 'cancelled')
      UNION ALL
      SELECT COALESCE(receipt.id::text, w.id::text), COALESCE(receipt."submittedAt", w."updatedAt")
      FROM "outcomego_outcome_work_item" w
      LEFT JOIN LATERAL (SELECT receipt.id, receipt."submittedAt" FROM "outcomego_outcome_human_receipt" receipt
        WHERE receipt."workItemId" = w.id ORDER BY receipt.sequence DESC LIMIT 1) receipt ON true
      WHERE w."contractRevisionId" = r.id AND w."executorType" = 'human' AND w.status IN ('submitted', 'review_pending')
    ) result
  ) ready
  WHERE ${outcomeDecisionRevisionActiveSql(Prisma.sql`o.id`, Prisma.sql`r.id`, Prisma.sql`(SELECT w.id FROM "outcomego_outcome_work_item" w WHERE w."outcomeId" = o.id AND w."contractRevisionId" = r.id AND w."executorType" = 'agent' AND w."startedAt" IS NOT NULL ORDER BY w.ordinal LIMIT 1)`)}
    AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL AND r.status = 'approved'
    AND NOT EXISTS (
      SELECT 1
      FROM "outcomego_outcome_thread" reviewer
      JOIN "outcomego_outcome_thread_turn" active_review ON active_review."threadId" = reviewer.id
      WHERE reviewer."outcomeId" = o.id AND reviewer.role = 'reviewer'
        AND active_review.purpose = 'review' AND active_review.status IN ('queued', 'running')
        AND active_review."clientRequestId" LIKE 'review-batch:%' || r.id::text || ':%'
    )
    AND (ready.ids IS NOT NULL OR (o.status = 'review_pending' AND NOT EXISTS (
      SELECT 1 FROM "outcomego_outcome_work_item" rework WHERE rework."contractRevisionId" = r.id
        AND rework."reworkOfWorkItemId" IS NOT NULL AND rework.status <> 'cancelled')))
`;

/** Current facts, shared by recovery, native read projection and the final push check. */
export const outcomeInboxNotificationFactsSql = Prisma.sql`
  SELECT 'decision.required:' || d.id::text AS "factKey", 'outcome.decision.required' AS type,
    o.id AS "outcomeId", o."botId", r.revision AS "contractRevision", d.id::text AS "decisionId", d."workItemId"::text AS "workItemId",
    d."reasonCode" = 'external_result_unknown' AS urgent, d."createdAt" AS "availableAt"
  FROM "outcomego_outcome_decision" d
    JOIN "outcomego_outcome" o ON o.id = d."outcomeId"
    JOIN "outcomego_outcome_contract_revision" r ON r.id = d."contractRevisionId"
  WHERE d.status IN ('open', 'presented') AND (d."expiresAt" IS NULL OR d."expiresAt" > CURRENT_TIMESTAMP)
    AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL
    AND ${outcomeDecisionRevisionActiveSql(Prisma.sql`o.id`, Prisma.sql`d."contractRevisionId"`, Prisma.sql`d."workItemId"`)}
  UNION ALL
  SELECT review."factKey", 'outcome.review.required', review."outcomeId", review."botId", review."contractRevision",
    NULL, NULL, false, review."availableAt"
  FROM (${outcomeReviewNotificationFactsSql}) review
  UNION ALL
  SELECT 'human_action.required:' || w.id::text, 'outcome.human_action.required', o.id, o."botId", r.revision,
    NULL, w.id::text, false, card."createdAt"
  FROM "outcomego_outcome_work_item" w JOIN "outcomego_outcome_human_action_card" card ON card."workItemId" = w.id
    JOIN "outcomego_outcome" o ON o.id = w."outcomeId"
    JOIN "outcomego_outcome_contract_revision" r ON r.id = w."contractRevisionId"
  WHERE ${outcomeDecisionRevisionActiveSql(Prisma.sql`o.id`, Prisma.sql`r.id`, Prisma.sql`card."requestedByWorkItemId"`)}
    AND w."executorType" = 'human' AND w.status IN ('pending', 'ready', 'in_progress', 'paused', 'rejected')
    AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL AND r.status = 'approved'
  UNION ALL
  SELECT 'outcome.completed:' || o.id::text || ':' || r.revision::text, 'outcome.accepted', o.id, o."botId", r.revision,
    NULL, NULL, false, o."acceptedAt"
  FROM "outcomego_outcome" o JOIN "outcomego_outcome_contract_revision" r ON r.id = o."currentRevisionId"
  WHERE o.status = 'accepted' AND o."cancelledAt" IS NULL AND o."acceptedAt" >= CURRENT_TIMESTAMP - INTERVAL '7 days'
  UNION ALL
  -- Every agent attempt of the current revision failed. The key changes when a different set of attempts fails, so a retry that fails again notifies again.
  SELECT 'outcome.failed:' || o.id::text || ':' || r.revision::text || ':' || md5(failed.ids), 'outcome.failed', o.id, o."botId", r.revision,
    NULL, NULL, false, failed."availableAt"
  FROM "outcomego_outcome" o JOIN "outcomego_outcome_contract_revision" r ON r.id = o."currentRevisionId"
  CROSS JOIN LATERAL (
    SELECT string_agg(w.id::text, ',' ORDER BY w.id) AS ids, MAX(w."updatedAt") AS "availableAt"
    FROM "outcomego_outcome_work_item" w
    WHERE w."outcomeId" = o.id AND w."contractRevisionId" = r.id AND w."executorType" = 'agent' AND w.status = 'failed'
  ) failed
  WHERE o.status = 'failed' AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL AND r.status = 'approved'
    AND failed.ids IS NOT NULL AND failed."availableAt" >= CURRENT_TIMESTAMP - INTERVAL '2 days'
  UNION ALL
  -- The executor reported a task as blocked while still running. It clears itself when no task is blocked any more.
  SELECT 'outcome.blocked:' || w.id::text || ':' || md5(blocked.ids), 'outcome.blocked', o.id, o."botId", r.revision,
    NULL, w.id::text, false, w."updatedAt"
  FROM "outcomego_outcome_work_item" w
    JOIN "outcomego_outcome" o ON o.id = w."outcomeId" AND o."currentRevisionId" = w."contractRevisionId"
    JOIN "outcomego_outcome_contract_revision" r ON r.id = w."contractRevisionId"
  CROSS JOIN LATERAL (
    SELECT string_agg(task->>'id', ',' ORDER BY task->>'id') AS ids
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.progress->'tasks') = 'array' THEN w.progress->'tasks' ELSE '[]'::jsonb END) task
    WHERE task->>'status' = 'blocked'
  ) blocked
  WHERE w."executorType" = 'agent' AND w.status = 'running' AND blocked.ids IS NOT NULL
    AND o.status = 'running' AND o."cancelledAt" IS NULL AND o."acceptedAt" IS NULL AND r.status = 'approved'
`;

async function publishFact(tx: Prisma.TransactionClient, fact: Fact): Promise<boolean> {
  const channel = await tx.channel.findFirst({ where: { kind: "bot_dm", archivedAt: null, members: { some: { botId: fact.botId } } }, orderBy: { createdAt: "asc" } });
  if (!channel) return false;
  await publishOutcomeNotification(tx, outcomeNotificationPayload({ type: fact.type, factKey: fact.factKey, outcomeId: fact.outcomeId,
    ...(fact.decisionId ? { decisionId: fact.decisionId } : {}), botId: fact.botId, channelId: channel.id, contractRevision: fact.contractRevision, urgent: fact.urgent }));
  // The same fact also leaves a card in the Bot conversation; it never wakes the Bot (see outcome-update-cards).
  await postOutcomeUpdateCard(tx, { channelId: channel.id, outcomeId: fact.outcomeId, factKey: fact.factKey, contractRevision: fact.contractRevision, type: fact.type });
  return true;
}

/** Receipt and notification intent commit together; an Event sequence is never a commit watermark. */
export async function consumeOutcomeInboxEvent(tx: Prisma.TransactionClient, sequence: bigint): Promise<{ processed: boolean; projected: boolean }> {
  const event = await tx.event.findUnique({ where: { sequence } });
  if (!event?.entityId || !(OUTCOME_INBOX_EVENT_TOPICS as readonly string[]).includes(event.topic)) return { processed: false, projected: false };
  const envelope = event.payload as { eventId?: string; contractRevision?: number; payload?: { decisionId?: string; workItemId?: string; revisionId?: string; reason?: string } };
  const eventId = envelope.eventId ?? event.sequence.toString();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${event.entityId}`}))`;
  const receipt = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope: OUTCOME_INBOX_EVENT_SCOPE, key: eventId } } });
  if (receipt) return { processed: true, projected: false };
  let projected = false;
  if (event.topic === "outcome.decision.closed") {
    const decision = envelope.payload?.decisionId ? await tx.outcomeDecision.findUnique({ where: { id: envelope.payload.decisionId } }) : null;
    if (decision && decision.outcomeId === event.entityId && ["expired", "withdrawn"].includes(decision.status) && decision.status === envelope.payload?.reason)
      await revokeOutcomeDecisionNotification(tx, decision.id);
  } else {
    const key = event.topic === "outcome.decision.required" ? `decision.required:${envelope.payload?.decisionId}`
      : event.topic === "outcome.human_action.required" ? `human_action.required:${envelope.payload?.workItemId}`
      : event.topic === "outcome.accepted" ? `outcome.completed:${event.entityId}:${envelope.contractRevision}`
      : null;
    const [fact] = await tx.$queryRaw<Fact[]>(Prisma.sql`SELECT fact.* FROM (${outcomeInboxNotificationFactsSql}) fact
      WHERE fact."outcomeId" = ${event.entityId}::uuid
        AND ${key ? Prisma.sql`fact."factKey" = ${key}` : Prisma.sql`fact.type = 'outcome.review.required' AND fact."contractRevision" = ${envelope.contractRevision ?? -1}`}`);
    if (fact && (envelope.contractRevision === undefined || envelope.contractRevision === fact.contractRevision)) {
      projected = await publishFact(tx, fact);
      if (!projected) return { processed: false, projected: false };
    }
  }
  await tx.idempotencyRecord.create({ data: { scope: OUTCOME_INBOX_EVENT_SCOPE, key: eventId, requestHash: event.topic,
    response: { processed: true, projected }, status: "completed", expiresAt: new Date(Date.now() + 30 * 86400_000) } });
  return { processed: true, projected };
}

/** Existing dispatcher startup/periodic drains recover all four categories after producer crashes or Event pruning. */
export async function reconcileOutcomeInboxNotifications(prisma: PrismaClient): Promise<number> {
  const facts = await prisma.$queryRaw<Fact[]>(Prisma.sql`
    SELECT fact.* FROM (${outcomeInboxNotificationFactsSql}) fact
    WHERE NOT EXISTS (SELECT 1 FROM "outcomego_channel_notification" n WHERE n.key = fact."factKey")
      AND EXISTS (SELECT 1 FROM "outcomego_channel" c JOIN "outcomego_channel_member" m ON m."channelId" = c.id
        WHERE c.kind = 'bot_dm' AND c."archivedAt" IS NULL AND m."botId" = fact."botId")
    ORDER BY fact."availableAt", fact."factKey" LIMIT 100
  `);
  let processed = 0;
  for (const candidate of facts) await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${candidate.outcomeId}`}))`;
    const [current] = await tx.$queryRaw<Fact[]>(Prisma.sql`SELECT fact.* FROM (${outcomeInboxNotificationFactsSql}) fact WHERE fact."factKey" = ${candidate.factKey}`);
    if (current && await publishFact(tx, current)) processed++;
  });
  // Missing-channel facts do not occupy the bounded Event page; permanent facts cover them once a channel exists.
  const events = await prisma.$queryRaw<Array<{ sequence: bigint }>>(Prisma.sql`
    SELECT event.sequence FROM "outcomego_event" event JOIN "outcomego_outcome" o ON o.id = event."entityId"
    WHERE event.topic IN (${Prisma.join([...OUTCOME_INBOX_EVENT_TOPICS])})
      AND NOT EXISTS (SELECT 1 FROM "outcomego_idempotency_record" receipt WHERE receipt.scope = ${OUTCOME_INBOX_EVENT_SCOPE}
        AND receipt.key = COALESCE(event.payload->>'eventId', event.sequence::text))
      AND (event.topic = 'outcome.decision.closed' OR EXISTS (
        SELECT 1 FROM "outcomego_channel" c JOIN "outcomego_channel_member" m ON m."channelId" = c.id
        WHERE c.kind = 'bot_dm' AND c."archivedAt" IS NULL AND m."botId" = o."botId"))
    ORDER BY event.sequence LIMIT 100
  `);
  for (const event of events) if ((await prisma.$transaction(tx => consumeOutcomeInboxEvent(tx, event.sequence))).processed) processed++;
  return processed;
}

export async function outcomeNotificationIsCurrent(tx: Prisma.TransactionClient, payload: OutcomeNotificationPayload): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ current: boolean }>>(Prisma.sql`
    SELECT true AS current FROM (${outcomeInboxNotificationFactsSql}) fact WHERE fact."factKey" = ${payload.factKey}
      AND fact."outcomeId" = ${payload.outcomeId}::uuid AND fact."contractRevision" = ${payload.contractRevision}
  `);
  return rows.length > 0;
}

/** Native consumers read only server-projected, unread, current facts with existing notification preferences. */
export async function unreadOutcomeNotifications(tx: Prisma.TransactionClient): Promise<OutcomeNotificationPayload[]> {
  const rows = await tx.$queryRaw<Array<{ payload: OutcomeNotificationPayload }>>(Prisma.sql`
    SELECT n.payload || jsonb_build_object('notificationSequence', n.sequence::text) AS payload
    FROM "outcomego_channel_notification" n JOIN (${outcomeInboxNotificationFactsSql}) fact ON fact."factKey" = n.key
      JOIN "outcomego_bot" bot ON bot.id = n."botId"
      JOIN "outcomego_channel" c ON c.id = n."channelId"
      LEFT JOIN "outcomego_channel_read_state" state ON state."channelId" = n."channelId"
    WHERE n.kind = 'outcome' AND NOT n.revoked AND bot."notificationsEnabled" AND NOT bot."hiddenFromSidebar"
      AND c."archivedAt" IS NULL AND NOT c."hiddenFromSidebar" AND n.sequence > COALESCE(state."lastReadNotificationSequence", 0)
      AND COALESCE((SELECT p."smartEnabled" FROM "outcomego_notification_preferences" p WHERE p.id = 'global'), true)
    ORDER BY n.sequence DESC LIMIT 100
  `);
  return rows.map(row => row.payload);
}
