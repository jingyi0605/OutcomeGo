import { expect, test } from "bun:test";
import { Client } from "pg";

const database = process.env.OUTCOMEGO_TEST_DATABASE_URL;

test.skipIf(!database)("one-time routine migration preserves legacy schedules and executions", async () => {
  const migration = await Bun.file(new URL("../prisma/migrations/202611250400_add_once_routine/migration.sql", import.meta.url)).text();
  const client = new Client({ connectionString: database });
  await client.connect();
  const schema = `once_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await client.query(`
      CREATE TYPE outcomego_routine_schedule_kind AS ENUM ('cron', 'interval', 'event');
      CREATE TYPE outcomego_routine_execution_kind AS ENUM ('scheduled', 'test');
      CREATE TABLE outcomego_routine ("scheduleKind" outcomego_routine_schedule_kind, "nextRunAt" timestamp(3));
      CREATE TABLE outcomego_routine_revision ("scheduleKind" outcomego_routine_schedule_kind);
      CREATE TABLE outcomego_routine_execution (kind outcomego_routine_execution_kind);
      INSERT INTO outcomego_routine VALUES ('cron', '2026-11-27 09:00:00'), ('interval', null), ('event', null);
      INSERT INTO outcomego_routine_revision VALUES ('cron');
      INSERT INTO outcomego_routine_execution VALUES ('scheduled'), ('test');
    `);
    await client.query(migration);
    expect((await client.query('SELECT "scheduleKind", "nextRunAt"::text, "onceAt", "onceStartedAt" FROM outcomego_routine ORDER BY "scheduleKind"')).rows).toEqual([
      { scheduleKind: "cron", nextRunAt: "2026-11-27 09:00:00", onceAt: null, onceStartedAt: null },
      { scheduleKind: "interval", nextRunAt: null, onceAt: null, onceStartedAt: null },
      { scheduleKind: "event", nextRunAt: null, onceAt: null, onceStartedAt: null },
    ]);
    expect((await client.query("SELECT * FROM outcomego_routine_revision")).rows).toEqual([{ scheduleKind: "cron", onceTrigger: null }]);
    expect((await client.query("SELECT * FROM outcomego_routine_execution ORDER BY kind")).rows).toEqual([{ kind: "scheduled" }, { kind: "test" }]);
    expect((await client.query("SELECT enum_range(null::outcomego_routine_schedule_kind)::text AS kinds")).rows[0]?.kinds).toBe("{cron,interval,event,once}");
    expect((await client.query("SELECT enum_range(null::outcomego_routine_execution_kind)::text AS kinds")).rows[0]?.kinds).toBe("{scheduled,test,preparation}");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
    await client.end();
  }
});
