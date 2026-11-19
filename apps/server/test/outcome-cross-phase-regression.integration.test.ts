import { describe, expect, test } from "bun:test";
import type { Prisma, PrismaClient } from "@outcomego/db";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const actor = "owner:local" as const;
const canary = "FICTIONAL_PRIVATE_CONTENT_MUST_NOT_APPEAR";
async function modules() {
  const [fixture, messaging, effect] = await Promise.all([
    import("./fixtures/outcome-recovery/fixture"),
    import("@outcomego/messaging"),
    import("effect"),
  ]);
  return { ...fixture, ...messaging, Effect: effect.Effect };
}

describe.skipIf(!url)("Cross-phase Outcome compatibility and failure boundaries", () => {
  for (const origin of ["user", "group", "routine"] as const) {
    test(`${origin} without an Outcome marker produces no Outcome or human facts`, async () => {
      const m = await modules();
      const f = await m.recoveryFixture();
      try {
        const counts = async () => ({
          outcomes: await f.db.outcome.count({ where: { botId: f.bot.id } }),
          items: await f.db.outcomeWorkItem.count({ where: { outcomeId: f.outcome.id } }),
          outputs: await f.db.outcomeOutput.count({ where: { outcomeId: f.outcome.id } }),
          evidence: await f.db.outcomeEvidence.count({ where: { outcomeId: f.outcome.id } }),
          decisions: await f.db.outcomeDecision.count({ where: { outcomeId: f.outcome.id } }),
          receipts: await f.db.outcomeHumanReceipt.count({ where: { outcomeId: f.outcome.id } }),
          reviews: await f.db.outcomeReview.count({ where: { outcomeId: f.outcome.id } }),
          outcomeEvents: await f.db.event.count({ where: { entityId: f.outcome.id, topic: { startsWith: "outcome." } } }),
        });
        const initial = await counts();
        const message = await f.db.message.create({ data: {
          botId: f.bot.id, conversationId: f.bot.conversation!.id, role: "user", content: "Fictional ordinary work",
        } });
        const ordinary = await f.db.run.create({ data: {
          botId: f.bot.id, conversationId: f.bot.conversation!.id, userMessageId: message.id,
          origin, status: "interrupted", outcomeWorkItemId: null,
        } });
        await f.db.$transaction(tx => m.settleOutcomeWorkItem(tx, ordinary.id, f.runtime));
        await m.recoverOutcomeWorkItems(f.db, f.runtime, null, f.outcome.id);
        expect(await counts()).toEqual(initial);
        expect(await f.foreground()).toEqual(f.foregroundBefore);
        expect((await f.db.run.findUniqueOrThrow({ where: { id: ordinary.id } })).status).toBe("interrupted");
        expect(await f.db.event.count({ where: { entityId: ordinary.id, topic: { startsWith: "outcome." } } })).toBe(0);
        expect(await f.db.outcomeHumanActionCard.count({ where: { workItem: { outcomeId: f.outcome.id } } })).toBe(0);
      } finally { await f.cleanup(); }
    });
  }

  for (const status of ["waiting_decision", "waiting_human"] as const) {
    test(`${status} is preserved by finish/recovery while foreground keeps its lease`, async () => {
      const m = await modules();
      const f = await m.recoveryFixture();
      try {
        const runId = await f.enqueue();
        await f.locked(tx => m.transitionWorkItem(tx, { workItemId: f.item.id, to: status, reason: "fixture_wait", actor }));
        await f.db.run.update({ where: { id: runId }, data: { status: "completed" } });
        await f.locked(tx => m.settleOutcomeWorkItem(tx, runId, f.runtime));
        await f.locked(tx => m.recoverOutcomeWorkItem(tx, f.item.id, f.runtime));
        expect((await f.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.item.id } })).status).toBe(status);
        expect(await f.db.outcomeOutput.count({ where: { outcomeId: f.outcome.id } })).toBe(0);
        expect(await f.db.run.count({ where: { outcomeWorkItemId: f.item.id } })).toBe(1);
        expect(await f.foreground()).toEqual(f.foregroundBefore);
      } finally { await f.cleanup(); }
    });
  }

  test("planning inference failure keeps one readable draft and no execution side effects", async () => {
    const { OutcomePlanningService } = await import("../src/services/outcome-planning-service");
    const m = await modules();
    const f = await m.recoveryFixture();
    const key = crypto.randomUUID();
    try {
      let calls = 0;
      const planning = new OutcomePlanningService(f.db, async () => { calls++; throw new Error(canary); });
      const input = { sourceText: "Fictional plan", context: { botId: f.bot.id }, clientRequestId: key };
      const first = await m.Effect.runPromise(m.Effect.either(planning.create(input)));
      const retry = await m.Effect.runPromise(m.Effect.either(planning.create(input)));
      expect(first._tag).toBe("Left"); expect(retry._tag).toBe("Left"); expect(calls).toBe(1);
      const drafts = await f.db.outcomePlanningDraft.findMany({ where: { botId: f.bot.id } });
      expect(drafts).toHaveLength(1); expect(drafts[0]!.status).toBe("failed");
      expect(JSON.stringify(drafts[0]!.error)).not.toContain(canary);
      expect(await f.db.run.count({ where: { outcomeWorkItemId: f.item.id } })).toBe(0);
      expect(await f.db.outcome.count({ where: { botId: f.bot.id } })).toBe(1);
      expect(await f.foreground()).toEqual(f.foregroundBefore);
    } finally {
      await f.db.idempotencyRecord.deleteMany({ where: { scope: "outcome-plan", key } });
      await f.cleanup();
    }
  });

  for (const [botStatus, itemStatus] of [["provisioning", "retry_pending"], ["archived", "failed"]] as const) {
    test(`a ${botStatus} executor has no partial Run and records ${itemStatus}`, async () => {
      const m = await modules();
      const f = await m.recoveryFixture();
      try {
        await f.db.bot.update({ where: { id: f.bot.id }, data: { status: botStatus } });
        const result = await f.locked(tx => m.enqueueOutcomeTurn(tx, f.messaging, {
          workItemId: f.item.id, content: "Fictional execution", reason: "start", clientId: `unavailable:${f.item.id}`,
        }));
        expect(result.status).toBe("queued_for_capacity");
        expect((await f.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.item.id } })).status).toBe(itemStatus);
        expect(await f.db.run.count({ where: { outcomeWorkItemId: f.item.id } })).toBe(0);
        expect(await f.foreground()).toEqual(f.foregroundBefore);
      } finally { await f.cleanup(); }
    });
  }

  test("a failure after Evidence creation rolls back Review, Evidence, acceptance and retry response", async () => {
    const { OutcomeReviewService } = await import("../src/services/outcome-review-service");
    const m = await modules();
    const f = await m.recoveryFixture();
    try {
      const runId = await f.enqueue();
      await f.db.run.update({ where: { id: runId }, data: { status: "completed" } });
      await f.locked(tx => m.settleOutcomeWorkItem(tx, runId, f.runtime));
      let injected = false;
      const fault = new Proxy(f.db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property, target);
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) =>
          target.$transaction(tx => callback(new Proxy(tx, { get(transaction, key) {
            if (key === "outcomeReview") return new Proxy(transaction.outcomeReview, { get(delegate, method) {
              if (method === "create") return async () => { injected = true; throw new Error("injected_post_evidence_failure"); };
              return Reflect.get(delegate, method, delegate);
            } });
            return Reflect.get(transaction, key, transaction);
          } })), options);
      } }) as PrismaClient;
      const input = {
        expectedRevision: 1, clientRequestId: crypto.randomUUID(),
        results: [{ criterionId: f.revision.criteria[0]!.id, result: "PASS" as const, evidenceIds: [], comment: "Fictional observed result" }],
        newEvidence: [{ criterionId: f.revision.criteria[0]!.id, sourceType: "url" as const, sourceRef: "https://example.test/fictional", contentSummary: "Fictional observation" }],
      };
      const service = new OutcomeReviewService(fault, f.messaging, async () => { throw new Error("unused"); });
      await expect(m.Effect.runPromise(service.submit(f.outcome.id, input, actor))).rejects.toThrow("injected_post_evidence_failure");
      expect(injected).toBe(true);
      expect(await f.db.outcomeEvidence.count({ where: { outcomeId: f.outcome.id } })).toBe(0);
      expect(await f.db.outcomeReview.count({ where: { outcomeId: f.outcome.id } })).toBe(0);
      expect((await f.db.outcome.findUniqueOrThrow({ where: { id: f.outcome.id } })).acceptedAt).toBeNull();
      expect(await f.db.idempotencyRecord.count({ where: { scope: `outcome-review:${f.outcome.id}`, key: input.clientRequestId } })).toBe(0);
      const result = await m.Effect.runPromise(new OutcomeReviewService(f.db, f.messaging, async () => { throw new Error("unused"); }).submit(f.outcome.id, input, actor));
      expect(result.status).toBe("accepted");
      expect(await f.db.outcomeEvidence.count({ where: { outcomeId: f.outcome.id } })).toBe(1);
      expect(await f.foreground()).toEqual(f.foregroundBefore);
    } finally { await f.cleanup(); }
  });

  test("recovery diagnostics exclude private payloads and missing attention remains unknown", async () => {
    const { OutcomeRecoveryService } = await import("../src/services/outcome-recovery-service");
    const m = await modules();
    const f = await m.recoveryFixture();
    const deliveryKey = `fixture:${f.outcome.id}`;
    try {
      await f.db.outcome.update({ where: { id: f.outcome.id }, data: { title: canary } });
      await f.db.outboxDelivery.create({ data: {
        deliveryKey, topic: "fixture.notification", target: "fixture", status: "failed", attempts: 5,
        payload: { outcomeId: f.outcome.id, body: canary }, error: { providerBody: canary },
      } });
      const recovery = new OutcomeRecoveryService(f.db, f.messaging);
      const before = await f.snapshot();
      const metrics = await m.Effect.runPromise(recovery.metrics(f.outcome.id));
      const diagnostics = await m.Effect.runPromise(recovery.get(f.outcome.id));
      expect(metrics.attentionSeconds).toBeNull();
      expect(metrics.duplicateEventCount).toBeNull();
      expect(metrics.humanInterventionCount).toBe(1);
      expect(diagnostics.notificationFailures).toMatchObject([{ errorCode: "notification_retry_exhausted", attempts: 5 }]);
      expect(JSON.stringify({ metrics, diagnostics })).not.toContain(canary);
      const sample = { clientRequestId: crypto.randomUUID(), surface: "review" as const, seconds: 12 };
      await m.Effect.runPromise(recovery.recordAttention(f.outcome.id, sample, actor));
      await m.Effect.runPromise(recovery.recordAttention(f.outcome.id, sample, actor));
      expect((await m.Effect.runPromise(recovery.metrics(f.outcome.id))).attentionSeconds).toBe(12);
      expect(await f.snapshot()).toEqual(before);
      expect(await f.foreground()).toEqual(f.foregroundBefore);
    } finally {
      await f.db.outboxDelivery.deleteMany({ where: { deliveryKey } });
      await f.cleanup();
    }
  });

  test("database foreign keys reject orphan Output and Evidence without repairing facts", async () => {
    const m = await modules();
    const f = await m.recoveryFixture();
    try {
      const missing = crypto.randomUUID();
      await expect(Promise.resolve(f.db.outcomeOutput.create({ data: {
        outcomeId: f.outcome.id, workItemId: missing, kind: "final_result", title: "Fictional orphan",
        dedupeKey: `orphan:${f.item.id}`,
      } }))).rejects.toMatchObject({ code: "P2003" });
      await expect(Promise.resolve(f.db.outcomeEvidence.create({ data: {
        outcomeId: f.outcome.id, contractRevisionId: f.revision.id, criterionId: missing,
        sourceType: "url", sourceRef: "https://example.test/fictional", credibility: "human_confirmed", capturedBy: actor,
      } }))).rejects.toMatchObject({ code: "P2003" });
      expect(await f.db.outcomeOutput.count({ where: { outcomeId: f.outcome.id } })).toBe(0);
      expect(await f.db.outcomeEvidence.count({ where: { outcomeId: f.outcome.id } })).toBe(0);
    } finally { await f.cleanup(); }
  });
});
