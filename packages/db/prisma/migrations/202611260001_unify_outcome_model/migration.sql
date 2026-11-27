BEGIN;

CREATE TYPE "outcomego_outcome_kind" AS ENUM ('standard', 'tracked', 'scheduled_once', 'todo', 'explore_idea', 'note');
CREATE TYPE "outcomego_outcome_urgency" AS ENUM ('low', 'normal', 'high');
CREATE TYPE "outcomego_outcome_executor" AS ENUM ('owner', 'bot');
CREATE TYPE "outcomego_outcome_plan_mode" AS ENUM ('triage', 'advice', 'contract_plan');

ALTER TYPE "outcomego_outcome_status" ADD VALUE 'scheduled';
ALTER TYPE "outcomego_outcome_status" ADD VALUE 'preparing';
ALTER TYPE "outcomego_outcome_status" ADD VALUE 'suggested';
ALTER TYPE "outcomego_outcome_status" ADD VALUE 'open';
ALTER TYPE "outcomego_outcome_status" ADD VALUE 'waiting';
ALTER TYPE "outcomego_outcome_status" ADD VALUE 'exploring';
ALTER TYPE "outcomego_outcome_status" ADD VALUE 'active';
ALTER TYPE "outcomego_outcome_status" ADD VALUE 'archived';
ALTER TYPE "outcomego_outcome_thread_turn_status" ADD VALUE 'cancelled';

COMMIT;
BEGIN;

CREATE TEMP TABLE retired_outcome_routine_ids ON COMMIT DROP AS
SELECT id FROM "outcomego_routine"
WHERE "scheduleKind" = 'once'
   OR ("scheduleKind" = 'cron' AND trigger->>'type' = 'cron'
       AND "cronExpression" ~ '^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+[*][[:space:]]*$');

DELETE FROM "outcomego_routine_execution"
WHERE "kind" = 'preparation'
   OR "routineId" IN (SELECT id FROM retired_outcome_routine_ids)
   OR "routineRevisionId" IN (SELECT id FROM "outcomego_routine_revision" WHERE "scheduleKind" = 'once');

DELETE FROM "outcomego_routine_revision" WHERE "scheduleKind" = 'once';
DELETE FROM "outcomego_routine" WHERE id IN (SELECT id FROM retired_outcome_routine_ids);

CREATE TYPE "outcomego_routine_schedule_kind_new" AS ENUM ('cron', 'interval', 'event');
ALTER TABLE "outcomego_routine" ALTER COLUMN "scheduleKind" TYPE "outcomego_routine_schedule_kind_new" USING "scheduleKind"::text::"outcomego_routine_schedule_kind_new";
ALTER TABLE "outcomego_routine_revision" ALTER COLUMN "scheduleKind" TYPE "outcomego_routine_schedule_kind_new" USING "scheduleKind"::text::"outcomego_routine_schedule_kind_new";
DROP TYPE "outcomego_routine_schedule_kind";
ALTER TYPE "outcomego_routine_schedule_kind_new" RENAME TO "outcomego_routine_schedule_kind";

CREATE TYPE "outcomego_routine_execution_kind_new" AS ENUM ('scheduled', 'test');
ALTER TABLE "outcomego_routine_execution" ALTER COLUMN "kind" TYPE "outcomego_routine_execution_kind_new" USING "kind"::text::"outcomego_routine_execution_kind_new";
DROP TYPE "outcomego_routine_execution_kind";
ALTER TYPE "outcomego_routine_execution_kind_new" RENAME TO "outcomego_routine_execution_kind";

ALTER TABLE "outcomego_routine" DROP COLUMN "onceAt", DROP COLUMN "onceStartedAt";
ALTER TABLE "outcomego_routine_revision" DROP COLUMN "onceTrigger";

ALTER TABLE "outcomego_outcome" DROP COLUMN "inspectionRevisionId",
    DROP COLUMN "planningDraftId",
    ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT 'owner:local',
    ADD COLUMN "dedupeKey" TEXT,
    ADD COLUMN "executor" "outcomego_outcome_executor" NOT NULL DEFAULT 'bot',
    ADD COLUMN "followUpAt" TIMESTAMP(3),
    ADD COLUMN "kind" "outcomego_outcome_kind" NOT NULL DEFAULT 'standard',
    ADD COLUMN "kindMeta" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "ownerId" TEXT NOT NULL DEFAULT 'local',
    ADD COLUMN "parentOutcomeId" UUID,
    ADD COLUMN "prepareAt" TIMESTAMP(3),
    ADD COLUMN "prepareInstruction" TEXT,
    ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "scheduledAt" TIMESTAMP(3),
    ADD COLUMN "snoozeUntil" TIMESTAMP(3),
    ADD COLUMN "sourceRef" JSONB,
    ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "urgency" "outcomego_outcome_urgency" NOT NULL DEFAULT 'normal',
    ALTER COLUMN "botId" DROP NOT NULL;

