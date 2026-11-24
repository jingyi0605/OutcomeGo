import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

// Specs/004.10 task 2.1: the schedule migration only adds columns and an index, and leaves existing rows alone.
// Needs a disposable PostgreSQL server (OUTCOMEGO_TEST_DATABASE_URL); it creates and drops its own database.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const migration = readFileSync(
  join(import.meta.dir, "../prisma/migrations/202611240002_add_outcome_schedule/migration.sql"),
  "utf8"
);

const deploy = async (databaseUrl: string) => {
  const child = Bun.spawn(["bun", "scripts/deploy-schema.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_OPTIONS: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, `${out}\n${error}`).toBe(0);
};

test("the migration is additive by construction: no statement drops, rewrites or deletes", () => {
  const statements = migration
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  for (const forbidden of [/\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bUPDATE\b/i, /\bALTER COLUMN\b/i, /\bRENAME\b/i])
    expect(statements).not.toMatch(forbidden);
  expect(statements).toMatch(/ADD COLUMN "scheduledAt"/);
  expect(statements).toMatch(/ADD COLUMN "taskPolicy"/);
});

test.skipIf(!url)(
  "an upgraded database keeps its rows, new columns start empty, and the index exists",
  async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const name = `outcomego_schedule_${suffix}`;
    const admin = new Client({ connectionString: url! });
    await admin.connect();
    const target = new URL(url!);
    let db: Client | undefined;
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      target.pathname = `/${name}`;
      await deploy(target.toString());
      db = new Client({ connectionString: target.toString() });
      await db.connect();

      // Put the database back in its pre-migration shape.
      await db.query('DROP INDEX "outcomego_outcome_work_item_status_scheduled_at_idx"');
      await db.query(`ALTER TABLE "outcomego_outcome_work_item"
        DROP COLUMN "scheduledAt", DROP COLUMN "dueAt", DROP COLUMN "estimateMinutes", DROP COLUMN "deferCount"`);
      await db.query('ALTER TABLE "outcomego_outcome" DROP COLUMN "dueAt"');
      await db.query('ALTER TABLE "outcomego_feature_settings" DROP COLUMN "taskPolicy"');
      await db.query(`INSERT INTO "outcomego_feature_settings" ("id", "outcomesEnabled", "updatedAt") VALUES ('global', true, now())`);

      const before = (await db.query(`SELECT "id", "outcomesEnabled", "streamBotReplies" FROM "outcomego_feature_settings"`)).rows;

      await db.query(migration);

      const after = (await db.query(`SELECT "id", "outcomesEnabled", "streamBotReplies", "taskPolicy" FROM "outcomego_feature_settings"`)).rows;
      expect(after).toHaveLength(1);
      expect({ id: after[0].id, outcomesEnabled: after[0].outcomesEnabled, streamBotReplies: after[0].streamBotReplies }).toEqual(before[0]);
      expect(after[0].taskPolicy).toBeNull();

      const columns = (
        await db.query(
          `SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND ((table_name = 'outcomego_outcome_work_item' AND column_name IN ('scheduledAt','dueAt','estimateMinutes','deferCount'))
               OR (table_name = 'outcomego_outcome' AND column_name = 'dueAt')
               OR (table_name = 'outcomego_feature_settings' AND column_name = 'taskPolicy'))`
        )
      ).rows;
      expect(columns).toHaveLength(6);
      const byName = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row]));
      expect(byName.get("outcomego_outcome_work_item.deferCount")!.is_nullable).toBe("NO");
      expect(String(byName.get("outcomego_outcome_work_item.deferCount")!.column_default)).toBe("0");
      for (const key of ["outcomego_outcome_work_item.scheduledAt", "outcomego_outcome_work_item.dueAt", "outcomego_outcome_work_item.estimateMinutes", "outcomego_outcome.dueAt", "outcomego_feature_settings.taskPolicy"])
        expect(byName.get(key)!.is_nullable).toBe("YES");

      const index = (
        await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'outcomego_outcome_work_item_status_scheduled_at_idx'`)
      ).rows;
      expect(index).toHaveLength(1);
      // Postgres only quotes mixed-case names, so match the column order and not the quoting.
      expect(String(index[0].indexdef).replaceAll('"', "")).toContain("(status, scheduledAt)");
    } finally {
      await db?.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
      await admin.end();
    }
  },
  120_000
);
