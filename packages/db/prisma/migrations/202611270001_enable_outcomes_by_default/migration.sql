-- Goal management is on unless the owner switched it off. Stored rows keep their value.
ALTER TABLE "outcomego_feature_settings" ALTER COLUMN "outcomesEnabled" SET DEFAULT true;
