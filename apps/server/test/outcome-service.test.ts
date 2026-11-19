import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApiError } from "@outcomego/contracts";
import { decodeOutcomeCursor, isOutcomeEventTopic, type OutcomeListPage } from "@outcomego/contracts/outcomes";
import { createPrismaClient } from "@outcomego/db";
import { Effect } from "effect";
import { OutcomeService } from "../src/services/outcome-service";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;

const snapshot = {
  goal: { options: [{ id: "goal-1", text: "形成可执行的选型建议", recommended: true, reason: "直接对应决策目标" }], selectedOptionIds: [], customEntries: [] },
  acceptance: {
    options: [
      { id: "acceptance-1", text: "比较两条可行路线的成本、恢复时间和限制", required: true },
      { id: "acceptance-2", text: "每个结论附来源", required: true },
    ],
    selectedOptionIds: [],
    customEntries: [],
  },
  boundaries: {
    options: [
      { id: "boundaries-1", text: "只使用公开资料", kind: "included" },
      { id: "boundaries-2", text: "修改生产系统", kind: "excluded" },
    ],
    selectedOptionIds: [],
    customEntries: [],
  },
};

const selections = {
  goal: { selectedOptionIds: ["goal-1"], customEntries: [] },
  acceptance: { selectedOptionIds: ["acceptance-1", "acceptance-2"], customEntries: [] },
  boundaries: { selectedOptionIds: ["boundaries-1", "boundaries-2"], customEntries: [] },
};

const failure = async (effect: Effect.Effect<unknown, Error>) => {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Right") throw new Error("expected the operation to fail");
  return result.left;
};
const codeOf = async (effect: Effect.Effect<unknown, Error>) => {
  const error = await failure(effect);
  expect(error).toBeInstanceOf(ApiError);
  return (error as ApiError).code;
};

