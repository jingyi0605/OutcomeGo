import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApiError } from "@outcomego/contracts";
import { createPrismaClient } from "@outcomego/db";
import { transitionWorkItem } from "@outcomego/messaging";
import { HumanWorkService } from "../src/services/human-work-service";
import { humanWorkScenario } from "./human-work-fixtures";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("human work service (004.4 wave 1)", () => {
  const prisma = createPrismaClient(url!);
  const service = new HumanWorkService(prisma);
  const bots: string[] = [];
  const scenario = async () => {
    const result = await humanWorkScenario(prisma, service);
    bots.push(result.bot.id);
    return result;
  };
  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.$disconnect();
  });
  const mutation = () => ({ clientRequestId: crypto.randomUUID(), expectedContractRevision: 1 });
  const pause = () => ({ ...mutation(), currentStepId: "step-1", draftSummary: "DHCP checked", readReferenceIds: [], reason: "Awaiting site access" });
  const code = async (operation: () => unknown) => {
    try { await operation(); throw new Error("Expected a service error"); }
    catch (error) { expect(error).toBeInstanceOf(ApiError); return (error as ApiError).code; }
  };

  test("internal creation uses shared WorkItem, snapshots criteria/steps, emits events and creates no Run or receipt", async () => {
    const { card, outcome, agent } = await scenario();
    const detail = await service.detail(card.workItemId);
    expect(detail.status).toBe("ready");
    expect(detail.kind).toBe("human_action");
    expect(detail.card?.steps[0]?.id).toBe("step-1");
    expect(detail.card?.evidenceRequirements[0]?.criterionId).toBeTruthy();
    expect(await prisma.run.count({ where: { outcomeWorkItemId: card.workItemId } })).toBe(0);
    expect(await prisma.outcomeHumanReceipt.count({ where: { workItemId: card.workItemId } })).toBe(0);
    expect((await prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("running");
    expect((await service.list(outcome.id)).map((item) => item.executorType)).toEqual(["agent", "human"]);
    expect(await service.list(outcome.id, { executorType: "human", status: "ready" })).toHaveLength(1);
    const topics = (await prisma.event.findMany({ where: { entityId: outcome.id }, orderBy: { sequence: "asc" } })).map((event) => event.topic);
    expect(topics).toContain("outcome.work_item.created");
    expect(topics).toContain("outcome.human_action.required");
    expect(topics).toContain("outcome.work_item.updated");
  });

  test("start, pause, reopen and resume preserve server state and first actor/time", async () => {
    const { card } = await scenario();
    const started = await service.start(card.workItemId, mutation(), "owner:local");
    expect(started.card?.startedBy).toBe("owner:local");
    expect(started.startedAt).toBe(started.card?.startedAt ?? null);
    expect(started.status).toBe("in_progress");
    const input = pause();
    const paused = await service.pause(card.workItemId, input, "owner:local");
    expect(paused.status).toBe("paused");
    expect((await new HumanWorkService(prisma).detail(card.workItemId)).card?.draft?.draftSummary).toBe(input.draftSummary);
    const resumed = await service.start(card.workItemId, mutation(), "system:test");
    expect(resumed.startedAt).toBe(started.startedAt);
    expect(resumed.card?.startedBy).toBe("owner:local");
    expect(resumed.card?.draft?.currentStepId).toBe("step-1");
  });

  test("duplicate/concurrent start and pause replay once, conflicting content fails", async () => {
    const { card } = await scenario();
    const input = mutation();
    const [first, second] = await Promise.all([
      service.start(card.workItemId, input, "owner:local"), service.start(card.workItemId, input, "owner:local"),
    ]);
    expect(second).toEqual(JSON.parse(JSON.stringify(first)));
    const draft = pause();
    const [a, b] = await Promise.all([
      service.pause(card.workItemId, draft, "owner:local"), service.pause(card.workItemId, draft, "owner:local"),
    ]);
    expect(b).toEqual(JSON.parse(JSON.stringify(a)));
    expect(await code(() => service.pause(card.workItemId, { ...draft, draftSummary: "Changed" }, "owner:local"))).toBe("receipt_idempotency_conflict");
    expect(await prisma.event.count({ where: { entityId: first.outcomeId, topic: "outcome.work_item.updated" } })).toBe(3);
  });

  test("invalid states, unknown steps, nonhuman actions and old revisions fail without mutations", async () => {
    const { card, outcome, revision, agent } = await scenario();
    expect(await code(() => service.pause(card.workItemId, pause(), "owner:local"))).toBe("human_work_item_not_active");
    expect(await code(() => service.start(agent.id, mutation(), "owner:local"))).toBe("human_work_item_not_active");
    await service.start(card.workItemId, mutation(), "owner:local");
    expect(await code(() => service.start(card.workItemId, mutation(), "owner:local"))).toBe("human_work_item_not_active");
    expect(await code(() => service.pause(card.workItemId, { ...pause(), currentStepId: "unknown" }, "owner:local"))).toBe("invalid_request");
    expect(await code(() => service.pause(card.workItemId, { ...pause(), readReferenceIds: ["foreign"] }, "owner:local"))).toBe("invalid_request");
    const next = await prisma.outcomeContractRevision.create({ data: {
      outcomeId: outcome.id, revision: 2, status: "draft", goal: [], boundaries: {}, executionBotId: agent.botId,
      createdBy: "owner:local", contentHash: "second", baseRevisionId: revision.id,
    } });
    await prisma.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: next.id } });
    expect(await code(() => service.pause(card.workItemId, pause(), "owner:local"))).toBe("review_revision_conflict");
    expect((await service.detail(card.workItemId)).status).toBe("in_progress");
  });

  test("different concurrent requests have one winner and a terminal item cannot restart", async () => {
    const { card } = await scenario();
    const results = await Promise.allSettled([service.start(card.workItemId, mutation(), "owner:local"), service.start(card.workItemId, mutation(), "owner:local")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await prisma.$transaction((tx) => transitionWorkItem(tx, { workItemId: card.workItemId, to: "cancelled", reason: "Test cancellation", actor: "owner:local" }));
    expect(await code(() => service.start(card.workItemId, mutation(), "owner:local"))).toBe("human_work_item_not_active");
  });

  for (const action of ["start", "pause"] as const) {
    test(`${action} replays its original response after revision changes while new old-revision requests fail`, async () => {
      const { card, outcome, revision, agent } = await scenario();
      const input = action === "start" ? mutation() : pause();
      if (action === "pause") await service.start(card.workItemId, mutation(), "owner:local");
      const invoke = (request: typeof input) => action === "start"
        ? service.start(card.workItemId, request, "owner:local")
        : service.pause(card.workItemId, request as ReturnType<typeof pause>, "owner:local");
      const original = await invoke(input);
      const next = await prisma.outcomeContractRevision.create({ data: {
        outcomeId: outcome.id, revision: 2, status: "draft", goal: [], boundaries: {}, executionBotId: agent.botId,
        createdBy: "owner:local", contentHash: "revision-after-lost-response", baseRevisionId: revision.id,
      } });
      await prisma.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: next.id } });
      await prisma.$transaction((tx) => transitionWorkItem(tx, {
        workItemId: card.workItemId, to: "cancelled", reason: "Superseded Contract", actor: "owner:local",
      }));
      const events = await prisma.event.count({ where: { entityId: outcome.id } });
      const replays = await Promise.all([invoke(input), invoke(input)]);
      for (const replay of replays) expect(replay).toEqual(JSON.parse(JSON.stringify(original)));
      expect(await code(() => invoke({ ...input, clientRequestId: crypto.randomUUID() }))).toBe("review_revision_conflict");
      expect(await code(() => invoke({ ...input, expectedContractRevision: 2 }))).toBe("receipt_idempotency_conflict");
      expect(await code(() => action === "start"
        ? service.start(card.workItemId, input, "system:other-actor")
        : service.pause(card.workItemId, input as ReturnType<typeof pause>, "system:other-actor")
      )).toBe("receipt_idempotency_conflict");
      expect(await prisma.event.count({ where: { entityId: outcome.id } })).toBe(events);
      expect((await service.detail(card.workItemId)).status).toBe("cancelled");
    });
  }

  test("creation validates revision, requester, references and criteria atomically", async () => {
    const { cardInput, outcome } = await scenario();
    const count = await prisma.outcomeWorkItem.count({ where: { outcomeId: outcome.id } });
    expect(await code(() => prisma.$transaction((tx) => service.createCard(tx, { ...cardInput, expectedContractRevision: 2 }, "owner:local")))).toBe("review_revision_conflict");
    expect(await code(() => prisma.$transaction((tx) => service.createCard(tx, {
      ...cardInput, card: { ...cardInput.card, referenceIds: ["missing"] },
    }, "owner:local")))).toBe("human_evidence_missing");
    expect(await code(() => prisma.$transaction((tx) => service.createCard(tx, {
      ...cardInput, card: { ...cardInput.card, evidenceRequirements: [{ criterionOrdinal: 99, kind: "text", label: "Unknown" }] },
    }, "owner:local")))).toBe("human_evidence_missing");
    expect(await prisma.outcomeWorkItem.count({ where: { outcomeId: outcome.id } })).toBe(count);
  });
});
