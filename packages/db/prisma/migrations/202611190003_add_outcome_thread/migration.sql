ALTER TYPE "outcomego_run_origin" ADD VALUE 'outcome_thread';

CREATE TYPE "outcomego_outcome_thread_turn_purpose" AS ENUM ('plan', 'owner_message');
CREATE TYPE "outcomego_outcome_thread_turn_status" AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE "outcomego_outcome_thread" (
  "id" UUID NOT NULL,
  "outcomeId" UUID NOT NULL,
  "botId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outcomego_outcome_thread_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_outcome_thread_outcomeId_key" UNIQUE ("outcomeId"),
  CONSTRAINT "outcomego_outcome_thread_outcomeId_fkey"
    FOREIGN KEY ("outcomeId") REFERENCES "outcomego_outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "outcomego_run" ADD COLUMN "outcomeThreadId" UUID;
ALTER TABLE "outcomego_run" ADD CONSTRAINT "outcomego_run_outcomeThreadId_fkey"
  FOREIGN KEY ("outcomeThreadId") REFERENCES "outcomego_outcome_thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "outcomego_run_outcome_thread_id_created_at_idx" ON "outcomego_run"("outcomeThreadId", "createdAt");

CREATE TABLE "outcomego_outcome_thread_turn" (
  "id" UUID NOT NULL,
  "threadId" UUID NOT NULL,
  "purpose" "outcomego_outcome_thread_turn_purpose" NOT NULL,
  "trigger" TEXT NOT NULL,
  "triggerBy" TEXT NOT NULL,
  "status" "outcomego_outcome_thread_turn_status" NOT NULL DEFAULT 'queued',
  "runId" UUID,
  "reply" TEXT,
  "error" JSONB,
  "clientRequestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_outcome_thread_turn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_outcome_thread_turn_runId_key" UNIQUE ("runId"),
  CONSTRAINT "outcomego_outcome_thread_turn_thread_id_client_request_id_key" UNIQUE ("threadId", "clientRequestId"),
  CONSTRAINT "outcomego_outcome_thread_turn_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "outcomego_outcome_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_outcome_thread_turn_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "outcomego_run"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "outcomego_outcome_thread_turn_thread_id_created_at_idx"
  ON "outcomego_outcome_thread_turn"("threadId", "createdAt");
