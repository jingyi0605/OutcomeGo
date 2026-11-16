import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";
import { applyRawSchema } from "./apply-raw-schema";

config({ path: join(import.meta.dirname, "..", "..", "..", ".env"), quiet: true });

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://outcomego:outcomego@127.0.0.1:5432/outcomego";
const SCHEMA_VERSION = "outcomego-v1";
const schemaFingerprint = createHash("sha256")
  .update(await readFile(join(import.meta.dirname, "..", "prisma", "schema.prisma")))
  .update("\0")
  .update(await readFile(join(import.meta.dirname, "..", "prisma", "sql", "raw-schema.sql")))
  .digest("hex");
const READY_PREFIX = `OutcomeGo schema ready: ${SCHEMA_VERSION}:`;
const INITIALIZING_PREFIX = `OutcomeGo schema initializing: ${SCHEMA_VERSION}:`;
const INITIALIZING_MARKER = `${INITIALIZING_PREFIX}${schemaFingerprint}`;
const READY_MARKER = `${READY_PREFIX}${schemaFingerprint}`;

const assertFreshOrCurrentDatabase = async (): Promise<"initialize" | "ready"> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const existing = await client.query<{ has_objects: boolean }>(`
      SELECT (
        EXISTS (
          SELECT 1 FROM pg_class
          WHERE relnamespace = current_schema()::regnamespace
            AND relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        ) OR EXISTS (
          SELECT 1 FROM pg_type
          WHERE typnamespace = current_schema()::regnamespace
            AND typtype IN ('e', 'd')
        ) OR EXISTS (
          SELECT 1 FROM pg_proc
          WHERE pronamespace = current_schema()::regnamespace
        )
      ) AS has_objects
    `);
    const schemaResult = await client.query<{ comment: string | null }>(`
      SELECT obj_description(n.oid, 'pg_namespace') AS comment
      FROM pg_namespace n
      WHERE n.nspname = current_schema()
    `);
    const schemaComment = schemaResult.rows[0]?.comment ?? null;

    if (
      !existing.rows[0]?.has_objects &&
      (schemaComment === null || schemaComment === "standard public schema")
    ) {
      return "initialize";
    }
    if (schemaComment === READY_MARKER && existing.rows[0]?.has_objects) return "ready";
    if (schemaComment === INITIALIZING_MARKER) return "initialize";
    if (
      (schemaComment?.startsWith(READY_PREFIX) || schemaComment?.startsWith(INITIALIZING_PREFIX)) &&
      existing.rows[0]?.has_objects
    )
      return "initialize";
    if (existing.rows[0]?.has_objects) {
      throw new Error(
        "Database is not a recognized OutcomeGo schema. Refusing to modify it; create a fresh database and import a validated outcomego-v1 backup."
      );
    }
    throw new Error("Database schema marker does not match the current OutcomeGo schema. Create a fresh database for this version.");
  } finally {
    await client.end();
  }
};

const prepareSearchProjection = async (): Promise<boolean> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ is_generated: string }>(`
      SELECT is_generated
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'outcomego_search_document'
        AND column_name = 'searchVector'
    `);
    if (result.rows[0]?.is_generated !== "ALWAYS") return false;
    await client.query('ALTER TABLE "outcomego_search_document" ALTER COLUMN "searchVector" DROP EXPRESSION');
    return true;
  } finally {
    await client.end();
  }
};

// db push without --accept-data-loss refuses to drop storage that still holds values, so
// storage the app no longer has is dropped here first. Every statement is a no-op once done.
const MEMORY_UUID_BODY = "([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const MEMORY_NAMESPACE_PATTERN = `^(user:)?agent:(${MEMORY_UUID_BODY}|[{]${MEMORY_UUID_BODY}[}])$`;

