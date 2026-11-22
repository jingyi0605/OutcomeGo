-- Spec 004.9: Outcome planner/reviewer roles, task plans, per-bot inference model & run fallback

UPDATE "outcomego_bot" SET "inferenceProvider" = NULL, "inferenceModel" = NULL;
ALTER TABLE "outcomego_bot" ADD COLUMN "inferenceReasoning" TEXT;

ALTER TABLE "outcomego_run" ADD COLUMN "inferenceFallback" JSONB;

ALTER TABLE "outcomego_feature_settings"
  ADD COLUMN "plannerBotId" UUID,
  ADD COLUMN "reviewerBotId" UUID,
  ADD COLUMN "plannerModel" JSONB,
  ADD COLUMN "reviewerModel" JSONB,
  ADD COLUMN "environmentNote" TEXT;

CREATE TYPE "outcomego_outcome_thread_role" AS ENUM ('planner', 'reviewer');

ALTER TYPE "outcomego_outcome_thread_turn_purpose" ADD VALUE IF NOT EXISTS 'replan';
ALTER TYPE "outcomego_outcome_thread_turn_purpose" ADD VALUE IF NOT EXISTS 'review';
ALTER TYPE "outcomego_outcome_thread_turn_purpose" ADD VALUE IF NOT EXISTS 'review_task';

ALTER TABLE "outcomego_outcome_thread"
  ADD COLUMN "role" "outcomego_outcome_thread_role" NOT NULL DEFAULT 'planner';
ALTER TABLE "outcomego_outcome_thread"
  DROP CONSTRAINT IF EXISTS "outcomego_outcome_thread_outcomeId_key";
ALTER TABLE "outcomego_outcome_thread"
  ADD CONSTRAINT "outcomego_outcome_thread_outcome_id_role_key" UNIQUE ("outcomeId", "role");

ALTER TABLE "outcomego_outcome_thread_turn"
  ADD COLUMN "model" JSONB,
  ADD COLUMN "result" JSONB,
  ADD COLUMN "workItemId" UUID;
ALTER TABLE "outcomego_outcome_thread_turn"
  ADD CONSTRAINT "outcomego_outcome_thread_turn_workItemId_fkey"
  FOREIGN KEY ("workItemId") REFERENCES "outcomego_outcome_work_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "outcomego_outcome_thread_turn_work_item_id_idx"
  ON "outcomego_outcome_thread_turn"("workItemId");

ALTER TABLE "outcomego_outcome_contract_revision" ADD COLUMN "plan" JSONB;

ALTER TABLE "outcomego_outcome_work_item" ADD COLUMN "planKey" TEXT;
ALTER TABLE "outcomego_outcome_work_item"
  ADD CONSTRAINT "outcomego_outcome_work_item_revision_id_plan_key_key" UNIQUE ("contractRevisionId", "planKey");
