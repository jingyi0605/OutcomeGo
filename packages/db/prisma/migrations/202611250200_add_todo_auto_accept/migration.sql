ALTER TABLE "outcomego_owner_todo_item" ADD COLUMN "autoAcceptRuleName" TEXT;
CREATE INDEX "outcomego_owner_todo_rule_day_idx" ON "outcomego_owner_todo_item"("ownerId", "autoAcceptRuleId", "createdAt");

CREATE TABLE "outcomego_todo_auto_accept_rule" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "routineId" UUID,
    "botId" UUID,
    "sourceKind" VARCHAR(40),
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "lastMatchedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "outcomego_todo_auto_accept_rule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outcomego_todo_auto_accept_rule_binding" CHECK ("routineId" IS NOT NULL OR "botId" IS NOT NULL)
);

CREATE INDEX "outcomego_todo_auto_accept_owner_enabled_idx" ON "outcomego_todo_auto_accept_rule"("ownerId", "enabled", "createdAt");
