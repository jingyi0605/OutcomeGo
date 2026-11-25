import { expect, test } from "bun:test";
import { Client } from "pg";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const migration = await Bun.file(new URL("../prisma/migrations/202611250100_add_todo_item/migration.sql", import.meta.url)).text();
const autoAcceptMigration = await Bun.file(new URL("../prisma/migrations/202611250200_add_todo_auto_accept/migration.sql", import.meta.url)).text();

test.skipIf(!url)("auto-accept SQL upgrades the owner todo schema without altering existing values", async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("CREATE SCHEMA todo_rule_migration_test; SET LOCAL search_path TO todo_rule_migration_test;");
    await db.query(migration);
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO "outcomego_owner_todo_item" ("id", "ownerId", "title", "createdVia", "createdBy", "updatedAt")
      VALUES ($1, 'local', 'Placeholder', 'owner_ui', 'local', now())`, [id]);
    await db.query(autoAcceptMigration);
    expect((await db.query('SELECT "title", "autoAcceptRuleName" FROM "outcomego_owner_todo_item" WHERE "id" = $1', [id])).rows)
      .toEqual([{ title: "Placeholder", autoAcceptRuleName: null }]);
    const insert = (botId: string | null) => db.query(`INSERT INTO "outcomego_todo_auto_accept_rule"
      ("id", "ownerId", "name", "botId", "sourceKind", "updatedAt") VALUES ($1, 'local', 'Rule', $2, 'alpha', now())
      RETURNING "enabled", "matchCount"`, [crypto.randomUUID(), botId]);
    expect((await insert(crypto.randomUUID())).rows).toEqual([{ enabled: true, matchCount: 0 }]);
    await expect(insert(null)).rejects.toMatchObject({ code: "23514" });
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});

test.skipIf(!url)("owner todo SQL applies over the legacy bot table without changing its rows", async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA owner_todo_migration_test;
      SET LOCAL search_path TO owner_todo_migration_test;
      CREATE TABLE "outcomego_todo_item" (LIKE public."outcomego_todo_item" INCLUDING ALL);`);
    const botId = crypto.randomUUID();
    const legacy = await db.query(`INSERT INTO "outcomego_todo_item" ("botId", "id", "content", "status", "position", "updatedAt")
      VALUES ($1, 'fixture', 'Original content', 'pending', 0, now()) RETURNING *`, [botId]);

    await db.query(migration);

    expect((await db.query('SELECT * FROM "outcomego_todo_item" WHERE "botId" = $1', [botId])).rows).toEqual(legacy.rows);
    const insert = (owner: string, key: string | null) => db.query(`INSERT INTO "outcomego_owner_todo_item"
      ("id", "ownerId", "title", "createdVia", "createdBy", "dedupeKey", "updatedAt")
      VALUES ($1, $2, 'Placeholder', 'owner_ui', $2, $3, now()) RETURNING status, executor, urgency, revision`, [crypto.randomUUID(), owner, key]);
    expect((await insert("first", "ref:1")).rows).toEqual([{ status: "open", executor: "owner", urgency: "normal", revision: 1 }]);
    await insert("second", "ref:1");
    await insert("first", null);
    await insert("first", null);
    await expect(insert("first", "ref:1")).rejects.toMatchObject({ code: "23505" });
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});
