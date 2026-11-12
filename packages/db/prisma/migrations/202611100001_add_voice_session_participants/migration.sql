ALTER TABLE "outcomego_voice_session"
ADD COLUMN "participantBotIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
