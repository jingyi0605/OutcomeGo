-- Spec 004.10: task scheduling dates, goal deadline and the owner policy column.
-- Only adds nullable columns, one defaulted column and one index. Existing rows are not changed.

ALTER TABLE "outcomego_outcome_work_item"
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "estimateMinutes" INTEGER,
  ADD COLUMN "deferCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "outcomego_outcome_work_item_status_scheduled_at_idx"
  ON "outcomego_outcome_work_item"("status", "scheduledAt");

ALTER TABLE "outcomego_outcome" ADD COLUMN "dueAt" TIMESTAMP(3);

ALTER TABLE "outcomego_feature_settings" ADD COLUMN "taskPolicy" JSONB;
