import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { DynamicToolCallRequest } from "@outcomego/contracts";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeChatTools } from "../src/services/outcome-chat-tools";
import { OutcomeService } from "../src/services/outcome-service";
import { OutcomeThreadService } from "../src/services/outcome-thread-service";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const requestId = () => `chat-unified:${crypto.randomUUID()}`;
const cleanups: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

describe.skipIf(!databaseUrl)("unified Outcome chat tools", () => {
  test("dispatches all six tools through the unified Outcome services", async () => {
    const fixture = await outcomeThreadFixture();
    let noteId: string | undefined;
    cleanups.push(async () => {
      // A note has no Bot, so deleting the fixture Bot would leave it behind for later test files.
      if (noteId) {
        await fixture.db.memoryFact.deleteMany({ where: { sourceOutcomeId: noteId } });
        await fixture.db.event.deleteMany({ where: { entityId: noteId } });
        await fixture.db.idempotencyRecord.deleteMany({ where: { scope: { contains: noteId } } });
        await fixture.db.outcome.deleteMany({ where: { id: noteId } });
      }
      await fixture.cleanup();
    });
    await fixture.db.featureSettings.upsert({
      where: { id: "global" },
      create: { id: "global", outcomesEnabled: true },
      update: { outcomesEnabled: true },
    });

    const threads = new OutcomeThreadService(fixture.db, fixture.messaging);
    const outcomes = new OutcomeService(
      fixture.db,
      fixture.messaging,
      undefined,
      undefined,
      undefined,
      { enqueuePlan: (id, input, actor, context) => threads.plan(id, input, actor, context) },
    );
    const tools = new OutcomeChatTools(
      outcomes,
      undefined,
      threads,
    );
    const context = {
      runId: "",
      botId: fixture.bot.id,
      conversationId: fixture.bot.conversation!.id,
      channelId: fixture.channel.id,
      deliveryId: null,
      origin: "user" as const,
      callId: requestId(),
      timeZone: null,
      replyToMessageId: null,
      isFork: false,
    };
    const call = (tool: string, argumentsValue: unknown) =>
      tools.execute({
        runId: context.runId,
        botId: context.botId,
        conversationId: context.conversationId,
        channelId: context.channelId,
        deliveryId: context.deliveryId,
        callId: requestId(),
        tool,
        arguments: argumentsValue,
      } as DynamicToolCallRequest, context);

    const created = await call("CreateOutcome", {
      kind: "note",
      title: "Chat note",
      description: "Capture this note from the unified tool.",
      clientRequestId: requestId(),
    }) as { outcome: { id: string; kind: string; status: string; revision: number } };
    noteId = created.outcome.id;
    expect(created.outcome).toMatchObject({ kind: "note", status: "active", revision: 1 });

    const updated = await call("UpdateOutcome", {
      outcomeId: created.outcome.id,
      title: "Updated chat note",
      expectedRevision: 1,
      clientRequestId: requestId(),
    }) as { outcome: { title: string; revision: number } };
    expect(updated.outcome).toMatchObject({ title: "Updated chat note", revision: 2 });

    const queried = await call("QueryOutcomes", {
      kinds: ["note"],
      statuses: ["active"],
      query: "Updated chat note",
      limit: 20,
    }) as { items: Array<{ id: string }> };
    expect(queried.items.map(({ id }) => id)).toContain(created.outcome.id);

    const read = await call("GetOutcome", { outcomeId: created.outcome.id }) as {
      outcome: { id: string; title: string };
    };
    expect(read.outcome).toMatchObject({ id: created.outcome.id, title: "Updated chat note" });

    const acted = await call("ActOnOutcome", {
      outcomeId: created.outcome.id,
      action: "archive",
      expectedRevision: 2,
      clientRequestId: requestId(),
    }) as { outcome: { status: string; revision: number } };
    expect(acted.outcome).toMatchObject({ status: "archived", revision: 3 });

    const planned = await call("PlanOutcome", {
      outcomeId: fixture.outcome.id,
      mode: "advice",
      expectedRevision: 1,
      clientRequestId: requestId(),
    }) as { outcome: { id: string }; turn: { planMode: string; status: string } };
    expect(planned.outcome.id).toBe(fixture.outcome.id);
    expect(planned.turn).toMatchObject({ planMode: "advice", status: "queued" });
  });

  test("rejects retired chat tool names", async () => {
    const fixture = await outcomeThreadFixture();
    cleanups.push(() => fixture.cleanup());
    const tools = new OutcomeChatTools(new OutcomeService(fixture.db));
    const context = {
      runId: "",
      botId: fixture.bot.id,
      conversationId: fixture.bot.conversation!.id,
      channelId: fixture.channel.id,
      deliveryId: null,
      origin: "user" as const,
      callId: requestId(),
      timeZone: null,
      replyToMessageId: null,
      isFork: false,
    };
    await expect(tools.execute({
      runId: "",
      botId: fixture.bot.id,
      conversationId: context.conversationId,
      channelId: context.channelId,
      deliveryId: null,
      callId: requestId(),
      tool: "TrackOutcome",
      arguments: {},
    } as DynamicToolCallRequest, context)).rejects.toMatchObject({ code: "invalid_request" });
  });

  test("resolves the authenticated deployment owner when authMode is required", async () => {
    const fixture = await outcomeThreadFixture();
    const user = await fixture.db.user.create({
      data: {
        id: crypto.randomUUID(),
        email: `owner-${crypto.randomUUID()}@example.invalid`,
        name: "Owner",
        emailVerified: true,
      },
    });
    const createdIds: string[] = [];
    cleanups.push(async () => {
      if (createdIds.length > 0) {
        await fixture.db.memoryFact.deleteMany({ where: { sourceOutcomeId: { in: createdIds } } });
        await fixture.db.event.deleteMany({ where: { entityId: { in: createdIds } } });
        await fixture.db.outcome.deleteMany({ where: { id: { in: createdIds } } });
      }
      await fixture.db.user.deleteMany({ where: { id: user.id } });
      await fixture.cleanup();
    });
    await fixture.db.featureSettings.upsert({
      where: { id: "global" },
      create: { id: "global", outcomesEnabled: true },
      update: { outcomesEnabled: true },
    });

    const threads = new OutcomeThreadService(fixture.db, fixture.messaging);
    const outcomes = new OutcomeService(
      fixture.db,
      fixture.messaging,
      undefined,
      undefined,
      undefined,
      { enqueuePlan: (id, input, actor, ctx) => threads.plan(id, input, actor, ctx) },
    );
    const createdTodo = await Effect.runPromise(
      outcomes.create(
        {
          kind: "todo",
          title: "整理采购订单待办",
          botId: fixture.bot.id,
          clientRequestId: requestId(),
        },
        `user:${user.id}`,
      ),
    );
    createdIds.push(createdTodo.outcome.id);

    const tools = new OutcomeChatTools(outcomes, undefined, threads, "required");
    const context = {
      runId: "",
      botId: fixture.bot.id,
      conversationId: fixture.bot.conversation!.id,
      channelId: fixture.channel.id,
      deliveryId: null,
      origin: "user" as const,
      callId: requestId(),
      timeZone: null,
      replyToMessageId: null,
      isFork: false,
    };
    const call = (tool: string, args: Record<string, unknown>) =>
      tools.execute(
        {
          runId: "",
          botId: fixture.bot.id,
          conversationId: context.conversationId,
          channelId: context.channelId,
          deliveryId: null,
          callId: requestId(),
          tool,
          arguments: args,
        } as DynamicToolCallRequest,
        context,
      );

    const queried = (await call("QueryOutcomes", { kinds: ["todo"] })) as {
      items: Array<{ id: string; title: string }>;
    };
    expect(queried.items.some((item) => item.id === createdTodo.outcome.id)).toBe(true);

    const fetched = (await call("GetOutcome", { outcomeId: createdTodo.outcome.id })) as {
      outcome: { id: string; title: string };
    };
    expect(fetched.outcome.id).toBe(createdTodo.outcome.id);
    expect(fetched.outcome.title).toBe("整理采购订单待办");

    const planned = (await call("PlanOutcome", {
      outcomeId: createdTodo.outcome.id,
      mode: "advice",
      expectedRevision: 1,
      clientRequestId: requestId(),
    })) as { outcome: { id: string }; turn: { planMode: string; status: string } };
    expect(planned.outcome.id).toBe(createdTodo.outcome.id);
    expect(planned.turn).toMatchObject({ planMode: "advice", status: "queued" });
  });
});