describe.skipIf(!url)("OutcomeService (specs/004.2 task 1.3)", () => {
  let prisma!: ReturnType<typeof createPrismaClient>;
  let service!: OutcomeService;
  const bots: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(url!);
    await prisma.$connect();
    service = new OutcomeService(prisma);
  });
  afterAll(async () => {
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.$disconnect();
  });

  const draft = async (expiresInMs = 60_000) => {
    const botId = crypto.randomUUID();
    await prisma.bot.create({ data: { id: botId, name: `outcome ${botId.slice(0, 6)}`, defaultDirectory: "/tmp", conversation: { create: {} } } });
    bots.push(botId);
    return prisma.outcomePlanningDraft.create({
      data: { botId, sourceText: "比较两个备份方案并给出选型建议", snapshot, expiresAt: new Date(Date.now() + expiresInMs) },
    });
  };
  const request = () => `req:${crypto.randomUUID()}`;
  const create = async (overrides: Partial<typeof selections> = {}) => {
    const plan = await draft();
    const input = { planId: plan.id, ...selections, ...overrides, title: "备份方案选型建议", clientRequestId: request() };
    return { plan, input, outcome: await Effect.runPromise(service.createFromDraft(input, "owner:local")) };
  };
  const approve = (outcomeId: string, revision: number, clientRequestId = request()) =>
    service.approve(outcomeId, revision, { expectedRevision: revision, confirmationText: "我确认以上目标、验收和边界", clientRequestId }, "owner:local");

  test("creating from a draft writes revision 1 with resolved text, consumes the draft and emits outcome.* events", async () => {
    const { plan, outcome } = await create();
    expect(outcome.status).toBe("pending_approval");
    expect(outcome.currentRevision).toBe(1);
    expect(outcome.currentRevisionView?.goal).toEqual(["形成可执行的选型建议"]);
    expect(outcome.currentRevisionView?.boundaries).toEqual({ included: ["只使用公开资料"], excluded: ["修改生产系统"] });
    expect(outcome.currentRevisionView?.criteria.map((criterion) => [criterion.ordinal, criterion.required])).toEqual([[1, true], [2, true]]);
    expect((await prisma.outcomePlanningDraft.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("consumed");
    const topics = (await prisma.event.findMany({ where: { entityId: outcome.id }, orderBy: { sequence: "asc" } })).map((event) => event.topic);
    expect(topics).toEqual(["outcome.created", "outcome.contract.revision_created", "outcome.status_changed", "goal.status.changed"]);
    expect(topics.slice(0, -1).every(isOutcomeEventTopic)).toBe(true);
  });

  test("a retried request returns the first result; the same ID with another body is refused", async () => {
    const { input, outcome } = await create();
    const again = await Effect.runPromise(service.createFromDraft(input, "owner:local"));
    expect(again.id).toBe(outcome.id);
    expect(await codeOf(service.createFromDraft({ ...input, title: "另一个标题" }, "owner:local"))).toBe("idempotency_conflict");
  });

  test("an expired or consumed draft and an unknown option are refused without writing an Outcome", async () => {
    const expired = await draft(-1);
    const before = await prisma.outcome.count();
    expect(await codeOf(service.createFromDraft({ planId: expired.id, ...selections, title: "t", clientRequestId: request() }, "owner:local"))).toBe("planning_draft_expired");
    const fresh = await draft();
    expect(await codeOf(service.createFromDraft({
      planId: fresh.id, ...selections, goal: { selectedOptionIds: ["goal-9"], customEntries: [] }, title: "t", clientRequestId: request(),
    }, "owner:local"))).toBe("planning_option_not_found");
    expect(await prisma.outcome.count()).toBe(before);
    expect((await prisma.outcomePlanningDraft.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("ready");
  });

  test("a blocking conflict keeps revision 1 in draft and it cannot be approved", async () => {
    const { outcome } = await create({ acceptance: { selectedOptionIds: [], customEntries: [] } });
    expect(outcome.status).toBe("draft");
    expect(outcome.currentRevisionView?.status).toBe("draft");
    expect(outcome.currentRevisionView?.conflicts.map((conflict) => conflict.code)).toContain("missing_acceptance");
    expect(await codeOf(approve(outcome.id, 1))).toBe("planning_conflict");
  });

  test("approval records the server-side actor and content hash; a repeat with the same ID replays", async () => {
    const { outcome } = await create();
    const key = request();
    const approved = await Effect.runPromise(approve(outcome.id, 1, key));
    expect(approved.status).toBe("approved");
    expect(approved.currentRevisionView?.approvedBy).toBe("owner:local");
    const revision = await prisma.outcomeContractRevision.findFirstOrThrow({ where: { outcomeId: outcome.id, revision: 1 } });
    expect(revision.approvalProof).toMatchObject({ contentHash: revision.contentHash, actorRef: "owner:local" });
    expect((await Effect.runPromise(approve(outcome.id, 1, key))).currentRevisionView?.approvedAt).toBe(approved.currentRevisionView?.approvedAt ?? null);
    expect(await codeOf(approve(outcome.id, 1))).toBe("invalid_outcome_transition");
  });

  test("two concurrent approvals produce exactly one approval", async () => {
    const { outcome } = await create();
    const results = await Promise.all([approve(outcome.id, 1), approve(outcome.id, 1)].map((effect) => Effect.runPromise(Effect.either(effect))));
    expect(results.filter((result) => result._tag === "Right")).toHaveLength(1);
    expect(await prisma.event.count({ where: { entityId: outcome.id, topic: "outcome.contract.revision_approved" } })).toBe(1);
  });

  test("a new revision needs the current base; revision N stays in force until N+1 is approved", async () => {
    const { outcome } = await create();
    await Effect.runPromise(approve(outcome.id, 1));
    const contract = {
      goal: ["形成可执行的选型建议"],
      acceptance: [{ statement: "比较三条路线", required: true }],
      boundaries: { included: ["只使用公开资料"], excluded: ["修改生产系统"] },
      budget: null,
    };
    expect(await codeOf(service.createRevision(outcome.id, { baseRevision: 2, contract, clientRequestId: request() }, "owner:local"))).toBe("contract_revision_conflict");
    const revised = await Effect.runPromise(service.createRevision(outcome.id, { baseRevision: 1, contract, changeSummary: "扩大比较范围", clientRequestId: request() }, "owner:local"));
    expect(revised.currentRevision).toBe(2);
    expect(revised.status).toBe("pending_approval");
    expect(revised.revisions.map((entry) => [entry.revision, entry.status])).toEqual([[1, "approved"], [2, "pending_approval"]]);
    const approved = await Effect.runPromise(approve(outcome.id, 2));
    expect(approved.revisions.map((entry) => [entry.revision, entry.status])).toEqual([[1, "superseded"], [2, "approved"]]);
    expect(approved.currentRevisionView?.changeSummary).toBe("扩大比较范围");
  });

  test("status follows work items: running, waiting for a decision (with resume status), then review", async () => {
    const { outcome } = await create();
    await Effect.runPromise(approve(outcome.id, 1));
    const revision = await prisma.outcomeContractRevision.findFirstOrThrow({ where: { outcomeId: outcome.id, revision: 1 } });
    const item = await prisma.outcomeWorkItem.create({
      data: { outcomeId: outcome.id, contractRevisionId: revision.id, botId: outcome.botId, executorType: "agent", title: "研究", status: "running", ordinal: 1 },
    });
    const recompute = () => prisma.$transaction((tx) => service.recomputeStatus(tx, outcome.id, "system:test"));
    expect(await recompute()).toBe("running");
    await prisma.outcomeWorkItem.update({ where: { id: item.id }, data: { status: "waiting_decision" } });
    expect(await recompute()).toBe("decision_pending");
    expect((await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } })).resumeStatus).toBe("approved");
    await prisma.outcomeWorkItem.update({ where: { id: item.id }, data: { status: "completed" } });
    expect(await recompute()).toBe("review_pending");
    expect((await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } })).resumeStatus).toBeNull();
  });

  test("cancelling stops unfinished work items and freezes the Outcome", async () => {
    const { outcome } = await create();
    await Effect.runPromise(approve(outcome.id, 1));
    const revision = await prisma.outcomeContractRevision.findFirstOrThrow({ where: { outcomeId: outcome.id, revision: 1 } });
    await prisma.outcomeWorkItem.create({
      data: { outcomeId: outcome.id, contractRevisionId: revision.id, botId: outcome.botId, executorType: "agent", title: "研究", status: "queued", ordinal: 1 },
    });
    const cancelled = await Effect.runPromise(service.cancel(outcome.id, { clientRequestId: request() }, "owner:local"));
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.workItems.map((item) => item.status)).toEqual(["cancelled"]);
    expect(await codeOf(approve(outcome.id, 1))).toBe("invalid_outcome_transition");
  });

  test("the list pages by updatedAt and id without repeating or skipping", async () => {
    for (let index = 0; index < 3; index++) await create();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: OutcomeListPage = await Effect.runPromise(service.list({ statuses: ["pending_approval"], cursor: cursor ? decodeOutcomeCursor(cursor) : null, limit: 2 }));
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  test("an unknown Outcome is a 404", async () => {
    expect(await codeOf(service.get(crypto.randomUUID()))).toBe("outcome_not_found");
  });
});
