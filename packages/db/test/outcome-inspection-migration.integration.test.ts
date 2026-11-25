import { expect, test } from "bun:test";
import { Client } from "pg";

const database = process.env.OUTCOMEGO_TEST_DATABASE_URL;

test.skipIf(!database)("inspection migration preserves goal, task and review history", async () => {
  const migration = await Bun.file(new URL("../prisma/migrations/202611250500_add_outcome_inspection/migration.sql", import.meta.url)).text();
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query("BEGIN");
    const schema = `inspection_${crypto.randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`);
    await client.query(`
      CREATE TYPE outcomego_outcome_thread_turn_purpose AS ENUM ('plan', 'owner_message', 'replan', 'review', 'review_task');
      CREATE TABLE outcomego_outcome (id text, "dueAt" timestamp(3));
      CREATE TABLE outcomego_outcome_work_item (id text, "dueAt" timestamp(3));
      CREATE TABLE outcomego_outcome_thread_turn (purpose outcomego_outcome_thread_turn_purpose);
      INSERT INTO outcomego_outcome VALUES ('goal', '2026-11-27 09:00:00');
      INSERT INTO outcomego_outcome_work_item VALUES ('task', null);
      INSERT INTO outcomego_outcome_thread_turn VALUES ('review');
    `);
    await client.query(migration);
    expect((await client.query('SELECT id, "dueAt"::text, "inspectionEnabled", "inspectionRevisionId" FROM outcomego_outcome')).rows).toEqual([
      { id: "goal", dueAt: "2026-11-27 09:00:00", inspectionEnabled: true, inspectionRevisionId: null },
    ]);
    expect((await client.query("SELECT * FROM outcomego_outcome_work_item")).rows).toEqual([
      { id: "task", dueAt: null, inspectionEnabled: true, inspectionRevisionId: null },
    ]);
    expect((await client.query("SELECT * FROM outcomego_outcome_thread_turn")).rows).toEqual([{ purpose: "review" }]);
    expect((await client.query("SELECT enumlabel FROM pg_enum WHERE enumtypid = 'outcomego_outcome_thread_turn_purpose'::regtype")).rows).toContainEqual({ enumlabel: "inspection" });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
