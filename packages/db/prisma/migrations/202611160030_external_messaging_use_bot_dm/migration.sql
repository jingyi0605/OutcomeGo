-- External contacts now share the Bot's own chat instead of getting a Channel each (specs/009).
-- A mapping keeps only the contact's identity; `channelId` stays set on rows from the earlier design.
ALTER TABLE "outcomego_external_channel_mapping" ALTER COLUMN "channelId" DROP NOT NULL;

-- Detach the earlier per-contact conversations and archive them. History stays readable and nothing
-- is deleted.
UPDATE "outcomego_external_channel_mapping" SET "channelId" = NULL WHERE "channelId" IS NOT NULL;
UPDATE "outcomego_channel" SET "archivedAt" = now()
  WHERE "kind" = 'external_dm' AND "archivedAt" IS NULL;
