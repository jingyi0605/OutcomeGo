import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "@outcomego/contracts";
import type { ClassifyOutcomeInput, OutcomeThreadTurnView } from "@outcomego/contracts/outcome-thread";
import { createPrismaClient, type OutcomePlanMode } from "@outcomego/db";
import { AgentDataStore, AgentMessaging, settleOutcomeThreadTurn } from "@outcomego/messaging";
import { Effect } from "effect";
import { OutcomeClassificationService } from "../src/services/outcome-classification";
import { OutcomeService, type ActorRef } from "../src/services/outcome-service";
import { OutcomeThreadService } from "../src/services/outcome-thread-service";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const ownerId = `classification-${crypto.randomUUID()}`;
const owner: ActorRef = `user:${ownerId}`;
const requestId = () => `test-classify:${crypto.randomUUID()}`;
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const attachment = { assetId: "d".repeat(64), fileName: "intake.txt", kind: "text", mimeType: "text/plain", byteSize: 5 } as const;

const planView = (id: string, planMode: "triage" | "contract_plan", outcomeRevision: number): OutcomeThreadTurnView => ({
  id, purpose: "plan", planMode, outcomeRevision, trigger: "Test plan", status: "queued", reply: null, error: null, runId: null, createdAt: at(0), updatedAt: at(0),
});

