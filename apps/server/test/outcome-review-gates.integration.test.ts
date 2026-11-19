import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentMessaging } from "@outcomego/messaging";
import { DecisionService } from "../src/services/decision-service";
import { OutcomeReviewService } from "../src/services/outcome-review-service";
import { outcomeFixture, requestId, testDatabaseUrl } from "./fixtures/outcome-fixture";

describe.skipIf(!testDatabaseUrl)("Outcome acceptance facts across Decision and HumanAction", () => {
  const f = outcomeFixture();
  const reviews = new OutcomeReviewService(f.prisma, {} as AgentMessaging, async () => { throw new Error("offline"); });
  afterAll(() => f.close());
  const submit = (x: Awaited<ReturnType<typeof f.completed>>) => Effect.runPromise(reviews.submit(x.outcome.id, {
    expectedRevision: 1, clientRequestId: requestId(),
    results: [{ criterionId: x.required.id, result: "PASS", evidenceIds: [], comment: "Owner verified", userConfirmed: true }],
  }, "owner:local"));
  const createDecision = (x: Awaited<ReturnType<typeof f.completed>>) => Effect.runPromise(new DecisionService(f.prisma).create({
    outcomeId: x.outcome.id, contractRevisionId: x.revision.id,
    reasonCode: "missing_input", completedSummary: "Complete", problemSummary: "Choose next step",
    nextStepSummary: "Wait for owner", options: [{ id: "plan", label: "Keep plan", consequence: "No scope change", source: "runtime", resolutionEffect: "plan_only" }],
  }, "owner:local"));

  for (const state of ["open", "presented"] as const) {
    test(`an independent ${state} Decision blocks acceptance until closed`, async () => {
      const x = await f.completed();
      const decision = await createDecision(x);
      expect(decision.workItemId).toBeNull();
      await f.prisma.outcomeDecision.update({ where: { id: decision.id }, data: { status: state } });
      expect((await submit(x)).acceptedAt).toBeNull();
      expect(await f.prisma.outcomeReview.count({ where: { outcomeId: x.outcome.id } })).toBe(1);
      expect(await f.prisma.event.count({ where: { entityId: x.outcome.id, topic: "outcome.accepted" } })).toBe(0);
      await f.prisma.outcomeDecision.update({ where: { id: decision.id }, data: { status: state === "open" ? "resolved" : "withdrawn" } });
      expect((await submit(x)).status).toBe("accepted");
    });
  }

  test("expired timestamps and old-revision Decisions do not block current acceptance", async () => {
    const x = await f.completed();
    const decision = await createDecision(x);
    await f.prisma.outcomeDecision.update({ where: { id: decision.id }, data: { expiresAt: new Date(0) } });
    const historical = await f.prisma.outcomeContractRevision.create({ data: {
      outcomeId: x.outcome.id, revision: 2, status: "superseded", goal: [], boundaries: {},
      executionBotId: x.bot.id, contentHash: "historical", createdBy: "owner:local",
    } });
    await f.prisma.outcomeDecision.create({ data: {
      outcomeId: x.outcome.id, contractRevisionId: historical.id, status: "open",
      reasonCode: "missing_input", completedSummary: "", problemSummary: "", nextStepSummary: "",
      options: [], idempotencyKey: requestId(),
    } });
    expect((await submit(x)).status).toBe("accepted");
  });

  test("an open HumanAction still blocks supported PASS until the action is closed", async () => {
    const x = await f.completed();
    const human = await f.prisma.outcomeWorkItem.create({ data: {
      outcomeId: x.outcome.id, contractRevisionId: x.revision.id, botId: x.bot.id, executorType: "human",
      kind: "human_action", title: "Required onsite action", ordinal: 2, status: "ready",
      humanActionCard: { create: { purpose: "Collect required confirmation", steps: ["Verify"], evidenceRequirements: [{ criterionId: x.required.id, required: true }] } },
    } });
    expect((await submit(x)).acceptedAt).toBeNull();
    await f.prisma.outcomeWorkItem.update({ where: { id: human.id }, data: { status: "cancelled" } });
    expect((await submit(x)).status).toBe("accepted");
  });
});
