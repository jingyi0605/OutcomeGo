import { afterAll, describe, expect, test } from "bun:test";
import { createPrismaClient, Prisma } from "@outcomego/db";
import { OUTCOME_EVIDENCE_EVENT_SCOPE } from "../src/services/outcome-event-retention";
import { SnapshotService } from "../src/services/snapshot-service";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("Outcome Event replay and durable retention", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const entityId = crypto.randomUUID();
  const scopeKeys: string[] = [];
  const service = new SnapshotService(prisma, "/tmp", "http://computer", () => true);

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { entityId } });
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: OUTCOME_EVIDENCE_EVENT_SCOPE, key: { in: scopeKeys } },
    });
    await prisma.$disconnect();
  });

  test("filters before pagination and keeps global bounds across Outcome-only gaps", async () => {
    const start = await prisma.event.create({ data: { entityId, topic: "channel.read", payload: {} } });
    await prisma.event.createMany({
      data: Array.from({ length: 70 }, () => ({
        entityId, topic: "outcome.decision.resolved", payload: { customText: "private business answer" },
      })),
    });
    const visible = [];
    for (const topic of ["notification.created", "channel.read", "notification.presence.changed", "snapshot.required"]) {
      visible.push(await prisma.event.create({ data: { entityId, topic, payload: {} } }));
    }
    const tail = await prisma.event.create({
      data: { entityId, topic: "outcome.updated", payload: { customText: "private business goal" } },
    });
    const page = await service.eventWindowAfter(start.sequence, 2);
    expect(page.events.map(event => event.sequence)).toEqual(visible.slice(0, 2).map(event => event.sequence.toString()));
    expect(page.cursorExpired).toBe(false);
    expect(page.cursorAhead).toBe(false);
    expect(page.hasMore).toBe(true);
    expect(JSON.stringify(page.events)).not.toContain("private business");
    const next = await service.eventWindowAfter(BigInt(page.events.at(-1)!.sequence), 2);
    expect(next.events.map(event => event.sequence)).toEqual(visible.slice(2).map(event => event.sequence.toString()));
    const empty = await service.eventWindowAfter(visible.at(-1)!.sequence);
    expect(empty.events).toEqual([]);
    expect(empty.latest).toBe(tail.sequence);
    expect(empty.cursorExpired).toBe(false);
    expect(empty.cursorAhead).toBe(false);
    const internal = await prisma.event.findUniqueOrThrow({ where: { sequence: tail.sequence } });
    expect(internal.payload).toEqual({ customText: "private business goal" });
  });

  test("pruning preserves old unreceipted output and completed-item inputs until receipt", async () => {
    const outputKey = crypto.randomUUID();
    const completedKey = crypto.randomUUID();
    const oldEvents = [];
    for (const data of [
      { topic: "outcome.output.recorded", payload: { eventId: outputKey, payload: { outputId: crypto.randomUUID() } } },
      { topic: "outcome.work_item.updated", payload: { eventId: completedKey, workItemId: crypto.randomUUID(), payload: { to: "completed" } } },
      { topic: "outcome.output.recorded", payload: { payload: { outputId: crypto.randomUUID() } } },
      { topic: "outcome.work_item.updated", payload: { payload: { to: "running" } } },
      { topic: "outcome.work_item.updated", payload: {} },
      { topic: "channel.read", payload: {} },
    ]) {
      oldEvents.push(await prisma.event.create({ data: { entityId, ...data } }));
    }
    const latest = await prisma.event.aggregate({ _max: { sequence: true } });
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "outcomego_event" ("topic", "entityId", "payload", "createdAt")
      SELECT 'channel.read', ${entityId}::uuid, '{}'::jsonb, NOW()
      FROM generate_series(1, 100000)
    `);
    expect(await service.pruneEvents()).toBeGreaterThan(0);
    const remaining = await prisma.event.findMany({
      where: { entityId, sequence: { lte: latest._max.sequence! } }, orderBy: { sequence: "asc" },
    });
    expect(remaining.map(event => event.sequence)).toEqual(oldEvents.slice(0, 3).map(event => event.sequence));
    // Offline startup and failed handlers have no receipt: repeated pruning must preserve recovery inputs.
    await service.pruneEvents();
    expect(await prisma.event.count({ where: { sequence: { in: oldEvents.slice(0, 3).map(event => event.sequence) } } })).toBe(3);
    const keys = [outputKey, completedKey, oldEvents[2]!.sequence.toString()];
    scopeKeys.push(...keys);
    await prisma.idempotencyRecord.createMany({
      data: keys.map(key => ({
        scope: OUTCOME_EVIDENCE_EVENT_SCOPE, key, requestHash: "test", response: { processed: true },
        status: "completed", expiresAt: new Date("9999-01-01"),
      })),
    });
    expect(await service.pruneEvents()).toBe(3);
    expect(await prisma.event.count({ where: { sequence: { in: oldEvents.map(event => event.sequence) } } })).toBe(0);
  }, 30_000);
});
