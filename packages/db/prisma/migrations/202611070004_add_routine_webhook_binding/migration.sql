ALTER TABLE "AutomationWebhook"
ADD COLUMN "routineId" UUID;

CREATE UNIQUE INDEX "AutomationWebhook_routineId_key"
ON "AutomationWebhook"("routineId");

ALTER TABLE "AutomationWebhook"
ADD CONSTRAINT "AutomationWebhook_routineId_fkey"
FOREIGN KEY ("routineId") REFERENCES "Routine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
