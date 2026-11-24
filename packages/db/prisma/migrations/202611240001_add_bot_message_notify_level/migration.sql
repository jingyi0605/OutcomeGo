CREATE TYPE "outcomego_bot_message_notify_level" AS ENUM ('every_message', 'final_only');

ALTER TABLE "outcomego_notification_preferences"
  ADD COLUMN "botMessageLevel" "outcomego_bot_message_notify_level" NOT NULL DEFAULT 'every_message';
