import { afterEach, describe, expect, test } from "bun:test";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OwnerTodoService } from "../src/services/owner-todo-service";
import { createTodoRoutes } from "../src/routes/todos";
import { createActivityRoutes } from "../src/routes/activity";
import { ActivityService } from "../src/services/activity-service";
import type { RouteContext } from "../src/routes/context";
import { expireTodoSuggestions } from "@outcomego/messaging";
import { readTranscript } from "@outcomego/messaging";
import { Effect } from "effect";
import { InternalToolService } from "../src/services/internal-tool-service";
import { ChannelService } from "../src/services/channel-service";

const enabled = Boolean(process.env.OUTCOMEGO_TEST_DATABASE_URL);
const cleanups: Array<() => Promise<void>> = [];
const now = new Date("2026-11-25T10:00:00Z");
const later = "2026-11-25T12:00:00Z";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const fixture = await outcomeThreadFixture();
  const { db } = fixture;
  const owner = crypto.randomUUID();
  await db.featureSettings.upsert({ where: { id: "global" }, create: { outcomesEnabled: true }, update: { outcomesEnabled: true } });
  cleanups.push(async () => {
    const rows = await db.ownerTodoItem.findMany({ where: { ownerId: { in: [owner, "local"] } }, select: { id: true } });
    await db.outboxDelivery.deleteMany({ where: { OR: rows.map(({ id }) => ({ deliveryKey: { startsWith: `todo:urgent:${id}:` } })) } });
    await db.event.deleteMany({ where: { topic: "todo.changed", entityId: { in: rows.map((row) => row.id) } } });
    await db.ownerTodoItem.deleteMany({ where: { ownerId: { in: [owner, "local"] } } });
    await db.todoAutoAcceptRule.deleteMany({ where: { ownerId: { in: [owner, "local"] } } });
    await db.idempotencyRecord.deleteMany({ where: { scope: { in: [`todo-create:${owner}`, "todo-create:local", "todo-agent:local"] } } });
    await db.idempotencyRecord.deleteMany({ where: { scope: { startsWith: "todo-update:local:" } } });
    await db.idempotencyRecord.deleteMany({ where: { scope: `conversation:${fixture.bot.conversation!.id}:message` } });
    await db.featureSettings.deleteMany({ where: { id: "global" } });
    await fixture.cleanup();
  });
  return { ...fixture, owner, todos: new OwnerTodoService(db) };
}

