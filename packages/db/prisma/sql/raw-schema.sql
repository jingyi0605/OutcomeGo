-- Database objects Prisma's schema language cannot express.
--
-- `prisma db push` creates everything declared in schema.prisma. This file adds the
-- rest: the search projection table and its trigger-maintained refresh functions, the
-- event wakeup notifier, and the check constraints and defaults Prisma does not model.
--
-- It runs after every `db push` (see packages/db/scripts/apply-raw-schema.ts) and must
-- stay idempotent: re-running it on an up-to-date database is a no-op.

-- Search projection -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "outcomego_search_document" (
    "id" text NOT NULL,
    "kind" text NOT NULL,
    "sourceType" text NOT NULL,
    "sourceId" uuid NOT NULL,
    "entityId" text NOT NULL,
    "channelId" uuid,
    "messageId" uuid,
    "botId" uuid,
    "title" text DEFAULT ''::text NOT NULL,
    "subtitle" text DEFAULT ''::text NOT NULL,
    "content" text DEFAULT ''::text NOT NULL,
    "url" text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "searchVector" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('simple'::regconfig, COALESCE("title", ''::text)), 'A'::"char") ||
      setweight(to_tsvector('simple'::regconfig, COALESCE("subtitle", ''::text)), 'B'::"char") ||
      setweight(to_tsvector('simple'::regconfig, COALESCE("content", ''::text)), 'C'::"char")
    ) STORED,
    CONSTRAINT "outcomego_search_document_pkey" PRIMARY KEY ("id")
);

-- Prisma cannot express the generated tsvector column or the kind constraint.
ALTER TABLE "outcomego_search_document" DROP CONSTRAINT IF EXISTS "outcomego_search_document_kind_check";
ALTER TABLE "outcomego_search_document" ADD CONSTRAINT "outcomego_search_document_kind_check" CHECK (
  "kind" = ANY (ARRAY['message'::text, 'bot'::text, 'channel'::text, 'file'::text, 'link'::text, 'routine'::text])
);

