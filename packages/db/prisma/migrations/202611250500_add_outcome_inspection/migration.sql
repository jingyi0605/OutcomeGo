ALTER TYPE "outcomego_outcome_thread_turn_purpose" ADD VALUE 'inspection';

ALTER TABLE "outcomego_outcome"
  ADD COLUMN "inspectionEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "inspectionRevisionId" UUID;

ALTER TABLE "outcomego_outcome_work_item"
  ADD COLUMN "inspectionEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "inspectionRevisionId" UUID;

CREATE INDEX "outcomego_outcome_inspection_due_idx"
  ON "outcomego_outcome" ("inspectionEnabled", "dueAt");

CREATE INDEX "outcomego_outcome_work_item_inspection_due_idx"
  ON "outcomego_outcome_work_item" ("inspectionEnabled", "dueAt");
