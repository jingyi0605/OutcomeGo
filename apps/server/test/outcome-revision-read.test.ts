import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { failureCode, outcomeFixture, requestId, testDatabaseUrl } from "./fixtures/outcome-fixture";

describe.skipIf(!testDatabaseUrl)("retained revision reads", () => {
  const f = outcomeFixture();
  afterAll(() => f.close());
  test("pending successors never replace the actual old criteria or mutate the current pointer on history reads", async () => {
    const x = await f.create();
    const original = x.outcome.currentRevisionView!;
    await Effect.runPromise(f.outcomes.createRevision(x.outcome.id, {
      baseRevision: 1, contract: { goal: ["A new goal"], acceptance: [{ statement: "Different current criterion", required: true }], boundaries: { included: [], excluded: [] }, budget: null },
      changeSummary: "New criterion", clientRequestId: requestId(),
    }, "owner:local"));
    const old = await Effect.runPromise(f.outcomes.getRevision(x.outcome.id, 1));
    expect(old).toEqual(original);
    expect((await Effect.runPromise(f.outcomes.get(x.outcome.id))).currentRevision).toBe(2);
    expect(await failureCode(f.outcomes.getRevision(x.outcome.id, 999))).toBe("contract_revision_not_found");
    expect(await failureCode(f.outcomes.getRevision(crypto.randomUUID(), 1))).toBe("outcome_not_found");
  });
});