INSERT INTO "outcomego_outcome" (
  "id", "ownerId", "kind", "botId", "parentOutcomeId", "title", "description",
  "sourceRef", "revision", "scheduledAt", "followUpAt", "snoozeUntil",
  "executor", "dedupeKey", "kindMeta", "status", "createdBy", "createdAt",
  "updatedAt", "acceptedAt", "cancelledAt", "closeSummary", "dueAt", "tags", "urgency"
)
SELECT
  todo."id",
  todo."ownerId",
  'todo',
  todo."botId",
  todo."linkedOutcomeId",
  todo."title",
  COALESCE(todo."note", todo."summary", ''),
  todo."sourceRef",
  todo."revision",
  todo."scheduledAt",
  todo."followUpAt",
  todo."snoozeUntil",
  CASE WHEN todo."executor"::text = 'bot' THEN 'bot'::"outcomego_outcome_executor" ELSE 'owner'::"outcomego_outcome_executor" END,
  CASE
    WHEN todo."dedupeKey" IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM "outcomego_outcome" existing
      WHERE existing."ownerId" = todo."ownerId" AND existing."dedupeKey" = todo."dedupeKey"
    ) THEN todo."dedupeKey" || ':legacy:' || todo."id"::text
    ELSE todo."dedupeKey"
  END,
  jsonb_strip_nulls(jsonb_build_object(
    'createdVia', todo."createdVia"::text,
    'authorizedByMessageId', todo."authorizedByMessageId",
    'autoAcceptRuleId', todo."autoAcceptRuleId",
    'autoAcceptRuleName', todo."autoAcceptRuleName",
    'acceptedBy', todo."acceptedBy"::text,
    'createdByRunId', todo."createdByRunId",
    'createdByRoutineId', todo."createdByRoutineId",
    'handoffBotId', todo."handoffBotId",
    'handoffMessageId', todo."handoffMessageId",
    'expiresAt', todo."expiresAt",
    'summary', todo."summary",
    'dismissReason', todo."dismissReason"::text
  )),
  CASE todo."status"::text
    WHEN 'done' THEN 'accepted'::"outcomego_outcome_status"
    WHEN 'dismissed' THEN 'cancelled'::"outcomego_outcome_status"
    ELSE todo."status"::text::"outcomego_outcome_status"
  END,
  todo."createdBy",
  todo."createdAt",
  todo."updatedAt",
  CASE WHEN todo."status"::text = 'done' THEN todo."completedAt" ELSE NULL END,
  CASE WHEN todo."status"::text = 'dismissed' THEN todo."dismissedAt" ELSE NULL END,
  todo."completionNote",
  todo."dueAt",
  COALESCE(todo."tags", ARRAY[]::TEXT[]),
  todo."urgency"::text::"outcomego_outcome_urgency"
FROM "outcomego_owner_todo_item" todo
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "outcomego_outcome" (
  "id", "ownerId", "kind", "botId", "parentOutcomeId", "title", "description",
  "sourceRef", "kindMeta", "status", "executor", "createdBy", "createdAt",
  "updatedAt", "cancelledAt"
)
SELECT
  idea."id",
  'local',
  'explore_idea',
  idea."botId",
  idea."sourceOutcomeId",
  idea."title",
  idea."note",
  jsonb_strip_nulls(jsonb_build_object(
    'sourceReferences', idea."sourceReferences",
    'legacy', jsonb_strip_nulls(jsonb_build_object(
      'status', idea."status"::text,
      'planningDraftId', idea."planningDraftId",
      'planningDraft', draft."snapshot",
      'planningSourceText', draft."sourceText",
      'planningError', draft."error",
      'planningExpiresAt', draft."expiresAt",
      'proposedOutcomeId', idea."proposedOutcomeId",
      'discardedAt', idea."discardedAt"
    ))
  )),
  jsonb_strip_nulls(jsonb_build_object('budget', idea."budget")),
  CASE idea."status"::text
    WHEN 'discarded' THEN 'cancelled'::"outcomego_outcome_status"
    WHEN 'converted' THEN 'cancelled'::"outcomego_outcome_status"
    WHEN 'proposed_for_delivery' THEN 'exploring'::"outcomego_outcome_status"
    ELSE idea."status"::text::"outcomego_outcome_status"
  END,
  CASE WHEN idea."botId" IS NULL THEN 'owner'::"outcomego_outcome_executor" ELSE 'bot'::"outcomego_outcome_executor" END,
  CASE WHEN idea."botId" IS NULL THEN 'owner:local' ELSE 'bot:' || idea."botId"::text END,
  idea."createdAt",
  idea."updatedAt",
  CASE WHEN idea."status"::text IN ('discarded', 'converted') THEN idea."discardedAt" ELSE NULL END
FROM "outcomego_explore_idea" idea
LEFT JOIN "outcomego_outcome_planning_draft" draft ON draft."id" = idea."planningDraftId"
ON CONFLICT ("id") DO NOTHING;

