import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { ExploreService } from "../src/services/explore-service";
import { OutcomePlanningService } from "../src/services/outcome-planning-service";
import { OutcomeService } from "../src/services/outcome-service";
import type { OutcomeInference } from "../src/services/outcome-inference";
import { failureCode, outcomeFixture, requestId, testDatabaseUrl } from "./fixtures/outcome-fixture";

const actor = "owner:local" as const;
const generation = { text: JSON.stringify({
  goal: [{ text: "Compare the alternatives" }], acceptance: [{ text: "Compare costs" }],
  boundaries: [{ text: "Public sources only", kind: "included" }], questions: [],
}) };
const delivery = (planId: string) => ({
  planId, title: "Independent delivery", clientRequestId: requestId(),
  goal: { selectedOptionIds: ["goal-1"], customEntries: [] },
  acceptance: { selectedOptionIds: ["acceptance-1"], customEntries: [] },
  boundaries: { selectedOptionIds: ["boundaries-1"], customEntries: [] },
});

describe.skipIf(!testDatabaseUrl)("Explore and independent Delivery", () => {
  const f = outcomeFixture(), ideas: string[] = [];
  const services = (infer: OutcomeInference = async () => generation) => {
    const planning = new OutcomePlanningService(f.prisma, infer);
    return { planning, explore: new ExploreService(f.prisma, planning) };
  };
  const create = async (service: ExploreService, botId?: string, sourceOutcomeId?: string) => {
    const idea = await Effect.runPromise(service.create({
      title: "Investigate alternatives", note: "An idea without a contract", botId, sourceOutcomeId,
      sourceReferences: [{ sourceRef: "https://example.test/reference", version: "1" }],
      budget: { timeLimitMinutes: 15, costLimit: null }, clientRequestId: requestId(),
    }, actor));
    ideas.push(idea.id);
    return idea;
  };
  afterAll(async () => {
    await f.prisma.exploreIdea.deleteMany({ where: { id: { in: ideas } } });
    await f.close();
  });

  test("informal ideas are readable without a Bot or Contract; discard preserves notes, sources and budget", async () => {
    const { explore } = services();
    const idea = await create(explore);
    expect(idea).toMatchObject({ status: "draft", botId: null, planningDraftId: null, proposedOutcomeId: null });
    expect(await failureCode(explore.propose(idea.id, { clientRequestId: requestId() }, actor))).toBe("explore_bot_required");
    const input = { clientRequestId: requestId() };
    const discarded = await Effect.runPromise(explore.discard(idea.id, input, actor));
    expect(await Effect.runPromise(explore.discard(idea.id, input, actor))).toEqual(discarded);
    expect(discarded).toMatchObject({ note: idea.note, sourceReferences: idea.sourceReferences, budget: idea.budget, status: "discarded" });
    expect(discarded.discardedAt).not.toBeNull();
    expect((await Effect.runPromise(explore.list({ statuses: ["discarded"], cursor: null, limit: 100 }))).items.some(row => row.id === idea.id)).toBe(true);
    expect(await failureCode(explore.propose(idea.id, { clientRequestId: requestId() }, actor))).toBe("explore_read_only");
  });

  test("proposal creates only a planning draft; conversion atomically creates an independent unapproved Outcome", async () => {
    const x = await f.create();
    const original = await f.prisma.outcomeContractRevision.findUniqueOrThrow({ where: { id: x.outcome.currentRevisionView!.id }, include: { criteria: true } });
    let calls = 0;
    const { explore } = services(async () => { calls++; return generation; });
    const idea = await create(explore, undefined, x.outcome.id);
    const input = { clientRequestId: requestId() };
    const proposal = await Effect.runPromise(explore.propose(idea.id, input, actor));
    expect(await Effect.runPromise(explore.propose(idea.id, input, actor))).toEqual(proposal);
    expect(calls).toBe(1);
    expect(proposal.idea).toMatchObject({ status: "proposed_for_delivery", planningDraftId: proposal.plan.planId, proposedOutcomeId: null });
    expect(await f.prisma.outcome.count({ where: { botId: x.bot.id } })).toBe(1);
    expect(await f.prisma.run.count({ where: { botId: x.bot.id } })).toBe(0);
    const request = delivery(proposal.plan.planId);
    const outcomes = await Promise.all([1, 2].map(() => Effect.runPromise(f.outcomes.createFromDraft(request, actor))));
    expect(outcomes[0]).toEqual(outcomes[1]);
    const created = outcomes[0]!;
    expect(created.id).not.toBe(x.outcome.id);
    expect(created.sourceExploreId).toBe(idea.id);
    expect(created.currentRevisionView?.status).toBe("pending_approval");
    const converted = await f.prisma.exploreIdea.findUniqueOrThrow({ where: { id: idea.id } });
    expect(converted).toMatchObject({ status: "converted", proposedOutcomeId: created.id, planningDraftId: proposal.plan.planId });
    expect(await f.prisma.outcomeContractRevision.findUniqueOrThrow({ where: { id: original.id }, include: { criteria: true } })).toEqual(original);
    expect(await f.prisma.run.count({ where: { botId: x.bot.id } })).toBe(0);
    expect(await failureCode(explore.discard(idea.id, { clientRequestId: requestId() }, actor))).toBe("explore_read_only");
    expect(await failureCode(explore.propose(idea.id, { clientRequestId: requestId() }, actor))).toBe("explore_read_only");
  });

  test("discard while inference is paused commits promptly and prevents any orphan planning draft", async () => {
    const bot = await f.bot();
    let began!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const { explore } = services(async () => { began(); await held; return generation; });
    const idea = await create(explore, bot.id);
    const pending = Effect.runPromise(Effect.either(explore.propose(idea.id, { clientRequestId: requestId() }, actor)));
    await started;
    try {
      await Effect.runPromise(explore.discard(idea.id, { clientRequestId: requestId() }, actor));
    } finally { release(); }
    const result = await pending;
    expect(result._tag).toBe("Left");
    expect(result._tag === "Left" && (result.left as { code?: string }).code).toBe("explore_read_only");
    expect(await f.prisma.outcomePlanningDraft.count({ where: { botId: bot.id } })).toBe(0);
    expect(await f.prisma.outcome.count({ where: { botId: bot.id } })).toBe(0);
  });

  test("a failed model plan remains readable and stable on retry, then a new request can generate successfully", async () => {
    const bot = await f.bot();
    let calls = 0;
    const { explore, planning } = services(async () => ++calls <= 2 ? { text: "not JSON" } : generation);
    const idea = await create(explore, bot.id), input = { clientRequestId: requestId() };
    expect(await failureCode(explore.propose(idea.id, input, actor))).toBe("planning_generation_failed");
    expect(await failureCode(explore.propose(idea.id, input, actor))).toBe("planning_generation_failed");
    expect(calls).toBe(2);
    const failed = await f.prisma.exploreIdea.findUniqueOrThrow({ where: { id: idea.id } });
    expect(failed.status).toBe("exploring");
    expect((await Effect.runPromise(planning.get(failed.planningDraftId!))).status).toBe("failed");
    const ready = await Effect.runPromise(explore.propose(idea.id, { clientRequestId: requestId() }, actor));
    expect(ready.plan.status).toBe("ready");
    expect(ready.plan.planId).not.toBe(failed.planningDraftId);
    expect(calls).toBe(3);
  });

  test("discarded proposal cannot be consumed through the ordinary Outcome creation route", async () => {
    const bot = await f.bot(), { explore } = services();
    const idea = await create(explore, bot.id);
    const proposal = await Effect.runPromise(explore.propose(idea.id, { clientRequestId: requestId() }, actor));
    await Effect.runPromise(explore.discard(idea.id, { clientRequestId: requestId() }, actor));
    expect(await failureCode(f.outcomes.createFromDraft(delivery(proposal.plan.planId), actor))).toBe("explore_read_only");
    expect(await f.prisma.outcome.count({ where: { botId: bot.id } })).toBe(0);
    expect((await f.prisma.outcomePlanningDraft.findUniqueOrThrow({ where: { id: proposal.plan.planId } })).status).toBe("ready");
  });

  test("a conversion failure after the new Outcome is written rolls back the draft, revision and both source links", async () => {
    const bot = await f.bot(), { explore } = services();
    const idea = await create(explore, bot.id);
    const proposal = await Effect.runPromise(explore.propose(idea.id, { clientRequestId: requestId() }, actor));
    const outcomes = new OutcomeService({
      idempotencyRecord: f.prisma.idempotencyRecord,
      $transaction: (write: (tx: Prisma.TransactionClient) => Promise<unknown>) => f.prisma.$transaction(tx => write(new Proxy(tx, {
        get(target, property, receiver) {
          if (property !== "exploreIdea") return Reflect.get(target, property, receiver);
          return new Proxy(target.exploreIdea, { get(delegate, method) {
            if (method !== "update") return Reflect.get(delegate, method);
            return async (args: Parameters<typeof delegate.update>[0]) => {
              await delegate.update(args);
              throw new Error("conversion rollback");
            };
          } });
        },
      }))),
    } as unknown as PrismaClient);
    const result = await Effect.runPromise(Effect.either(outcomes.createFromDraft(delivery(proposal.plan.planId), actor)));
    expect(result._tag).toBe("Left");
    expect(await f.prisma.outcome.count({ where: { botId: bot.id } })).toBe(0);
    expect((await f.prisma.outcomePlanningDraft.findUniqueOrThrow({ where: { id: proposal.plan.planId } })).status).toBe("ready");
    expect(await f.prisma.exploreIdea.findUniqueOrThrow({ where: { id: idea.id } })).toMatchObject({ status: "proposed_for_delivery", proposedOutcomeId: null });
  });
});
