import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ExternalInboundMessageService, type AcceptContext } from "../../src/services/external-messaging/inbound";
import { createHarness, databaseUrl, entry, hashOf, message, type Harness } from "./fixtures";

describe.skipIf(!databaseUrl)("inbound acceptance", () => {
  let h: Harness;
  let service: ExternalInboundMessageService;
  const interrupted: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
    service = new ExternalInboundMessageService({
      prisma: h.prisma,
      messaging: h.messaging,
      assets: h.assets,
      exchange: h.exchange,
      computerFetch: async () => new Response("{}"),
      interruptRun: async (runId) => void interrupted.push(runId),
    });
  });
  afterAll(() => h.cleanup());

  const setup = async () => {
    const bot = await h.bot();
    const connection = await h.connection();
    const binding = await h.bind(connection.id, bot.id);
    const context: AcceptContext = { binding: { id: binding.id, botId: bot.id, connectionId: connection.id }, platform: "chat", platformLabel: "Chat" };
    return { bot, connection, binding, context };
  };

  describe("a message from the owner", () => {
    test("creates the chat, the user message, the receipt and one Bot wake together", async () => {
      const { bot, connection, context } = await setup();
      const msg = message({ text: "what is the weather", peer: { id: "peer-1", type: "direct", displayName: "Alice" } });
      const result = await service.accept(context, entry(msg));
      if (result.status !== "accepted") throw new Error(`expected acceptance, got ${result.status}`);
      const runId = result.runId!;
      expect(runId).toMatch(/^[0-9a-f-]{36}$/);

      const mapping = await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: connection.id } });
      expect(mapping).toMatchObject({ botId: bot.id, peerId: "peer-1", platform: "chat", status: "active", displayName: "Alice", channelId: null });
      // The owner is talking to their Bot: no chat of its own is created, the message joins the Bot's.
      expect(await h.prisma.channel.count({ where: { kind: "external_dm", members: { some: { botId: bot.id } } } })).toBe(0);
      const home = await h.home(bot.id);

      const stored = await h.prisma.channelMessage.findMany({ where: { channelId: home } });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ sender: "user", content: "what is the weather" });
      const metadata = stored[0]!.metadata as { type: string; address: string; external: Record<string, unknown> };
      expect(metadata).toMatchObject({ type: "text", external: { platform: "chat", occurredAt: msg.occurredAt } });
      expect(metadata.address).toBeTruthy();

      const receipt = await h.prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: connection.id } });
      expect(receipt).toMatchObject({ status: "accepted", mappingId: mapping.id, channelMessageId: stored[0]!.id, runId, payloadHash: hashOf(msg) });

      // The Bot is woken as if the owner had typed it, and told where it came from.
      const wake = await h.prisma.inboxEvent.findFirstOrThrow({ where: { botId: bot.id, type: "user.message" } });
      const content = (wake.payload as { content: string }).content;
      expect(content).toContain(`[${metadata.address}]`);
      expect(content).toContain("what is the weather");
      expect(content).toContain("[Sent from Chat]");
      expect(wake.runId).toBe(runId);
      expect((await h.prisma.run.findUniqueOrThrow({ where: { id: wake.runId! } })).origin).toBe("user");
    });

    test("the same contact keeps one identity; other connections and Bots get their own, all in the Bot's chat", async () => {
      const { bot, connection, context } = await setup();
      await service.accept(context, entry(message({ providerMessageId: "a1" })));
      await service.accept(context, entry(message({ providerMessageId: "a2", text: "second" })));
      const own = await h.prisma.externalChannelMapping.findMany({ where: { connectionId: connection.id } });
      expect(own).toHaveLength(1);
      expect(await h.prisma.channelMessage.count({ where: { channelId: await h.home(bot.id), sender: "user" } })).toBe(2);

      // Same peer id on another connection: a separate conversation.
      const other = await h.connection();
      const otherBinding = await h.bind(other.id, bot.id);
      await service.accept({ binding: { id: otherBinding.id, botId: bot.id, connectionId: other.id }, platform: "chat", platformLabel: "Chat" }, entry(message({ providerMessageId: "a1" })));
      const mappings = await h.prisma.externalChannelMapping.findMany({ where: { botId: bot.id } });
      expect(new Set(mappings.map((mapping) => mapping.connectionId)).size).toBe(2);
      // Both accounts reach the one chat the owner already has with this Bot.
      expect(await h.prisma.channelMessage.count({ where: { channelId: await h.home(bot.id), sender: "user" } })).toBe(3);
    });

    test("the first messages of a new contact, arriving together, create one identity", async () => {
      const { bot, connection, context } = await setup();
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => service.accept(context, entry(message({ providerMessageId: `race-${i}`, text: `m${i}` })))));
      expect(results.every((result) => result.status === "accepted")).toBe(true);
      const mappings = await h.prisma.externalChannelMapping.findMany({ where: { connectionId: connection.id } });
      expect(mappings).toHaveLength(1);
      expect(await h.prisma.channelMessage.count({ where: { channelId: await h.home(bot.id), sender: "user" } })).toBe(6);
      expect(await h.prisma.externalMessageReceipt.count({ where: { connectionId: connection.id } })).toBe(6);
    });
  });

  describe("redelivery", () => {
    test("the same message again is a duplicate and adds nothing", async () => {
      const { connection, context } = await setup();
      const msg = message({ providerMessageId: "once" });
      expect((await service.accept(context, entry(msg))).status).toBe("accepted");
      expect(await service.accept(context, entry(msg))).toEqual({ status: "duplicate" });
      // A redelivery that only differs in things the hash ignores is still a duplicate.
      expect((await service.accept(context, entry({ ...msg, peer: { ...msg.peer, displayName: "Renamed" }, providerMetadata: { x: 1 } }))).status).toBe("duplicate");
      expect(await h.prisma.channelMessage.count({ where: { sender: "user", externalReceipts: { some: { connectionId: connection.id } } } })).toBe(1);
      expect(await h.prisma.inboxEvent.count({ where: { type: "user.message", run: { externalReceipts: { some: { connectionId: connection.id } } } } })).toBe(1);
    });

    test("concurrent redeliveries create one message and one wake", async () => {
      const { connection, context } = await setup();
      const msg = message({ providerMessageId: "storm" });
      const results = await Promise.all(Array.from({ length: 8 }, () => service.accept(context, entry(msg))));
      expect(results.filter((result) => result.status === "accepted")).toHaveLength(1);
      expect(results.filter((result) => result.status === "duplicate")).toHaveLength(7);
      expect(await h.prisma.externalMessageReceipt.count({ where: { connectionId: connection.id } })).toBe(1);
      expect(await h.prisma.channelMessage.count({ where: { externalReceipts: { some: { connectionId: connection.id } } } })).toBe(1);
    });

    test("the same id with different content is a conflict; the first message stands", async () => {
      const { binding, connection, context } = await setup();
      const first = message({ providerMessageId: "same-id", text: "original" });
      await service.accept(context, entry(first));
      const second = await service.accept(context, entry({ ...first, text: "tampered" }));
      expect(second).toEqual({ status: "rejected", code: "external_message_conflict" });
      const receipt = await h.prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: connection.id } });
      expect(receipt).toMatchObject({ status: "accepted", payloadHash: hashOf(first) });
      expect((await h.prisma.channelMessage.findFirstOrThrow({ where: { externalReceipts: { some: { connectionId: connection.id } } } })).content).toBe("original");
      expect(((await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } })).rejectedCounts as Record<string, number>).external_message_conflict).toBe(1);
    });
  });

  describe("who may speak", () => {
    test("someone who is not the account owner is refused, with nothing stored but the refusal", async () => {
      const { binding, connection, context } = await setup();
      const stranger = message({ providerMessageId: "stranger", text: "secret words", sender: { id: "peer-2", isAccountOwner: false } });
      expect(await service.accept(context, entry(stranger))).toEqual({ status: "rejected", code: "external_sender_not_allowed" });
      const receipt = await h.prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: connection.id } });
      expect(receipt).toMatchObject({ status: "rejected", rejectionCode: "external_sender_not_allowed" });
      // Nothing of the text survives, and no chat, message or wake exists.
      expect(JSON.stringify(receipt)).not.toContain("secret words");
      expect(await h.prisma.externalChannelMapping.count({ where: { connectionId: connection.id } })).toBe(0);
      expect(await h.prisma.inboxEvent.count({ where: { botId: context.binding.botId } })).toBe(0);
      expect(((await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } })).rejectedCounts as Record<string, number>).external_sender_not_allowed).toBe(1);
    });

    test("group and channel peers are refused", async () => {
      const { connection, context } = await setup();
      for (const type of ["group", "channel"] as const)
        expect(await service.accept(context, entry(message({ providerMessageId: `t-${type}`, peer: { id: "room", type } })))).toEqual({ status: "rejected", code: "external_peer_type_unsupported" });
      expect(await h.prisma.externalChannelMapping.count({ where: { connectionId: connection.id } })).toBe(0);
    });

    test("a refused message redelivered is a duplicate, not refused and counted again", async () => {
      const { context } = await setup();
      const stranger = entry(message({ providerMessageId: "again", sender: { id: "x", isAccountOwner: false } }));
      expect((await service.accept(context, stranger)).status).toBe("rejected");
      expect((await service.accept(context, stranger)).status).toBe("rejected");
    });
  });

  describe("malformed messages", () => {
    test("a message that failed validation is refused and recorded by id and hash only", async () => {
      const { connection, context } = await setup();
      const result = await service.accept(context, { ackCursor: "q:1", invalid: { code: "external_message_too_large", providerMessageId: "big-1", payloadHash: "a".repeat(64) } });
      expect(result).toEqual({ status: "rejected", code: "external_message_too_large" });
      expect(await h.prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: connection.id, providerMessageId: "big-1" } })).toMatchObject({ status: "rejected", rejectionCode: "external_message_too_large", payloadHash: "a".repeat(64) });
    });

    test("one with no usable id is only counted", async () => {
      const { binding, connection, context } = await setup();
      expect((await service.accept(context, { ackCursor: "q:2", invalid: { code: "external_message_invalid", payloadHash: "b".repeat(64) } })).status).toBe("rejected");
      expect(await h.prisma.externalMessageReceipt.count({ where: { connectionId: connection.id } })).toBe(0);
      expect(((await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } })).rejectedCounts as Record<string, number>).external_message_invalid).toBe(1);
    });

    test("a message with no text, files or notes is refused", async () => {
      const { context } = await setup();
      expect(await service.accept(context, entry(message({ text: "  " })))).toEqual({ status: "rejected", code: "external_message_invalid" });
    });

    test("control characters never reach the Bot", async () => {
      const { connection, context } = await setup();
      await service.accept(context, entry({ ...message({ providerMessageId: "ctl" }), text: "a\u0000b\u0007c\nd" }));
      const stored = await h.prisma.channelMessage.findFirstOrThrow({ where: { externalReceipts: { some: { connectionId: connection.id } } } });
      expect(stored.content).toBe("abc\nd");
    });
  });

  describe("when it cannot be accepted yet", () => {
    test("an archived contact refuses new messages and keeps its history", async () => {
      const { bot, connection, context } = await setup();
      await service.accept(context, entry(message({ providerMessageId: "before" })));
      const mapping = await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: connection.id } });
      await h.prisma.externalChannelMapping.update({ where: { id: mapping.id }, data: { status: "archived" } });
      expect(await service.accept(context, entry(message({ providerMessageId: "after" })))).toEqual({ status: "rejected", code: "external_channel_unavailable" });
      expect(await h.prisma.channelMessage.count({ where: { channelId: await h.home(bot.id), sender: "user" } })).toBe(1);
      expect(await h.prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: connection.id, providerMessageId: "after" } })).toMatchObject({ status: "rejected", rejectionCode: "external_channel_unavailable" });
    });

    test("a contact from the earlier one-chat-each design is moved to the Bot's chat and the old chat is archived", async () => {
      const { bot, connection, context } = await setup();
      const legacy = await h.prisma.channel.create({ data: { kind: "external_dm", directKey: `external:${crypto.randomUUID()}`, name: "Old", members: { create: { botId: bot.id, ordinal: 0 } } } });
      await h.prisma.externalChannelMapping.create({ data: { connectionId: connection.id, botId: bot.id, peerId: "peer-1", platform: "chat", channelId: legacy.id } });
      expect((await service.accept(context, entry(message({ providerMessageId: "new-design" })))).status).toBe("accepted");
      expect((await h.prisma.channel.findUniqueOrThrow({ where: { id: legacy.id } })).archivedAt).not.toBeNull();
      expect((await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: connection.id } })).channelId).toBeNull();
      expect(await h.prisma.channelMessage.count({ where: { channelId: legacy.id } })).toBe(0);
      expect(await h.prisma.channelMessage.count({ where: { channelId: await h.home(bot.id), sender: "user" } })).toBe(1);
    });

    test("a Bot that is archived pauses the binding without writing anything", async () => {
      const { bot, binding, connection, context } = await setup();
      await h.prisma.bot.update({ where: { id: bot.id }, data: { status: "archived" } });
      expect(await service.accept(context, entry(message()))).toEqual({ status: "retry", code: "external_target_unavailable", targetUnavailable: true });
      expect(await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } })).toMatchObject({ status: "needs_attention", lastErrorCode: "external_target_unavailable" });
      expect(await h.prisma.externalMessageReceipt.count({ where: { connectionId: connection.id } })).toBe(0);
      expect(await h.prisma.externalChannelMapping.count({ where: { connectionId: connection.id } })).toBe(0);
      expect(await h.prisma.inboxEvent.count({ where: { botId: bot.id } })).toBe(0);
    });

    test("a failure inside the transaction leaves no receipt, chat, message or wake, and a retry then succeeds", async () => {
      const { bot, connection, context } = await setup();
      const original = h.messaging.scheduleTranscriptProjection.bind(h.messaging);
      let calls = 0;
      h.messaging.scheduleTranscriptProjection = (async (...args: Parameters<typeof original>) => {
        if (++calls === 1) throw new Error("injected crash after the message was written");
        return original(...args);
      }) as typeof original;
      try {
        const msg = message({ providerMessageId: "crashy" });
        expect(await service.accept(context, entry(msg))).toMatchObject({ status: "retry", targetUnavailable: false });
        expect(await h.prisma.externalMessageReceipt.count({ where: { connectionId: connection.id } })).toBe(0);
        expect(await h.prisma.externalChannelMapping.count({ where: { connectionId: connection.id } })).toBe(0);
        expect(await h.prisma.channel.count({ where: { kind: "external_dm", members: { some: { botId: bot.id } } } })).toBe(0);
        expect(await h.prisma.inboxEvent.count({ where: { botId: bot.id } })).toBe(0);
        // The next attempt, as the poller would make, accepts it exactly once.
        expect((await service.accept(context, entry(msg))).status).toBe("accepted");
        expect(await h.prisma.channelMessage.count({ where: { externalReceipts: { some: { connectionId: connection.id } } } })).toBe(1);
      } finally {
        h.messaging.scheduleTranscriptProjection = original;
      }
    });

    test("a typed message supersedes the turn in progress, like typing in the app", async () => {
      const { bot, context } = await setup();
      await service.accept(context, entry(message({ providerMessageId: "first" })));
      const run = await h.prisma.inboxEvent.findFirstOrThrow({ where: { botId: bot.id }, select: { runId: true } });
      await h.prisma.run.update({ where: { id: run.runId! }, data: { status: "running" } });
      // The Bot is mid-turn: it holds the foreground lease on that run.
      await h.prisma.botRunLease.create({ data: { botId: bot.id, scope: "foreground", runId: run.runId!, ownerId: "test-worker", expiresAt: new Date(Date.now() + 60_000) } });
      interrupted.length = 0;
      const second = await service.accept(context, entry(message({ providerMessageId: "second", text: "never mind, do this instead" })));
      await Bun.sleep(50);
      expect(second.status).toBe("accepted");
      // The running turn is cancelled so the new message runs as a fresh turn.
      expect(interrupted).toEqual([run.runId!]);
    });
  });
});
