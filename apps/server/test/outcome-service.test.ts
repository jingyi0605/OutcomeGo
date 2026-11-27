import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApiError } from "@outcomego/contracts";
import { decodeOutcomeCursor, isOutcomeEventTopic, type OutcomeListPage } from "@outcomego/contracts/outcomes";
import { createPrismaClient } from "@outcomego/db";
import { Effect } from "effect";
import { OutcomeService } from "../src/services/outcome-service";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const owner = "owner:local" as const;

const request = () => `service:${crypto.randomUUID()}`;
const contract = {
  goal: ["形成可执行的选型建议"],
  acceptance: [
    { statement: "比较两条可行路线的成本、恢复时间和限制", required: true },
    { statement: "每个结论附来源", required: true },
  ],
  boundaries: { included: ["只使用公开资料"], excluded: ["修改生产系统"] },
  budget: null,
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

describe.skipIf(!url)("OutcomeService unified standard contract", () => {
  let prisma!: ReturnType<typeof createPrismaClient>;
  let service!: OutcomeService;
  const bots: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(url!);
    await prisma.$connect();
    service = new OutcomeService(prisma);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.outcome.deleteMany({ where: { ownerId: owner.slice("owner:".length) } });
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.$disconnect();
  });

  const bot = async () => {
    const row = await prisma.bot.create({
      data: {
        name: `Outcome service ${request().slice(-8)}`,
        status: "active",
        defaultDirectory: "/tmp",
        conversation: { create: {} },
      },
    });
    bots.push(row.id);
    return row.id;
  };

  const create = async () => {
    const botId = await bot();
    const outcome = await Effect.runPromise(service.createFromContract({
      title: "备份方案选型建议",
      ...contract,
      clientRequestId: request(),
    }, botId, owner));
    return { botId, outcome };
  };

  const approve = (outcomeId: string, revision: number, clientRequestId = request()) =>
    service.approve(outcomeId, revision, {
      expectedRevision: revision,
      confirmationText: "我确认以上目标、验收和边界",
      clientRequestId,
    }, owner);

  test("creates a standard Outcome with revision 1 and emits unified events", async () => {
    const { outcome } = await create();
    expect(outcome.kind).toBe("standard");
    expect(outcome.status).toBe("pending_approval");
    expect(outcome.currentRevision).toBe(1);
    expect(outcome.currentRevisionView?.goal).toEqual(contract.goal);
    expect(outcome.currentRevisionView?.boundaries).toEqual(contract.boundaries);
    expect(outcome.currentRevisionView?.criteria.map(({ ordinal, required }) => [ordinal, required])).toEqual([[1, true], [2, true]]);

    const topics = (await prisma.event.findMany({
      where: { entityId: outcome.id },
      orderBy: { sequence: "asc" },
    })).map(({ topic }) => topic);
    expect(topics).toContain("outcome.created");
    expect(topics).toContain("outcome.contract.revision_created");
    expect(topics.filter((topic) => topic.startsWith("outcome.")).every(isOutcomeEventTopic)).toBe(true);
  });

  test("replays an identical contract request and rejects a conflicting idempotency body", async () => {
    const botId = await bot();
    const input = { title: "备份方案选型建议", ...contract, clientRequestId: request() };
    const first = await Effect.runPromise(service.createFromContract(input, botId, owner));
    expect(await Effect.runPromise(service.createFromContract(input, botId, owner))).toEqual(first);
    expect(await codeOf(service.createFromContract({ ...input, title: "不同标题" }, botId, owner))).toBe("idempotency_conflict");
  });

  test("approval records proof and a successor revision requires the current base", async () => {
    const { outcome } = await create();
    const approved = await Effect.runPromise(approve(outcome.id, 1));
    expect(approved.status).toBe("approved");
    expect(approved.currentRevisionView?.approvedBy).toBe(owner);

    const revision = await prisma.outcomeContractRevision.findFirstOrThrow({
      where: { outcomeId: outcome.id, revision: 1 },
    });
    expect(revision.approvalProof).toMatchObject({
      contentHash: revision.contentHash,
      actorRef: owner,
    });
    expect(await codeOf(service.createRevision(outcome.id, {
      baseRevision: 2,
      contract: { ...contract, goal: ["扩大后的选型建议"] },
      clientRequestId: request(),
    }, owner))).toBe("contract_revision_conflict");

    const revised = await Effect.runPromise(service.createRevision(outcome.id, {
      baseRevision: 1,
      contract: { ...contract, goal: ["扩大后的选型建议"] },
      changeSummary: "扩大比较范围",
      clientRequestId: request(),
    }, owner));
    expect(revised.currentRevision).toBe(2);
    expect(revised.revisions.map(({ revision, status }) => [revision, status])).toEqual([
      [1, "approved"],
      [2, "pending_approval"],
    ]);

    const approvedRevision = await Effect.runPromise(approve(outcome.id, 2));
    expect(approvedRevision.revisions.map(({ revision, status }) => [revision, status])).toEqual([
      [1, "superseded"],
      [2, "approved"],
    ]);
    expect(approvedRevision.currentRevisionView?.changeSummary).toBe("扩大比较范围");
  });

  test("recomputes status from work items and preserves the approved resume status", async () => {
    const { botId, outcome } = await create();
    await Effect.runPromise(approve(outcome.id, 1));
    const revision = await prisma.outcomeContractRevision.findFirstOrThrow({
      where: { outcomeId: outcome.id, revision: 1 },
    });
    const item = await prisma.outcomeWorkItem.create({
      data: {
        outcomeId: outcome.id,
        contractRevisionId: revision.id,
        botId,
        executorType: "agent",
        title: "研究",
        status: "running",
        ordinal: 1,
      },
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

  test("cancels unfinished work and rejects later approval", async () => {
    const { botId, outcome } = await create();
    await Effect.runPromise(approve(outcome.id, 1));
    const revision = await prisma.outcomeContractRevision.findFirstOrThrow({
      where: { outcomeId: outcome.id, revision: 1 },
    });
    await prisma.outcomeWorkItem.create({
      data: {
        outcomeId: outcome.id,
        contractRevisionId: revision.id,
        botId,
        executorType: "agent",
        title: "研究",
        status: "queued",
        ordinal: 1,
      },
    });
    const cancelled = await Effect.runPromise(service.cancel(outcome.id, { clientRequestId: request() }, owner));
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.workItems.map(({ status }) => status)).toEqual(["cancelled"]);
    expect(await codeOf(approve(outcome.id, 1))).toBe("invalid_outcome_transition");
  });

  test("lists pending standard Outcomes by cursor without duplicates", async () => {
    for (let index = 0; index < 3; index++) await create();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: OutcomeListPage = await Effect.runPromise(service.list({
        kinds: ["standard"],
        statuses: ["pending_approval"],
        cursor: cursor ? decodeOutcomeCursor(cursor) : null,
        limit: 2,
      }, owner));
      seen.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  test("returns a not-found error for an unknown Outcome", async () => {
    expect(await codeOf(service.get(crypto.randomUUID(), owner))).toBe("outcome_not_found");
  });
});