CREATE INDEX IF NOT EXISTS "outcomego_search_document_kind_updated_at_idx" ON "outcomego_search_document" USING btree ("kind", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "outcomego_search_document_search_vector_idx" ON "outcomego_search_document" USING gin ("searchVector");
CREATE INDEX IF NOT EXISTS "outcomego_search_document_source_idx" ON "outcomego_search_document" USING btree ("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "outcomego_search_document_title_exact_hash_idx" ON "outcomego_search_document" USING btree (md5(lower("title")));

-- Constraints and defaults Prisma does not model -------------------------------------

-- A routine belongs to exactly one owner: a bot or a channel, never both or neither.
ALTER TABLE "outcomego_routine" DROP CONSTRAINT IF EXISTS "outcomego_routine_exactly_one_owner_check";
ALTER TABLE "outcomego_routine" ADD CONSTRAINT "outcomego_routine_exactly_one_owner_check"
  CHECK (("botId" IS NOT NULL) <> ("channelId" IS NOT NULL));

ALTER TABLE "outcomego_subagent_attempt" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- External messaging (specs/009). Status vocabularies and lifecycle invariants that Prisma
-- stores as plain text. A receipt exists only in a terminal state, and a delivery holds a
-- dispatch lease exactly while it is not terminal.
ALTER TABLE "outcomego_external_messaging_binding" DROP CONSTRAINT IF EXISTS "outcomego_external_messaging_binding_valid";
ALTER TABLE "outcomego_external_messaging_binding" ADD CONSTRAINT "outcomego_external_messaging_binding_valid" CHECK (
  "inboundPolicy" = 'owner_only'
  AND "status" IN ('active', 'needs_attention')
  AND ("inboundCursor" IS NULL OR char_length("inboundCursor") <= 2048)
  AND "reminderTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND ("lastReminderOutcome" IS NULL OR "lastReminderOutcome" IN ('sent', 'failed', 'uncertain'))
);
ALTER TABLE "outcomego_external_channel_mapping" DROP CONSTRAINT IF EXISTS "outcomego_external_channel_mapping_valid";
ALTER TABLE "outcomego_external_channel_mapping" ADD CONSTRAINT "outcomego_external_channel_mapping_valid" CHECK (
  "peerType" = 'direct'
  AND "status" IN ('active', 'archived')
  AND char_length("peerId") BETWEEN 1 AND 256
  AND ("displayName" IS NULL OR char_length("displayName") <= 120)
);
ALTER TABLE "outcomego_external_message_receipt" DROP CONSTRAINT IF EXISTS "outcomego_external_message_receipt_valid";
ALTER TABLE "outcomego_external_message_receipt" ADD CONSTRAINT "outcomego_external_message_receipt_valid" CHECK (
  "status" IN ('accepted', 'rejected')
  AND ("status" = 'rejected') = ("rejectionCode" IS NOT NULL)
  AND "payloadHash" ~ '^[0-9a-f]{64}$'
  AND char_length("providerMessageId") BETWEEN 1 AND 256
);
ALTER TABLE "outcomego_external_outbound_delivery" DROP CONSTRAINT IF EXISTS "outcomego_external_outbound_delivery_valid";
ALTER TABLE "outcomego_external_outbound_delivery" ADD CONSTRAINT "outcomego_external_outbound_delivery_valid" CHECK (
  "status" IN ('pending', 'sending', 'sent', 'failed', 'uncertain')
  AND ("errorMessage" IS NULL OR char_length("errorMessage") <= 500)
  AND (
    ("status" IN ('pending', 'sending') AND "deliveryLeaseOwner" IS NOT NULL AND "deliveryLeaseExpiresAt" IS NOT NULL)
    OR ("status" IN ('sent', 'failed', 'uncertain') AND "deliveryLeaseOwner" IS NULL AND "deliveryLeaseExpiresAt" IS NULL)
  )
);

-- Trigger functions ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.outcomego_notify_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- The listener only needs a wakeup. An identical payload lets PostgreSQL
  -- coalesce many Event inserts from one transaction into one notification.
  PERFORM pg_notify('outcomego_events', '');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.outcomego_refresh_bot_search()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM "outcomego_search_document"
  WHERE "sourceType" = 'bot' AND "sourceId" = COALESCE(NEW."id", OLD."id");

  IF TG_OP <> 'DELETE' AND NEW."status" <> 'archived' THEN
    INSERT INTO "outcomego_search_document" (
      "id", "kind", "sourceType", "sourceId", "entityId", "botId",
      "title", "subtitle", "content", "createdAt", "updatedAt"
    ) VALUES (
      'bot:' || NEW."id", 'bot', 'bot', NEW."id", NEW."id"::text, NEW."id",
      NEW."name", coalesce(NULLIF(NEW."title", ''), ''),
      NEW."description",
      NEW."createdAt", NEW."updatedAt"
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.outcomego_refresh_channel_search()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM "outcomego_search_document"
  WHERE "sourceType" = 'channel' AND "sourceId" = COALESCE(NEW."id", OLD."id");

  IF TG_OP <> 'DELETE' AND NEW."archivedAt" IS NULL AND NEW."kind" = 'group' THEN
    INSERT INTO "outcomego_search_document" (
      "id", "kind", "sourceType", "sourceId", "entityId", "channelId",
      "title", "subtitle", "content", "createdAt", "updatedAt"
    ) VALUES (
      'channel:' || NEW."id", 'channel', 'channel', NEW."id", NEW."id"::text, NEW."id",
      NEW."name",
      CASE NEW."kind" WHEN 'group' THEN 'Channel' WHEN 'agent_dm' THEN 'Bot conversation' ELSE 'Chat' END,
      coalesce(NEW."workingDirectory", ''), NEW."createdAt", NEW."updatedAt"
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.outcomego_refresh_message_search()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  attachment JSONB;
  attachment_index INTEGER := 0;
  matched TEXT[];
  clean_url TEXT;
BEGIN
  -- Reactions and unrelated metadata do not affect search.
  IF TG_OP = 'UPDATE'
    AND NEW."content" IS NOT DISTINCT FROM OLD."content"
    AND (NEW."metadata"::jsonb -> 'attachments')
      IS NOT DISTINCT FROM (OLD."metadata"::jsonb -> 'attachments') THEN
    RETURN NEW;
  END IF;

  DELETE FROM "outcomego_search_document"
  WHERE "sourceType" = 'channel_message' AND "sourceId" = COALESCE(NEW."id", OLD."id");

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF btrim(NEW."content") <> '' THEN
    INSERT INTO "outcomego_search_document" (
      "id", "kind", "sourceType", "sourceId", "entityId", "channelId", "messageId", "botId",
      "title", "content", "createdAt", "updatedAt"
    ) VALUES (
      'message:' || NEW."id", 'message', 'channel_message', NEW."id", NEW."id"::text,
      NEW."channelId", NEW."id", NEW."senderBotId", NEW."content", '',
      NEW."createdAt", NEW."createdAt"
    );

    FOR matched IN
      SELECT DISTINCT regexp_matches(NEW."content", 'https?://[^[:space:]<>"'']+', 'gi')
    LOOP
      clean_url := regexp_replace(matched[1], '[.,;:!?)}\]]+$', '');
      IF clean_url <> '' THEN
        INSERT INTO "outcomego_search_document" (
          "id", "kind", "sourceType", "sourceId", "entityId", "channelId", "messageId", "botId",
          "title", "subtitle", "content", "url", "createdAt", "updatedAt"
        ) VALUES (
          'link:' || NEW."id" || ':' || md5(clean_url), 'link', 'channel_message', NEW."id",
          NEW."id"::text || ':' || md5(clean_url), NEW."channelId", NEW."id", NEW."senderBotId",
          clean_url, 'Shared link', '', clean_url, NEW."createdAt", NEW."createdAt"
        ) ON CONFLICT ("id") DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  IF jsonb_typeof(NEW."metadata"::jsonb -> 'attachments') = 'array'
    AND jsonb_array_length(NEW."metadata"::jsonb -> 'attachments') > 0 THEN
    FOR attachment IN
      SELECT value FROM jsonb_array_elements(NEW."metadata"::jsonb -> 'attachments')
    LOOP
      INSERT INTO "outcomego_search_document" (
        "id", "kind", "sourceType", "sourceId", "entityId", "channelId", "messageId", "botId",
        "title", "subtitle", "content", "url", "createdAt", "updatedAt"
      ) VALUES (
        'file:' || NEW."id" || ':' || attachment_index, 'file', 'channel_message', NEW."id",
        NEW."id"::text || ':' || attachment_index, NEW."channelId", NEW."id", NEW."senderBotId",
        coalesce(NULLIF(attachment ->> 'fileName', ''), NULLIF(attachment ->> 'alt', ''), 'Attachment'),
        concat_ws(' · ', NULLIF(attachment ->> 'kind', ''), NULLIF(attachment ->> 'mimeType', '')),
        coalesce(attachment ->> 'alt', ''),
        CASE
          WHEN attachment ->> 'assetId' ~ '^[a-f0-9]{64}$'
            THEN '/api/v0/assets/' || (attachment ->> 'assetId')
          ELSE NULL
        END,
        NEW."createdAt", NEW."createdAt"
      );
      attachment_index := attachment_index + 1;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.outcomego_refresh_routine_search()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM "outcomego_search_document"
  WHERE "sourceType" = 'routine' AND "sourceId" = COALESCE(NEW."id", OLD."id");

  IF TG_OP <> 'DELETE' AND NEW."deletedAt" IS NULL THEN
    INSERT INTO "outcomego_search_document" (
      "id", "kind", "sourceType", "sourceId", "entityId", "channelId", "botId",
      "title", "subtitle", "content", "createdAt", "updatedAt"
    ) VALUES (
      'routine:' || NEW."id", 'routine', 'routine', NEW."id", NEW."id"::text,
      NEW."channelId", NEW."botId", NEW."name", NEW."scheduleText", NEW."prompt",
      NEW."createdAt", NEW."updatedAt"
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

-- Triggers ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS "outcomego_bot_search_refresh" ON "outcomego_bot";
CREATE TRIGGER "outcomego_bot_search_refresh" AFTER INSERT OR DELETE OR UPDATE ON "outcomego_bot"
  FOR EACH ROW EXECUTE FUNCTION public.outcomego_refresh_bot_search();

DROP TRIGGER IF EXISTS "outcomego_channel_search_refresh" ON "outcomego_channel";
CREATE TRIGGER "outcomego_channel_search_refresh" AFTER INSERT OR DELETE OR UPDATE ON "outcomego_channel"
  FOR EACH ROW EXECUTE FUNCTION public.outcomego_refresh_channel_search();

DROP TRIGGER IF EXISTS "outcomego_routine_search_refresh" ON "outcomego_routine";
CREATE TRIGGER "outcomego_routine_search_refresh" AFTER INSERT OR DELETE OR UPDATE ON "outcomego_routine"
  FOR EACH ROW EXECUTE FUNCTION public.outcomego_refresh_routine_search();

DROP TRIGGER IF EXISTS "outcomego_channel_message_search_refresh" ON "outcomego_channel_message";
CREATE TRIGGER "outcomego_channel_message_search_refresh" AFTER INSERT OR DELETE OR UPDATE ON "outcomego_channel_message"
  FOR EACH ROW EXECUTE FUNCTION public.outcomego_refresh_message_search();

DROP TRIGGER IF EXISTS outcomego_event_notify ON "outcomego_event";
CREATE TRIGGER outcomego_event_notify AFTER INSERT ON "outcomego_event"
  FOR EACH ROW EXECUTE FUNCTION public.outcomego_notify_event();

-- The current Prisma schema owns the complete provider schedule shape. This script only
-- installs constraints that Prisma cannot express; it does not convert older table shapes.
ALTER TABLE "outcomego_web_search_settings" DROP CONSTRAINT IF EXISTS "outcomego_web_search_settings_valid";
ALTER TABLE "outcomego_web_fetch_settings" DROP CONSTRAINT IF EXISTS "outcomego_web_fetch_settings_valid";
ALTER TABLE "outcomego_web_tool_provider" DROP CONSTRAINT IF EXISTS "outcomego_web_tool_provider_valid";

CREATE OR REPLACE FUNCTION public.outcomego_valid_provider_schedule(schedule JSONB, allowed TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(schedule) IS DISTINCT FROM 'array' THEN FALSE
    ELSE jsonb_array_length(schedule) = (
      SELECT count(DISTINCT item.value)
      FROM jsonb_array_elements(schedule) AS item(value)
    ) AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(schedule) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
         OR item.value #>> '{}' <> ALL (allowed)
    )
  END
$function$;

ALTER TABLE "outcomego_web_search_settings" ADD CONSTRAINT "outcomego_web_search_settings_valid" CHECK (
  "id" = 'global' AND public.outcomego_valid_provider_schedule("providers", ARRAY[
    'exa', 'brave', 'parallel', 'firecrawl', 'bing-serpapi', 'perplexity', 'deepseek'
  ]) AND "strategy" IN ('round_robin', 'failover') AND "cursor" >= 0
);
ALTER TABLE "outcomego_web_fetch_settings" ADD CONSTRAINT "outcomego_web_fetch_settings_valid" CHECK (
  "id" = 'global' AND public.outcomego_valid_provider_schedule("providers", ARRAY[
    'builtin', 'exa', 'parallel', 'firecrawl', 'deepseek'
  ]) AND "strategy" IN ('round_robin', 'failover') AND "cursor" >= 0
);
ALTER TABLE "outcomego_voice_settings" DROP CONSTRAINT IF EXISTS "outcomego_voice_settings_provider_valid";
ALTER TABLE "outcomego_voice_settings" ADD CONSTRAINT "outcomego_voice_settings_provider_valid"
  CHECK ("provider" IN ('volcengine', 'deepgram'));
ALTER TABLE "outcomego_web_tool_provider" ADD CONSTRAINT "outcomego_web_tool_provider_valid" CHECK (
  (("tool" = 'search' AND "provider" IN (
    'exa', 'brave', 'parallel', 'firecrawl', 'bing-serpapi', 'perplexity', 'deepseek'
  )) OR ("tool" = 'fetch' AND "provider" IN (
    'builtin', 'exa', 'parallel', 'firecrawl', 'deepseek'
  ))) AND
  ("secret" IS NULL OR length(btrim("secret")) > 0) AND
  ("checkStatus" IS NULL OR "checkStatus" IN ('passed', 'failed')) AND
  (("checkStatus" IS NULL) = ("checkedAt" IS NULL))
);

-- Group task board (specs/010-群任务看板). No assignee rule: deleting a Bot sets its assignments to NULL.
ALTER TABLE "outcomego_group_task" DROP CONSTRAINT IF EXISTS "outcomego_group_task_valid";
ALTER TABLE "outcomego_group_task" ADD CONSTRAINT "outcomego_group_task_valid" CHECK (
  "number" > 0 AND "revision" > 0 AND
  char_length("title") BETWEEN 1 AND 200 AND char_length("titleKey") > 0 AND
  (("status" IN ('done', 'cancelled')) = ("completedAt" IS NOT NULL)) AND
  ("parentId" IS NULL OR "parentId" <> "id")
);

-- Preserve deletion markers from deployments that only recorded them in the event replay log.
INSERT INTO "outcomego_retired_agent" ("id", "retiredAt")
SELECT "entityId", MIN("createdAt") FROM "outcomego_event"
WHERE "topic" IN ('channel.deleted', 'bot.archived') AND "entityId" IS NOT NULL
GROUP BY "entityId"
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "outcomego_retired_agent" ("id", "retiredAt")
SELECT "id", "updatedAt" FROM "outcomego_bot" WHERE "status" = 'archived'
ON CONFLICT ("id") DO NOTHING;
