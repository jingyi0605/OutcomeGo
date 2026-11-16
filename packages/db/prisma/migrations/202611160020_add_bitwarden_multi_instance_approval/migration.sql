-- Add multi-instance connection binding and candidate snapshot to BitwardenReadApproval.
ALTER TABLE "outcomego_bitwarden_read_approval"
  ADD COLUMN IF NOT EXISTS "connectionId" UUID,
  ADD COLUMN IF NOT EXISTS "instanceName" TEXT,
  ADD COLUMN IF NOT EXISTS "candidates" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'outcomego_bitwarden_read_approval_connectionId_fkey'
  ) THEN
    ALTER TABLE "outcomego_bitwarden_read_approval"
      ADD CONSTRAINT "outcomego_bitwarden_read_approval_connectionId_fkey"
      FOREIGN KEY ("connectionId") REFERENCES "outcomego_plugin_connection"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "outcomego_bitwarden_read_approval_connection_idx"
  ON "outcomego_bitwarden_read_approval" ("connectionId");
