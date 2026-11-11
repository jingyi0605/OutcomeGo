ALTER TABLE "WebSearchSettings"
  ADD COLUMN "providers" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "strategy" TEXT NOT NULL DEFAULT 'failover',
  ADD COLUMN "cursor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WebFetchSettings"
  ADD COLUMN "providers" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "strategy" TEXT NOT NULL DEFAULT 'failover',
  ADD COLUMN "cursor" INTEGER NOT NULL DEFAULT 0;

UPDATE "WebSearchSettings"
SET "providers" = jsonb_build_array("provider")
WHERE "provider" IS NOT NULL AND "providers" = '[]'::jsonb;

UPDATE "WebFetchSettings"
SET "providers" = jsonb_build_array("provider")
WHERE "provider" IS NOT NULL AND "providers" = '[]'::jsonb;
