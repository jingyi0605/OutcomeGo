import { describe, expect, spyOn, test } from "bun:test";
import type { PrismaClient } from "@outcomego/db";
import { appendOutcomeEvent } from "@outcomego/messaging";
import { OutcomeEvidenceConsumer } from "../src/services/outcome-evidence-consumer";
import { runProductReplay } from "./fixtures/outcome-recovery/product-replay";
import { outcomeFixture } from "./fixtures/outcome-fixture";

describe.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("local executable product replay", () => {
  test("does not consume an unrelated pending Output in the canonical database", async () => {
    const foreign = outcomeFixture();
    try {
      const seeded = await foreign.completed();
      const event = await foreign.prisma.$transaction(tx => appendOutcomeEvent(tx, "outcome.output.recorded", seeded.outcome.id, {
        actor: "system:test", workItemId: seeded.item.id, contractRevision: 1,
        payload: { outputId: seeded.output.id, kind: "final_result" },
      }));
      const eventId = (event.payload as { eventId: string }).eventId;
      const snapshot = async () => ({
        evidence: await foreign.prisma.outcomeEvidence.findMany({ where: { outcomeId: seeded.outcome.id }, orderBy: { id: "asc" } }),
        outputReceipt: await foreign.prisma.idempotencyRecord.findUnique({
          where: { scope_key: { scope: "outcome-output-evidence", key: seeded.output.id } },
        }),
        prereviewReceipt: await foreign.prisma.idempotencyRecord.findUnique({
          where: { scope_key: { scope: "outcome-prereview", key: seeded.item.id } },
        }),
        eventReceipt: await foreign.prisma.idempotencyRecord.findUnique({
          where: { scope_key: { scope: "outcome-event:output-evidence", key: eventId } },
        }),
      });
      const before = await snapshot();
      expect(before).toEqual({ evidence: [], outputReceipt: null, prereviewReceipt: null, eventReceipt: null });
      const replay = await runProductReplay("research");
      const after = await snapshot();
      console.log(JSON.stringify({
        scenario: "foreign-output-isolation", foreignOutcomeId: seeded.outcome.id, foreignOutputId: seeded.output.id,
        before, after, databaseIsolation: replay.databaseIsolation,
      }));
      expect(after).toEqual(before);
      expect(replay.databaseIsolation).toMatchObject({ inheritedData: false, removed: true });
      expect(await foreign.prisma.$queryRaw<Array<{ datname: string }>>`
        SELECT datname FROM pg_database WHERE datname=${replay.databaseIsolation.databaseName}
      `).toEqual([]);
    } finally { await foreign.close(); }
  }, 60_000);

  test("publication failure leaves no private database or borrowed client damage", async () => {
    const foreign = outcomeFixture();
    let databaseName = "";
    try {
      await expect(runProductReplay("research", async report => {
        databaseName = report.databaseIsolation.databaseName;
        throw new Error("injected_publication_failure");
      })).rejects.toThrow("injected_publication_failure");
      expect(databaseName).toBeTruthy();
      expect(await foreign.prisma.$queryRaw<Array<{ datname: string }>>`
        SELECT datname FROM pg_database WHERE datname=${databaseName}
      `).toEqual([]);
    } finally { await foreign.close(); }
  }, 60_000);

  test("an execution failure drops its private database and preserves the caller client", async () => {
    const foreign = outcomeFixture();
    let databaseName = "";
    const failure = spyOn(OutcomeEvidenceConsumer.prototype, "drain")
      .mockImplementationOnce(async function(this: OutcomeEvidenceConsumer) {
        const db = (this as unknown as { prisma: PrismaClient }).prisma;
        const rows = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
        databaseName = rows[0]!.name;
        throw new Error("injected_consumer_execution_failure");
      });
    try {
      await expect(runProductReplay("research")).rejects.toThrow("injected_consumer_execution_failure");
      expect(databaseName).toMatch(/^outcomego_product_replay_/);
      const remaining = await foreign.prisma.$queryRaw<Array<{ datname: string }>>`
        SELECT datname FROM pg_database WHERE datname=${databaseName}
      `;
      expect(remaining).toEqual([]);
      console.log(JSON.stringify({ scenario: "execution-failure-cleanup", databaseName, remaining }));
    } finally {
      failure.mockRestore();
      await foreign.close();
    }
  }, 60_000);

  for (const scenario of ["research", "human"] as const) {
    test(`${scenario} records one complete actual service lineage and preserves local-only boundaries`, async () => {
      const report = await runProductReplay(scenario);
      expect(report.status).toBe("PASS");
      expect(report.realBotReplay).toBe("PENDING");
      expect(report.nativeUIReplay).toBe("PENDING");
      expect(report.databaseIsolation).toMatchObject({ inheritedData: false, removed: true });
      expect(report.checks.every(check => check.passed)).toBe(true);
      expect(report.finalDetail.id).toBe(report.ids.outcomeId!);
      expect(report.finalDetail.status).toBe("accepted");
      expect(report.finalDetail.outputs.length).toBeGreaterThan(0);
      expect(report.finalDetail.evidence.some(evidence => evidence.credibility === "human_confirmed")).toBe(true);
      expect(report.finalDetail.reviews.length).toBeGreaterThan(0);
      expect(report.lineage.outputs.length).toBeGreaterThan(0);
      expect(report.idempotency.length).toBeGreaterThan(0);
      expect(report.requests.some(step => step.operation === "outcomes.startRun")).toBe(true);
      expect(report.requests.some(step => step.operation === "reviews.submit.final")).toBe(true);
      if (scenario === "human") {
        expect(report.contexts).toHaveLength(2);
        expect(report.contexts[1]!.contextSessionId).toBe(report.contexts[0]!.contextSessionId);
        expect(report.ids.humanWorkItemId).toBeTruthy();
        expect(report.requests.some(step => step.operation === "reviews.submit.missing-PASS" &&
          (step.result as { errorCode: string }).errorCode === "human_evidence_missing")).toBe(true);
        expect(report.requests.some(step => step.operation === "reviews.submit.FAIL")).toBe(true);
      }
    }, 60_000);
  }
});
