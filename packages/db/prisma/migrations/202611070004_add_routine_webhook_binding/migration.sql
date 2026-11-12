ALTER TABLE "outcomego_automation_webhook" ADD COLUMN "routineId" UUID;

CREATE UNIQUE INDEX "outcomego_automation_webhook_routine_id_key"
ON "outcomego_automation_webhook"("routineId");

ALTER TABLE "outcomego_automation_webhook"
ADD CONSTRAINT "outcomego_automation_webhook_routine_id_fkey"
FOREIGN KEY ("routineId") REFERENCES "outcomego_routine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
