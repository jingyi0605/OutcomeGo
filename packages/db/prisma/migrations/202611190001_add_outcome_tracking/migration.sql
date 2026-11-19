CREATE TYPE "outcomego_outcome_tracking_mode" AS ENUM ('standard', 'tracked');

ALTER TABLE "outcomego_outcome"
  ADD COLUMN "trackingMode" "outcomego_outcome_tracking_mode" NOT NULL DEFAULT 'standard',
  ADD COLUMN "autoClosedAt" TIMESTAMP(3),
  ADD COLUMN "closeSummary" TEXT;
