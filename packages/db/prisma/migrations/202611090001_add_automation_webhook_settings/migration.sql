CREATE TABLE "outcomego_automation_webhook_settings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "publicUrl" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_automation_webhook_settings_pkey" PRIMARY KEY ("id")
);
