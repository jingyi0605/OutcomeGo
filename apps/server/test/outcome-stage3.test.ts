import { expect, test } from "bun:test";
import { Effect } from "effect";
import { OutcomePlanService } from "../src/services/outcome-plan-service";
import { OutcomeService } from "../src/services/outcome-service";

type Row = Record<string, any>;

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_B = "22222222-2222-4222-8222-222222222222";
const CRIT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTCOME_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REV_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeStage3Harness(initialPlan: Row | null, revisionStatus = "pending_approval") {
  const idempotency = new Map<string, Row>();
  const events: Row[] = [];
  const wakes: Row[] = [];
  const workItems: Row[] = [];
  let itemSeq = 0;

  const revision: Row = {
    id: REV_ID,
    outcomeId: OUTCOME_ID,
    revision: 1,
    status: revisionStatus,
    goal: ["Finish multi-bot report"],
    boundaries: { included: [], excluded: [] },
    budget: null,
    executionBotId: BOT_A,
    changeSummary: null,
    baseRevisionId: null,
    sourceDecisionId: null,
    createdBy: `bot:${BOT_A}`,
    approvedBy: revisionStatus === "approved" ? "owner:local" : null,
    approvedAt: revisionStatus === "approved" ? new Date() : null,
    conflicts: [],
    contentHash: "hash-1",
    plan: initialPlan,
    criteria: [{ id: CRIT_1, ordinal: 1, statement: "Final deliverable complete", required: true, verificationMethod: "human_review" }],
    createdAt: new Date(),
  };

  const outcome: Row = {
    id: OUTCOME_ID,
    sourceExploreId: null,
    title: "Multi-bot Outcome",
    status: revisionStatus === "approved" ? "running" : "pending_approval",
    botId: BOT_A,
    description: "Test",
    resumeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    acceptedAt: null,
    cancelledAt: null,
    trackingMode: "standard",
    autoClosedAt: null,
    closeSummary: null,
    currentRevisionId: REV_ID,
  };

  const tx: Row = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ active: true }],
    idempotencyRecord: {
      findUnique: async ({ where }: Row) => idempotency.get(`${where.scope_key.scope}:${where.scope_key.key}`) ?? null,
      findFirst: async ({ where }: Row) => {
        for (const row of idempotency.values()) {
          if (row.scope === where.scope && row.status === where.status) return row;
        }
        return null;
      },
      create: async ({ data }: Row) => void idempotency.set(`${data.scope}:${data.key}`, { ...data }),
      update: async ({ where, data }: Row) => {
        const key = `${where.scope_key.scope}:${where.scope_key.key}`;
        Object.assign(idempotency.get(key)!, data);
      },
      deleteMany: async ({ where }: Row) => {
        for (const [k, row] of idempotency.entries()) {
          if (row.scope === where.scope && (!where.status || row.status === where.status)) {
            idempotency.delete(k);
          }
        }
        return { count: 1 };
      },
    },
    featureSettings: { findUnique: async () => ({ outcomesEnabled: true }) },
    bot: {
      findUnique: async ({ where }: Row) =>
        where.id === BOT_A || where.id === BOT_B
          ? { id: where.id, status: "active", subagentIdentity: null, conversation: { id: `c-${where.id}` } }
          : null,
    },
    channel: { findFirst: async ({ where }: Row) => ({ id: `dm-${where.members.some.botId}` }) },
    outcome: {
      findUnique: async ({ where }: Row) => (where.id === OUTCOME_ID ? outcome : null),
      findUniqueOrThrow: async () => ({
        ...outcome,
        currentRevision: revision,
        revisions: [revision],
        workItems: workItems.map((w) => ({ ...w, contractRevision: revision, runs: w.rootRunId ? [{ id: w.rootRunId }] : [] })),
        outputs: [],
        evidence: [],
        reviews: [],
      }),
      update: async ({ data }: Row) => Object.assign(outcome, data),
    },
    outcomeContractRevision: {
      findUnique: async ({ where }: Row) => {
        if (where.id === REV_ID || where.outcomeId_revision?.revision === 1) return revision;
        return null;
      },
      update: async ({ data }: Row) => Object.assign(revision, data),
      updateMany: async () => ({ count: 0 }),
    },
    outcomeWorkItem: {
      findFirst: async ({ where }: Row) => {
        if (where.id) return workItems.find((w) => w.id === where.id) ?? null;
        if (where.outcomeId && !where.kind) {
          return [...workItems].sort((a, b) => b.ordinal - a.ordinal)[0] ?? null;
        }
        return workItems.find((w) => w.kind === where.kind && w.contractRevisionId === where.contractRevisionId) ?? null;
      },
      findUnique: async ({ where }: Row) => workItems.find((w) => w.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: Row) => {
        const w = workItems.find((item) => item.id === where.id)!;
        return { ...w, outcome, contractRevision: revision };
      },
      findMany: async ({ where }: Row) => {
        return workItems.filter((w) => {
          if (where?.contractRevisionId && w.contractRevisionId !== where.contractRevisionId) return false;
          if (where?.planKey?.not === null && !w.planKey) return false;
          if (where?.executorType && w.executorType !== where.executorType) return false;
          if (where?.startedAt === null && w.startedAt !== null) return false;
          return true;
        });
      },
      count: async ({ where }: Row) => {
        if (where?.id?.in && where?.status?.in) {
          const ids = where.id.in as string[];
          return workItems.filter((w) => ids.includes(w.id) && where.status.in.includes(w.status)).length;
        }
        return 0;
      },
      create: async ({ data }: Row) => {
        itemSeq += 1;
        const row: Row = {
          id: `00000000-0000-4000-8000-${String(itemSeq).padStart(12, "0")}`,
          statusReason: null,
          progress: null,
          dependsOn: [],
          rootRunId: null,
          startedAt: null,
          completedAt: null,
          reworkOfWorkItemId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        workItems.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => {
        const w = workItems.find((item) => item.id === where.id)!;
        return Object.assign(w, data);
      },
    },
    outcomeDecision: { count: async () => 0 },
    outcomeThreadTurn: { count: async () => 0 },
    event: { create: async ({ data }: Row) => void events.push(data) },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: Row) => unknown) => fn(tx) };
  const messaging = {
    enqueueWake: async (_t: Row, input: Row) => {
      const id = `run-${wakes.length + 1}`;
      wakes.push(input);
      return { run: { id } };
    },
  };
  const outcomes = new OutcomeService(prisma as never, messaging as never);
  const plans = new OutcomePlanService(prisma as never, outcomes as never, messaging as never);
  return { outcomes, plans, workItems, wakes, idempotency, revision, outcome, events };
}

