import { afterAll, describe, expect, test } from "bun:test";
import { outcomeFixture, testDatabaseUrl, requestId } from "./fixtures/outcome-fixture";
import { OutcomeService } from "../src/services/outcome-service";

describe.skipIf(!testDatabaseUrl)("transaction-scoped contract revision", () => {
  const f = outcomeFixture();
  afterAll(() => f.close());
  test("shares caller transaction, invokes withdrawal hook and rolls back every revision fact", async () => {
    const { outcome } = await f.create();
    const calls: string[] = [];
    const service = new OutcomeService(f.prisma, async (tx, id) => {
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
});
