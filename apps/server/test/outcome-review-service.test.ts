import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { OutcomeThreadFake, type AgentMessaging } from "@outcomego/messaging";
import { OutcomeReviewService } from "../src/services/outcome-review-service";
import { HumanWorkService } from "../src/services/human-work-service";
import { HumanReceiptService } from "../src/services/human-receipt-service";
import {
  outcomeFixture,
  requestId,
  testDatabaseUrl,
  failureCode,
} from "./fixtures/outcome-fixture";
import type { SubmitOutcomeReviewInput, ReviewResult } from "@outcomego/contracts/outcomes";

test("acceptance route rejects blank feedback and accepts a whole-result decision", async () => {
  const { outcomeRoutes } = await import("../src/routes/outcome");
  type RouteContext = import("../src/routes/context").RouteContext;
  const id = "01234567-0000-4000-8000-012345678901";
  const url = new URL(`http://localhost/api/outcomes/${id}/acceptance`);
  const received: unknown[] = [];
  const run = (input: object) => outcomeRoutes({
    app: {
      prisma: { outcome: { findFirst: async ({ where }: { where: { id: string; ownerId: string } }) =>
        where.id === id && where.ownerId === "local" ? { id } : null } },
      outcomeReviews: { decide: (id: string, input: unknown, actor: string) => {
        received.push({ id, input, actor });
        return Effect.succeed({ id });
      } },
    } as unknown as RouteContext["app"],
    path: url.pathname,
    request: new Request(url, { method: "POST", body: JSON.stringify(input) }),
    url,
    authMode: "disabled",
    authenticatedSessionId: null,
  } as RouteContext);
  const base = { expectedRevision: 1, clientRequestId: "request-123" };
  await expect(run({ ...base, decision: "reject", reason: "  " })).rejects.toThrow();
  expect(received).toEqual([]);
  await run({ ...base, decision: "approve" });
  await run({ ...base, decision: "reject", reason: "Include the before and after capacity." });
  expect(received).toEqual([
    { id, input: { ...base, decision: "approve" }, actor: "owner:local" },
    {
      id, input: { ...base, decision: "reject", reason: "Include the before and after capacity." },
      actor: "owner:local",
    },
  ]);
});

