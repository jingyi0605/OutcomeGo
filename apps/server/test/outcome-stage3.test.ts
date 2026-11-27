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
    title: "Multi-bot Outcome",
    status: revisionStatus === "approved" ? "running" : "pending_approval",
    botId: BOT_A,
    description: "Test",
    resumeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    acceptedAt: null,
    cancelledAt: null,
    kind: "standard",
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

// Specs/004.10 task 2.2: schedule fields reach the work item rows and obey the post-approval rules.
const approveHarness = async (plan: Row, id: string) => {
  const f = makeStage3Harness(plan, "pending_approval");
  await Effect.runPromise(
    f.outcomes.approve(OUTCOME_ID, 1, { expectedRevision: 1, confirmationText: "Approve", clientRequestId: id }, "owner:local")
  );
  return f;
};
const step = (key: string, extra: Row = {}) => ({
  key, title: `Step ${key}`, instructions: `Run ${key}`, botId: BOT_A, covers: [CRIT_1], nature: "deliverable", ...extra,
});

test("approval copies start, due and estimate from the plan task onto the work item", async () => {
  const f = await approveHarness(
    { tasks: [step("t1", { startAt: "2026-12-01T09:00:00+08:00", dueAt: "2026-12-05T09:00:00Z", estimateMinutes: 90 })] },
    "approve-sched-1"
  );
  const row = f.workItems[0]!;
  expect(row.scheduledAt).toEqual(new Date("2026-12-01T01:00:00.000Z"));
  expect(row.dueAt).toEqual(new Date("2026-12-05T09:00:00.000Z"));
  expect(row.estimateMinutes).toBe(90);
});

test("approval of a plan without schedule fields leaves the schedule columns empty", async () => {
  const f = await approveHarness({ tasks: [step("t1")] }, "approve-sched-none");
  const row = f.workItems[0]!;
  expect(row.scheduledAt ?? null).toBeNull();
  expect(row.dueAt ?? null).toBeNull();
  expect(row.estimateMinutes ?? null).toBeNull();
});

test("a task added after approval also gets its schedule", async () => {
  const f = await approveHarness({ tasks: [step("t1")] }, "approve-sched-2");
  await f.plans.savePlan(OUTCOME_ID, {
    expectedRevision: 1,
    tasks: [step("t1"), step("t2", { dependsOn: ["t1"], startAt: "2026-12-10T00:00:00Z", estimateMinutes: 30 })] as never,
    clientRequestId: "add-sched",
  }, `bot:${BOT_A}`);
  const added = f.workItems.find((item) => item.planKey === "t2")!;
  expect(added.scheduledAt).toEqual(new Date("2026-12-10T00:00:00.000Z"));
  expect(added.estimateMinutes).toBe(30);
});

test("changing the schedule of an unstarted task updates its row and re-queues it with a fresh record", async () => {
  const f = await approveHarness(
    { tasks: [step("t1"), step("t2", { dependsOn: ["t1"], startAt: "2026-12-10T00:00:00Z" })] },
    "approve-sched-3"
  );
  const second = f.workItems.find((item) => item.planKey === "t2")!;
  const oldKeys = [...f.idempotency.keys()].filter((key) => key.startsWith(`outcome-turn:${second.id}:`));
  expect(oldKeys.length).toBe(1);

  await f.plans.savePlan(OUTCOME_ID, {
    expectedRevision: 1,
    tasks: [step("t1"), step("t2", { dependsOn: ["t1"], startAt: "2026-12-20T00:00:00Z", dueAt: "2026-12-25T00:00:00Z", estimateMinutes: 45 })] as never,
    clientRequestId: "reschedule",
  }, `bot:${BOT_A}`);

  expect(second.scheduledAt).toEqual(new Date("2026-12-20T00:00:00.000Z"));
  expect(second.dueAt).toEqual(new Date("2026-12-25T00:00:00.000Z"));
  expect(second.estimateMinutes).toBe(45);
  const keys = [...f.idempotency.keys()].filter((key) => key.startsWith(`outcome-turn:${second.id}:`));
  expect(keys.length).toBe(1);
  expect(keys[0]).not.toBe(oldKeys[0]);
  expect(keys[0]).toContain("reschedule");
});

test("clearing a schedule field on an unstarted task empties the column", async () => {
  const f = await approveHarness(
    { tasks: [step("t1"), step("t2", { dependsOn: ["t1"], startAt: "2026-12-10T00:00:00Z", dueAt: "2026-12-12T00:00:00Z", estimateMinutes: 20 })] },
    "approve-sched-4"
  );
  const second = f.workItems.find((item) => item.planKey === "t2")!;
  await f.plans.savePlan(OUTCOME_ID, { expectedRevision: 1, tasks: [step("t1"), step("t2", { dependsOn: ["t1"] })] as never, clientRequestId: "clear" }, `bot:${BOT_A}`);
  expect(second.scheduledAt).toBeNull();
  expect(second.dueAt).toBeNull();
  expect(second.estimateMinutes).toBeNull();
});

