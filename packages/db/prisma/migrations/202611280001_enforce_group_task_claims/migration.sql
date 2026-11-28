ALTER TABLE "outcomego_run" ADD COLUMN "groupTaskId" UUID;
ALTER TABLE "outcomego_run" ADD CONSTRAINT "outcomego_run_groupTaskId_fkey"
  FOREIGN KEY ("groupTaskId") REFERENCES "outcomego_group_task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "outcomego_run_group_task_id_idx" ON "outcomego_run"("groupTaskId");

CREATE TABLE "outcomego_group_task_request" (
  "requestId" UUID PRIMARY KEY,
  "taskId" UUID NOT NULL,
  CONSTRAINT "outcomego_group_task_request_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "outcomego_group_task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "outcomego_group_task_request_task_id_idx" ON "outcomego_group_task_request"("taskId");
