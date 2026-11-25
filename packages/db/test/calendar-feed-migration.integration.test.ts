import { expect, test } from "bun:test";
import { Client } from "pg";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const migration = await Bun.file(new URL("../prisma/migrations/202611250300_add_calendar_feed_token/migration.sql", import.meta.url)).text();

test.skipIf(!url)("calendar feed SQL preserves owner rows and enforces a unique digest and a valid owner", async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query(`BEGIN;
      CREATE SCHEMA calendar_feed_migration_test;
      SET LOCAL search_path TO calendar_feed_migration_test;
      CREATE TABLE "outcomego_user" (LIKE public."outcomego_user" INCLUDING ALL);
      INSERT INTO "outcomego_user" (id, name, email, "updatedAt") VALUES ('fixture', 'Original', 'fixture@example.test', now());`);
    const before = await db.query('SELECT * FROM "outcomego_user"');
    await db.query(migration);
    expect((await db.query('SELECT * FROM "outcomego_user"')).rows).toEqual(before.rows);
    const insert = (owner: string | null, hash: string) => db.query(`INSERT INTO "outcomego_calendar_feed_token"
      (id, "userId", name, "tokenHash", kinds) VALUES ($1, $2, 'Fixture', $3, ARRAY['goal_due']) RETURNING "includeLinks", "revokedAt"`,
      [crypto.randomUUID(), owner, hash]);
    expect((await insert("fixture", "fixture-digest")).rows).toEqual([{ includeLinks: false, revokedAt: null }]);
    await insert(null, "local-digest");
    await db.query("SAVEPOINT uniqueness");
    await expect(insert("fixture", "fixture-digest")).rejects.toMatchObject({ code: "23505" });
    await db.query("ROLLBACK TO SAVEPOINT uniqueness");
    await expect(insert("missing", "other-digest")).rejects.toMatchObject({ code: "23503" });
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});
