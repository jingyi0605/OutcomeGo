CREATE TABLE "outcomego_outcome_brief" (
  "id" UUID NOT NULL,
  "outcomeId" UUID NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "brief" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outcomego_outcome_brief_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_outcome_brief_outcome_id_source_hash_key" UNIQUE ("outcomeId", "sourceHash"),
  CONSTRAINT "outcomego_outcome_brief_outcomeId_fkey"
    FOREIGN KEY ("outcomeId") REFERENCES "outcomego_outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