describe.skipIf(!url)("transactional Go intake classification", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let outcomes: OutcomeService;
  let plannerId: string;
  let assigneeId: string;
  let root: string;
  let channelId: string;
  let originalSettings: boolean | undefined;

  beforeAll(async () => {
    db = createPrismaClient(url!);
    root = await mkdtemp(join(tmpdir(), "outcome-classification-"));
    outcomes = new OutcomeService(db, undefined, undefined, undefined, undefined, {
      enqueuePlan: async (_id, { expectedRevision }) => planView(crypto.randomUUID(), "triage", expectedRevision),
    });
    originalSettings = (await db.featureSettings.findUnique({ where: { id: "global" } }))?.outcomesEnabled;
    await db.featureSettings.upsert({ where: { id: "global" }, create: { id: "global", outcomesEnabled: true }, update: { outcomesEnabled: true } });
    const bots = await Promise.all(["Classification planner", "Classification executor"].map((name) => db.bot.create({
      data: { name, status: "active", defaultDirectory: root, conversation: { create: {} } },
    })));
    [plannerId, assigneeId] = bots.map(({ id }) => id) as [string, string];
    channelId = (await db.channel.create({ data: { kind: "bot_dm", name: "Classification DM", directKey: `bot:${plannerId}`, members: { create: { botId: plannerId, ordinal: 0 } } } })).id;
  });

  afterAll(async () => {
    if (!db) return;
    const rows = await db.outcome.findMany({ where: { ownerId }, select: { id: true, threads: { select: { turns: { select: { id: true } } } } } });
    const ids = rows.map(({ id }) => id);
    const turnIds = rows.flatMap(({ threads }) => threads.flatMap(({ turns }) => turns.map(({ id }) => id)));
    await db.memoryFact.deleteMany({ where: { sourceOutcomeId: { in: ids } } });
    await db.event.deleteMany({ where: { entityId: { in: ids } } });
    await db.outcome.deleteMany({ where: { ownerId } });
    await db.idempotencyRecord.deleteMany({ where: { OR: [{ scope: { contains: ownerId } }, { scope: "outcome-classify", key: { in: turnIds } }] } });
    if (plannerId && assigneeId) await db.bot.deleteMany({ where: { id: { in: [plannerId, assigneeId] } } });
    if (channelId) await db.channel.deleteMany({ where: { id: channelId } });
    if (originalSettings === undefined) await db.featureSettings.deleteMany({ where: { id: "global" } });
    else await db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: originalSettings } });
    await db.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function runningTurn(sourceId: string, sourceRevision: number, planMode: OutcomePlanMode = "triage") {
    const { id: conversationId } = await db.conversation.findUniqueOrThrow({ where: { botId: plannerId }, select: { id: true } });
    return db.$transaction(async (tx) => {
      const thread = await tx.outcomeThread.upsert({ where: { outcomeId_role: { outcomeId: sourceId, role: "planner" } },
        create: { outcomeId: sourceId, botId: plannerId }, update: {} });
      const userMessage = await tx.message.create({ data: { botId: plannerId, conversationId, role: "user", content: "Triage", status: "completed" } });
      const run = await tx.run.create({ data: { botId: plannerId, conversationId, origin: "outcome_thread", status: "running", outcomeThreadId: thread.id, userMessageId: userMessage.id } });
      const turn = await tx.outcomeThreadTurn.create({ data: { threadId: thread.id, runId: run.id, purpose: "plan", planMode, outcomeRevision: sourceRevision,
        status: "running", trigger: "Go intake", triggerBy: owner, clientRequestId: requestId() } });
      return { turn, context: { runId: run.id, botId: plannerId } };
    });
  }

  async function intake(text: string, botId?: string) {
    const { outcome } = await Effect.runPromise(outcomes.createIntake({ text, attachments: [attachment], botId, clientRequestId: requestId() }, owner));
    return { outcome, ...await runningTurn(outcome.id, outcome.revision) };
  }

  const classifications = () => new OutcomeClassificationService(db, outcomes, async (_id, { expectedRevision }) => planView(crypto.randomUUID(), "contract_plan", expectedRevision));

  test("converts the source to an open Todo without duplicating it, preserves attachments and revokes note memory", async () => {
    const source = await intake("Follow up on the invoice");
    const result = await classifications().classify(source.context, { strategy: "single_convert", summary: "One task", clientRequestId: requestId(),
      outcome: { kind: "todo", title: "Follow up", followUpAt: at(60) } });
    expect(result).toEqual({ schemaVersion: 1, sourceOutcomeId: source.outcome.id, strategy: "single_convert", sourceKind: "todo", createdChildren: [], summary: "One task" });
    expect(await db.outcome.findUniqueOrThrow({ where: { id: source.outcome.id } })).toMatchObject({
      kind: "todo", status: "open", revision: 2, title: "Follow up", description: source.outcome.description, attachments: [attachment],
      kindMeta: { createdVia: "owner_go_inbox", acceptedBy: "owner" },
    });
    expect(await db.outcomeThreadTurn.findUniqueOrThrow({ where: { id: source.turn.id } })).toMatchObject({ result });
    expect(await db.memoryFact.count({ where: { sourceOutcomeId: source.outcome.id } })).toBe(0);
  });

  test("split preserves raw text and assets, writes note memory, and attributes all children to the source owner", async () => {
    const raw = "Original details, unchanged.\n\n- Ask about a contract.\n- Sketch a delivery plan.";
    const source = await intake(raw, assigneeId);
    await db.outcome.update({ where: { id: source.outcome.id }, data: { tags: ["existing"], sourceRef: { source: "trusted input" } } });
    const enqueued: Array<{ id: string; revision: number; actor: ActorRef }> = [];
    const service = new OutcomeClassificationService(db, outcomes, async (id, { expectedRevision }, actor) => {
      expect(await db.outcomeThreadTurn.findUniqueOrThrow({ where: { id: source.turn.id } })).toMatchObject({ result: { strategy: "split_from_note" } });
      expect(await db.outcome.findUniqueOrThrow({ where: { id } })).toMatchObject({ ownerId, kind: "standard", botId: assigneeId });
      enqueued.push({ id, revision: expectedRevision, actor });
      return planView(crypto.randomUUID(), "contract_plan", expectedRevision);
    });
    const result = await service.classify(source.context, { strategy: "split_from_note", clientRequestId: requestId(), summary: "Two next steps",
      sourceNote: { title: "An intake note", description: "Summarized only", tags: ["new"] }, memoryFacts: ["A contract needs confirmation"],
      children: [{ kind: "todo", title: "Ask about the contract", followUpAt: at(90) }, { kind: "standard", title: "Deliver the plan", description: "Draft the plan" }],
    });
    expect(result.strategy).toBe("split_from_note");
    expect(result.createdChildren).toHaveLength(2);
    const updated = await db.outcome.findUniqueOrThrow({ where: { id: source.outcome.id }, include: { childOutcomes: true } });
    expect(updated).toMatchObject({ status: "active", revision: 2, title: "An intake note", description: raw, attachments: [attachment], tags: ["existing", "new"],
      kindMeta: { triageStatus: "completed", memorySummary: "A contract needs confirmation", createdVia: "owner_go_inbox" }, sourceRef: { source: "trusted input" } });
    for (const child of updated.childOutcomes) expect(child).toMatchObject({ parentOutcomeId: source.outcome.id, ownerId, createdBy: owner, kindMeta: { createdVia: "owner_go_inbox" } });
    expect(updated.childOutcomes.find(({ kind }) => kind === "todo")).toMatchObject({ status: "open", attachments: [] });
    expect(enqueued).toEqual([{ id: result.createdChildren[1]!.outcomeId, revision: 1, actor: owner }]);
    expect(await db.memoryFact.findMany({ where: { sourceOutcomeId: source.outcome.id } })).toMatchObject([{ namespace: "user:notes", fact: expect.stringContaining("A contract needs confirmation") }]);
  });

  test("invalid child aborts all classified source edits, memory changes, events, and previously inserted children", async () => {
    const source = await intake("Retain this draft");
    const before = await db.outcome.findUniqueOrThrow({ where: { id: source.outcome.id } });
    const eventCount = await db.event.count({ where: { entityId: before.id } });
    const facts = await db.memoryFact.findMany({ where: { sourceOutcomeId: before.id } });
    await expect(classifications().classify(source.context, { strategy: "split_from_note", summary: "Rollback", clientRequestId: requestId(),
      sourceNote: { title: "Should not stick" }, children: [{ kind: "todo", title: "Valid child" }, { kind: "scheduled_once", title: "Bad child", scheduledAt: at(-30), description: "Invalid" }],
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(await db.outcome.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    expect(await db.outcome.count({ where: { parentOutcomeId: before.id } })).toBe(0);
    expect(await db.event.count({ where: { entityId: before.id } })).toBe(eventCount);
    expect(await db.memoryFact.findMany({ where: { sourceOutcomeId: before.id } })).toEqual(facts);
    expect(await db.outcomeThreadTurn.findUniqueOrThrow({ where: { id: source.turn.id } })).toMatchObject({ result: null });
  });

  test("concurrent semantic replays create children once and reject a conflicting result or another run's Bot", async () => {
    const source = await intake("Deduplicate this split");
    const service = classifications();
    const input = { strategy: "split_from_note", summary: "One child", clientRequestId: requestId(), children: [{ kind: "todo", title: "A child" }] } as const satisfies ClassifyOutcomeInput;
    const [first, duplicate] = await Promise.all([service.classify(source.context, input), service.classify(source.context, { ...input, clientRequestId: requestId() })]);
    expect(first).toEqual(duplicate);
    expect(await db.outcome.count({ where: { parentOutcomeId: source.outcome.id } })).toBe(1);
    await expect(service.classify(source.context, { ...input, summary: "Different", clientRequestId: requestId() })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(service.classify({ ...source.context, botId: assigneeId }, input)).rejects.toMatchObject({ code: "outcome_thread_tool_forbidden" });
    await db.outcomeThreadTurn.update({ where: { id: source.turn.id }, data: { status: "completed" } });
    await db.run.update({ where: { id: source.context.runId }, data: { status: "completed" } });
    expect(await service.classify(source.context, input)).toEqual(first);
  });

  test("rejects non-Go notes, wrong plan modes, stale notes and non-running turns", async () => {
    const input = { strategy: "single_convert", summary: "Keep as note", clientRequestId: requestId(), outcome: { kind: "note", title: "Categorized" } } as const satisfies ClassifyOutcomeInput;
    const service = classifications();
    const ordinary = await Effect.runPromise(outcomes.create({ kind: "note", title: "Ordinary note", clientRequestId: requestId() }, owner));
    await expect(service.classify((await runningTurn(ordinary.outcome.id, ordinary.outcome.revision)).context, input)).rejects.toMatchObject({ code: "outcome_thread_tool_forbidden" });
    const source = await intake("Go note, owner changed it");
    await expect(service.classify((await runningTurn(source.outcome.id, source.outcome.revision, "advice")).context, input)).rejects.toMatchObject({ code: "outcome_thread_tool_forbidden" });
    const changed = await Effect.runPromise(outcomes.update(source.outcome.id, { title: "Owner changed the note", expectedRevision: 1, clientRequestId: requestId() }, owner));
    await expect(service.classify(source.context, input)).rejects.toMatchObject({ code: "outcome_revision_conflict" });
    const settled = await runningTurn(source.outcome.id, changed.revision);
    await db.outcomeThreadTurn.update({ where: { id: settled.turn.id }, data: { status: "completed" } });
    await expect(service.classify(settled.context, input)).rejects.toMatchObject({ code: "outcome_thread_tool_forbidden" });
    const retry = await runningTurn(source.outcome.id, changed.revision);
    expect(await service.classify(retry.context, input)).toMatchObject({ strategy: "single_convert", sourceKind: "note" });
    expect(await db.outcome.findUniqueOrThrow({ where: { id: source.outcome.id } })).toMatchObject({ title: "Categorized", description: source.outcome.description, kind: "note", revision: 3 });
  });

  test("standard auto-plan only runs after commit and keeps the classification when enqueue fails", async () => {
    const source = await intake("A standard goal");
    const keys: string[] = [];
    const service = new OutcomeClassificationService(db, outcomes, async (id, { expectedRevision, clientRequestId }, actor) => {
      expect(actor).toBe(owner);
      expect(await db.outcome.findUniqueOrThrow({ where: { id } })).toMatchObject({ kind: "standard", revision: expectedRevision, botId: plannerId });
      keys.push(clientRequestId);
      if (keys.length === 1) throw new ApiError(409, "planner_unavailable", "Test forced enqueue failure");
      return planView(crypto.randomUUID(), "contract_plan", expectedRevision);
    });
    const input = { strategy: "single_convert", summary: "Plan the goal", clientRequestId: requestId(), outcome: { kind: "standard", title: "A goal" } } as const satisfies ClassifyOutcomeInput;
    const first = await service.classify(source.context, input);
    expect(first.sourceKind).toBe("standard");
    expect(await service.classify(source.context, { ...input, clientRequestId: requestId() })).toEqual(first);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test("enqueues exactly one real standard Plan while triage is running and preserves success through later runtime failure", async () => {
    const { outcome } = await Effect.runPromise(outcomes.createIntake({ text: "Investigate an issue", botId: plannerId, clientRequestId: requestId() }, owner));
    const source = await runningTurn(outcome.id, outcome.revision);
    const messaging = new AgentMessaging(db, { send: async () => "test-job" } as never,
      new AgentDataStore(db, { root: join(root, "agent-data"), workspaceRoot: root }));
    const threads = new OutcomeThreadService(db, messaging);
    const service = new OutcomeClassificationService(db, outcomes, (id, input, actor) => threads.plan(id, input, actor));
    const input = { strategy: "single_convert", summary: "Plan the investigation", clientRequestId: requestId(), outcome: { kind: "standard", title: "An investigation" } } as const satisfies ClassifyOutcomeInput;
    const [first, replay] = await Promise.all([service.classify(source.context, input), service.classify(source.context, { ...input, clientRequestId: requestId() })]);
    expect(first).toEqual(replay);
    const plans = await db.outcomeThreadTurn.findMany({ where: { threadId: source.turn.threadId, planMode: "contract_plan" } });
    expect(plans).toMatchObject([{ status: "queued", outcomeRevision: 2 }]);
    expect(plans[0]?.runId).toBeTruthy();
    await db.run.update({ where: { id: source.context.runId }, data: { status: "failed", error: { code: "test_runtime_failure" } } });
    await db.$transaction((tx) => settleOutcomeThreadTurn(tx, source.context.runId, messaging));
    expect(await db.outcomeThreadTurn.findUniqueOrThrow({ where: { id: source.turn.id } })).toMatchObject({ status: "completed", result: first });
    expect(await db.outcome.findUniqueOrThrow({ where: { id: outcome.id } })).toMatchObject({ kind: "standard", status: "planning" });
  });
});
