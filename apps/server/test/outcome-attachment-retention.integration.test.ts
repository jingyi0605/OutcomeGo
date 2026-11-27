import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Prisma, createPrismaClient } from "@outcomego/db";
import { referencedAssetIdsSql } from "../src/services/asset-retention";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;

describe.skipIf(!url)("Outcome source attachments", () => {
  test("retains assets after failed triage, archive and in-place conversion", async () => {
    const db = createPrismaClient(url);
    const id = randomUUID();
    const assetId = randomUUID().replaceAll("-", "").repeat(2);
    const referenced = async () => {
      const [result] = await db.$queryRaw<Array<{ retained: boolean }>>(Prisma.sql`
        SELECT EXISTS (SELECT 1 FROM (${referencedAssetIdsSql}) AS refs WHERE "assetId" = ${assetId}) AS retained
      `);
      return result?.retained;
    };
    try {
      await db.outcome.create({ data: {
        id, title: "Source note", kind: "note", status: "active", kindMeta: { createdVia: "owner_go_inbox", triageStatus: "failed" },
        attachments: [{ assetId, fileName: "meeting.txt", mimeType: "text/plain", byteSize: 10, kind: "text" }],
      } });
      expect(await referenced()).toBe(true);
      await db.outcome.update({ where: { id }, data: { status: "archived" } });
      expect(await referenced()).toBe(true);
      await db.outcome.update({ where: { id }, data: { kind: "todo", status: "open" } });
      expect(await referenced()).toBe(true);
      await db.outcome.update({ where: { id }, data: { attachments: [] } });
      expect(await referenced()).toBe(false);
    } finally {
      await db.outcome.deleteMany({ where: { id } });
      await db.$disconnect();
    }
  });
});
