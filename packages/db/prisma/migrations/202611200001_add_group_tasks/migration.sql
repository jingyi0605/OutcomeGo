CREATE TYPE "outcomego_group_task_status" AS ENUM ('open', 'in_progress', 'blocked', 'done', 'cancelled');

CREATE TABLE "outcomego_group_task" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "parentId" UUID,
  "title" TEXT NOT NULL,
  "titleKey" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "outcomego_group_task_status" NOT NULL DEFAULT 'open',
  "creatorBotId" UUID,
  "assigneeBotId" UUID,
  "note" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "clientRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "outcomego_group_task_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_group_task_channel_id_number_key" UNIQUE ("channelId", "number"),
  CONSTRAINT "outcomego_group_task_channel_id_client_request_id_key" UNIQUE ("channelId", "clientRequestId"),
  CONSTRAINT "outcomego_group_task_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "outcomego_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_group_task_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "outcomego_group_task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_group_task_creatorBotId_fkey"
    FOREIGN KEY ("creatorBotId") REFERENCES "outcomego_bot"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "outcomego_group_task_assigneeBotId_fkey"
    FOREIGN KEY ("assigneeBotId") REFERENCES "outcomego_bot"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "outcomego_group_task_channel_id_status_idx" ON "outcomego_group_task"("channelId", "status");
CREATE INDEX "outcomego_group_task_channel_id_parent_id_idx" ON "outcomego_group_task"("channelId", "parentId");
CREATE INDEX "outcomego_group_task_assignee_bot_id_idx" ON "outcomego_group_task"("assigneeBotId");

ALTER TABLE "outcomego_group_task" ADD CONSTRAINT "outcomego_group_task_valid" CHECK (
  "number" > 0 AND "revision" > 0 AND
  char_length("title") BETWEEN 1 AND 200 AND char_length("titleKey") > 0 AND
  (("status" IN ('done', 'cancelled')) = ("completedAt" IS NOT NULL)) AND
  ("parentId" IS NULL OR "parentId" <> "id")
);
