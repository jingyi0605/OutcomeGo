import { afterAll, describe, expect, test } from "bun:test";
import { outcomeFixture, testDatabaseUrl, requestId } from "./fixtures/outcome-fixture";
import { Effect } from "effect";
import type { PrismaClient } from "@outcomego/db";
import { OutcomeService } from "../src/services/outcome-service";
import { DecisionService } from "../src/services/decision-service";
import { withdrawSupersededDecisions } from "../src/services/decision-lifecycle";

describe.skipIf(!testDatabaseUrl)("transaction-scoped contract revision", () => {
  const f = outcomeFixture();
  afterAll(() => f.close());
  const concurrentService = () => {
    let reads = 0;
    let release!: () => void;
    const together = new Promise<void>(resolve => { release = resolve; });
    const prisma = {
      $transaction: f.prisma.$transaction.bind(f.prisma),
      idempotencyRecord: {
        findUnique: async (args: Parameters<typeof f.prisma.idempotencyRecord.findUnique>[0]) => {
          const result = await f.prisma.idempotencyRecord.findUnique(args);
          // Hold the two optimistic reads so both callers observe an absent receipt.
          if (++reads <= 2) {
            if (reads === 2) release();
            await together;
          }
          return result;
        },
      },
    } as unknown as PrismaClient;
    return new OutcomeService(prisma);
  };
  test("same-key concurrent approval replays the original approved response", async () => {
    const { outcome } = await f.create(false);
    const service = concurrentService();
    const input = { expectedRevision: 1, confirmationText: "I confirm", clientRequestId: requestId() };
    const results = await Promise.all([1, 2].map(() => Effect.runPromise(Effect.either(service.approve(outcome.id, 1, input, "owner:local")))));
    expect(results.every(result => result._tag === "Right")).toBe(true);
    expect(results[0]).toEqual(results[1]);
    expect(await f.prisma.event.count({ where: { entityId: outcome.id, topic: "outcome.contract.revision_approved" } })).toBe(1);
  });
  test("same-key concurrent revision creation replays without a base revision conflict", async () => {
    const { outcome } = await f.create();
    const service = concurrentService();
    const input = { baseRevision: 1, contract: { goal: ["Compare more plans"], acceptance: [{ statement: "Compare costs", required: true }], boundaries: { included: [], excluded: [] }, budget: null }, changeSummary: "Expanded comparison", clientRequestId: requestId() };
    const results = await Promise.all([1, 2].map(() => Effect.runPromise(Effect.either(service.createRevision(outcome.id, input, "owner:local")))));
    expect(results.every(result => result._tag === "Right")).toBe(true);
    expect(results[0]).toEqual(results[1]);
    expect(await f.prisma.outcomeContractRevision.count({ where: { outcomeId: outcome.id } })).toBe(2);
  });
  test("shares caller transaction, invokes withdrawal hook and rolls back every revision fact", async () => {
    const { outcome } = await f.create();
    const calls: string[] = [];
    const service = new OutcomeService(f.prisma, undefined, undefined, async (tx, id) => {
      expect((await tx.outcome.findUniqueOrThrow({ where: { id } })).currentRevisionId).not.toBe(outcome.currentRevisionView!.id);
      calls.push(id);
    });
    const input = { baseRevision: 1, contract: { goal: ["Compare three plans"], acceptance: [{ statement: "Compare costs", required: true }], boundaries: { included: [], excluded: [] }, budget: null }, changeSummary: "Expanded comparison", clientRequestId: requestId() };
    await expect(f.prisma.$transaction(async tx => {
      const result = await service.createRevisionInTransaction(tx, outcome.id, input, "owner:local");
      expect(result.currentRevision).toBe(2);
      throw new Error("caller rollback");
    })).rejects.toThrow("caller rollback");
    expect(calls).toEqual([outcome.id]);
    expect(await f.prisma.outcomeContractRevision.count({ where: { outcomeId: outcome.id } })).toBe(1);
    expect(await f.prisma.event.count({ where: { entityId: outcome.id, topic: "outcome.contract.revision_created" } })).toBe(1);
    const result = await f.prisma.$transaction(tx => service.createRevisionInTransaction(tx, outcome.id, input, "owner:local"));
    expect(result.currentRevision).toBe(2);
    expect(await f.prisma.idempotencyRecord.count({ where: { scope: `outcome-revision:${outcome.id}`, key: input.clientRequestId } })).toBe(0);
  });

  for (const operation of ["revision", "cancel"] as const) {
    test(`${operation} withdraws independent Decisions through the production hook before any refresh`, async () => {
      const { outcome } = await f.create();
      const decision = await Effect.runPromise(new DecisionService(f.prisma).create({
        outcomeId: outcome.id, contractRevisionId: outcome.currentRevisionView!.id,
        reasonCode: "missing_input", completedSummary: "", problemSummary: "Choose", nextStepSummary: "Wait",
        options: [{ id: "plan", label: "Keep plan", consequence: "Continue", source: "runtime", resolutionEffect: "plan_only" }],
      }, "owner:local"));
      const service = new OutcomeService(f.prisma, undefined, undefined, withdrawSupersededDecisions);
      if (operation === "revision") {
        await Effect.runPromise(service.createRevision(outcome.id, {
          baseRevision: 1, contract: { goal: ["Compare more plans"], acceptance: [{ statement: "Compare costs", required: true }], boundaries: { included: [], excluded: [] }, budget: null },
          changeSummary: "Expanded comparison", clientRequestId: requestId(),
        }, "owner:local"));
      } else {
        await Effect.runPromise(service.cancel(outcome.id, { clientRequestId: requestId() }, "owner:local"));
      }
      expect((await f.prisma.outcomeDecision.findUniqueOrThrow({ where: { id: decision.id } })).status).toBe("withdrawn");
      expect(await f.prisma.event.count({ where: { entityId: outcome.id, topic: "outcome.decision.closed" } })).toBe(1);
    });
  }
});
