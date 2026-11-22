import { expect, test } from "bun:test";
import { OutcomePlanService } from "../src/services/outcome-plan-service";
import { OutcomeThreadTools } from "../src/services/outcome-thread-tools";

type Row = Record<string, any>;

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_B = "22222222-2222-4222-8222-222222222222";
const BOT_DOWN = "33333333-3333-4333-8333-333333333333";
const CRIT_REQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CRIT_OPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUTCOME_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REV_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeFixture(options: { status?: string; revStatus?: string; revNumber?: number } = {}) {
  const idempotency = new Map<string, Row>();
  const events: Row[] = [];
  const revision: Row = {
    id: REV_ID,
    outcomeId: OUTCOME_ID,
    revision: options.revNumber ?? 1,
    status: options.revStatus ?? "pending_approval",
    contentHash: "hash-v1",
    plan: null as unknown,
    criteria: [
      { id: CRIT_REQ, ordinal: 1, statement: "Deliver dataset summary", required: true },
      { id: CRIT_OPT, ordinal: 2, statement: "Include appendix table", required: false },
    ],
  };
  const outcome: Row = {
    id: OUTCOME_ID,
    botId: BOT_A,
    status: options.status ?? "pending_approval",
    currentRevisionId: REV_ID,
  };
  const tx: Row = {
    $executeRaw: async () => 0,
    idempotencyRecord: {
      findUnique: async ({ where }: Row) => idempotency.get(`${where.scope_key.scope}:${where.scope_key.key}`) ?? null,
      create: async ({ data }: Row) => void idempotency.set(`${data.scope}:${data.key}`, data),
    },
    outcome: {
      findUnique: async ({ where }: Row) => (where.id === OUTCOME_ID ? outcome : null),
    },
    outcomeContractRevision: {
      findUnique: async ({ where }: Row) => (where.id === REV_ID ? revision : null),
      update: async ({ data }: Row) => Object.assign(revision, data),
    },
    bot: {
      findUnique: async ({ where }: Row) => {
        if (where.id === BOT_A || where.id === BOT_B) {
          return { id: where.id, status: "active", subagentIdentity: null, conversation: { id: `c-${where.id}` } };
        }
        if (where.id === BOT_DOWN) {
          return { id: where.id, status: "archived", subagentIdentity: null, conversation: { id: "c-down" } };
        }
        return null;
      },
    },
    channel: {
      findFirst: async () => ({ id: "dm-1" }),
    },
    event: {
      create: async ({ data }: Row) => void events.push(data),
    },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: Row) => unknown) => fn(tx) };
  const outcomes = {
    getInTransaction: async () => ({
      id: outcome.id,
      currentRevision: revision.revision,
      currentRevisionView: { revision: revision.revision, status: revision.status },
      plan: revision.plan,
    }),
  };
  const service = new OutcomePlanService(prisma as never, outcomes as never);
  return { service, revision, outcome, events, prisma };
}

test("SavePlan saves and replaces pre-approval plan without altering contentHash", async () => {
  const f = makeFixture();
  const detail = await f.service.savePlan(
    OUTCOME_ID,
    {
      expectedRevision: 1,
      notes: "Execute collection before synthesis.",
      tasks: [
        {
          key: "collect",
          title: "Gather source notes",
          instructions: "Collect references and summarize findings.",
          botId: BOT_A,
          covers: [CRIT_OPT],
          nature: "action",
        },
        {
          key: "synthesize",
          title: "Produce final report",
          instructions: "Draft report using collected notes.",
          botId: BOT_B,
          dependsOn: ["collect"],
          covers: [CRIT_REQ],
          nature: "deliverable",
        },
      ],
      clientRequestId: "save-plan-1",
    },
    `bot:${BOT_A}`
  );

  expect(f.revision.contentHash).toBe("hash-v1");
  expect((detail as Row).plan).toEqual({
    notes: "Execute collection before synthesis.",
    tasks: [
      {
        key: "collect",
        title: "Gather source notes",
        instructions: "Collect references and summarize findings.",
        botId: BOT_A,
        covers: [CRIT_OPT],
        nature: "action",
      },
      {
        key: "synthesize",
        title: "Produce final report",
        instructions: "Draft report using collected notes.",
        botId: BOT_B,
        dependsOn: ["collect"],
        covers: [CRIT_REQ],
        nature: "deliverable",
      },
    ],
  });
  expect(f.events.some((e) => e.topic === "outcome.plan.saved")).toBe(true);

  // Saving the exact same plan rejects with plan_unchanged.
  await expect(
    f.service.savePlan(
      OUTCOME_ID,
      {
        expectedRevision: 1,
        notes: "Execute collection before synthesis.",
        tasks: (f.revision.plan as Row).tasks,
        clientRequestId: "save-plan-2",
      },
      `bot:${BOT_A}`
    )
  ).rejects.toMatchObject({ code: "plan_unchanged" });

  // Saving an updated plan replaces it cleanly before approval.
  await f.service.savePlan(
    OUTCOME_ID,
    {
      expectedRevision: 1,
      tasks: [
        {
          key: "single",
          title: "Single deliverable",
          instructions: "Produce full deliverable directly.",
          botId: BOT_B,
          covers: [CRIT_REQ],
          nature: "deliverable",
        },
      ],
      clientRequestId: "save-plan-3",
    },
    `bot:${BOT_A}`
  );
  expect((f.revision.plan as Row).tasks).toHaveLength(1);
});