describe.skipIf(!enabled)("owner todo basics", () => {
  test("handoff sends an owner message once, projects progress and links only existing goals", async () => {
    const fixture = await setup();
    const { bot, db, channel, messaging, root, outcome, owner, todos } = fixture;
    const channels = new ChannelService(db, messaging, root, async () => new Response(null));
    const original = await todos.create(owner, { title: "Item A", note: "Note A", clientRequestId: "handoff" });
    const input = { botId: bot.id, revision: original.revision, instruction: "Resolve the item" };
    await expect(todos.handoff("other", original.id, input, channels.sendDirectMessage, null)).rejects.toMatchObject({ status: 404 });
    const sent = await todos.handoff(owner, original.id, input, channels.sendDirectMessage, null);
    expect(sent).toMatchObject({ status: "open", executor: "bot", handoffBotId: bot.id, revision: 2, handoffProgress: { channelId: channel.id, state: null } });
    expect(await todos.handoff(owner, original.id, input, channels.sendDirectMessage, null)).toEqual(sent);
    const messages = await db.channelMessage.findMany({ where: { channelId: channel.id, sender: "user" } });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain('"note":"Note A"');
    const request = await db.run.findUniqueOrThrow({ where: { userMessageId: sent.handoffMessageId! } });
    expect(request.origin).toBe("user");
    await db.run.update({ where: { id: request.id }, data: { requestProgress: { runId: request.id, revision: 1, state: "complete", summary: "Result A", remaining: [], evidence: [] } } });
    expect(await todos.detail(owner, sent.id)).toMatchObject({ status: "open", handoffProgress: { runId: request.id, state: "completed", summary: "Result A" } });
    await expect(todos.linkOutcome(owner, sent.id, { revision: sent.revision, outcomeId: crypto.randomUUID() })).rejects.toMatchObject({ status: 404 });
    const linked = await todos.linkOutcome(owner, sent.id, { revision: sent.revision, outcomeId: outcome.id });
    expect(linked).toMatchObject({ status: "done", linkedOutcomeId: outcome.id, revision: 3 });
    expect(await todos.linkOutcome(owner, sent.id, { revision: sent.revision, outcomeId: outcome.id })).toEqual(linked);
  });
  for (const [title, tag] of [["Alpha", "one"], ["Beta", "two"]]) {
    test(`${title}: creation is idempotent, owner scoped, and independent of outcomes`, async () => {
      const { db, owner, todos } = await setup();
      const outcomeCount = await db.outcome.count();
      const input = { title: title!, tags: [tag!], clientRequestId: "repeat", dueAt: later };
      const [first, second] = await Promise.all([todos.create(owner, input, now), todos.create(owner, input, now)]);
      expect(second).toEqual(first);
      expect(first).toMatchObject({ status: "open", executor: "owner", createdVia: "owner_ui", urgency: "normal", revision: 1 });
      expect((await todos.list(owner, { tag }, now)).items).toEqual([first]);
      expect((await todos.list("non-owner", {}, now)).items).toEqual([]);
      await expect(todos.detail("non-owner", first.id, now)).rejects.toMatchObject({ status: 404 });
      await expect(todos.create(owner, { ...input, title: "Different" }, now)).rejects.toMatchObject({ status: 409 });
      expect(await db.event.count({ where: { topic: "todo.changed", entityId: first.id } })).toBe(1);
      expect(await db.outcome.count()).toBe(outcomeCount);
    });
  }

  test("the revision guard, transitions and configurable restore retention apply to writes", async () => {
    const { db, owner, todos } = await setup();
    const item = await todos.create(owner, { title: "Initial", clientRequestId: "transitions" }, now);
    await expect(todos.act(owner, item.id, "accept", { revision: 1 }, now)).rejects.toMatchObject({ status: 409 });
    const writes = await Promise.allSettled([
      todos.update(owner, item.id, { revision: 1, title: "First" }, now),
      todos.update(owner, item.id, { revision: 1, title: "Second" }, now),
    ]);
    expect(writes.map((write) => write.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(writes.find((write) => write.status === "rejected")).toMatchObject({ reason: { code: "todo_conflict" } });
    const waiting = await todos.update(owner, item.id, { revision: 2, status: "waiting", followUpAt: later }, now);
    expect(waiting).toMatchObject({ status: "waiting", revision: 3 });
    const done = await todos.act(owner, item.id, "complete", { revision: 3, note: "Finished" }, now);
    expect(done).toMatchObject({ status: "done", completedAt: now.toISOString(), completionNote: "Finished", revision: 4 });
    expect((await todos.list(owner, { view: "history" }, now)).items).toEqual([done]);
    const restored = await todos.act(owner, item.id, "restore", { revision: 4 }, now);
    expect(restored).toMatchObject({ status: "open", completedAt: null, completionNote: null });
    const dismissed = await todos.act(owner, item.id, "dismiss", { revision: 5 }, now);
    expect(dismissed).toMatchObject({ status: "dismissed", dismissReason: "owner" });
    await db.featureSettings.update({ where: { id: "global" }, data: { taskPolicy: { "todo.restoreRetentionDays": 1 } } });
    const afterRetention = new Date("2026-11-27T10:00:00Z");
    expect((await todos.list(owner, { view: "history" }, afterRetention)).items).toEqual([]);
    await expect(todos.act(owner, item.id, "restore", { revision: 6 }, afterRetention)).rejects.toMatchObject({ status: 409 });
  });

  test("owner routes validate payload, apply the feature gate and support disabled-auth installations", async () => {
    const { db, todos } = await setup();
    const route = createTodoRoutes(todos);
    const request = new Request("http://localhost/api/todos", { method: "POST", body: JSON.stringify({ title: "Alpha", clientRequestId: "route" }) });
    const ctx = { request, path: "/api/todos", url: new URL(request.url), authenticatedSessionId: null } as RouteContext;
    await expect(route({ ...ctx, authMode: "required" })).rejects.toMatchObject({ status: 401 });
    const response = await route({ ...ctx, authMode: "disabled" });
    expect(response?.status).toBe(201);
    const malformed = new Request(request.url, { method: "POST", body: JSON.stringify({ title: "Alpha", clientRequestId: "invalid", dueAt: "2026-11-25T12:00:00" }) });
    await expect(route({ ...ctx, request: malformed, authMode: "disabled" })).rejects.toMatchObject({ status: 400 });
    await db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: false } });
    await expect(route({ ...ctx, authMode: "disabled", request: new Request(request.url) })).rejects.toMatchObject({ code: "outcomes_disabled" });
  });

  test("needs-me shows reached follow-ups, removes snoozed items and preserves the activity response", async () => {
    const { db, todos } = await setup();
    const owner = "local";
    const item = await todos.create(owner, { title: "Initial", clientRequestId: "waiting" }, now);
    await todos.update(owner, item.id, { revision: 1, status: "waiting", followUpAt: later }, now);
    expect(await todos.attention(owner, now)).toEqual([]);
    const at = new Date(later);
    expect(await todos.attention(owner, at)).toMatchObject([{ attention: "follow_up", todo: { id: item.id, revision: 2 } }]);
    expect((await todos.list(owner, { view: "needs_me" }, at)).items.map(({ id }) => id)).toEqual([item.id]);
    const request = new Request("http://localhost/api/needs-me");
    const context = { request, path: "/api/needs-me", url: new URL(request.url), authMode: "disabled", authenticatedSessionId: null } as RouteContext;
    const response = await createActivityRoutes(new ActivityService(db), {
      ownerForSession: todos.ownerForSession.bind(todos), attention: (ownerId) => todos.attention(ownerId, at), digest: (ownerId) => todos.digest(ownerId, at),
    })(context);
    expect(await response?.json()).toMatchObject({ items: [], todoDigest: null, todos: [{ todo: { id: item.id } }] });
    await todos.act(owner, item.id, "snooze", { revision: 2, snoozeUntil: "2026-11-25T13:00:00Z" }, now);
    expect(await todos.attention(owner, at)).toEqual([]);
    expect((await todos.list(owner, { view: "needs_me" }, at)).items).toEqual([]);
  });

  test("high urgency uses the owner outbox only when enabled and only once per todo", async () => {
    const { db, todos } = await setup();
    const device = await db.pushDevice.create({ data: { installationId: crypto.randomUUID(), pushToken: crypto.randomUUID(), platform: "ios", authRequired: false, locale: "zh-CN" } });
    cleanups.unshift(async () => { await db.pushDevice.deleteMany({ where: { id: device.id } }); });
    const muted = await todos.create("local", { title: "Private title A", urgency: "high", clientRequestId: "muted" }, now);
    await db.featureSettings.update({ where: { id: "global" }, data: { taskPolicy: { "todo.highUrgencyNotify": true } } });
    const input = { title: "Private title B", urgency: "high" as const, clientRequestId: "enabled" };
    const [first, retry] = await Promise.all([todos.create("local", input, now), todos.create("local", input, now)]);
    expect(first.id).toBe(retry.id);
    const edited = await todos.create("local", { title: "Private title C", clientRequestId: "edit" }, now);
    await todos.update("local", edited.id, { revision: 1, urgency: "high" }, now);
    const deliveries = await db.outboxDelivery.findMany({ where: { target: device.id, deliveryKey: { startsWith: "todo:urgent:" } } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ deliveryKey: `todo:urgent:${first.id}:${device.id}`, payload: { kind: "todo", type: "urgent", todoId: first.id, title: "有一件高紧急度待办" } });
    expect(JSON.stringify(deliveries)).not.toContain("Private title");
    expect(muted.id).not.toBe(first.id);
  });
});

