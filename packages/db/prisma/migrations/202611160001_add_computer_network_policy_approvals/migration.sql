CREATE TYPE "outcomego_computer_network_policy_approval_status" AS ENUM ('verification_pending', 'approval_pending', 'approved', 'denied', 'expired');

CREATE TABLE "outcomego_computer_network_policy_approval" (
  "id" UUID NOT NULL,
  "botId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "sourceRunId" UUID NOT NULL,
  "sourceCallId" TEXT NOT NULL,
  "widgetMessageId" UUID,
  "expectedRevision" INTEGER NOT NULL,
  "mode" TEXT NOT NULL,
  "rules" JSONB NOT NULL,
  "status" "outcomego_computer_network_policy_approval_status" NOT NULL DEFAULT 'verification_pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "outcomego_computer_network_policy_approval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_computer_network_policy_approval_call_key" UNIQUE ("sourceRunId", "sourceCallId"),
  CONSTRAINT "outcomego_computer_network_policy_approval_widgetMessageId_key" UNIQUE ("widgetMessageId"),
  CONSTRAINT "outcomego_computer_network_policy_approval_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "outcomego_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_computer_network_policy_approval_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "outcomego_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_computer_network_policy_approval_sourceRunId_fkey"
    FOREIGN KEY ("sourceRunId") REFERENCES "outcomego_run"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "outcomego_computer_network_policy_approval_lookup_idx"
  ON "outcomego_computer_network_policy_approval" ("botId", "channelId", "status", "createdAt");

CREATE INDEX "outcomego_computer_network_policy_approval_source_run_idx"
  ON "outcomego_computer_network_policy_approval" ("sourceRunId", "status");
