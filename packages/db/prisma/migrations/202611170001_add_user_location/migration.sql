-- Add only the account-owned location table. Existing application tables are untouched.
CREATE TABLE IF NOT EXISTS "outcomego_user_location" (
  "ownerKey" TEXT NOT NULL,
  "sharingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "sharingRevision" UUID NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracyMeters" DOUBLE PRECISION,
  "capturedAt" TIMESTAMPTZ(3),
  "device" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outcomego_user_location_pkey" PRIMARY KEY ("ownerKey")
);