describe.skipIf(!enabled)("owner todo source gate and triage", () => {
  async function turn(fixture: Awaited<ReturnType<typeof setup>>, origin: "user" | "agent" | "routine" | "event" | "background_revival", createdAt = now, conversationId = fixture.bot.conversation!.id) {
    const { bot, db } = fixture;
    const message = await db.message.create({ data: {
      botId: bot.id, conversationId, role: "user", content: `Stored text: ${origin}`, createdAt,
    } });
    const run = await db.run.create({ data: { botId: bot.id, conversationId, userMessageId: message.id, origin } });
    return { message, run, context: { runId: run.id, botId: bot.id, authMode: "disabled" as const } };
  }

  test("bot tools dispatch from trusted turns, resolve transcript references and enforce bot scope", async () => {
    const fixture = await setup();
    const { bot, db, channel, messaging, todos } = fixture;
    const clientId = crypto.randomUUID();
    const visible = await db.channelMessage.create({ data: { clientId, channelId: channel.id, sender: "user", content: "Record fixture" } });
    const message = await db.message.create({ data: { clientId, botId: bot.id, conversationId: bot.conversation!.id, role: "user", content: visible.content } });
    const run = await db.run.create({ data: { botId: bot.id, conversationId: bot.conversation!.id, channelId: channel.id, origin: "user", status: "running", userMessageId: message.id } });
    await db.message.update({ where: { id: message.id }, data: { runId: run.id } });
    const transcript = await readTranscript(db, { botId: bot.id, channelId: channel.id }, {});
    expect(transcript.rows).toContainEqual(expect.objectContaining({ id: visible.id, ownerMessageRef: message.id }));
    const tools = new InternalToolService(db, messaging, {} as never, async () => {}, {} as never, {} as never, {} as never, {} as never,
      undefined, undefined, undefined, undefined, undefined, {}, undefined, undefined, undefined, undefined, undefined, todos, "disabled");
    const call = async (tool: string, args: unknown, current = run) => {
      const result = await Effect.runPromise(Effect.either(tools.execute({ tool, arguments: args, callId: crypto.randomUUID(),
        runId: current.id, botId: current.botId, conversationId: current.conversationId, channelId: current.channelId!, deliveryId: null })));
      if (result._tag === "Left") throw result.left;
      return result.right;
    };
    const open = await call("CreateTodo", { title: "Visible", clientRequestId: "create-tool", ownerMessageRef: message.id }) as { todo: { id: string; revision: number; status: string } };
    expect(open.todo.status).toBe("open");
    const ownerItem = await todos.create("local", { title: "Private", clientRequestId: "owner-exclusive" });
    const listing = await call("ListTodos", {});
    expect(listing).toMatchObject({ items: [{ id: open.todo.id, title: "Visible" }] });
    await expect(call("UpdateTodo", { todoId: ownerItem.id, revision: 1, title: "Changed", clientRequestId: "forbidden" })).rejects.toMatchObject({ code: "todo_not_found" });
    const update = { todoId: open.todo.id, revision: 1, status: "done", completionNote: "Confirmed", clientRequestId: "update-tool" };
    expect(await call("UpdateTodo", update)).toMatchObject({ status: "done", revision: 2 });
    expect(await call("UpdateTodo", update)).toMatchObject({ status: "done", revision: 2 });
    expect((await todos.detail("local", open.todo.id)).completionNote).toBe("Confirmed");
    const event = await turn(fixture, "event");
    const eventRun = await db.run.update({ where: { id: event.run.id }, data: { channelId: channel.id, status: "running" } });
    await expect(call("ListTodos", {}, eventRun)).rejects.toMatchObject({ code: "todo_turn_forbidden" });
    await expect(call("CreateTodo", { title: "Forbidden", clientRequestId: "forbidden", ownerMessageRef: message.id }, eventRun)).rejects.toMatchObject({ code: "todo_turn_forbidden" });
    await expect(call("UpdateTodo", update, eventRun)).rejects.toMatchObject({ code: "todo_turn_forbidden" });
    expect(await call("SuggestTodo", { title: "Proposed", summary: "Placeholder", clientRequestId: "event-tool", sourceRef: { kind: "alpha", id: "one", label: "Label A" } }, eventRun))
      .toMatchObject({ todo: { status: "suggested" } });
  });

  test("owner rules apply only to new matching suggestions and respect the local-day limit", async () => {
    const fixture = await setup();
    const { bot, db, todos } = fixture;
    const { context } = await turn(fixture, "event");
    const laterTurn = await turn(fixture, "agent");
    const begin = new Date("2026-11-25T15:59:00Z");
    const nextDay = new Date("2026-11-25T16:00:00Z");
    await db.userTimeZoneSettings.create({ data: { id: "global", override: "Asia/Singapore" } });
    cleanups.push(async () => { await db.userTimeZoneSettings.delete({ where: { id: "global" } }); });
    await db.featureSettings.update({ where: { id: "global" }, data: { taskPolicy: { "todo.autoAccept.maxPerRulePerDay": 1 } } });
    const route = createTodoRoutes(todos);
    const endpoint = "/api/todos/auto-accept-rules";
    const requestRule = (method: string, payload?: object, suffix = "", authMode = "disabled") => {
      const path = `${endpoint}${suffix}`;
      const request = new Request(`http://localhost${path}`, { method, body: payload ? JSON.stringify(payload) : undefined });
      return route({ request, path, url: new URL(request.url), authMode, authenticatedSessionId: null } as RouteContext);
    };
    await expect(requestRule("GET", undefined, "", "required")).rejects.toMatchObject({ status: 401 });
    await expect(requestRule("POST", { name: "Unbound", sourceKind: "alpha" })).rejects.toMatchObject({ status: 400 });
    const draft = { name: "First", botId: bot.id, sourceKind: "alpha" };
    const created = (await requestRule("POST", draft))!;
    expect(created.status).toBe(201);
    const rule = await created.json() as { id: string };
    await todos.createAutoAcceptRule("local", { ...draft, name: "Later" }, new Date(Date.now() + 1_000));
    await todos.createAutoAcceptRule(fixture.owner, { ...draft, name: "Separate" }, new Date());
    await expect(requestRule("PATCH", { botId: null }, `/${rule.id}`)).rejects.toMatchObject({ status: 400 });
    await expect(todos.deleteAutoAcceptRule(fixture.owner, rule.id)).rejects.toMatchObject({ status: 404 });
    const input = (id: string, kind = "alpha") => ({ title: `Item ${id}`, summary: "Placeholder", clientRequestId: id, sourceRef: { kind, id, label: "Label" } });
    const submit = (id: string, time = begin, kind = "alpha") => todos.createFromTurn(context, "suggest", input(id, kind), time);
    expect((await submit("different", begin, "beta")).todo.status).toBe("suggested");
    await expect(todos.createFromTurn(context, "suggest", { ...input("forged"), botId: bot.id }, begin)).rejects.toMatchObject({ status: 400 });
    expect(await todos.createFromTurn(laterTurn.context, "create", { title: "Placeholder", clientRequestId: "invalid-ref", ownerMessageRef: crypto.randomUUID(), sourceRef: input("invalid-ref").sourceRef }, begin))
      .toMatchObject({ reason: "owner_ref_invalid", todo: { status: "suggested" } });
    const results = await Promise.all([submit("one"), submit("two")]);
    expect(results.map(({ todo }) => todo.status).sort()).toEqual(["open", "suggested"]);
    const accepted = results.find(({ todo }) => todo.status === "open")!.todo;
    expect(await todos.detail("local", accepted.id, begin)).toMatchObject({ acceptedBy: "rule", autoAcceptRuleId: rule.id, autoAcceptRuleName: "First", createdVia: "agent_turn", authorizedByMessageId: null });
    expect(await submit("one")).toEqual(results[0]);
    expect((await submit("tomorrow", nextDay)).todo.status).toBe("open");
    const listing = await (await requestRule("GET"))!.json() as { rules: unknown[] };
    expect(listing.rules).toHaveLength(2);
    expect(listing.rules).toContainEqual(expect.objectContaining({ id: rule.id, matchCount: 2, lastMatchedAt: nextDay.toISOString() }));
    expect((await requestRule("PATCH", { enabled: false }, `/${rule.id}`))?.status).toBe(200);
    expect((await requestRule("DELETE", undefined, `/${rule.id}`))?.status).toBe(204);
    expect(await todos.detail("local", accepted.id, nextDay)).toMatchObject({ status: "open", autoAcceptRuleName: "First" });
    expect((await todos.act("local", accepted.id, "dismiss", { revision: accepted.revision }, nextDay)).status).toBe("dismissed");
  });

  test("a later turn can reference a recent owner message, but synthetic, stale and foreign messages cannot authorize", async () => {
    const fixture = await setup();
    const { db, todos } = fixture;
    const ownerTurn = await turn(fixture, "user");
    const laterTurn = await turn(fixture, "agent");
    const stale = await turn(fixture, "user", new Date("2026-11-23T10:00:00Z"));
    const foreignBot = await db.bot.create({ data: { name: "Other", defaultDirectory: fixture.root, conversation: { create: {} } }, include: { conversation: true } });
    cleanups.unshift(async () => { await db.bot.deleteMany({ where: { id: foreignBot.id } }); });
    const foreign = await turn(fixture, "user", now, foreignBot.conversation!.id);
    const input = { title: "Placeholder", clientRequestId: "owner-ref", ownerMessageRef: ownerTurn.message.id };
    await db.featureSettings.update({ where: { id: "global" }, data: { taskPolicy: { "todo.ownerRef.maxTodosPerMessage": 1 } } });
    const created = await todos.createFromTurn(laterTurn.context, "create", input, now);
    expect(created).toMatchObject({ todo: { status: "open" }, reason: null });
    expect(await todos.detail("local", created.todo.id, now)).toMatchObject({ ownerMessagePreview: "Stored text: user", createdVia: "owner_chat", authorizedByMessageId: ownerTurn.message.id });
    expect(await todos.createFromTurn(laterTurn.context, "create", input, now)).toEqual(created);
    const synthetic = await Promise.all((["routine", "event", "background_revival"] as const).map((origin) => turn(fixture, origin)));
    for (const ref of [ownerTurn, stale, foreign, ...synthetic]) {
      const result = await todos.createFromTurn(laterTurn.context, "create", { ...input, clientRequestId: ref.run.id, ownerMessageRef: ref.message.id }, now);
      expect(result).toMatchObject({ reason: "owner_ref_invalid", todo: { status: "suggested" } });
      expect((await todos.detail("local", result.todo.id, now)).authorizedByMessageId).toBeNull();
    }
    await expect(todos.createFromTurn(synthetic[0]!.context, "create", input, now)).rejects.toMatchObject({ status: 403 });
    expect((await todos.createFromTurn(laterTurn.context, "create", { title: "Other", clientRequestId: "missing" }, now)).reason).toBe("owner_ref_missing");
  });

  for (const [kind, title] of [["alpha", "First item"], ["beta", "Second item"]] as const) {
    test(`${kind}: source dedupe, pending cap, expiry and bulk triage`, async () => {
      const fixture = await setup();
      const { db, todos } = fixture;
      const { context } = await turn(fixture, "event");
      await db.featureSettings.update({ where: { id: "global" }, data: { taskPolicy: { "todo.suggestionTtlDays": 1, "todo.maxPendingSuggestionsPerBot": 1 } } });
      const input = { title, summary: `Summary ${kind}`, clientRequestId: "original", sourceRef: { kind, id: "1", label: title }, dueAt: later };
      const original = await todos.createFromTurn(context, "suggest", input, now);
      expect(await todos.detail("local", original.todo.id, now)).toMatchObject({ status: "suggested", dueAt: "2026-11-25T12:00:00.000Z", expiresAt: "2026-11-26T10:00:00.000Z" });
      const duplicate = await todos.createFromTurn(context, "suggest", { ...input, clientRequestId: "duplicate" }, now);
      expect(duplicate.todo.id).toBe(original.todo.id);
      const other = { ...input, clientRequestId: "other", sourceRef: { ...input.sourceRef, id: "2" } };
      await expect(todos.createFromTurn(context, "suggest", other, now)).rejects.toMatchObject({ status: 429, code: "suggestion_limit_reached" });
      expect(await expireTodoSuggestions(db, now)).toBe(0);
      const future = new Date("2026-11-26T10:00:00Z");
      expect(await expireTodoSuggestions(db, future)).toBe(1);
      expect((await todos.detail("local", original.todo.id, future)).dismissReason).toBe("expired");
      const next = await todos.createFromTurn(context, "suggest", other, future);
      const accepted = await todos.bulk("local", { action: "accept", items: [{ id: next.todo.id, revision: 1 }] }, future);
      expect(accepted.items[0]).toMatchObject({ status: "open", dueAt: "2026-11-25T12:00:00.000Z" });
      await db.featureSettings.update({ where: { id: "global" }, data: { taskPolicy: { "todo.suggestionTtlDays": 0 } } });
      const retry = await todos.createFromTurn(context, "suggest", { ...input, clientRequestId: "after-expiry" }, future);
      expect(retry.todo.id).not.toBe(original.todo.id);
      expect((await todos.detail("local", retry.todo.id, future)).expiresAt).toBeNull();
      expect(await expireTodoSuggestions(db, new Date("2026-12-01T10:00:00Z"))).toBe(0);
      expect((await todos.bulk("local", { action: "dismissBot", botId: context.botId }, future)).items).toHaveLength(1);
      const ignored = await todos.createFromTurn(context, "suggest", { ...input, clientRequestId: "after-ignore" }, future);
      expect(ignored.todo).toEqual({ id: retry.todo.id, status: "dismissed", revision: 2 });
    });
  }
});