const RETIRE_UNUSED_STORAGE = `
DO $$
DECLARE
  memory_namespace_changed boolean := false;
BEGIN
  IF to_regclass('"outcomego_memory_fact"') IS NOT NULL THEN
    -- UUID values are case-insensitive, but namespace text was not. Preserve
    -- existing facts and history when converging legacy UUID spellings.
    WITH canonical AS MATERIALIZED (
      SELECT "id", CASE WHEN "namespace" ~* '^user:agent:' THEN 'user:agent:' ELSE 'agent:' END
        || (regexp_replace("namespace", '^(user:)?agent:', '', 'i')::uuid)::text AS value
      FROM "outcomego_memory_fact" WHERE "namespace" ~* '${MEMORY_NAMESPACE_PATTERN}'
    ), changed AS (
      UPDATE "outcomego_memory_fact" AS fact SET "namespace" = canonical.value
      FROM canonical WHERE fact."id" = canonical."id" AND fact."namespace" <> canonical.value
      RETURNING fact."id"
    ) SELECT EXISTS (SELECT 1 FROM changed) INTO memory_namespace_changed;
    IF memory_namespace_changed THEN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
          AND table_name = 'outcomego_context_prompt_snapshot' AND column_name = 'promptSections') THEN
        UPDATE "outcomego_context_prompt_snapshot" SET "promptSections" = "promptSections" - 'memory' WHERE "promptSections" ? 'memory';
      END IF;
      IF to_regclass('"outcomego_memory_revision"') IS NOT NULL THEN
        INSERT INTO "outcomego_memory_revision" ("scope", "revision") VALUES ('user', 1)
          ON CONFLICT ("scope") DO UPDATE SET "revision" = "outcomego_memory_revision"."revision" + 1;
      ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
          AND table_name = 'outcomego_bot' AND column_name = 'memoryRevision') THEN
        UPDATE "outcomego_bot" SET "memoryRevision" = "memoryRevision" + 1;
      END IF;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'outcomego_context_prompt_snapshot' AND column_name = 'memoryAudienceKey') THEN
    -- Frozen memory from the old prompt layout re-renders once.
    UPDATE "outcomego_context_prompt_snapshot" SET "promptSections" = "promptSections" - 'memory';
  END IF;
  IF to_regclass('"outcomego_subagent"') IS NOT NULL THEN
    UPDATE "outcomego_subagent" SET "subagentType" = 'computerUse' WHERE "subagentType" = 'browserUse';
    UPDATE "outcomego_subagent" SET "taskConfiguration" = "taskConfiguration" - 'combinedComputerUse'
      WHERE "taskConfiguration" ? 'combinedComputerUse';
  END IF;
  IF to_regclass('"outcomego_run"') IS NOT NULL THEN
    UPDATE "outcomego_run" SET "taskConfiguration" = "taskConfiguration" - 'combinedComputerUse'
      WHERE "taskConfiguration" ? 'combinedComputerUse';
  END IF;
  IF to_regclass('"outcomego_task_settings"') IS NOT NULL THEN
    UPDATE "outcomego_task_settings" SET "configuration" = "configuration" - 'combinedComputerUse'
      WHERE "configuration" ? 'combinedComputerUse';
  END IF;
  IF to_regclass('"outcomego_plugin_installation"') IS NOT NULL THEN
    -- An installed package that named browserUse becomes the rollback target after its update,
    -- and rollback validates skill agents.
    UPDATE "outcomego_plugin_installation" SET "manifest" = jsonb_set("manifest", '{skills}', (
      SELECT jsonb_agg(CASE WHEN skill->'agents' ? 'browserUse'
        THEN jsonb_set(skill, '{agents}', ((skill->'agents') - 'browserUse')
          || CASE WHEN skill->'agents' ? 'computerUse' THEN '[]'::jsonb ELSE '["computerUse"]'::jsonb END)
        ELSE skill END ORDER BY position)
      FROM jsonb_array_elements("manifest"->'skills') WITH ORDINALITY AS skills(skill, position)))
    WHERE "manifest" @> '{"skills":[{"agents":["browserUse"]}]}';
  END IF;
  IF to_regclass('"outcomego_idempotency_record"') IS NOT NULL THEN
    -- Receipts of the removed SendFeedback tool.
    DELETE FROM "outcomego_idempotency_record" WHERE "scope" = 'feedback-send';
  END IF;
  IF to_regclass('"outcomego_channel_message"') IS NOT NULL THEN
    -- Approval cards of the removed Auto-review.
    DELETE FROM "outcomego_channel_message" WHERE "metadata"->>'type' = 'approval';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typnamespace = current_schema()::regnamespace AND t.typname = 'MemoryScope'
        AND e.enumlabel NOT IN ('agent', 'user')) THEN
    DELETE FROM "outcomego_memory_fact" WHERE "scope"::text NOT IN ('agent', 'user');
    ALTER TYPE "MemoryScope" RENAME TO "MemoryScope_retired";
    CREATE TYPE "MemoryScope" AS ENUM ('agent', 'user');
    ALTER TABLE "outcomego_memory_fact" ALTER COLUMN "scope" TYPE "MemoryScope" USING "scope"::text::"MemoryScope";
    DROP TYPE "MemoryScope_retired";
  END IF;
END $$;
ALTER TABLE IF EXISTS "outcomego_memory_fact" DROP COLUMN IF EXISTS "memoryConversationId",
  DROP COLUMN IF EXISTS "sourcePath", DROP COLUMN IF EXISTS "sourceLine", DROP COLUMN IF EXISTS "projectSlug";
ALTER TABLE IF EXISTS "outcomego_run" DROP COLUMN IF EXISTS "memoryConversationId";
DROP TABLE IF EXISTS "outcomego_memory_conversation";
DROP TABLE IF EXISTS "outcomego_project_member";
DROP TABLE IF EXISTS "outcomego_project";
-- Every turn runs in a context session and freezes its prompt there, so no per-bot snapshot is kept.
DROP TABLE IF EXISTS "outcomego_agent_prompt_snapshot";
ALTER TABLE IF EXISTS "outcomego_bot" DROP COLUMN IF EXISTS "dreamingEnabled",
  DROP COLUMN IF EXISTS "episodePending", DROP COLUMN IF EXISTS "episodeTurns";
ALTER TABLE IF EXISTS "outcomego_context_prompt_snapshot" DROP COLUMN IF EXISTS "memoryEpoch",
  DROP COLUMN IF EXISTS "memoryRender", DROP COLUMN IF EXISTS "memoryHasFacts",
  DROP COLUMN IF EXISTS "memoryAudienceKey";
ALTER TABLE IF EXISTS "outcomego_subagent" DROP COLUMN IF EXISTS "combinedComputerUse";
-- Every Task runs in the background, and typed or parent messages start new turns instead of
-- steering a running one, so neither the foreground flag nor the steer inbox is stored anymore.
ALTER TABLE IF EXISTS "outcomego_subagent" DROP COLUMN IF EXISTS "runInBackground";
ALTER TABLE IF EXISTS "outcomego_subagent_attempt" DROP COLUMN IF EXISTS "runInBackground";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'outcomego_inbox_event' AND column_name = 'deliveryMode') THEN
    DELETE FROM "outcomego_inbox_event" WHERE "deliveryMode"::text = 'steer';
    ALTER TABLE "outcomego_inbox_event" DROP COLUMN "deliveryMode";
  END IF;
END $$;
DROP TYPE IF EXISTS "InboxDeliveryMode";
-- Auto-review's settings and Allow / Ask first rules.
DROP TABLE IF EXISTS "AutoReviewSettings";
`;

const retireUnusedStorage = async () => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(RETIRE_UNUSED_STORAGE);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
};


const markSchema = async (marker: string): Promise<void> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ schema: string }>("SELECT current_schema() AS schema");
    const schema = `"${result.rows[0]!.schema.replaceAll('"', '""')}"`;
    await client.query(`COMMENT ON SCHEMA ${schema} IS '${marker}'`);
  } finally {
    await client.end();
  }
};

if ((await assertFreshOrCurrentDatabase()) === "ready") process.exit(0);

// A matching initializing marker lets an interrupted first install retry without admitting older schemas.
await markSchema(INITIALIZING_MARKER);

await retireUnusedStorage();
const schemaWasPrepared = await prepareSearchProjection();
const prisma = Bun.spawn(
  [
    join(import.meta.dirname, "..", "node_modules", ".bin", "prisma"),
    "db",
    "push",
    "--config",
    "prisma.config.ts",
  ],
  {
    cwd: join(import.meta.dirname, ".."),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }
);

const status = await prisma.exited;
if (status === 0 || schemaWasPrepared) await applyRawSchema();
if (status !== 0) process.exit(status);
await markSchema(READY_MARKER);
