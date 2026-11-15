import { expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "pg";

const url = process.env.OPENTEAM_TEST_DATABASE_URL;

const deploy = async (databaseUrl: string) => {
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  for (const [command, args] of [
    ["bun", ["prisma", "db", "push", "--config", "prisma.config.ts"]],
    ["bun", ["scripts/apply-raw-schema.ts"]],
  ] as const) {
    const child = Bun.spawn([command, ...args], {
      cwd: join(import.meta.dirname, ".."),
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) throw new Error(`${args.join(" ")} exited ${status}\n${stdout}\n${stderr}`);
  }
};

test.skipIf(!url)("upgrades legacy deletion markers, preserves them after event pruning, and reruns safely", async () => {
  const name = `retired_agents_${crypto.randomUUID().slice(0, 8)}`;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(url!);
  target.pathname = `/${name}`;
  const db = new Client({ connectionString: target.toString() });
  const legacyId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const botId = crypto.randomUUID();
  try {
    await deploy(target.toString());
    await db.connect();
    // Simulate the tombstone table from before durable cleanup fields were added.
    await db.query(`ALTER TABLE "outcomego_retired_agent" DROP COLUMN "cleanupPending", DROP COLUMN "cleanupRunIds", DROP COLUMN "nextCleanupAt"`);
    await db.query(`INSERT INTO "outcomego_retired_agent" (id, "retiredAt") VALUES ($1, now())`, [legacyId]);
    await db.query(`INSERT INTO "outcomego_event" (topic, "entityId", payload)
      VALUES ('channel.deleted', $1, '{}'), ('channel.deleted', $1, '{}')`, [groupId]);
    // An archived bot remains identifiable even if its original event was already pruned.
    await db.query(`INSERT INTO "outcomego_bot" (id, name, "defaultDirectory", status, "updatedAt")
      VALUES ($1, 'Archived', '/workspace', 'archived', now())`, [botId]);
    await deploy(target.toString());
    const ids = async () => (await db.query(`SELECT id FROM "outcomego_retired_agent" ORDER BY id`)).rows.map(({ id }) => id);
    expect(await ids()).toEqual([legacyId, groupId, botId].sort());
    const migrated = (await db.query(`SELECT "cleanupPending", "cleanupRunIds", "nextCleanupAt" FROM "outcomego_retired_agent" WHERE id = $1`, [legacyId])).rows[0];
    expect(migrated.cleanupPending).toBe(true);
    expect(migrated.cleanupRunIds).toEqual([]);
    expect(migrated.nextCleanupAt).toBeInstanceOf(Date);
    await db.query(`DELETE FROM "outcomego_event"`);
    await deploy(target.toString());
    expect(await ids()).toEqual([legacyId, groupId, botId].sort());
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}, 120_000);
