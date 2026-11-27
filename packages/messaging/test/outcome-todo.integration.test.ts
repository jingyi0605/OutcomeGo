import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import { todoAttentionWhere } from "../src/outcome-todo-attention";
import { expireTodoRows } from "../src/outcome-todo-lifecycle";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const now = new Date("2026-11-26T09:00:00.000Z");
const past = "2026-11-26T07:00:00.000Z";
const future = "2026-11-26T10:00:00.000Z";

describe.skipIf(!url)("Outcome todo storage", () => {
  test("attention selects current suggestions and actionable todos only", async () => {
    const db = createPrismaClient(url);
    const ownerId = randomUUID();
    try {
      await db.outcome.createMany({ data: [
        { ownerId, title: "No expiry key", kind: "todo", status: "suggested" },
        { ownerId, title: "Null expiry", kind: "todo", status: "suggested", kindMeta: { expiresAt: null } },
        { ownerId, title: "Future expiry", kind: "todo", status: "suggested", kindMeta: { expiresAt: future } },
        { ownerId, title: "Past expiry", kind: "todo", status: "suggested", kindMeta: { expiresAt: past } },
        { ownerId, title: "Due todo", kind: "todo", status: "open", dueAt: now },
        { ownerId, title: "Snoozed todo", kind: "todo", status: "open", dueAt: now, snoozeUntil: new Date(future) },
        { ownerId, title: "Due goal", kind: "tracked", status: "active", dueAt: now },
      ] });
      const selected = await db.outcome.findMany({ where: await todoAttentionWhere(db, ownerId, now, "UTC"), orderBy: { title: "asc" } });
      expect(selected.map(({ title }) => title)).toEqual(["Due todo", "Future expiry", "No expiry key", "Null expiry"]);
    } finally {
      await db.outcome.deleteMany({ where: { ownerId } });
      await db.$disconnect();
    }
  });

  test("concurrent expiration releases the dedupe key and publishes one revision", async () => {
    const db = createPrismaClient(url);
    const ownerId = randomUUID();
    const id = randomUUID();
    try {
      await db.outcome.create({ data: { id, ownerId, title: "Expired", kind: "todo", status: "suggested", dedupeKey: "same", kindMeta: { expiresAt: past }, snoozeUntil: new Date(future) } });
      const results = await Promise.all(Array.from({ length: 2 }, () => db.$transaction((tx) => expireTodoRows(tx, now, { ownerId }))));
      expect(results.flat().map(({ id, revision }) => ({ id, revision }))).toEqual([{ id, revision: 2 }]);
      const row = await db.outcome.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: "cancelled", cancelledAt: now, kindMeta: { dismissReason: "expired", expiresAt: past }, dedupeKey: null, snoozeUntil: null });
      expect(await db.event.count({ where: { topic: "goal.updated", entityId: id } })).toBe(1);
    } finally {
      await db.event.deleteMany({ where: { entityId: id } });
      await db.outcome.deleteMany({ where: { ownerId } });
      await db.$disconnect();
    }
  });
});