if (testDatabaseUrl) describe("OutcomeReviewService", () => {
  const f = outcomeFixture();
  const fake = new OutcomeThreadFake();
  const humanWork = new HumanWorkService(f.prisma);
  const humanReceipts = new HumanReceiptService(f.prisma,
    { metadata: async () => { throw new Error("No assets in these text receipt fixtures"); } },
    { resolve: async () => [] }, {} as AgentMessaging,
    (tx, messaging, input) => fake.enqueueOutcomeTurn(tx, messaging, input));
  const submitHuman = async (x: Awaited<ReturnType<typeof f.completed>>, optional = false) => {
    const card = await f.prisma.$transaction(tx => humanWork.createCard(tx, {
      outcomeId: x.outcome.id, expectedContractRevision: 1, requestedByWorkItemId: x.item.id, references: [],
      card: { title: "Inspection", purpose: "Collect real observations", steps: ["Human inspects the fixture"],
        evidenceRequirements: [x.required, ...(optional ? [x.optional] : [])].map(criterion => ({
          criterionOrdinal: criterion.ordinal, label: criterion.statement, kind: "text" as const,
        })) },
    }, "owner:local"));
    await humanWork.start(card.workItemId, { clientRequestId: requestId(), expectedContractRevision: 1 }, "owner:local");
    const receipt = await humanReceipts.submit(card.workItemId, {
      clientRequestId: requestId(), expectedContractRevision: 1, text: "Human observed the synthetic inspection result",
    }, "owner:local");
    return { item: { id: card.workItemId }, receipt };
  };
  const reviews = new OutcomeReviewService(
    f.prisma,
    {} as AgentMessaging,
    async () => {
      throw new Error("offline");
    },
    (tx, messaging, input) => fake.enqueueOutcomeTurn(tx, messaging, input),
    humanReceipts
  );
  afterAll(() => f.close());
  const input = (
    criterionId: string,
    result: ReviewResult,
    extras = {}
  ): SubmitOutcomeReviewInput => ({
    expectedRevision: 1,
    results: [{ criterionId, result, evidenceIds: [], comment: "Owner result", ...extras }],
    clientRequestId: requestId(),
  });

  test("approval signs off the whole result and rejection queues one follow-up with the reason", async () => {
    const approved = await f.completed();
    const acceptRequest = { decision: "approve", expectedRevision: 1, clientRequestId: requestId() } as const;
    const accept = () => Effect.runPromise(reviews.decide(approved.outcome.id, acceptRequest, "owner:local"));
    const accepted = await accept();
    expect(accepted.status).toBe("accepted");
    expect(accepted.reviews).toEqual([]);
    expect(await accept()).toEqual(accepted);
    expect(await f.prisma.event.count({ where: { entityId: approved.outcome.id, topic: "outcome.accepted" } })).toBe(1);

    const rejected = await f.completed();
    const rejectRequest = {
      decision: "reject", expectedRevision: 1, reason: "Include the before and after capacity.",
      clientRequestId: requestId(),
    } as const;
    const reject = () => Effect.runPromise(reviews.decide(rejected.outcome.id, rejectRequest, "owner:local"));
    const [first, replay] = await Promise.all([reject(), reject()]);
    expect(first).toEqual(replay);
    expect(first.status).toBe("running");
    const followUp = first.workItems.find((item) => item.kind === "rework")!;
    expect(followUp.reworkOfWorkItemId).toBe(rejected.item.id);
    expect(fake.enqueueCalls.filter((call) => call.workItemId === followUp.id)).toHaveLength(1);
    expect(fake.enqueueCalls.at(-1)?.content).toContain(rejectRequest.reason);
  });

  test("Output candidates are idempotent, sourced and advisory; advisory PASS and missing evidence fail", async () => {
    const x = await f.completed();
    const first = await reviews.recordOutputEvidence(x.output.id);
    expect(first.evidenceIds).toHaveLength(2);
    expect(await reviews.recordOutputEvidence(x.output.id)).toEqual(first);
    const evidence = await f.prisma.outcomeEvidence.findMany({ where: { outputId: x.output.id } });
    expect(
      evidence.every(
        (e) =>
          e.credibility === "agent_report" &&
          e.capturedBy === `bot:${x.bot.id}` &&
          e.contractRevisionId === x.revision.id
      )
    ).toBe(true);
    expect(
      await failureCode(reviews.submit(x.outcome.id, input(x.required.id, "PASS"), "owner:local"))
    ).toBe("evidence_missing");
    expect(
      await failureCode(
        reviews.submit(
          x.outcome.id,
          input(x.required.id, "PASS", {
            evidenceIds: [evidence.find((e) => e.criterionId === x.required.id)!.id],
          }),
          "owner:local"
        )
      )
    ).toBe("evidence_missing");
    expect(await f.prisma.outcomeReview.count({ where: { outcomeId: x.outcome.id } })).toBe(0);
  });
  test("required PASS accepts with owner confirmation; optional FAIL does not block; replay emits one event", async () => {
    const x = await f.completed();
    const base = input(x.required.id, "PASS", { userConfirmed: true });
    const request: SubmitOutcomeReviewInput = {
      ...base,
      results: [
        ...base.results,
        {
          criterionId: x.optional.id,
          result: "FAIL",
          evidenceIds: [],
          comment: "Optional appendix omitted",
        },
      ],
    };
    const result = await Effect.runPromise(reviews.submit(x.outcome.id, request, "owner:local"));
    expect(result.status).toBe("accepted");
    expect(result.acceptedAt).not.toBeNull();
    expect(await Effect.runPromise(reviews.submit(x.outcome.id, request, "owner:local"))).toEqual(
      result
    );
    expect(
      await f.prisma.event.count({ where: { entityId: x.outcome.id, topic: "outcome.accepted" } })
    ).toBe(1);
  });
  test("new human evidence supports PASS while cross-criterion evidence rolls back", async () => {
    const x = await f.completed();
    const request = {
      ...input(x.required.id, "PASS"),
      newEvidence: [
        {
          criterionId: x.required.id,
          sourceType: "url" as const,
          sourceRef: "https://example.test/check",
          contentSummary: "Owner inspected source",
        },
      ],
    };
    const result = await Effect.runPromise(reviews.submit(x.outcome.id, request, "owner:local"));
    expect(result.status).toBe("accepted");
    expect(result.evidence[0]?.credibility).toBe("human_confirmed");
    const y = await f.completed();
    expect(
      await failureCode(
        reviews.submit(
          y.outcome.id,
          input(y.required.id, "PASS", { evidenceIds: [result.evidence[0]!.id] }),
          "owner:local"
        )
      )
    ).toBe("evidence_missing");
  });
  test("FAIL/UNVERIFIED and unsupported required waiver never accept; stale revision refused", async () => {
    const x = await f.completed();
    for (const result of ["FAIL", "UNVERIFIED"] as const) {
      const detail = await Effect.runPromise(
        reviews.submit(x.outcome.id, input(x.required.id, result), "owner:local")
      );
      expect(detail.status).toBe("review_pending");
    }
    expect(
      await failureCode(
        reviews.submit(
          x.outcome.id,
          input(x.required.id, "WAIVED_BY_APPROVED_CHANGE"),
          "owner:local"
        )
      )
    ).toBe("review_incomplete");
    expect(
      await failureCode(
        reviews.submit(
          x.outcome.id,
          { ...input(x.required.id, "PASS"), expectedRevision: 9 },
          "owner:local"
        )
      )
    ).toBe("review_revision_conflict");
    const event = await f.prisma.event.findFirstOrThrow({
      where: { entityId: x.outcome.id, topic: "outcome.review.required" },
    });
    expect(event.payload).toMatchObject({
      contractRevision: 1,
      payload: { criterionIds: [x.required.id], workItemIds: [x.item.id] },
    });
  });
  test("concurrent identical Review writes one sequence; different keys serialize full history", async () => {
    const x = await f.completed();
    const request = input(x.required.id, "FAIL");
    const results = await Promise.all(
      [1, 2].map(() => Effect.runPromise(reviews.submit(x.outcome.id, request, "owner:local")))
    );
    expect(results[0]).toEqual(results[1]);
    expect(await f.prisma.outcomeReview.count({ where: { criterionId: x.required.id } })).toBe(1);
    await Promise.all(
      [1, 2].map(() =>
        Effect.runPromise(
          reviews.submit(x.outcome.id, input(x.required.id, "UNVERIFIED"), "owner:local")
        )
      )
    );
    expect(
      (
        await f.prisma.outcomeReview.findMany({
          where: { criterionId: x.required.id },
          orderBy: { sequence: "asc" },
        })
      ).map((r) => r.sequence)
    ).toEqual([1, 2, 3]);
    expect(
      await failureCode(
        reviews.submit(
          x.outcome.id,
          { ...request, results: [{ ...request.results[0]!, comment: "Different" }] },
          "owner:local"
        )
      )
    ).toBe("idempotency_conflict");
  });
  test("running or unsubmitted human work blocks Outcome acceptance", async () => {
    const x = await f.completed();
    await f.prisma.outcomeWorkItem.create({
      data: {
        outcomeId: x.outcome.id,
        contractRevisionId: x.revision.id,
        botId: x.bot.id,
        executorType: "human",
        kind: "human_action",
        title: "Check cables",
        ordinal: 2,
        status: "in_progress",
      },
    });
    const detail = await Effect.runPromise(
      reviews.submit(
        x.outcome.id,
        input(x.required.id, "PASS", { userConfirmed: true }),
        "owner:local"
      )
    );
    expect(detail.acceptedAt).toBeNull();
    expect(detail.status).toBe("human_action_pending");
  });
  test("the unified review accepts submitted human receipt work via shared transitions", async () => {
    const x = await f.completed();
    const { item, receipt } = await submitHuman(x);
    const evidence = { id: receipt.evidenceIds[0]! };
    const detail = await Effect.runPromise(
      reviews.submit(
        x.outcome.id,
        input(x.required.id, "PASS", { evidenceIds: [evidence.id] }),
        "owner:local"
      )
    );
    expect(detail.workItems.find((i) => i.id === item.id)?.status).toBe("accepted");
    expect(detail.status).toBe("accepted");
  });
  test("an optional receipt criterion failure does not reject an otherwise satisfied human action", async () => {
    const x = await f.completed();
    const { item, receipt } = await submitHuman(x, true);
    const evidenceIds = receipt.evidenceIds;
    const detail = await Effect.runPromise(reviews.submit(x.outcome.id, { expectedRevision: 1, results: [{ criterionId: x.required.id, result: "PASS", evidenceIds: [evidenceIds[0]!], comment: "Verified" }, { criterionId: x.optional.id, result: "FAIL", evidenceIds: [evidenceIds[1]!], comment: "Optional appendix missing" }], clientRequestId: requestId() }, "owner:local"));
    expect(detail.workItems.find(i => i.id === item.id)?.status).toBe("accepted");
    expect(detail.status).toBe("accepted");
  });
  test("FAIL rework creates a new thread, preserves history, and repeats safely; non-FAIL refused", async () => {
    const x = await f.completed();
    const request = {
      expectedRevision: 1,
      criterionIds: [x.required.id],
      comment: "Compare restore times",
      clientRequestId: requestId(),
    };
    expect(await failureCode(reviews.rework(x.outcome.id, request, "owner:local"))).toBe(
      "rework_not_allowed"
    );
    await Effect.runPromise(
      reviews.submit(x.outcome.id, input(x.required.id, "FAIL"), "owner:local")
    );
    const detail = await Effect.runPromise(reviews.rework(x.outcome.id, request, "owner:local"));
    expect(detail.workItems[1]).toMatchObject({
      kind: "rework",
      contractRevision: 1,
      reworkOfWorkItemId: x.item.id,
      status: "running",
    });
    expect(fake.enqueueCalls.at(-1)).toMatchObject({
      reason: "rework",
      clientId: request.clientRequestId,
    });
    expect(await Effect.runPromise(reviews.rework(x.outcome.id, request, "owner:local"))).toEqual(
      detail
    );
    expect(detail.reviews).toHaveLength(1);
  });
  test("PASS criteria refuse rework and UNVERIFIED criteria allow it", async () => {
    const x = await f.completed();
    await Effect.runPromise(
      reviews.submit(
        x.outcome.id,
        {
          expectedRevision: 1,
          results: [
            {
              criterionId: x.required.id,
              result: "UNVERIFIED",
              evidenceIds: [],
              comment: "Needs independent check",
            },
            {
              criterionId: x.optional.id,
              result: "PASS",
              evidenceIds: [],
              comment: "Inspected",
              userConfirmed: true,
            },
          ],
          clientRequestId: requestId(),
        },
        "owner:local"
      )
    );
    const request = {
      expectedRevision: 1,
      criterionIds: [x.optional.id],
      comment: "Try rework",
      clientRequestId: requestId(),
    };
    expect(await failureCode(reviews.rework(x.outcome.id, request, "owner:local"))).toBe(
      "rework_not_allowed"
    );
    const detail = await Effect.runPromise(
      reviews.rework(
        x.outcome.id,
        { ...request, criterionIds: [x.required.id], clientRequestId: requestId() },
        "owner:local"
      )
    );
    expect(detail.workItems.at(-1)?.kind).toBe("rework");
  });
  test("concurrent accepting requests produce one acceptance event", async () => {
    const x = await f.completed();
    const results = await Promise.all(
      [1, 2].map(() =>
        Effect.runPromise(
          Effect.either(
            reviews.submit(
              x.outcome.id,
              input(x.required.id, "PASS", { userConfirmed: true }),
              "owner:local"
            )
          )
        )
      )
    );
    expect(results.filter((result) => result._tag === "Right")).toHaveLength(1);
    expect(
      await f.prisma.event.count({ where: { entityId: x.outcome.id, topic: "outcome.accepted" } })
    ).toBe(1);
  });
  test("an explicit approved successor can waive one uniquely matched formerly-required criterion", async () => {
    const x = await f.completed();
    const changed = await Effect.runPromise(
      f.outcomes.createRevision(
        x.outcome.id,
        {
          baseRevision: 1,
          contract: {
            goal: x.revision.goal,
            acceptance: [
              { statement: x.required.statement, required: false },
              { statement: "Verify restore time", required: true },
            ],
            boundaries: x.revision.boundaries,
            budget: null,
          },
          changeSummary: `Make optional after scope change: ${x.required.statement}`,
          clientRequestId: requestId(),
        },
        "owner:local"
      )
    );
    const approved = await Effect.runPromise(
      f.outcomes.approve(
        x.outcome.id,
        2,
        {
          expectedRevision: 2,
          confirmationText: "I approve the changed requirement",
          clientRequestId: requestId(),
        },
        "owner:local"
      )
    );
    const current = approved.currentRevisionView!;
    await f.prisma.outcomeWorkItem.create({
      data: {
        outcomeId: x.outcome.id,
        contractRevisionId: current.id,
        botId: x.bot.id,
        executorType: "agent",
        status: "completed",
        ordinal: 2,
        title: "Changed comparison",
      },
    });
    const optional = current.criteria.find((c) => !c.required)!;
    const required = current.criteria.find((c) => c.required)!;
    const result = await Effect.runPromise(
      reviews.submit(
        x.outcome.id,
        {
          expectedRevision: 2,
          results: [
            {
              criterionId: optional.id,
              result: "WAIVED_BY_APPROVED_CHANGE",
              evidenceIds: [],
              comment: "Approved changed scope",
            },
            {
              criterionId: required.id,
              result: "PASS",
              evidenceIds: [],
              comment: "Verified",
              userConfirmed: true,
            },
          ],
          clientRequestId: requestId(),
        },
        "owner:local"
      )
    );
    expect(changed.currentRevision).toBe(2);
    expect(result.status).toBe("accepted");
    expect(
      result.reviews.some(
        (r) => r.criterionId === optional.id && r.result === "WAIVED_BY_APPROVED_CHANGE"
      )
    ).toBe(true);
  });
  test("optional-only, undocumented and duplicate-statement waivers are refused", async () => {
    const x = await f.completed();
    expect(
      await failureCode(
        reviews.submit(
          x.outcome.id,
          input(x.optional.id, "WAIVED_BY_APPROVED_CHANGE"),
          "owner:local"
        )
      )
    ).toBe("review_incomplete");
    const contract = {
      goal: x.revision.goal,
      acceptance: [
        { statement: x.required.statement, required: true },
        { statement: x.required.statement, required: true },
        { statement: "Unique required", required: true },
      ],
      boundaries: x.revision.boundaries,
      budget: null,
    };
    await Effect.runPromise(
      f.outcomes.createRevision(
        x.outcome.id,
        {
          baseRevision: 1,
          contract,
          changeSummary: "Add repeated requirement",
          clientRequestId: requestId(),
        },
        "owner:local"
      )
    );
    await Effect.runPromise(
      f.outcomes.approve(
        x.outcome.id,
        2,
        { expectedRevision: 2, confirmationText: "Confirm", clientRequestId: requestId() },
        "owner:local"
      )
    );
    await Effect.runPromise(
      f.outcomes.createRevision(
        x.outcome.id,
        {
          baseRevision: 2,
          contract: {
            ...contract,
            acceptance: [
              { statement: x.required.statement, required: false },
              { statement: "Unique required", required: true },
            ],
          },
          changeSummary: `Make optional: ${x.required.statement}`,
          clientRequestId: requestId(),
        },
        "owner:local"
      )
    );
    const approved = await Effect.runPromise(
      f.outcomes.approve(
        x.outcome.id,
        3,
        { expectedRevision: 3, confirmationText: "Confirm", clientRequestId: requestId() },
        "owner:local"
      )
    );
    const optional = approved.currentRevisionView!.criteria.find((c) => !c.required)!;
    expect(
      await failureCode(
        reviews.submit(
          x.outcome.id,
          { ...input(optional.id, "WAIVED_BY_APPROVED_CHANGE"), expectedRevision: 3 },
          "owner:local"
        )
      )
    ).toBe("review_incomplete");
    expect(await f.prisma.outcomeReview.count({ where: { outcomeId: x.outcome.id } })).toBe(0);
  });
  test("completed rework can satisfy a failed original without rewriting its history", async () => {
    const x = await f.completed();
    await f.prisma.outcomeWorkItem.update({ where: { id: x.item.id }, data: { status: "failed" } });
    await f.prisma.outcomeWorkItem.create({
      data: {
        outcomeId: x.outcome.id,
        contractRevisionId: x.revision.id,
        botId: x.bot.id,
        executorType: "agent",
        kind: "rework",
        reworkOfWorkItemId: x.item.id,
        title: "Fixed report",
        status: "completed",
        ordinal: 2,
      },
    });
    const detail = await Effect.runPromise(
      reviews.submit(
        x.outcome.id,
        input(x.required.id, "PASS", { userConfirmed: true }),
        "owner:local"
      )
    );
    expect(detail.status).toBe("accepted");
    expect(detail.workItems[0]?.status).toBe("failed");
  });
  test("prereview stores per-criterion advice once and never creates Review", async () => {
    const x = await f.completed();
    let calls = 0;
    const service = new OutcomeReviewService(f.prisma, {} as AgentMessaging, async (request) => {
      calls++;
      expect(request.kind).toBe("prereview");
      return {
        text: JSON.stringify({
          results: [
            { criterionId: x.required.id, suggestion: "likely_pass", reason: "Costs are compared" },
          ],
        }),
      };
    });
    await service.prereview(x.item.id);
    await service.prereview(x.item.id);
    expect(calls).toBe(1);
    expect(
      await f.prisma.outcomeEvidence.count({
        where: { workItemId: x.item.id, credibility: "ai_prereview" },
      })
    ).toBe(1);
    expect(await f.prisma.outcomeReview.count({ where: { outcomeId: x.outcome.id } })).toBe(0);
    const evidence = await f.prisma.outcomeEvidence.findFirstOrThrow({
      where: { workItemId: x.item.id },
    });
    expect(
      await failureCode(
        service.submit(
          x.outcome.id,
          input(x.required.id, "PASS", { evidenceIds: [evidence.id] }),
          "owner:local"
        )
      )
    ).toBe("evidence_missing");
  });
  test("prereview failure never blocks an owner Review", async () => {
    const x = await f.completed();
    await reviews.prereview(x.item.id);
    expect(
      await f.prisma.outcomeEvidence.count({
        where: { workItemId: x.item.id, credibility: "ai_prereview" },
      })
    ).toBe(0);
    expect(
      (
        await Effect.runPromise(
          reviews.submit(
            x.outcome.id,
            input(x.required.id, "PASS", { userConfirmed: true }),
            "owner:local"
          )
        )
      ).status
    ).toBe("accepted");
  });
});