UPDATE "outcomego_outcome" converted
SET "parentOutcomeId" = idea."id"
FROM "outcomego_explore_idea" idea
WHERE converted."sourceExploreId" = idea."id"
  AND converted."parentOutcomeId" IS NULL;

UPDATE "outcomego_outcome" proposed
SET "parentOutcomeId" = idea."id"
FROM "outcomego_explore_idea" idea
WHERE proposed."id" = idea."proposedOutcomeId"
  AND proposed."parentOutcomeId" IS NULL;

UPDATE "outcomego_outcome" SET "kind" = 'tracked' WHERE "trackingMode" = 'tracked';
ALTER TABLE "outcomego_outcome" DROP COLUMN "trackingMode", DROP COLUMN "sourceExploreId";
ALTER TABLE "outcomego_outcome_work_item" DROP COLUMN "inspectionRevisionId";

ALTER TABLE "outcomego_outcome_thread_turn" ADD COLUMN "outcomeRevision" INTEGER,
    ADD COLUMN "planMode" "outcomego_outcome_plan_mode",
    ADD COLUMN "skipReason" TEXT;
UPDATE "outcomego_outcome_thread_turn"
SET "planMode" = 'advice', "purpose" = 'plan',
    "status" = CASE WHEN "status" IN ('queued', 'running') THEN 'failed' ELSE "status" END
WHERE "purpose" = 'inspection';

CREATE TYPE "outcomego_outcome_thread_turn_purpose_new" AS ENUM ('plan', 'owner_message', 'replan', 'review', 'review_task');
ALTER TABLE "outcomego_outcome_thread_turn" ALTER COLUMN "purpose" TYPE "outcomego_outcome_thread_turn_purpose_new" USING "purpose"::text::"outcomego_outcome_thread_turn_purpose_new";
DROP TYPE "outcomego_outcome_thread_turn_purpose";
ALTER TYPE "outcomego_outcome_thread_turn_purpose_new" RENAME TO "outcomego_outcome_thread_turn_purpose";

DROP TABLE "outcomego_owner_todo_item";
DROP TABLE "outcomego_explore_idea";
DROP TABLE "outcomego_outcome_planning_draft";
DROP TYPE "outcomego_owner_todo_status";
DROP TYPE "outcomego_owner_todo_executor";
DROP TYPE "outcomego_owner_todo_created_via";
DROP TYPE "outcomego_owner_todo_accepted_by";
DROP TYPE "outcomego_owner_todo_urgency";
DROP TYPE "outcomego_owner_todo_dismiss_reason";
DROP TYPE "outcomego_explore_idea_status";
DROP TYPE "outcomego_outcome_planning_draft_status";
DROP TYPE "outcomego_outcome_tracking_mode";

ALTER TABLE "outcomego_todo_auto_accept_rule" RENAME TO "outcomego_outcome_auto_accept_rule";
ALTER TABLE "outcomego_outcome_auto_accept_rule" RENAME CONSTRAINT "outcomego_todo_auto_accept_rule_pkey" TO "outcomego_outcome_auto_accept_rule_pkey";
ALTER INDEX "outcomego_todo_auto_accept_owner_enabled_idx" RENAME TO "outcomego_outcome_auto_accept_owner_enabled_idx";

ALTER TABLE "outcomego_memory_fact" ADD COLUMN "sourceOutcomeId" UUID;
ALTER TABLE "outcomego_run" ADD COLUMN "outcomeId" UUID;
CREATE INDEX "outcomego_memory_fact_source_outcome_id_idx" ON "outcomego_memory_fact"("sourceOutcomeId");
CREATE INDEX "outcomego_run_outcome_id_idx" ON "outcomego_run"("outcomeId");
CREATE INDEX "outcomego_outcome_owner_kind_updated_at_id_idx" ON "outcomego_outcome"("ownerId", "kind", "updatedAt", "id");
CREATE INDEX "outcomego_outcome_kind_status_scheduled_at_idx" ON "outcomego_outcome"("kind", "status", "scheduledAt");
CREATE INDEX "outcomego_outcome_kind_prepare_at_idx" ON "outcomego_outcome"("kind", "prepareAt");
CREATE INDEX "outcomego_outcome_parent_outcome_id_idx" ON "outcomego_outcome"("parentOutcomeId");
CREATE INDEX "outcomego_outcome_follow_up_at_idx" ON "outcomego_outcome"("followUpAt");
CREATE UNIQUE INDEX "outcomego_outcome_owner_dedupe_key" ON "outcomego_outcome"("ownerId", "dedupeKey");
CREATE INDEX "outcomego_outcome_thread_turn_revision_mode_status_idx" ON "outcomego_outcome_thread_turn"("threadId", "outcomeRevision", "planMode", "status");

ALTER TABLE "outcomego_outcome" ADD CONSTRAINT "outcomego_outcome_parentOutcomeId_fkey"
    FOREIGN KEY ("parentOutcomeId") REFERENCES "outcomego_outcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
