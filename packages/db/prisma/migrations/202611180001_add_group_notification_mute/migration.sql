ALTER TABLE "outcomego_channel"
  ADD COLUMN "notificationsMuted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mutedThroughNotificationSequence" BIGINT NOT NULL DEFAULT 0;
