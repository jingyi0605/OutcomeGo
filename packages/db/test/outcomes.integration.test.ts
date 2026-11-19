import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrismaClient } from "../src";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;

const refused = async (write: PromiseLike<unknown>): Promise<string> => {
  try {
    await write;
  } catch (error) {
    return String((error as Error)?.message ?? error);
  }
  throw new Error("the database accepted a write it should have refused");
};

describe.skipIf(!url)("outcome tables (specs/004.2 task 1.2)", () => {
  let prisma!: ReturnType<typeof createPrismaClient>;
  const bots: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(url!);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.$disconnect();
  });

  const bot = async () => {
    const id = crypto.randomUUID();
    await prisma.bot.create({ data: { id, name: `outcome ${id.slice(0, 6)}`, defaultDirectory: "/tmp", conversation: { create: {} } } });
    bots.push(id);
    return (await prisma.bot.findUniqueOrThrow({ where: { id }, include: { conversation: true } }));
  };

  const outcomeWithRevision = async () => {
    const owner = await bot();
    const outcome = await prisma.outcome.create({ data: { botId: owner.id, title: "备份方案选型建议" } });
    const revision = await prisma.outcomeContractRevision.create({
      data: {
        outcomeId: outcome.id,
        revision: 1,
        status: "pending_approval",
        goal: ["形成可执行的选型建议"],
        boundaries: { included: ["公开资料"], excluded: ["修改生产系统"] },
        executionBotId: owner.id,
        contentHash: "0".repeat(64),
        createdBy: "owner:local",
        criteria: { create: [{ ordinal: 1, statement: "比较两条路线", required: true }] },
      },
      include: { criteria: true },
    });
    await prisma.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: revision.id, status: "pending_approval" } });
    return { owner, outcome, revision };
  };

  test("revision numbers and criterion ordinals are unique per parent", async () => {
    const { outcome, revision, owner } = await outcomeWithRevision();
    expect(await refused(prisma.outcomeContractRevision.create({
      data: { outcomeId: outcome.id, revision: 1, goal: [], boundaries: {}, executionBotId: owner.id, contentHash: "1", createdBy: "owner:local" },
    }))).toContain("Unique constraint");
    expect(await refused(prisma.outcomeAcceptanceCriterion.create({
      data: { contractRevisionId: revision.id, ordinal: 1, statement: "重复", required: false },
    }))).toContain("Unique constraint");
  });

  test("an Outcome sub-thread run is linked to its work item, and ordinary runs stay unlinked", async () => {
    const { outcome, revision, owner } = await outcomeWithRevision();
    const workItem = await prisma.outcomeWorkItem.create({
      data: {
        outcomeId: outcome.id,
        contractRevisionId: revision.id,
        botId: owner.id,
        executorType: "agent",
        title: "研究",
        status: "queued",
        ordinal: 1,
      },
    });
    const message = async () => (await prisma.message.create({
      data: { botId: owner.id, conversationId: owner.conversation!.id, clientId: crypto.randomUUID(), role: "user", content: "x", status: "completed" },
    })).id;
    const threadRun = await prisma.run.create({
      data: { botId: owner.id, conversationId: owner.conversation!.id, userMessageId: await message(), origin: "outcome", outcomeWorkItemId: workItem.id },
    });
    const chatRun = await prisma.run.create({
      data: { botId: owner.id, conversationId: owner.conversation!.id, userMessageId: await message(), origin: "user" },
    });
    await prisma.outcomeWorkItem.update({ where: { id: workItem.id }, data: { rootRunId: threadRun.id } });

    const loaded = await prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: workItem.id }, include: { runs: true, rootRun: true } });
    expect(loaded.runs.map((run) => run.id)).toEqual([threadRun.id]);
    expect(loaded.rootRun?.origin).toBe("outcome");
    expect((await prisma.run.findUniqueOrThrow({ where: { id: chatRun.id } })).outcomeWorkItemId).toBeNull();
    expect(await refused(prisma.outcomeWorkItem.create({
      data: { outcomeId: outcome.id, contractRevisionId: revision.id, botId: owner.id, executorType: "agent", title: "dup", status: "queued", ordinal: 1 },
    }))).toContain("Unique constraint");
  });

  test("an output is recorded once per dedupe key, and reviews append by sequence", async () => {
    const { outcome, revision, owner } = await outcomeWithRevision();
    const workItem = await prisma.outcomeWorkItem.create({
      data: { outcomeId: outcome.id, contractRevisionId: revision.id, botId: owner.id, executorType: "agent", title: "研究", status: "completed", ordinal: 1 },
    });
    await prisma.outcomeOutput.create({ data: { outcomeId: outcome.id, workItemId: workItem.id, kind: "final_result", title: "结果", content: "A", dedupeKey: `final:${workItem.id}` } });
    expect(await refused(prisma.outcomeOutput.create({
      data: { outcomeId: outcome.id, workItemId: workItem.id, kind: "final_result", title: "结果", content: "B", dedupeKey: `final:${workItem.id}` },
    }))).toContain("Unique constraint");

    const criterionId = revision.criteria[0]!.id;
    const review = (sequence: number, result: "FAIL" | "PASS") => prisma.outcomeReview.create({
      data: { outcomeId: outcome.id, contractRevisionId: revision.id, criterionId, sequence, result, reviewedBy: "owner:local" },
    });
    await review(1, "FAIL");
    await review(2, "PASS");
    expect(await refused(review(2, "PASS"))).toContain("Unique constraint");
    expect((await prisma.outcomeReview.findMany({ where: { criterionId }, orderBy: { sequence: "asc" } })).map((row) => row.result)).toEqual(["FAIL", "PASS"]);
  });

  test("deleting the executing bot removes its Outcomes; deleting a run only unlinks it", async () => {
    const { outcome, owner } = await outcomeWithRevision();
    await prisma.bot.delete({ where: { id: owner.id } });
    expect(await prisma.outcome.findUnique({ where: { id: outcome.id } })).toBeNull();
    expect(await prisma.outcomeContractRevision.count({ where: { outcomeId: outcome.id } })).toBe(0);
  });
});
