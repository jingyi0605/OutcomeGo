import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, parseListOutcomesQuery, type CreateOutcomeInput } from "@outcomego/contracts";
import { createPrismaClient } from "@outcomego/db";
import { AgentDataStore, AgentMessaging } from "@outcomego/messaging";
import { Effect } from "effect";
import { OutcomeService, type OutcomeLifecycleOptions } from "../src/services/outcome-service";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const requestId = () => `unified:${crypto.randomUUID()}`;
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const failureCode = async (operation: Effect.Effect<unknown, Error>) => {
  const result = await Effect.runPromise(Effect.either(operation));
  if (result._tag !== "Left" || !(result.left instanceof ApiError)) throw new Error(`Expected ApiError, got ${JSON.stringify(result)}`);
  return result.left.code;
};

describe.skipIf(!url)("Spec 004.11 unified Outcome lifecycle", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let messaging: AgentMessaging;
  let service: OutcomeService;
  let botId: string;
  let otherBotId: string;
  let channelId: string;
  let root: string;
  let originalSettings: boolean | undefined;
  const wakes: unknown[] = [];
  const ownerId = `unified-${crypto.randomUUID()}`;
  const owner = `user:${ownerId}` as const;
  const bot = () => `bot:${botId}` as const;
  const botContext = { ownerId };
  const create = (input: Omit<CreateOutcomeInput, "clientRequestId">) =>
    Effect.runPromise(service.create({ ...input, clientRequestId: requestId() }, owner)).then(({ outcome }) => outcome);

  beforeAll(async () => {
    db = createPrismaClient(url!);
    root = await mkdtemp(join(tmpdir(), "outcome-unified-test-"));
    messaging = new AgentMessaging(db, { send: async (queue: string, payload: unknown) => { wakes.push({ queue, payload }); return "test-job"; } } as never,
      new AgentDataStore(db, { root: join(root, "agent-data"), workspaceRoot: root }));
    service = new OutcomeService(db, messaging);
    const settings = await db.featureSettings.findUnique({ where: { id: "global" } });
    originalSettings = settings?.outcomesEnabled;
    await db.featureSettings.upsert({ where: { id: "global" }, create: { id: "global", outcomesEnabled: true }, update: { outcomesEnabled: true } });
    const bots = await Promise.all(["Unified test Bot", "Other test Bot"].map((name) => db.bot.create({
      data: { name, status: "active", defaultDirectory: root, conversation: { create: {} } },
    })));
    [botId, otherBotId] = bots.map(({ id }) => id) as [string, string];
    channelId = (await db.channel.create({ data: { kind: "bot_dm", name: "Unified test DM", directKey: `bot:${botId}`, members: { create: { botId, ordinal: 0 } } } })).id;
  });

  afterAll(async () => {
    if (!db) return;
    const rows = await db.outcome.findMany({ where: { ownerId }, select: { id: true } });
    const ids = rows.map(({ id }) => id);
    await db.memoryFact.deleteMany({ where: { sourceOutcomeId: { in: ids } } });
    await db.event.deleteMany({ where: { entityId: { in: ids } } });
    await db.outcome.deleteMany({ where: { ownerId } });
    await db.outcomeAutoAcceptRule.deleteMany({ where: { ownerId } });
    await db.idempotencyRecord.deleteMany({ where: { OR: [{ scope: { contains: ownerId } }, ...ids.map((id) => ({ scope: { contains: id } }))] } });
    if (botId && otherBotId) await db.bot.deleteMany({ where: { id: { in: [botId, otherBotId] } } });
    if (channelId) await db.channel.deleteMany({ where: { id: channelId } });
    if (originalSettings === undefined) await db.featureSettings.deleteMany({ where: { id: "global" } });
    else await db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: originalSettings } });
    await db.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("creates every kind and lists by kind, tag, keyword, range and cursor within the owner boundary", async () => {
    const dueAt = at(120);
    const rows = await Promise.all([
      create({ kind: "standard", title: "Unified standard", botId }),
      create({ kind: "tracked", title: "Unified tracked", botId }),
      create({ kind: "scheduled_once", title: "Unified schedule", description: "Deliver reminder", botId, scheduledAt: dueAt }),
      create({ kind: "todo", title: "Unified todo", tags: ["filters"], dueAt }),
      create({ kind: "explore_idea", title: "Unified idea", budget: { timeLimitMinutes: 20, costLimit: null } }),
      create({ kind: "note", title: "Unified note", tags: ["filters"], description: "Another needle", dueAt }),
    ]);
    expect(rows.map(({ kind, status }) => [kind, status])).toEqual([
      ["standard", "draft"], ["tracked", "running"], ["scheduled_once", "scheduled"], ["todo", "open"], ["explore_idea", "draft"], ["note", "active"],
    ]);
    expect(rows.slice(3).every(({ botId }) => botId === null)).toBe(true);
    expect(await failureCode(service.create({ kind: "tracked", title: "No execution Bot", clientRequestId: requestId() }, owner))).toBe("outcome_bot_required");
    expect(await failureCode(service.create({ kind: "standard", title: "Missing assigned Bot", botId: crypto.randomUUID(), clientRequestId: requestId() }, owner))).toBe("outcome_bot_required");
    const filters = new URLSearchParams({ kinds: "todo,note", tag: "filters", query: "unified", from: at(60), to: at(180), limit: "1" });
    const first = await Effect.runPromise(service.list(parseListOutcomesQuery(filters), owner));
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    filters.set("cursor", first.nextCursor!);
    const second = await Effect.runPromise(service.list(parseListOutcomesQuery(filters), owner));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.nextCursor).toBeNull();
    expect((await Effect.runPromise(service.list(parseListOutcomesQuery(new URLSearchParams("query=unified")), "owner:local"))).items).toEqual([]);
  });

  test("intake commits the note and uploaded asset before planner callback and persists enqueue failure only once", async () => {
    const attachment = await messaging.assets.ingestBytes({ fileName: "intake.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("intake evidence") });
    let attempted = 0;
    const enqueuePlan: NonNullable<OutcomeLifecycleOptions["enqueuePlan"]> = async (id, plan) => {
      attempted += 1;
      expect(plan).toMatchObject({ mode: "triage", expectedRevision: 1 });
      const committed = await db.outcome.findUniqueOrThrow({ where: { id } });
      expect(committed).toMatchObject({ kind: "note", description: "Remember the full draft", attachments: [attachment], kindMeta: { createdVia: "owner_go_inbox", triageStatus: "pending" } });
      throw new ApiError(409, "planner_unavailable", "No planning Bot configured");
    };
    const intake = new OutcomeService(db, messaging, undefined, undefined, undefined, { enqueuePlan });
    const input = { text: "Remember the full draft", attachments: [attachment], clientRequestId: requestId() };
    const [first, replay] = await Promise.all([Effect.runPromise(intake.createIntake(input, owner)), Effect.runPromise(intake.createIntake(input, owner))]);
    expect({ attempted, replay, first }).toMatchObject({ attempted: 1, first: { turn: null, outcome: { kind: "note", status: "active", kindMeta: { triageStatus: "failed", triageError: "planner_unavailable" } } } });
    expect(first).toEqual(replay);
    expect(await failureCode(intake.createIntake({ ...input, text: "A different draft" }, owner))).toBe("idempotency_conflict");
    const child = await create({ kind: "todo", title: "Follow up on the draft", parentOutcomeId: first.outcome.id });
    expect(child).toMatchObject({ status: "open", parentOutcomeId: first.outcome.id, kindMeta: { createdVia: "owner_go_inbox", acceptedBy: "owner" } });
    const moved = await Effect.runPromise(intake.convert(first.outcome.id, { targetKind: "todo", expectedRevision: 1, clientRequestId: requestId() }, owner));
    expect(moved.outcome).toMatchObject({ id: first.outcome.id, status: "open", kind: "todo", attachments: [attachment], kindMeta: { createdVia: "owner_go_inbox" } });
  });

  test("note memory updates on edits and tracks disable, archive, unarchive, cancellation and conversion", async () => {
    let note = await create({ kind: "note", title: "Memory note", description: `Latest note ${"content ".repeat(100)}` });
    const facts = () => db.memoryFact.findMany({ where: { sourceOutcomeId: note.id } });
    const action = (action: "archive" | "unarchive" | "cancel") => Effect.runPromise(service.act(note.id, { action, expectedRevision: note.revision, clientRequestId: requestId() }, owner));
    const [fact] = await facts();
    expect(fact?.namespace).toBe("user:notes");
    expect(fact!.fact.length).toBeLessThanOrEqual(500);
    await db.outcome.update({ where: { id: note.id }, data: { kindMeta: { createdVia: "owner_ui", syncToMemory: true, memorySummary: "Stale generated summary" } } });
    note = await Effect.runPromise(service.update(note.id, { description: "New description", expectedRevision: note.revision, clientRequestId: requestId() }, owner));
    expect((await facts()).map(({ fact }) => fact)).toEqual(["[note] Memory note: New description"]);
    note = await Effect.runPromise(service.update(note.id, { syncToMemory: false, expectedRevision: note.revision, clientRequestId: requestId() }, owner));
    expect(await facts()).toHaveLength(0);
    note = await Effect.runPromise(service.update(note.id, { syncToMemory: true, expectedRevision: note.revision, clientRequestId: requestId() }, owner));
    expect(await facts()).toHaveLength(1);
    note = await action("archive");
    expect(await facts()).toHaveLength(0);
    note = await action("unarchive");
    expect(await facts()).toHaveLength(1);
    note = await action("archive");
    note = await action("cancel");
    expect(note).toMatchObject({ kind: "note", status: "cancelled" });
    expect(await facts()).toHaveLength(0);
  });

  test("conversion preserves identity and thread history, and enqueues the initial contract plan once", async () => {
    let attempts = 0;
    const serviceWithPlan = new OutcomeService(db, messaging, undefined, undefined, undefined, { enqueuePlan: async (id, plan) => {
      attempts += 1;
      expect(await db.outcome.findUniqueOrThrow({ where: { id } })).toMatchObject({ kind: "standard", revision: 2 });
      expect(plan).toMatchObject({ mode: "contract_plan", expectedRevision: 2 });
      return { id: crypto.randomUUID(), purpose: "plan", planMode: "contract_plan", status: "queued", trigger: "test", reply: null, error: null, runId: null,
        outcomeRevision: 2, createdAt: at(0), updatedAt: at(0) };
    } });
    const note = await create({ kind: "note", title: "Promoted note", description: "Preserve all text", tags: ["keep"], sourceRef: { id: "source" } });
    const thread = await db.outcomeThread.create({ data: { outcomeId: note.id, botId } });
    await db.outcomeThreadTurn.create({ data: { threadId: thread.id, purpose: "plan", planMode: "advice", trigger: "read", triggerBy: owner, clientRequestId: requestId() } });
    const input = { targetKind: "standard", expectedRevision: 1, botId, clientRequestId: requestId() } as const;
    const converted = await Effect.runPromise(serviceWithPlan.convert(note.id, input, owner));
    expect(converted.outcome).toMatchObject({ id: note.id, kind: "standard", revision: 2, description: note.description, tags: ["keep"], sourceRef: { id: "source" } });
    expect(converted.turn?.planMode).toBe("contract_plan");
    expect(await Effect.runPromise(serviceWithPlan.convert(note.id, input, owner))).toEqual(converted);
    expect(attempts).toBe(1);
    expect(await db.outcomeThreadTurn.count({ where: { threadId: thread.id } })).toBe(1);
    expect(await db.memoryFact.count({ where: { sourceOutcomeId: note.id } })).toBe(0);
    expect(await failureCode(service.convert(note.id, { targetKind: "note", expectedRevision: 2, clientRequestId: requestId() }, owner))).toBe("outcome_conversion_invalid");
  });

  test("locks concurrent edits, replays identical writes and denies unauthorized writes without mutating data", async () => {
    const row = await create({ kind: "note", botId, title: "Guarded note" });
    const input = { title: "Owner edit", expectedRevision: 1, clientRequestId: requestId() };
    expect(await failureCode(service.update(row.id, input, "owner:local"))).toBe("outcome_not_found");
    expect(await failureCode(service.update(row.id, input, `bot:${otherBotId}`, botContext))).toBe("outcome_action_forbidden");
    expect(await failureCode(service.act(row.id, { action: "archive", expectedRevision: 1, clientRequestId: requestId() }, bot(), botContext))).toBe("outcome_action_forbidden");
    expect(await db.outcome.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ title: "Guarded note", revision: 1, status: "active" });
    const edits = await Promise.all([input, { ...input, title: "Bot edit", clientRequestId: requestId() }].map((request) =>
      Effect.runPromise(Effect.either(service.update(row.id, request, owner)))));
    expect(edits.filter((edit) => edit._tag === "Right")).toHaveLength(1);
    expect(edits.find((edit) => edit._tag === "Left")?.left).toMatchObject({ code: "outcome_revision_conflict" });
    const changed = edits[0]!._tag === "Right" ? input : { ...input, title: "Replay edit", expectedRevision: 2, clientRequestId: requestId() };
    const saved = await Effect.runPromise(service.update(row.id, changed, owner));
    expect(await Effect.runPromise(service.update(row.id, changed, owner))).toEqual(saved);
    expect(await failureCode(service.update(row.id, { ...changed, description: "Different content" }, owner))).toBe("idempotency_conflict");

    const tracked = await create({ kind: "tracked", title: "Bot-owned tracked work", botId });
    expect(await failureCode(service.act(tracked.id, {
      action: "close_tracked",
      payload: { resultSummary: "Completed by the owner" },
      expectedRevision: tracked.revision,
      clientRequestId: requestId(),
    }, owner))).toBe("outcome_action_forbidden");
    expect((await Effect.runPromise(service.act(tracked.id, {
      action: "close_tracked",
      payload: { resultSummary: "Completed by the assigned Bot" },
      expectedRevision: tracked.revision,
      clientRequestId: requestId(),
    }, bot(), botContext))).status).toBe("accepted");
  });

  test("owner-message and rule authorization are validated against a persisted run; handoff commits a real Bot run", async () => {
    const { message, run } = await db.$transaction((tx) => messaging.enqueueWake(tx, {
      botId, channelId, origin: "user", type: "user.message", content: "Please remind me to finish the exercise", clientId: requestId(), priority: 300,
    }));
    const context = { ...botContext, runId: run.id };
    const suggest = (title: string, sourceRef?: CreateOutcomeInput["sourceRef"]) =>
      Effect.runPromise(service.create({ kind: "todo", title, sourceRef, clientRequestId: requestId() }, bot(), context)).then(({ outcome }) => outcome);
    const untrusted = await suggest("No valid reference", { kind: "owner_message_ref", id: crypto.randomUUID() });
    expect(untrusted).toMatchObject({ status: "suggested", kindMeta: { authorizedByMessageId: null } });
    const direct = await suggest("Owner authorized", { kind: "owner_message_ref", id: message.id });
    expect(direct).toMatchObject({ status: "open", kindMeta: { authorizedByMessageId: message.id, acceptedBy: "owner" } });
    const rule = await service.createAutoAcceptRule(ownerId, { name: "Auto accept project tasks", botId, sourceKind: "project" });
    const ruled = await suggest("Rule authorized", { kind: "project", id: "source-1" });
    expect(ruled).toMatchObject({ status: "open", kindMeta: { autoAcceptRuleId: rule.id, acceptedBy: "rule" } });
    expect((await suggest("Duplicate source", { kind: "project", id: "source-1" })).id).toBe(ruled.id);
    expect((await service.listAutoAcceptRules(ownerId)).rules.find(({ id }) => id === rule.id)?.matchCount).toBe(1);
    await service.updateAutoAcceptRule(ownerId, rule.id, { enabled: false });
    expect((await suggest("Rule disabled", { kind: "project", id: "source-2" })).status).toBe("suggested");
    await service.deleteAutoAcceptRule(ownerId, rule.id);
    const request = { action: "handoff_to_bot", expectedRevision: direct.revision, payload: { botId, instruction: "Finish the exercise" }, clientRequestId: requestId() } as const;
    const before = wakes.length;
    const handed = await Effect.runPromise(service.act(direct.id, request, owner));
    expect(handed.executor).toBe("bot");
    expect(handed.kind).toBe("todo");
    if (handed.kind !== "todo") throw new Error("Expected Todo");
    const handoffMessage = await db.message.findUniqueOrThrow({ where: { id: handed.kindMeta.handoffMessageId! } });
    expect(handoffMessage.content).toContain("Finish the exercise");
    expect(await db.run.findUniqueOrThrow({ where: { userMessageId: handoffMessage.id } })).toMatchObject({ botId, channelId, origin: "user", status: "queued" });
    expect(await Effect.runPromise(service.act(direct.id, request, owner))).toEqual(handed);
    expect(wakes).toHaveLength(before + 1);
    const completed = await Effect.runPromise(service.act(handed.id, { action: "complete", expectedRevision: handed.revision, clientRequestId: requestId() }, bot(), context));
    expect(completed.status).toBe("accepted");
    expect((await Effect.runPromise(service.act(completed.id, { action: "restore", expectedRevision: completed.revision, clientRequestId: requestId() }, owner))).status).toBe("open");
  });

  test("scheduled and Explore actions obey their respective state machines", async () => {
    let scheduled = await create({ kind: "scheduled_once", title: "Change scheduling", botId, description: "Deliver result", scheduledAt: at(120), prepareAt: at(60) });
    for (const [action, status] of [["pause", "paused"], ["resume", "scheduled"]] as const) {
      scheduled = await Effect.runPromise(service.act(scheduled.id, { action, expectedRevision: scheduled.revision, clientRequestId: requestId() }, owner));
      expect(scheduled.status).toBe(status);
    }
    expect(await failureCode(service.update(scheduled.id, { scheduledAt: at(30), expectedRevision: scheduled.revision, clientRequestId: requestId() }, owner))).toBe("invalid_request");
    scheduled = await Effect.runPromise(service.update(scheduled.id, { scheduledAt: at(240), expectedRevision: scheduled.revision, clientRequestId: requestId() }, owner));
    expect(scheduled.revision).toBe(4);
    await db.outcome.update({ where: { id: scheduled.id }, data: { status: "running", kindMeta: { startedAt: at(0) } } });
    expect(await failureCode(service.convert(scheduled.id, { targetKind: "todo", expectedRevision: scheduled.revision, clientRequestId: requestId() }, owner))).toBe("outcome_conversion_invalid");
    expect(await failureCode(service.act(scheduled.id, { action: "cancel", expectedRevision: scheduled.revision, clientRequestId: requestId() }, owner))).toBe("invalid_outcome_transition");
    let idea = await create({ kind: "explore_idea", title: "Prototype something" });
    idea = await Effect.runPromise(service.act(idea.id, { action: "resume", expectedRevision: idea.revision, clientRequestId: requestId() }, owner));
    expect(idea.status).toBe("exploring");
    idea = await Effect.runPromise(service.act(idea.id, { action: "dismiss", expectedRevision: idea.revision, clientRequestId: requestId() }, owner));
    expect(idea.status).toBe("cancelled");
  });
});
