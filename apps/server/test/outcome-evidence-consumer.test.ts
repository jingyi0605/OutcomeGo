import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { appendOutcomeEvent, type AgentMessaging } from "@outcomego/messaging";
import { OutcomeEvidenceConsumer } from "../src/services/outcome-evidence-consumer";
import { OutcomeReviewService } from "../src/services/outcome-review-service";
import { EventWakeup } from "../src/event-wakeup";
import { outcomeFixture, testDatabaseUrl, requestId } from "./fixtures/outcome-fixture";

describe.skipIf(!testDatabaseUrl)("durable Output Evidence consumer", () => {
  const f = outcomeFixture();
  afterAll(() => f.close());
  const emit = (x: Awaited<ReturnType<typeof f.completed>>) => f.prisma.$transaction(tx => appendOutcomeEvent(tx, "outcome.output.recorded", x.outcome.id, { actor: "system:test", workItemId: x.item.id, contractRevision: 1, payload: { outputId: x.output.id, kind: "final_result" } }));
  test("startup backlog, duplicate events and a new consumer after restart do not duplicate evidence", async () => {
    const x = await f.completed(); await emit(x); await emit(x);
    const service = new OutcomeReviewService(f.prisma, {} as AgentMessaging, async () => { throw new Error("offline"); });
    const wakeup = new EventWakeup(testDatabaseUrl!);
    const consumer = new OutcomeEvidenceConsumer(f.prisma, service, wakeup);
    expect(await consumer.drain()).toBeGreaterThanOrEqual(2);
    expect(await f.prisma.outcomeEvidence.count({ where: { outputId: x.output.id } })).toBe(2);
    const restarted = new OutcomeEvidenceConsumer(f.prisma, service, wakeup);
    expect(await restarted.drain()).toBe(0);
    await emit(x); await restarted.drain();
    expect(await f.prisma.outcomeEvidence.count({ where: { outputId: x.output.id } })).toBe(2);
    expect((await Effect.runPromise(service.submit(x.outcome.id, { expectedRevision: 1, results: [{ criterionId: x.required.id, result: "PASS", userConfirmed: true, evidenceIds: [], comment: "Verified" }], clientRequestId: requestId() }, "owner:local"))).status).toBe("accepted");
  });
  test("a revision change during inference preserves original evidence revision and cannot accept the successor", async () => {
    const x = await f.completed(); await emit(x);
    const service = new OutcomeReviewService(f.prisma, {} as AgentMessaging, async () => {
      await Effect.runPromise(f.outcomes.createRevision(x.outcome.id, { baseRevision: 1, contract: { goal: ["New scope"], acceptance: [{ statement: "New check", required: true }], boundaries: { included: [], excluded: [] }, budget: null }, changeSummary: "Changed during prereview", clientRequestId: requestId() }, "owner:local"));
      return { text: JSON.stringify({ results: [{ criterionId: x.required.id, suggestion: "likely_pass", reason: "Original output" }] }) };
    });
    await new OutcomeEvidenceConsumer(f.prisma, service, new EventWakeup(testDatabaseUrl!)).drain();
    const evidence = await f.prisma.outcomeEvidence.findMany({ where: { workItemId: x.item.id } });
    expect(evidence.every(e => e.contractRevisionId === x.revision.id)).toBe(true);
    expect(evidence.some(e => e.credibility === "ai_prereview")).toBe(true);
    const outcome = await Effect.runPromise(f.outcomes.get(x.outcome.id)); expect(outcome.currentRevision).toBe(2); expect(outcome.acceptedAt).toBeNull();
  });
  test("poll fallback without LISTEN drains new events and clean stop aborts waiting", async () => {
    const x = await f.completed(); await emit(x);
    const service = new OutcomeReviewService(f.prisma, {} as AgentMessaging, async () => { throw new Error("offline"); });
    const wakeup = new EventWakeup(testDatabaseUrl!);
    const consumer = new OutcomeEvidenceConsumer(f.prisma, service, wakeup);
    consumer.start();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && await f.prisma.outcomeEvidence.count({ where: { outputId: x.output.id } }) < 2) await new Promise(resolve => setTimeout(resolve, 10));
    await consumer.stop();
    expect(await f.prisma.outcomeEvidence.count({ where: { outputId: x.output.id } })).toBe(2);
    await consumer.stop();
  });
});
