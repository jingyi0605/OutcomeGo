import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { appendOutcomeEvent, type AgentMessaging } from "@outcomego/messaging";
import { EventWakeup } from "../src/event-wakeup";
import { SnapshotService } from "../src/services/snapshot-service";
import { OutcomeEvidenceConsumer } from "../src/services/outcome-evidence-consumer";
import { OutcomeReviewService } from "../src/services/outcome-review-service";
import { outcomeFixture, testDatabaseUrl } from "./fixtures/outcome-fixture";

describe.skipIf(!testDatabaseUrl)("Outcome event retention integration", () => {
  const f = outcomeFixture();
  afterAll(() => f.close());
  test("pruning preserves pending input through handler failure and deletes it only after successful retry", async () => {
    const x = await f.completed();
    const snapshot = new SnapshotService(f.prisma, "/tmp", "http://127.0.0.1:1", () => false);
    const review = new OutcomeReviewService(f.prisma, {} as AgentMessaging, async () => { throw new Error("offline"); });
    const consumer = new OutcomeEvidenceConsumer(f.prisma, review, new EventWakeup(testDatabaseUrl!));
    try {
      const unrelated = await f.prisma.event.create({ data: { topic: "snapshot.required", entityId: x.outcome.id, payload: {} } });
      const output = await f.prisma.$transaction(tx => appendOutcomeEvent(tx, "outcome.output.recorded", x.outcome.id, { actor: "system:test", workItemId: x.item.id, contractRevision: 1, payload: { outputId: x.output.id, kind: "final_result" } }));
      // Exercise the legacy receipt identity fallback when no envelope eventId is present.
      const completed = await f.prisma.event.create({ data: { topic: "outcome.work_item.updated", entityId: x.outcome.id, payload: { workItemId: x.item.id, payload: { to: "completed" } } } });
      await f.prisma.$executeRaw`
        INSERT INTO "outcomego_event" ("topic", "entityId", "payload")
        SELECT 'snapshot.required', ${x.outcome.id}::uuid, '{}'::jsonb
        FROM generate_series(1, 100000)
      `;
      await snapshot.pruneEvents();
      expect(await f.prisma.event.findUnique({ where: { sequence: unrelated.sequence } })).toBeNull();
      expect(await f.prisma.event.findUnique({ where: { sequence: output.sequence } })).not.toBeNull();
      expect(await f.prisma.event.findUnique({ where: { sequence: completed.sequence } })).not.toBeNull();
      const failingHandler = spyOn(review, "recordOutputEvidence").mockRejectedValueOnce(new Error("handler temporarily failed"));
      try {
        await expect(consumer.drain()).rejects.toThrow("handler temporarily failed");
      } finally {
        failingHandler.mockRestore();
      }
      expect(await f.prisma.idempotencyRecord.count({ where: {
        scope: "outcome-event:output-evidence",
        key: { in: [(output.payload as { eventId: string }).eventId, completed.sequence.toString()] },
      } })).toBe(0);
      await snapshot.pruneEvents();
      expect(await f.prisma.event.findUnique({ where: { sequence: output.sequence } })).not.toBeNull();
      expect(await f.prisma.event.findUnique({ where: { sequence: completed.sequence } })).not.toBeNull();
      await consumer.drain();
      expect(await f.prisma.outcomeEvidence.count({ where: { outputId: x.output.id } })).toBe(2);
      expect(await consumer.drain()).toBe(0);
      await snapshot.pruneEvents();
      expect(await f.prisma.event.findUnique({ where: { sequence: output.sequence } })).toBeNull();
      expect(await f.prisma.event.findUnique({ where: { sequence: completed.sequence } })).toBeNull();
    } finally {
      await f.prisma.event.deleteMany({ where: { entityId: x.outcome.id } });
    }
  }, 30_000);
});