test("a started task refuses a schedule change as a whole, and nothing is modified", async () => {
  const f = await approveHarness(
    { tasks: [step("t1", { startAt: "2026-12-01T00:00:00Z" }), step("t2", { dependsOn: ["t1"] })] },
    "approve-sched-5"
  );
  const first = f.workItems.find((item) => item.planKey === "t1")!;
  first.status = "running";
  first.rootRunId = "run-started";
  const before = JSON.stringify(f.workItems);
  await expect(
    f.plans.savePlan(OUTCOME_ID, {
      expectedRevision: 1,
      // t2 is unstarted and also changes; the locked task's change must still reject the whole request.
      tasks: [step("t1", { startAt: "2026-12-09T00:00:00Z" }), step("t2", { dependsOn: ["t1"], startAt: "2026-12-30T00:00:00Z" })] as never,
      clientRequestId: "locked-sched",
    }, `bot:${BOT_A}`)
  ).rejects.toMatchObject({ code: "plan_task_locked", details: { key: "t1" } });
  expect(JSON.stringify(f.workItems)).toBe(before);
});

test("a started task may be sent back with its original schedule unchanged", async () => {
  const f = await approveHarness({ tasks: [step("t1", { startAt: "2026-12-01T00:00:00+08:00" }), step("t2", { dependsOn: ["t1"] })] }, "approve-sched-6");
  const first = f.workItems.find((item) => item.planKey === "t1")!;
  first.status = "running";
  first.rootRunId = "run-started";
  // The same instant written in UTC, plus a real change to the unstarted task.
  await f.plans.savePlan(OUTCOME_ID, {
    expectedRevision: 1,
    tasks: [step("t1", { startAt: "2026-11-30T16:00:00Z" }), step("t2", { dependsOn: ["t1"], estimateMinutes: 15 })] as never,
    clientRequestId: "echo-sched",
  }, `bot:${BOT_A}`);
  expect(f.workItems.find((item) => item.planKey === "t2")!.estimateMinutes).toBe(15);
});

// Specs/004.10 task 2.6 / design §10.2 item 14: the owner moving a task changes the task, not the saved plan. The
// planner still holds the plan it last saw, so sending that plan back must not be taken as a change, and must not
// undo the owner's move.
test("after the owner moved a task, the planner sending its last-seen plan back is accepted and the owner's date stays", async () => {
  const f = await approveHarness(
    { tasks: [step("t1", { startAt: "2026-12-01T00:00:00Z" }), step("t2", { dependsOn: ["t1"], startAt: "2026-12-10T00:00:00Z" })] },
    "approve-owner-move-1"
  );
  const first = f.workItems.find((item) => item.planKey === "t1")!;
  const second = f.workItems.find((item) => item.planKey === "t2")!;
  first.status = "running";
  first.rootRunId = "run-started";
  // The owner moves both tasks: the rows change, the saved plan does not.
  first.scheduledAt = new Date("2026-12-03T00:00:00Z");
  second.scheduledAt = new Date("2026-12-20T00:00:00Z");
  const movedFirst = first.scheduledAt;
  const movedSecond = second.scheduledAt;

  // The planner sends back exactly the plan it saw, with one unrelated change (a new estimate on t2).
  await f.plans.savePlan(OUTCOME_ID, {
    expectedRevision: 1,
    tasks: [step("t1", { startAt: "2026-12-01T00:00:00Z" }), step("t2", { dependsOn: ["t1"], startAt: "2026-12-10T00:00:00Z", estimateMinutes: 25 })] as never,
    clientRequestId: "echo-after-owner-move",
  }, `bot:${BOT_A}`);

  expect(first.scheduledAt).toEqual(movedFirst);
  expect(second.scheduledAt).toEqual(movedSecond);
  expect(second.estimateMinutes).toBe(25);
});

test("a planner that really changes a task's date still wins over the owner's older move", async () => {
  const f = await approveHarness(
    { tasks: [step("t1"), step("t2", { dependsOn: ["t1"], startAt: "2026-12-10T00:00:00Z" })] },
    "approve-owner-move-2"
  );
  const second = f.workItems.find((item) => item.planKey === "t2")!;
  second.scheduledAt = new Date("2026-12-20T00:00:00Z"); // the owner's move
  await f.plans.savePlan(OUTCOME_ID, {
    expectedRevision: 1,
    tasks: [step("t1"), step("t2", { dependsOn: ["t1"], startAt: "2026-12-12T00:00:00Z" })] as never, // a different date from the saved plan
    clientRequestId: "planner-changes-date",
  }, `bot:${BOT_A}`);
  expect(second.scheduledAt).toEqual(new Date("2026-12-12T00:00:00.000Z"));
});

test("a started task whose planner-visible schedule changed is still refused", async () => {
  const f = await approveHarness({ tasks: [step("t1", { startAt: "2026-12-01T00:00:00Z" }), step("t2", { dependsOn: ["t1"] })] }, "approve-owner-move-3");
  const first = f.workItems.find((item) => item.planKey === "t1")!;
  first.status = "running";
  first.rootRunId = "run-started";
  first.scheduledAt = new Date("2026-12-03T00:00:00Z"); // owner's move; the plan still says 12-01
  await expect(
    f.plans.savePlan(OUTCOME_ID, {
      expectedRevision: 1,
      tasks: [step("t1", { startAt: "2026-12-09T00:00:00Z" }), step("t2", { dependsOn: ["t1"] })] as never, // differs from the plan the planner saw
      clientRequestId: "locked-differs-from-plan",
    }, `bot:${BOT_A}`)
  ).rejects.toMatchObject({ code: "plan_task_locked", details: { key: "t1" } });
  expect(first.scheduledAt).toEqual(new Date("2026-12-03T00:00:00.000Z"));
});
