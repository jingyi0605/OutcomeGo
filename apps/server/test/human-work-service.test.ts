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

// Specs/004.10 task 2.7: dates on a human task. Booking a time never blocks or changes anything about the task.
describe.skipIf(!url)("human task dates (specs/004.10 task 2.7)", () => {
  const prisma = createPrismaClient(url!);
  const service = new HumanWorkService(prisma);
  const bots: string[] = [];
  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.$disconnect();
  });
  const card = (extra: Record<string, unknown> = {}) => ({
    title: "Perform another check", purpose: "Collect real observations", steps: ["Human checks it"],
    evidenceRequirements: [{ criterionOrdinal: 1, label: "Log", kind: "text" as const }], ...extra,
  });
  const create = async (extra: Record<string, unknown> = {}) => {
    const s = await humanWorkScenario(prisma, service);
    bots.push(s.bot.id);
    const result = await prisma.$transaction((tx) => service.createCard(tx, { ...s.cardInput, card: card(extra) as never }, "owner:local"));
    return { s, result, row: () => prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: result.workItemId } }) };
  };

  test("a card with a booked time and a deadline stores both on the task, and the task starts ready as usual", async () => {
    const t = await create({ scheduledAt: "2026-12-01T09:00:00+08:00", dueAt: "2026-12-05T09:00:00Z" });
    const row = await t.row();
    expect(row.scheduledAt!.toISOString()).toBe("2026-12-01T01:00:00.000Z");
    expect(row.dueAt!.toISOString()).toBe("2026-12-05T09:00:00.000Z");
    expect(row.status).toBe("ready");
    expect(row.executorType).toBe("human");
  });

  test("a card with no dates leaves both empty, exactly as before", async () => {
    const t = await create();
    const row = await t.row();
    expect(row.scheduledAt).toBeNull();
    expect(row.dueAt).toBeNull();
  });

  test("a future booked time does not hold the task back, and a past one does not change its state", async () => {
    for (const scheduledAt of ["2099-01-01T00:00:00Z", "2001-01-01T00:00:00Z"]) {
      const t = await create({ scheduledAt });
      expect((await t.row()).status).toBe("ready");
      const started = await service.start((await t.row()).id, { clientRequestId: crypto.randomUUID(), expectedContractRevision: 1 }, "owner:local");
      expect(started.status).toBe("in_progress");
    }
  });

  test("a malformed time, or a deadline before the booked time, refuses the whole request and creates nothing", async () => {
    const s = await humanWorkScenario(prisma, service);
    bots.push(s.bot.id);
    const before = await prisma.outcomeWorkItem.count({ where: { outcomeId: s.outcome.id } });
    const bad: Array<Record<string, unknown>> = [
      { scheduledAt: "soon" }, { dueAt: "2026-02-30T00:00:00Z" }, { scheduledAt: "2026-12-01" },
      { scheduledAt: "2026-12-05T00:00:00Z", dueAt: "2026-12-01T00:00:00Z" },
    ];
    for (const extra of bad) {
      const error = await prisma.$transaction((tx) => service.createCard(tx, { ...s.cardInput, card: card(extra) as never }, "owner:local")).then(() => null, (e) => e);
      expect([JSON.stringify(extra), (error as ApiError | null)?.status, (error as ApiError | null)?.code]).toEqual([JSON.stringify(extra), 400, "invalid_schedule"]);
    }
    expect(await prisma.outcomeWorkItem.count({ where: { outcomeId: s.outcome.id } })).toBe(before);
  });

  test("the card's own record is unchanged by the dates: they live on the task, not in a second place", async () => {
    const t = await create({ scheduledAt: "2026-12-01T09:00:00Z" });
    const stored = await prisma.outcomeHumanActionCard.findUniqueOrThrow({ where: { workItemId: (await t.row()).id } });
    expect(JSON.stringify(stored)).not.toContain("2026-12-01");
  });
});

// Specs/004.10 task 2.7: what the owner sees. Overdue is derived when read, and only a task with a deadline can be.
describe.skipIf(!url)("human task view dates and overdue (specs/004.10 task 2.7)", () => {
  const prisma = createPrismaClient(url!);
  const service = new HumanWorkService(prisma);
  const bots: string[] = [];
  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.$disconnect();
  });
  const make = async (extra: Record<string, unknown> = {}) => {
    const s = await humanWorkScenario(prisma, service);
    bots.push(s.bot.id);
    const card = { ...s.cardInput.card, title: "Dated task", ...extra };
    const result = await prisma.$transaction((tx) => service.createCard(tx, { ...s.cardInput, card: card as never }, "owner:local"));
    return { s, id: result.workItemId };
  };
  const view = async (t: { s: { outcome: { id: string } }; id: string }) => (await service.list(t.s.outcome.id)).find((entry) => entry.id === t.id)!;

  test("the list and the detail show the booked time and the deadline", async () => {
    const t = await make({ scheduledAt: "2026-12-01T09:00:00Z", dueAt: "2099-12-05T09:00:00Z" });
    expect(await view(t)).toMatchObject({ scheduledAt: "2026-12-01T09:00:00.000Z", dueAt: "2099-12-05T09:00:00.000Z", overdue: false });
    expect(await service.detail(t.id)).toMatchObject({ scheduledAt: "2026-12-01T09:00:00.000Z", dueAt: "2099-12-05T09:00:00.000Z" });
  });

  test("a task with no dates reports none, and is never overdue", async () => {
    const t = await make();
    expect(await view(t)).toMatchObject({ scheduledAt: null, dueAt: null, overdue: false });
  });

  test("a deadline that has passed marks the task overdue while it still needs doing", async () => {
    const t = await make({ dueAt: "2001-01-01T00:00:00Z" });
    for (const status of ["ready", "in_progress", "paused", "rejected"] as const) {
      await prisma.outcomeWorkItem.update({ where: { id: t.id }, data: { status } });
      expect([status, (await view(t)).overdue]).toEqual([status, true]);
    }
  });

  test("once a receipt is in, or the task is closed, it is no longer overdue", async () => {
    const t = await make({ dueAt: "2001-01-01T00:00:00Z" });
    for (const status of ["submitted", "review_pending", "accepted", "cancelled"] as const) {
      await prisma.outcomeWorkItem.update({ where: { id: t.id }, data: { status } });
      expect([status, (await view(t)).overdue]).toEqual([status, false]);
    }
  });

  test("a booked time alone never makes a task overdue, however long ago it was", async () => {
    const t = await make({ scheduledAt: "2001-01-01T00:00:00Z" });
    expect((await view(t)).overdue).toBe(false);
  });

  test("overdue is read off the date each time and is not stored", async () => {
    const t = await make({ dueAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await view(t)).overdue).toBe(false);
    await prisma.outcomeWorkItem.update({ where: { id: t.id }, data: { dueAt: new Date(Date.now() - 60_000) } });
    expect((await view(t)).overdue).toBe(true);
  });
});
