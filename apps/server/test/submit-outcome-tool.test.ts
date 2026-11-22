import { expect, test } from "bun:test";
import { Effect } from "effect";
import { OutcomeChatTools } from "../src/services/outcome-chat-tools";
import { OutcomeThreadService } from "../src/services/outcome-thread-service";

type Row = Record<string, any>;

const BOT_SUBMITTER = "11111111-1111-4111-8111-111111111111";
const BOT_PLANNER = "22222222-2222-4222-8222-222222222222";
const EXPLORE_ID = "33333333-3333-4333-8333-333333333333";

function setup(options: { plannerBotId?: string | null; plannerModel?: unknown } = {}) {
  const wakes: Row[] = [];
  const cards: Row[] = [];
  const outcomesCreated: Row[] = [];
  const directContractCalls: Row[] = [];
  const idempotency = new Map<string, Row>();
  const threads: Row[] = [];
  const turns: Row[] = [];
  const exploreIdea: Row = { id: EXPLORE_ID, status: "proposed_for_delivery" };

  const tx: Row = {
    $executeRaw: async () => 0,
    idempotencyRecord: {
      findUnique: async ({ where }: Row) => idempotency.get(`${where.scope_key.scope}:${where.scope_key.key}`) ?? null,
      create: async ({ data }: Row) => void idempotency.set(`${data.scope}:${data.key}`, data),
    },
    featureSettings: {
      findUnique: async () => ({
        outcomesEnabled: true,
        plannerBotId: options.plannerBotId ?? null,
        plannerModel: options.plannerModel ?? null,
      }),
    },
    bot: {
      findUnique: async ({ where }: Row) => {
        if (where.id === BOT_SUBMITTER || where.id === BOT_PLANNER) {
          return { id: where.id, status: "active", subagentIdentity: null, conversation: { id: `conv-${where.id}` } };
        }
        return null;
      },
    },
    channel: {
      findFirst: async ({ where }: Row) => ({ id: `dm-${where.members.some.botId}` }),
    },
    exploreIdea: {
      findUnique: async ({ where }: Row) => (where.id === EXPLORE_ID ? exploreIdea : null),
      update: async ({ data }: Row) => Object.assign(exploreIdea, data),
    },
    outcome: {
      findUnique: async ({ where }: Row) => outcomesCreated.find((o) => o.id === where.id) ?? null,
    },
    outcomeThread: {
      upsert: async ({ where, create }: Row) => {
        const found = threads.find((t) => t.outcomeId === where.outcomeId_role.outcomeId && t.role === where.outcomeId_role.role);
        if (found) return found;
        const row = { id: `thread-${threads.length + 1}`, ...create };
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
  const prisma = { ...tx, $transaction: async (fn: (t: Row) => unknown) => fn(tx) };
  const messaging = {
    enqueueWake: async (_tx: Row, input: Row) => {
      wakes.push(input);
      return { run: { id: `run-${wakes.length}` } };
    },
  };
  const outcomes = {
    createPlanningOutcome: async (_tx: Row, input: Row) => {
      const id = `00000000-0000-4000-8000-00000000000${outcomesCreated.length + 1}`;
      outcomesCreated.push({
        id,
        botId: input.botId,
        title: input.title,
        description: input.description,
        status: "planning",
        currentRevision: null,
        currentRevisionView: null,
      });
      return id;
    },
    getInTransaction: async (_tx: Row, id: string) => outcomesCreated.find((o) => o.id === id),
    createFromContract: (input: Row, botId: string) => {
      directContractCalls.push({ input, botId });
      return Effect.succeed({
        id: "direct-outcome-1",
        botId,
        title: input.title,
        description: input.goal[0],
        status: "pending_approval",
        currentRevision: 1,
        currentRevisionView: { status: "pending_approval", goal: input.goal },
      });
    },
  };
  const threadService = new OutcomeThreadService(prisma as never, messaging as never, outcomes as never, async () => "planning");
  const fakeCards = {
    begin: async (_ctx: Row, card: Row) => {
      cards.push({ kind: "begin", card: { ...card } });
      return "msg-card-1";
    },
    update: async (_ctx: Row, _id: string, card: Row) => {
      cards.push({ kind: "update", card: { ...card } });
    },
  };
  const chatTools = new OutcomeChatTools(
    outcomes as never,
    {} as never,
    {} as never,
    fakeCards as never,
    undefined,
    threadService,
    prisma as never
  );
  return { chatTools, wakes, cards, outcomesCreated, directContractCalls, exploreIdea };
}

test("SubmitOutcome submits verbatim user text from submitter bot to planner bot and stays idempotent", async () => {
  const f = setup({ plannerBotId: BOT_PLANNER });
  const text = "  请帮我整理 Q3 财报材料\n  保留原表结构  ";
  const req = {
    tool: "SubmitOutcome",
    arguments: { text, exploreIdeaId: EXPLORE_ID, clientRequestId: "submit-req-1" },
  };
  const first = (await f.chatTools.execute(req as never, { botId: BOT_SUBMITTER } as never)) as Row;
  expect((first.outcome as Row).botId).toBe(BOT_SUBMITTER);
  expect((first.outcome as Row).description).toBe(text.trim());
  expect(f.wakes).toHaveLength(1);
  expect(f.wakes[0]!.botId).toBe(BOT_PLANNER);
  expect(f.wakes[0]!.content).toBe(text);
  expect(f.exploreIdea.status).toBe("converted");
  expect(f.cards.some((c) => c.kind === "begin")).toBe(true);

  const replay = (await f.chatTools.execute(req as never, { botId: BOT_SUBMITTER } as never)) as Row;
  expect((replay.outcome as Row).id).toBe((first.outcome as Row).id);
  expect(f.wakes).toHaveLength(1);
});

test("CreateOutcome is rejected with SubmitOutcome hint when planner role is active, but allowed when unset", async () => {
  const contractArgs = {
    title: "Direct goal",
    goal: ["Deliver report"],
    acceptance: [{ statement: "Report ready", required: true }],
    boundaries: { included: [], excluded: [] },
    clientRequestId: "create-direct-1",
  };

  const withPlanner = setup({ plannerBotId: BOT_PLANNER });
  await expect(
    withPlanner.chatTools.execute(
      { tool: "CreateOutcome", arguments: contractArgs } as never,
      { botId: BOT_SUBMITTER } as never
    )
  ).rejects.toMatchObject({ code: "planner_role_active" });
  expect(withPlanner.cards).toHaveLength(0);
  expect(withPlanner.directContractCalls).toHaveLength(0);

  const withoutPlanner = setup({ plannerBotId: null, plannerModel: null });
  const res = (await withoutPlanner.chatTools.execute(
    { tool: "CreateOutcome", arguments: contractArgs } as never,
    { botId: BOT_SUBMITTER } as never
  )) as Row;
  expect((res.outcome as Row).id).toBe("direct-outcome-1");
  expect(withoutPlanner.directContractCalls).toHaveLength(1);
});
