CREATE TABLE "AutomationWebhookSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "publicUrl" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationWebhookSettings_pkey" PRIMARY KEY ("id")
);
