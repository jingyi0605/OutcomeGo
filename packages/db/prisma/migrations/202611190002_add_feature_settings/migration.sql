CREATE TABLE "outcomego_feature_settings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "outcomesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_feature_settings_pkey" PRIMARY KEY ("id")
);
