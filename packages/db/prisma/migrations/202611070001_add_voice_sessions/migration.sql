CREATE TYPE "outcomego_voice_session_status" AS ENUM ('created', 'active', 'closing', 'ended', 'failed');
CREATE TYPE "outcomego_voice_turn_status" AS ENUM ('listening', 'processing', 'speaking', 'output_paused', 'completed', 'superseded', 'interrupted', 'cancelled', 'failed');

CREATE TABLE "outcomego_voice_session" (
  "id" UUID NOT NULL,
  "botId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "ownerSessionId" TEXT,
  "clientPlatform" TEXT NOT NULL,
  "clientInstanceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" "outcomego_voice_session_status" NOT NULL DEFAULT 'created',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "closeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_voice_session_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "outcomego_voice_turn" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "runId" UUID,
  "userMessageId" TEXT,
  "status" "outcomego_voice_turn_status" NOT NULL DEFAULT 'listening',
  "transcript" TEXT,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "language" TEXT,
  "providerMetadata" JSONB,
  "assistantMessageIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "generation" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_voice_turn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outcomego_voice_turn_run_id_key" ON "outcomego_voice_turn"("runId");
CREATE INDEX "outcomego_voice_session_owner_session_id_status_expires_at_idx" ON "outcomego_voice_session"("ownerSessionId", "status", "expiresAt");
CREATE INDEX "outcomego_voice_session_bot_id_status_expires_at_idx" ON "outcomego_voice_session"("botId", "status", "expiresAt");
CREATE INDEX "outcomego_voice_session_channel_id_created_at_idx" ON "outcomego_voice_session"("channelId", "createdAt");
CREATE INDEX "outcomego_voice_turn_session_id_created_at_idx" ON "outcomego_voice_turn"("sessionId", "createdAt");
CREATE INDEX "outcomego_voice_turn_session_id_status_idx" ON "outcomego_voice_turn"("sessionId", "status");
ALTER TABLE "outcomego_voice_session" ADD CONSTRAINT "outcomego_voice_session_bot_id_fkey" FOREIGN KEY ("botId") REFERENCES "outcomego_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcomego_voice_session" ADD CONSTRAINT "outcomego_voice_session_conversation_id_fkey" FOREIGN KEY ("conversationId") REFERENCES "outcomego_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcomego_voice_session" ADD CONSTRAINT "outcomego_voice_session_channel_id_fkey" FOREIGN KEY ("channelId") REFERENCES "outcomego_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcomego_voice_session" ADD CONSTRAINT "outcomego_voice_session_owner_session_id_fkey" FOREIGN KEY ("ownerSessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcomego_voice_turn" ADD CONSTRAINT "outcomego_voice_turn_session_id_fkey" FOREIGN KEY ("sessionId") REFERENCES "outcomego_voice_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcomego_voice_turn" ADD CONSTRAINT "outcomego_voice_turn_run_id_fkey" FOREIGN KEY ("runId") REFERENCES "outcomego_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
