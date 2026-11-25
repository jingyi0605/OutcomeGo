CREATE TYPE "outcomego_owner_todo_status" AS ENUM ('suggested', 'open', 'waiting', 'done', 'dismissed');
CREATE TYPE "outcomego_owner_todo_executor" AS ENUM ('owner', 'bot', 'external');
CREATE TYPE "outcomego_owner_todo_created_via" AS ENUM ('owner_ui', 'owner_chat', 'agent_turn');
CREATE TYPE "outcomego_owner_todo_accepted_by" AS ENUM ('owner', 'rule');
CREATE TYPE "outcomego_owner_todo_urgency" AS ENUM ('low', 'normal', 'high');
CREATE TYPE "outcomego_owner_todo_dismiss_reason" AS ENUM ('owner', 'expired');

CREATE TABLE "outcomego_owner_todo_item" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" "outcomego_owner_todo_status" NOT NULL DEFAULT 'open',
    "executor" "outcomego_owner_todo_executor" NOT NULL DEFAULT 'owner',
    "createdVia" "outcomego_owner_todo_created_via" NOT NULL,
    "createdByRunId" UUID,
    "createdByRoutineId" UUID,
    "authorizedByMessageId" UUID,
    "acceptedBy" "outcomego_owner_todo_accepted_by",
    "autoAcceptRuleId" UUID,
    "urgency" "outcomego_owner_todo_urgency" NOT NULL DEFAULT 'normal',
    "sourceRef" JSONB,
    "summary" TEXT,
    "dedupeKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "botId" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dueAt" TIMESTAMPTZ(3),
    "scheduledAt" TIMESTAMPTZ(3),
    "snoozeUntil" TIMESTAMPTZ(3),
    "followUpAt" TIMESTAMPTZ(3),
    "linkedOutcomeId" UUID,
    "handoffBotId" UUID,
    "handoffMessageId" UUID,
    "expiresAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "completionNote" TEXT,
    "dismissedAt" TIMESTAMPTZ(3),
    "dismissReason" "outcomego_owner_todo_dismiss_reason",
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "outcomego_owner_todo_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outcomego_owner_todo_dedupe_key" ON "outcomego_owner_todo_item"("ownerId", "dedupeKey");
CREATE INDEX "outcomego_owner_todo_owner_status_due_idx" ON "outcomego_owner_todo_item"("ownerId", "status", "dueAt");
CREATE INDEX "outcomego_owner_todo_status_expires_idx" ON "outcomego_owner_todo_item"("status", "expiresAt");
CREATE INDEX "outcomego_owner_todo_bot_status_idx" ON "outcomego_owner_todo_item"("botId", "status");
CREATE INDEX "outcomego_owner_todo_authorization_idx" ON "outcomego_owner_todo_item"("ownerId", "authorizedByMessageId");
