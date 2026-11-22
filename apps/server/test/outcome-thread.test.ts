import { expect, test } from "bun:test";
import { Effect } from "effect";
import { OutcomeThreadService } from "../src/services/outcome-thread-service";
import { OutcomeThreadTools, triggeredByOwner } from "../src/services/outcome-thread-tools";

type Row = Record<string, any>;
const OWNER = "owner:local" as const;
const GOAL = "11111111-1111-4111-8111-111111111111";
const OTHER_GOAL = "22222222-2222-4222-8222-222222222222";

/** The few Prisma calls the thread service makes, in memory. */
function fixture(options: { status?: string; enabled?: boolean } = {}) {
  const idempotency = new Map<string, Row>();
  const turns: Row[] = [];
  const wakes: Row[] = [];
  const events: Row[] = [];
  const recomputed: string[] = [];
  let thread: Row | null = null;
  const threads: Row[] = [];
  const outcome: Row = { id: "o1", botId: "bot-1", title: "T", status: options.status ?? "pending_approval" };
  const tx: Row = {
    $executeRaw: async () => 0,
    idempotencyRecord: {
      findUnique: async ({ where }: Row) => idempotency.get(`${where.scope_key.scope}:${where.scope_key.key}`) ?? null,
      create: async ({ data }: Row) => void idempotency.set(`${data.scope}:${data.key}`, data),
    },
    featureSettings: { findUnique: async () => ({ outcomesEnabled: options.enabled ?? true }) },
    outcome: { findUnique: async () => outcome },
    bot: { findUnique: async ({ where }: Row) => (where.id === "bot-1" ? { id: "bot-1", status: "active" } : null) },
    exploreIdea: { findUnique: async () => null, update: async () => ({}) },
    channel: { findFirst: async () => ({ id: "dm-1" }) },
    outcomeThread: {
      upsert: async ({ create }: Row) => {
        if (!thread) {
          const created = { id: "thread-1", role: create.role ?? "planner", ...create };
          thread = created;
          threads.push(created);
        }
        return thread;
      },
      update: async ({ where, data }: Row) => Object.assign(threads.find((row) => row.id === where.id)!, data),
    },
    outcomeThreadTurn: {
      create: async ({ data }: Row) => {
        const row = { id: `turn-${turns.length + 1}`, status: "queued", reply: null, error: null, runId: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        turns.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => Object.assign(turns.find((turn) => turn.id === where.id)!, data),
    },
    event: { create: async ({ data }: Row) => void events.push(data) },
  };
  const prisma = {
    ...tx,
    $transaction: async (fn: (t: Row) => unknown) => fn(tx),
    outcomeThread: {
      ...tx.outcomeThread,
      findUnique: async () => thread && { ...thread, turns },
      findMany: async () => threads.map((row) => ({ ...row, turns: turns.filter((turn) => turn.threadId === row.id) })),
    },
  };
  const messaging = {
    enqueueWake: async (_tx: Row, input: Row) => {
      wakes.push(input);
      return { run: { id: `run-${wakes.length}` } };
    },
  };
  const outcomes = {
    createPlanningOutcome: async (_tx: Row, input: Row) => ((outcome.title = input.title), outcome.id),
    getInTransaction: async () => ({ ...outcome }),
  };
  const service = new OutcomeThreadService(prisma as never, messaging as never, outcomes as never, async (_tx, id) => void recomputed.push(id));
  return { service, turns, wakes, events, recomputed, outcome };
}
const send = (text: string, key = "request-key-1") => ({ text, clientRequestId: key });

test("the owner's words reach the bot exactly as written, with no wrapper or rewording", async () => {
  const f = fixture();
  const words = "  取消目标\n  (不要重新规划)  ";
  const turn = await f.service.send("o1", send(words), OWNER);
  expect(f.wakes).toHaveLength(1);
  const wake = f.wakes[0]!;
  expect(wake.content).toBe(words);
  expect(wake.origin).toBe("outcome_thread");
  expect(wake.wrapUserContent).toBe(false);
  expect(wake.outcomeThreadId).toBe("thread-1");
  expect(turn.trigger).toBe(words);
  expect(turn.status).toBe("queued");
  expect(turn.runId).toBe("run-1");
  expect(f.turns[0]!.triggerBy).toBe(OWNER);
  // The goal's status is derived again once a turn is open.
  expect(f.recomputed).toEqual(["o1"]);
});

test("a retried request delivers once; the same ID with other words is refused", async () => {
  const f = fixture();
  const first = await f.service.send("o1", send("Make it smaller", "same-key-123"), OWNER);
  const replay = await f.service.send("o1", send("Make it smaller", "same-key-123"), OWNER);
  expect(replay.id).toBe(first.id);
  expect(f.wakes).toHaveLength(1);
  await expect(f.service.send("o1", send("Something else", "same-key-123"), OWNER)).rejects.toMatchObject({ code: "idempotency_conflict" });
});

test("a finished goal takes no more messages, and nothing happens while goal management is off", async () => {
  for (const status of ["accepted", "cancelled"]) {
    const f = fixture({ status });
    await expect(f.service.send("o1", send("hello"), OWNER)).rejects.toMatchObject({ code: "invalid_outcome_transition" });
    expect(f.wakes).toHaveLength(0);
  }
  const off = fixture({ enabled: false });
  await expect(off.service.send("o1", send("hello"), OWNER)).rejects.toMatchObject({ code: "outcomes_disabled" });
  await expect(off.service.create({ text: "x", botId: "bot-1", clientRequestId: "create-key-1" }, OWNER)).rejects.toMatchObject({ code: "outcomes_disabled" });
  expect(off.wakes).toHaveLength(0);
});

test("a new goal is planning right away: one goal, one thread, one turn, a placeholder title", async () => {
  const f = fixture({ status: "planning" });
  const text = "帮我做一个个人记账小工具，拍照识别金额与分类\n要能导出 CSV";
  const created = await f.service.create({ text, botId: "bot-1", clientRequestId: "create-key-2" }, OWNER);
  expect(created.turn.purpose).toBe("plan");
  expect(created.turn.trigger).toBe(text);
  expect(f.outcome.title).toBe("帮我做一个个人记账小工具，拍照识别金额与分类");
  expect(f.wakes[0]!.content).toBe(text);
  await expect(f.service.create({ text: "x", botId: "missing", clientRequestId: "create-key-3" }, OWNER)).rejects.toMatchObject({ code: "bot_not_runnable" });
});

// --- tools -----------------------------------------------------------------------------------------------

function tools(options: { triggerBy?: string; botId?: string; enabled?: boolean; purpose?: string } = {}) {
  const calls: Array<[string, unknown]> = [];
  const outcomes = {
    saveAgentContract: (id: string, input: unknown, actor: string) => (calls.push(["save", { id, input, actor }]), Effect.succeed({ id, currentRevisionView: { status: "pending_approval" } })),
    cancel: (id: string, input: unknown, actor: string) => (calls.push(["cancel", { id, input, actor }]), Effect.succeed({ id, status: "cancelled" })),
    get: () => Effect.succeed({}),
  };
  const read = { execute: async (request: Row) => (calls.push(["read", request.tool]), { ok: true, outcome: { currentRevisionView: { id: "revision-1" } } }) };
  const prisma = {
    featureSettings: { findUnique: async () => ({ outcomesEnabled: options.enabled ?? true }) },
    outcomeDecision: { findMany: async ({ where }: Row) => {
      expect(where).toMatchObject({ outcomeId: GOAL, contractRevisionId: "revision-1", workItemId: { not: null } });
      return [{ id: "decision-1", completedSummary: "Saved receipt", status: "open" }];
    } },
    outcomeThreadTurn: {
      findUnique: async ({ where }: Row) =>
        where.runId === "run-1"
          ? { purpose: options.purpose ?? "owner_message", triggerBy: options.triggerBy ?? OWNER, thread: { outcomeId: GOAL, botId: options.botId ?? "bot-1" } }
          : null,
    },
  };
  const service = new OutcomeThreadTools(prisma as never, outcomes as never, read as never);
  const call = (tool: string, args: unknown, runId = "run-1") =>
    service.execute({ tool, arguments: args } as never, { runId, botId: "bot-1" } as never);
  return { call, calls };
}
const contract = {
  title: "记账小工具", goal: ["做一个本地记账工具"], acceptance: [{ statement: "能导出 CSV", required: true }],
  boundaries: { included: [], excluded: ["云同步"] }, clientRequestId: "contract-key-1",
};

test("the bot writes the contract itself, as the bot, and it only ever asks for approval", async () => {
  const t = tools();
  const result = (await t.call("SaveOutcomeContract", contract)) as Row;
  expect(result.approvalRequired).toBe(true);
  expect(result.nextStep).toContain("cannot approve");
  expect(t.calls[0]).toEqual(["save", { id: GOAL, input: contract, actor: "bot:bot-1" }]);
});

test("a goal's thread cancels only its own goal, and only on the owner's words", async () => {
  const owner = tools();
  await owner.call("CancelOutcome", { outcomeId: GOAL, clientRequestId: "cancel-key-1" });
  expect(owner.calls[0]![0]).toBe("cancel");
  await expect(owner.call("CancelOutcome", { outcomeId: OTHER_GOAL, clientRequestId: "cancel-key-2" })).rejects.toMatchObject({ code: "outcome_thread_scope" });
  const system = tools({ triggerBy: "system:outcome-thread" });
  await expect(system.call("CancelOutcome", { outcomeId: GOAL, clientRequestId: "cancel-key-3" })).rejects.toMatchObject({ code: "cancel_requires_owner" });
  expect(system.calls).toHaveLength(0);
  expect(triggeredByOwner("user:abc")).toBe(true);
  expect(triggeredByOwner("bot:abc")).toBe(false);
});

test("there is no way to approve, accept or leave the goal's thread, and outside a thread nothing works", async () => {
  const t = tools();
  for (const tool of ["ApproveOutcome", "StartOutcome", "CloseOutcome", "TrackOutcome", "PlanOutcome"])
    await expect(t.call(tool, {})).rejects.toMatchObject({ code: "outcome_thread_tool_forbidden" });
  await expect(t.call("SaveOutcomeContract", contract, "run-other")).rejects.toMatchObject({ code: "outcome_thread_required" });
  await expect(tools({ botId: "someone-else" }).call("SaveOutcomeContract", contract)).rejects.toMatchObject({ code: "outcome_thread_required" });
  await expect(tools({ enabled: false }).call("SaveOutcomeContract", contract)).rejects.toMatchObject({ code: "outcomes_disabled" });
  await expect(t.call("SaveOutcomeContract", { ...contract, extra: 1 })).rejects.toMatchObject({ code: "invalid_request" });
  expect(t.calls).toHaveLength(0);
});

test("purpose whitelist enforces planner vs reviewer tool boundaries", async () => {
  const reviewTurn = tools({ purpose: "review" });
  await expect(reviewTurn.call("GetOutcome", { outcomeId: GOAL })).resolves.toMatchObject({
    ok: true, decisionRecords: [{ id: "decision-1", completedSummary: "Saved receipt", status: "open" }],
  });
  for (const forbidden of ["SaveOutcomeContract", "SavePlan", "CancelOutcome", "ReviewTaskResult", "ListOutcomes"]) {
    await expect(reviewTurn.call(forbidden, {})).rejects.toMatchObject({ code: "outcome_thread_tool_forbidden" });
  }

  const taskReviewTurn = tools({ purpose: "review_task" });
  await expect(taskReviewTurn.call("GetOutcome", { outcomeId: GOAL })).resolves.toMatchObject({ ok: true });
  for (const forbidden of ["SaveOutcomeContract", "SavePlan", "SubmitPrereview", "CancelOutcome", "ListOutcomes"]) {
    await expect(taskReviewTurn.call(forbidden, {})).rejects.toMatchObject({ code: "outcome_thread_tool_forbidden" });
  }
});

test("create routes planner thread to configured plannerBotId while keeping main outcome.botId, and list exposes planner and reviewer turns", async () => {
  const threads: Row[] = [];
  const turns: Row[] = [];
  const wakes: Row[] = [];
  let createdOutcome: Row | null = null;
  const tx: Row = {
    $executeRaw: async () => 0,
    idempotencyRecord: { findUnique: async () => null, create: async () => ({}) },
    featureSettings: {
      findUnique: async () => ({
        outcomesEnabled: true,
        plannerBotId: "bot-planner",
        plannerModel: { providerId: "openai-codex", modelId: "gpt-5.4", reasoning: "high" },
      }),
    },
    outcome: { findUnique: async () => createdOutcome },
    bot: {
      findUnique: async ({ where }: Row) => {
        if (where.id === "bot-main" || where.id === "bot-planner") {
          return { id: where.id, status: "active", subagentIdentity: null, conversation: { id: `conv-${where.id}` } };
        }
        return null;
      },
    },
    exploreIdea: { findUnique: async () => null, update: async () => ({}) },
    channel: { findFirst: async ({ where }: Row) => ({ id: `dm-${where.members.some.botId}` }) },
    outcomeThread: {
      upsert: async ({ where, create }: Row) => {
        const found = threads.find((t) => t.outcomeId === where.outcomeId_role.outcomeId && t.role === where.outcomeId_role.role);
        if (found) return found;
        const row = { id: `thread-${create.role}`, ...create };
        threads.push(row);
        return row;
      },
    },
    outcomeThreadTurn: {
      create: async ({ data }: Row) => {
        const row = { id: `turn-${turns.length + 1}`, status: "queued", reply: null, error: null, runId: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        turns.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => Object.assign(turns.find((t) => t.id === where.id)!, data),
    },
    event: { create: async () => ({}) },
  };
  const prisma = {
    ...tx,
    $transaction: async (fn: (t: Row) => unknown) => fn(tx),
    outcomeThread: {
      ...tx.outcomeThread,
      findMany: async () => threads.map((t) => ({ ...t, turns: turns.filter((turn) => turn.threadId === t.id) })),
    },
  };
  const messaging = {
    enqueueWake: async (_tx: Row, input: Row) => {
      wakes.push(input);
      return { run: { id: `run-${wakes.length}` } };
    },
  };
  const outcomes = {
    createPlanningOutcome: async (_tx: Row, input: Row) => {
      createdOutcome = { id: "o-planned", botId: input.botId, title: input.title, status: "planning" };
      return "o-planned";
    },
    getInTransaction: async () => createdOutcome,
  };
  const service = new OutcomeThreadService(prisma as never, messaging as never, outcomes as never, async () => "planning");
  const created = await service.create({ text: "整理季度资料", botId: "bot-main", clientRequestId: "plan-key-1" }, OWNER);

  expect((createdOutcome as Row | null)?.botId).toBe("bot-main");
  expect(wakes[0]?.botId).toBe("bot-planner");
  expect(created.turn.model).toEqual({ providerId: "openai-codex", modelId: "gpt-5.4", reasoning: "high" });

  threads.push({ id: "thread-reviewer", outcomeId: "o-planned", role: "reviewer", botId: "bot-reviewer" });
  turns.push({
    id: "turn-review-1",
    threadId: "thread-reviewer",
    purpose: "review",
    trigger: "请初验",
    status: "completed",
    reply: "初验完成",
    error: null,
    runId: "run-rev-1",
    workItemId: null,
    result: { summary: "ok" },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const listed = await service.list("o-planned");
  expect(listed.threadId).toBe("thread-planner");
  expect(listed.turns).toHaveLength(1);
  expect(listed.reviewerThreadId).toBe("thread-reviewer");
  expect(listed.reviewTurns).toHaveLength(1);
  expect(listed.reviewTurns?.[0]?.result).toEqual({ summary: "ok" });
});
