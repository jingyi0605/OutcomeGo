import { expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "pg";
import { createPrismaClient } from "../src/client";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
// Phase 1 schema + raw SQL fingerprint; works in shallow CI checkouts too.
const PRE_LOCATION_FINGERPRINT = "c0abfef2e72814ec5a360b976da69799e52dd9534a6479ee2b2af4238678815e";
const migration = join(import.meta.dir, "../prisma/migrations/202611170001_add_user_location");
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

test.skipIf(!url)(
  "copied pre-location DB upgrades additively, survives repeat deploy, reads via Prisma, rolls back and forward-fixes",
  async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const baseName = `outcomego_location_before_${suffix}`;
    const copyName = `outcomego_location_copy_${suffix}`;
    const admin = new Client({ connectionString: url! });
    await admin.connect();
    let db: Client | undefined;
    const target = new URL(url!);
    try {
      await admin.query(`CREATE DATABASE "${baseName}"`);
      target.pathname = `/${baseName}`;
      await deploy(target.toString());
      db = new Client({ connectionString: target.toString() });
      await db.connect();
      await db.query('DROP TABLE "outcomego_user_location"');
      await db.query(`INSERT INTO "outcomego_user" ("id", "name", "email", "createdAt", "updatedAt")
      VALUES ('location-upgrade-sentinel', 'Keep me', 'location-upgrade@example.test', now(), now())`);
      const beforeMarker = `OutcomeGo schema ready: outcomego-v1:${PRE_LOCATION_FINGERPRINT}`;
      await db.query(
        "SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = current_schema()"
      );
      await db.query(`COMMENT ON SCHEMA public IS '${beforeMarker}'`);
      const beforeTables = (
        await db.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        )
      ).rows;
      await db.end();
      db = undefined;

      await admin.query(`CREATE DATABASE "${copyName}" TEMPLATE "${baseName}"`);
      target.pathname = `/${copyName}`;
      db = new Client({ connectionString: target.toString() });
      await db.connect();
      const sql = await Bun.file(join(migration, "migration.sql")).text();
      await db.query(sql);
      await db.query(sql);
      await deploy(target.toString());
      await deploy(target.toString());
      expect(
        (
          await db.query(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'outcomego_user_location' ORDER BY tablename"
          )
        ).rows
      ).toEqual(beforeTables);
      expect(
        (
          await db.query(
            `SELECT "name", "email" FROM "outcomego_user" WHERE "id" = 'location-upgrade-sentinel'`
          )
        ).rows
      ).toEqual([{ name: "Keep me", email: "location-upgrade@example.test" }]);
      const prisma = createPrismaClient(target.toString());
      try {
        await prisma.userLocation.create({
          data: {
            ownerKey: "user:location-upgrade-sentinel",
            sharingRevision: crypto.randomUUID(),
          },
        });
        expect(
          await prisma.userLocation.findUnique({
            where: { ownerKey: "user:location-upgrade-sentinel" },
          })
        ).toMatchObject({
          sharingEnabled: false,
          latitude: null,
          longitude: null,
          capturedAt: null,
        });
        const revised = await prisma.userLocation.update({
          where: { ownerKey: "user:location-upgrade-sentinel" },
          data: {
            sharingEnabled: true,
            latitude: 1,
            longitude: 2,
            capturedAt: new Date("2026-11-17T01:00:00Z"),
            device: "phone",
          },
        });
        expect(revised.capturedAt?.toISOString()).toBe("2026-11-17T01:00:00.000Z");
      } finally {
        await prisma.$disconnect();
      }

      await db.query(await Bun.file(join(migration, "rollback.sql")).text());
      await db.query(`COMMENT ON SCHEMA public IS '${beforeMarker}'`);
      expect(
        (
          await db.query(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
          )
        ).rows
      ).toEqual(beforeTables);
      expect(
        (
          await db.query(
            `SELECT "name" FROM "outcomego_user" WHERE "id" = 'location-upgrade-sentinel'`
          )
        ).rows[0].name
      ).toBe("Keep me");
      await db.query(sql);
      await deploy(target.toString());
      expect(
        (await db.query(`SELECT count(*)::int AS count FROM "outcomego_user_location"`)).rows[0]
          .count
      ).toBe(0);
      console.log(
        "Location migration: copied DB, repeated SQL/deploy, Prisma read/write, rollback and forward-fix passed"
      );
    } finally {
      await db?.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS "${copyName}" WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS "${baseName}" WITH (FORCE)`);
      await admin.end();
    }
  },
  120_000
);