test("approve materializes plan in topological order, wakes only root tasks, and replays idempotently", async () => {
  const plan = {
    notes: "Research then draft",
    tasks: [
      {
        key: "draft",
        title: "Write report",
        instructions: "Draft final document",
        botId: BOT_B,
        dependsOn: ["research"],
        covers: [CRIT_1],
        nature: "deliverable",
      },
      {
        key: "research",
        title: "Gather info",
        instructions: "Collect data",
        botId: BOT_A,
        covers: [CRIT_1],
        nature: "action",
      },
    ],
  };
  const f = makeStage3Harness(plan, "pending_approval");
  await Effect.runPromise(
    f.outcomes.approve(OUTCOME_ID, 1, { expectedRevision: 1, confirmationText: "Approve", clientRequestId: "approve-key-1" }, "owner:local")
  );
  // 2 work items created, ordered topological: research first, draft second
  expect(f.workItems.map((w) => w.planKey)).toEqual(["research", "draft"]);
  expect(f.workItems[0]!.botId).toBe(BOT_A);
  expect(f.workItems[1]!.botId).toBe(BOT_B);
  expect(f.workItems[1]!.dependsOn).toEqual([f.workItems[0]!.id]);
  // Only root task (research) was woken immediately; draft has processing record waiting on dependency
  expect(f.wakes).toHaveLength(1);
  expect(f.wakes[0]!.botId).toBe(BOT_A);
  expect(f.idempotency.get(`outcome-turn:${f.workItems[1]!.id}:outcome-run:${OUTCOME_ID}:1:${f.workItems[1]!.id}`)?.status).toBe("processing");

  // Replaying approve creates nothing extra
  await Effect.runPromise(
    f.outcomes.approve(OUTCOME_ID, 1, { expectedRevision: 1, confirmationText: "Approve", clientRequestId: "approve-key-1" }, "owner:local")
  );
  expect(f.workItems).toHaveLength(2);
  expect(f.wakes).toHaveLength(1);
});

