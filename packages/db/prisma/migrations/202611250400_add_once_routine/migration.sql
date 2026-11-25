ALTER TYPE "outcomego_routine_schedule_kind" ADD VALUE 'once';
ALTER TYPE "outcomego_routine_execution_kind" ADD VALUE 'preparation';
ALTER TABLE "outcomego_routine" ADD COLUMN "onceAt" TIMESTAMP(3), ADD COLUMN "onceStartedAt" TIMESTAMP(3);
ALTER TABLE "outcomego_routine_revision" ADD COLUMN "onceTrigger" JSONB;