test("SavePlan rejects invalid structure, cycles, unrunnable bots, uncovered required criteria, and conflicts", async () => {
  const f = makeFixture();
  const baseTask = {
    key: "t1",
    title: "Task 1",
    instructions: "Do task 1",
    botId: BOT_A,
    covers: [CRIT_REQ],
    nature: "deliverable" as const,
  };

  // Duplicate keys
  await expect(
    f.service.savePlan(OUTCOME_ID, { expectedRevision: 1, tasks: [baseTask, baseTask], clientRequestId: "err-dup-1" }, `bot:${BOT_A}`)
  ).rejects.toMatchObject({ code: "invalid_request", details: { field: "key", key: "t1" } });

  // Missing dependency key
  await expect(
    f.service.savePlan(
      OUTCOME_ID,
      { expectedRevision: 1, tasks: [{ ...baseTask, dependsOn: ["missing-dep"] }], clientRequestId: "err-dep-1" },
      `bot:${BOT_A}`
    )
  ).rejects.toMatchObject({ code: "invalid_request", details: { field: "dependsOn", key: "t1", missingDependency: "missing-dep" } });

  // Dependency cycle
  await expect(
    f.service.savePlan(
      OUTCOME_ID,
      {
        expectedRevision: 1,
        tasks: [
          { ...baseTask, key: "a", dependsOn: ["b"] },
          { ...baseTask, key: "b", dependsOn: ["a"] },
        ],
        clientRequestId: "err-cycle-1",
      },
      `bot:${BOT_A}`
    )
  ).rejects.toMatchObject({ code: "plan_cycle" });

  // Unrunnable / archived bot returns key
  await expect(
    f.service.savePlan(
      OUTCOME_ID,
      { expectedRevision: 1, tasks: [{ ...baseTask, key: "bad-bot-task", botId: BOT_DOWN }], clientRequestId: "err-bot-1" },
      `bot:${BOT_A}`
    )
  ).rejects.toMatchObject({ code: "invalid_request", details: { field: "botId", key: "bad-bot-task" } });

  // Uncovered required criterion
  await expect(
    f.service.savePlan(
      OUTCOME_ID,
      { expectedRevision: 1, tasks: [{ ...baseTask, covers: [CRIT_OPT] }], clientRequestId: "err-cov-1" },
      `bot:${BOT_A}`
    )
  ).rejects.toMatchObject({ code: "plan_uncovered_criteria", details: { uncoveredCriterionIds: [CRIT_REQ] } });

  // Too many tasks (>20)
  const many = Array.from({ length: 21 }, (_, idx) => ({ ...baseTask, key: `k-${idx}` }));
  await expect(
    f.service.savePlan(OUTCOME_ID, { expectedRevision: 1, tasks: many, clientRequestId: "err-max-1" }, `bot:${BOT_A}`)
  ).rejects.toMatchObject({ code: "invalid_request", details: { field: "tasks", limit: 20 } });

  // Notes > 2000 chars
  await expect(
    f.service.savePlan(
      OUTCOME_ID,
      { expectedRevision: 1, notes: "x".repeat(2001), tasks: [baseTask], clientRequestId: "err-notes-1" },
      `bot:${BOT_A}`
    )
  ).rejects.toMatchObject({ code: "invalid_request", details: { field: "notes" } });

  // Revision conflict
  await expect(
    f.service.savePlan(OUTCOME_ID, { expectedRevision: 2, tasks: [baseTask], clientRequestId: "err-rev-1" }, `bot:${BOT_A}`)
  ).rejects.toMatchObject({ code: "plan_revision_conflict" });

  // Terminal outcome
  const closed = makeFixture({ status: "cancelled" });
  await expect(
    closed.service.savePlan(OUTCOME_ID, { expectedRevision: 1, tasks: [baseTask], clientRequestId: "err-term-1" }, `bot:${BOT_A}`)
  ).rejects.toMatchObject({ code: "outcome_terminal" });
});

test("OutcomeThreadTools rejects SavePlan missing nature with offending task key", async () => {
  const f = makeFixture();
  const threadPrisma = {
    featureSettings: { findUnique: async () => ({ outcomesEnabled: true }) },
    outcomeThreadTurn: {
      findUnique: async () => ({
        purpose: "plan",
        triggerBy: "owner:local",
        thread: { outcomeId: OUTCOME_ID, botId: BOT_A },
      }),
    },
  };
  const tools = new OutcomeThreadTools(
    threadPrisma as never,
    {} as never,
    undefined,
    f.service
  );
  await expect(
    tools.execute(
      {
        tool: "SavePlan",
        arguments: {
          expectedRevision: 1,
          tasks: [
            {
              key: "task-without-nature",
              title: "No nature",
              instructions: "Do something",
              botId: BOT_A,
              covers: [CRIT_REQ],
            },
          ],
          clientRequestId: "save-plan-no-nature",
        },
      } as never,
      { runId: "run-1", botId: BOT_A } as never
    )
  ).rejects.toMatchObject({ code: "invalid_request", details: { field: "nature", key: "task-without-nature" } });
});