test("post-approval SavePlan locks started/finished tasks and cleanly edits/removes/adds unstarted tasks", async () => {
  const plan = {
    tasks: [
      { key: "t1", title: "Step 1", instructions: "Run step 1", botId: BOT_A, covers: [CRIT_1], nature: "action" },
      { key: "t2", title: "Step 2", instructions: "Run step 2", botId: BOT_B, dependsOn: ["t1"], covers: [CRIT_1], nature: "deliverable" },
      { key: "t3", title: "Step 3", instructions: "Drop me", botId: BOT_B, dependsOn: ["t1"], covers: [CRIT_1], nature: "action" },
    ],
  };
  const f = makeStage3Harness(plan, "pending_approval");
  await Effect.runPromise(
    f.outcomes.approve(OUTCOME_ID, 1, { expectedRevision: 1, confirmationText: "Approve", clientRequestId: "approve-key-2" }, "owner:local")
  );
  // Mark t1 as failed; leave t2 and t3 queued with rootRunId === null (blocked on t1)
  f.workItems[0]!.status = "failed";

  // Attempting to alter failed/locked t1 rejects with plan_task_locked
  await expect(
    f.plans.savePlan(
      OUTCOME_ID,
      {
        expectedRevision: 1,
        tasks: [
          { key: "t1", title: "Step 1", instructions: "Mutated instructions", botId: BOT_A, covers: [CRIT_1], nature: "action" },
          { key: "t2", title: "Step 2", instructions: "Run step 2", botId: BOT_B, dependsOn: ["t1"], covers: [CRIT_1], nature: "deliverable" },
        ],
        clientRequestId: "replan-lock-fail",
      },
      `bot:${BOT_A}`
    )
  ).rejects.toMatchObject({ code: "plan_task_locked", details: { key: "t1" } });

  // Keeping t1 intact, updating t2 to drop dependency on failed t1, dropping t3, adding replacement t4
  await f.plans.savePlan(
    OUTCOME_ID,
    {
      expectedRevision: 1,
      tasks: [
        { key: "t1", title: "Step 1", instructions: "Run step 1", botId: BOT_A, covers: [CRIT_1], nature: "action" },
        { key: "t2", title: "Step 2 updated", instructions: "Run step 2 solo", botId: BOT_B, covers: [CRIT_1], nature: "deliverable" },
        { key: "t4", title: "Recovery step", instructions: "Substitute for step 1", botId: BOT_A, covers: [CRIT_1], nature: "action" },
      ],
      clientRequestId: "replan-valid-1",
    },
    `bot:${BOT_A}`
  );

  // t3 was cancelled, t2 updated & re-enqueued (woken because dep removed), t4 created & woken
  expect(f.workItems[2]!.status).toBe("cancelled");
  expect(f.workItems[1]!.title).toBe("Step 2 updated");
  expect(f.workItems[1]!.dependsOn).toEqual([]);
  expect(f.workItems.map((w) => w.planKey)).toEqual(["t1", "t2", "t3", "t4"]);
  // Wakes: initial t1 + re-enqueued t2 + new t4 = 3
  expect(f.wakes).toHaveLength(3);
  expect(f.wakes[1]!.content).toBe("Run step 2 solo");
  expect(f.wakes[2]!.content).toBe("Substitute for step 1");
});
