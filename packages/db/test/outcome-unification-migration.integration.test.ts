import { expect, test } from "bun:test";
import { Client } from "pg";

const migration = await Bun.file(
  new URL("../prisma/migrations/202611260001_unify_outcome_model/migration.sql", import.meta.url),
).text();
const schema = await Bun.file(new URL("../prisma/schema.prisma", import.meta.url)).text();
const database = process.env.OUTCOMEGO_TEST_DATABASE_URL;

test("the unified schema removes legacy models and keeps one Outcome table", () => {
  for (const legacyModel of ["OwnerTodoItem", "ExploreIdea", "OutcomePlanningDraft", "OutcomeTrackingMode"]) {
    expect(schema).not.toContain(`model ${legacyModel}`);
    expect(schema).not.toContain(`enum ${legacyModel}`);
  }
  expect(schema).toContain("model OutcomeAutoAcceptRule");
  expect(schema).toContain('@@map("outcomego_outcome")');
});

test("the unification migration converts legacy rows before retiring their tables", () => {
  const ownerTodoInsert = migration.indexOf('FROM "outcomego_owner_todo_item"');
  const exploreInsert = migration.indexOf('FROM "outcomego_explore_idea"');
  const ownerTodoDrop = migration.indexOf('DROP TABLE IF EXISTS "outcomego_owner_todo_item"');
  const exploreDrop = migration.indexOf('DROP TABLE "outcomego_explore_idea"');

  expect(ownerTodoInsert).toBeGreaterThanOrEqual(0);
  expect(exploreInsert).toBeGreaterThanOrEqual(0);
  expect(ownerTodoDrop).toBeGreaterThan(ownerTodoInsert);
  expect(exploreDrop).toBeGreaterThan(exploreInsert);
  expect(migration).toContain("WHEN 'done' THEN 'accepted'");
  expect(migration).toContain("WHEN 'dismissed' THEN 'cancelled'");
  expect(migration).toContain("planningDraft");
  expect(migration).toContain('DROP COLUMN "trackingMode", DROP COLUMN "sourceExploreId"');
});

test.skipIf(!database)("the unification migration upgrades the beta.24 layout without interim features", async () => {
  const client = new Client({ connectionString: database });
  const namespace = `unification_${crypto.randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${namespace}; SET search_path TO ${namespace}`);
    await client.query(`
      CREATE TYPE outcomego_routine_schedule_kind AS ENUM ('cron', 'interval', 'event');
      CREATE TYPE outcomego_routine_execution_kind AS ENUM ('scheduled', 'test');
      CREATE TYPE outcomego_outcome_status AS ENUM ('draft', 'accepted', 'cancelled');
      CREATE TYPE outcomego_outcome_tracking_mode AS ENUM ('standard', 'tracked');
      CREATE TYPE outcomego_explore_idea_status AS ENUM ('draft', 'discarded', 'converted', 'proposed_for_delivery');
      CREATE TYPE outcomego_outcome_planning_draft_status AS ENUM ('ready');
      CREATE TYPE outcomego_outcome_thread_turn_purpose AS ENUM ('plan', 'owner_message', 'replan', 'review', 'review_task');
      CREATE TYPE outcomego_outcome_thread_turn_status AS ENUM ('queued', 'running', 'failed');

      CREATE TABLE outcomego_routine (
        id uuid PRIMARY KEY, "scheduleKind" outcomego_routine_schedule_kind, trigger jsonb, "cronExpression" text
      );
      CREATE TABLE outcomego_routine_revision (id uuid PRIMARY KEY, "scheduleKind" outcomego_routine_schedule_kind);
      CREATE TABLE outcomego_routine_execution (kind outcomego_routine_execution_kind, "routineId" uuid, "routineRevisionId" uuid);
      CREATE TABLE outcomego_outcome_planning_draft (
        id uuid PRIMARY KEY, snapshot jsonb, "sourceText" text, error text, "expiresAt" timestamp
      );
      CREATE TABLE outcomego_outcome (
        id uuid PRIMARY KEY, "botId" uuid NOT NULL, title text, description text, status outcomego_outcome_status,
        "sourceExploreId" uuid, "planningDraftId" uuid, "trackingMode" outcomego_outcome_tracking_mode,
        "createdAt" timestamp, "updatedAt" timestamp, "acceptedAt" timestamp, "cancelledAt" timestamp, "closeSummary" text
      );
      CREATE TABLE outcomego_explore_idea (
        id uuid PRIMARY KEY, "botId" uuid, "sourceOutcomeId" uuid, title text, note text, "sourceReferences" jsonb,
        status outcomego_explore_idea_status, "planningDraftId" uuid, "proposedOutcomeId" uuid, "discardedAt" timestamp,
        budget jsonb, "createdAt" timestamp, "updatedAt" timestamp
      );
      CREATE TABLE outcomego_outcome_work_item (id uuid PRIMARY KEY);
      CREATE TABLE outcomego_outcome_thread_turn (
        "threadId" uuid, purpose outcomego_outcome_thread_turn_purpose, status outcomego_outcome_thread_turn_status
      );
      CREATE TABLE outcomego_memory_fact (id uuid PRIMARY KEY);
      CREATE TABLE outcomego_run (id uuid PRIMARY KEY);

      INSERT INTO outcomego_routine (id, "scheduleKind") VALUES (gen_random_uuid(), 'interval');
      INSERT INTO outcomego_routine_revision VALUES (gen_random_uuid(), 'interval');
      INSERT INTO outcomego_routine_execution (kind, "routineId", "routineRevisionId")
        SELECT 'scheduled', routine.id, revision.id FROM outcomego_routine routine CROSS JOIN outcomego_routine_revision revision;
      INSERT INTO outcomego_outcome (id, "botId", title, status, "trackingMode")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'Existing tracked goal', 'draft', 'tracked');
      INSERT INTO outcomego_explore_idea (id, "sourceOutcomeId", title, status)
        SELECT gen_random_uuid(), id, 'Existing idea', 'draft' FROM outcomego_outcome;
    `);
    await client.query(migration);
    expect((await client.query('SELECT "scheduleKind" FROM outcomego_routine')).rows).toEqual([{ scheduleKind: "interval" }]);
    expect((await client.query('SELECT kind FROM outcomego_routine_execution')).rows).toEqual([{ kind: "scheduled" }]);
    expect((await client.query(`
      SELECT child.title, child.kind, parent.title AS parent FROM outcomego_outcome child
      LEFT JOIN outcomego_outcome parent ON parent.id = child."parentOutcomeId" ORDER BY child.title
    `)).rows).toEqual([
      { title: "Existing idea", kind: "explore_idea", parent: "Existing tracked goal" },
      { title: "Existing tracked goal", kind: "tracked", parent: null },
    ]);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await client.end();
  }
});
