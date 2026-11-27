import { expect, test } from "bun:test";
import { dispatchTodoDigest, readTodoDigest } from "@outcomego/messaging";
import { createPrismaClient } from "@outcomego/db";
import { apnsPayload } from "../src/apns";
import { fcmPayload } from "../src/fcm";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const before = new Date("2026-11-25T00:29:00Z");
const at = new Date("2026-11-25T00:30:00Z");
const tomorrow = new Date("2026-11-26T00:30:00Z");

test.skipIf(!url)("digest follows owner time, policy, same-day dedupe and empty-day suppression", async () => {
  const db = createPrismaClient(url);
  const device = await db.pushDevice.create({ data: { installationId: crypto.randomUUID(), pushToken: `token-${crypto.randomUUID()}`, platform: "ios", authRequired: false, notificationScope: "fixture-scope" } });
  const setPolicy = (taskPolicy: { [key: string]: boolean | string | number }) => db.featureSettings.upsert({
    where: { id: "global" }, create: { outcomesEnabled: true, taskPolicy }, update: { outcomesEnabled: true, taskPolicy },
  });
  try {
    await setPolicy({});
    await db.userTimeZoneSettings.upsert({ where: { id: "global" }, create: { override: "Asia/Singapore" }, update: { override: "Asia/Singapore" } });
    await db.outcome.createMany({ data: [
      { title: "First title", urgency: "high", dueAt: new Date("2026-11-25T02:00:00Z") },
      { title: "Second title", dueAt: new Date("2026-11-25T03:00:00Z") },
    ].map((row) => ({ ...row, urgency: row.urgency as "high" | undefined, ownerId: "local", kind: "todo", status: "open", executor: "owner", kindMeta: { createdVia: "owner_ui" }, createdBy: "owner:local", description: "PRIVATE-SUMMARY", sourceRef: { kind: "ref", id: "fixture", label: "PRIVATE-SOURCE" } })) });
    expect(await dispatchTodoDigest(db, "disabled", at)).toBe(false);
    expect(await readTodoDigest(db, "local", at)).toBeNull();
    await setPolicy({ "todo.digest.enabled": true, "todo.digest.localTime": "08:30", "todo.digest.maxTitles": 1 });
    expect(await dispatchTodoDigest(db, "disabled", before)).toBe(false);
    expect(await readTodoDigest(db, "local", at)).toEqual({ date: "2026-11-25", counts: { today: 2, overdue: 0, suggested: 0, follow_up: 0 }, titles: ["First title"] });
    const sent = await Promise.all([dispatchTodoDigest(db, "disabled", at), dispatchTodoDigest(db, "disabled", at)]);
    expect(sent.filter(Boolean)).toHaveLength(1);
    const deliveries = await db.outboxDelivery.findMany({ where: { target: device.id, topic: "push.notification" } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.payload).toMatchObject({ kind: "todo", type: "digest", date: "2026-11-25", body: expect.stringContaining("First title") });
    expect(JSON.stringify(deliveries)).not.toMatch(/PRIVATE|Second title/);
    const payload = { kind: "todo", type: "digest", ownerId: "local", schemaVersion: 1, date: "2026-11-25", title: "Summary", body: "Count and titles" } as const;
    expect(apnsPayload(device, payload, 0)).toMatchObject({ aps: { alert: { title: "Summary", body: "Count and titles" } }, data: { kind: "todo", type: "digest", notificationScope: "fixture-scope" } });
    expect(fcmPayload(device, payload, 0, "fixture")).toMatchObject({ message: { data: { kind: "todo", type: "digest", title: "Summary", body: "Count and titles", notificationScope: "fixture-scope" } } });
    await db.outcome.updateMany({ where: { kind: "todo", ownerId: "local" }, data: { status: "accepted" } });
    expect(await readTodoDigest(db, "local", tomorrow)).toBeNull();
    expect(await dispatchTodoDigest(db, "disabled", tomorrow)).toBe(false);
    expect(await db.idempotencyRecord.count({ where: { scope: "todo-digest" } })).toBe(1);
  } finally {
    await db.outboxDelivery.deleteMany({ where: { target: device.id } });
    await db.pushDevice.delete({ where: { id: device.id } });
    await db.outcome.deleteMany({ where: { kind: "todo", ownerId: "local" } });
    await db.idempotencyRecord.deleteMany({ where: { scope: "todo-digest" } });
    await db.userTimeZoneSettings.deleteMany({ where: { id: "global" } });
    await db.featureSettings.deleteMany({ where: { id: "global" } });
    await db.$disconnect();
  }
});
