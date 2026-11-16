import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { assertMessagingBound, ExternalMessagingBindingService } from "../../src/services/external-messaging/binding";
import { createHarness, databaseUrl, type Harness } from "./fixtures";

describe.skipIf(!databaseUrl)("messaging binding", () => {
  let h: Harness;
  let service: ExternalMessagingBindingService;
  beforeAll(async () => {
    h = await createHarness();
    service = new ExternalMessagingBindingService(h.prisma);
  });
  afterAll(() => h.cleanup());

  test("a connection with no binding reports support and an empty binding", async () => {
    const connection = await h.connection({ platform: "wechat" });
    expect(await service.get(connection.id)).toEqual({ supported: true, replyWindowHours: null, platform: "wechat", binding: null });
  });

  test("a connector without messaging reports it is unsupported and cannot be bound", async () => {
    const connection = await h.connection({ messaging: false });
    const bot = await h.bot();
    expect(await service.get(connection.id)).toEqual({ supported: false, replyWindowHours: null, platform: null, binding: null });
    await expect(service.put(connection.id, { enabled: true, botId: bot.id })).rejects.toMatchObject({ code: "external_messaging_unsupported" });
    expect(await h.prisma.externalMessagingBinding.count({ where: { connectionId: connection.id } })).toBe(0);
  });

  describe("linking requires a Bot", () => {
    const load = (id: string) => h.prisma.pluginConnection.findUniqueOrThrow({ where: { id }, include: { installation: true } });

    test("a messaging account cannot be connected before it has a Bot", async () => {
      const connection = await h.connection({ platform: "wechat" });
      await expect(assertMessagingBound(h.prisma, await load(connection.id))).rejects.toMatchObject({ status: 409, code: "external_binding_required" });
    });

    test("once a Bot is chosen the account may be connected", async () => {
      const connection = await h.connection({ platform: "wechat" });
      const bot = await h.bot();
      await service.put(connection.id, { enabled: true, botId: bot.id });
      await expect(assertMessagingBound(h.prisma, await load(connection.id))).resolves.toBeUndefined();
    });

    test("a connector without messaging is not asked for a Bot", async () => {
      const connection = await h.connection({ messaging: false });
      await expect(assertMessagingBound(h.prisma, await load(connection.id))).resolves.toBeUndefined();
    });
  });

  describe("daily reminder setting", () => {
    test("a platform with a reply window offers it, and it is saved with the Bot", async () => {
      const connection = await h.connection({ replyWindow: true });
      const bot = await h.bot();
      expect((await service.get(connection.id)).replyWindowHours).toBe(24);
      const saved = await service.put(connection.id, { enabled: true, botId: bot.id, reminder: { enabled: true, time: "21:30" } });
      expect(saved.binding!.reminder).toMatchObject({ enabled: true, time: "21:30", lastSentAt: null, lastOutcome: null });
      // Saving again without the setting leaves it as it was.
      expect((await service.put(connection.id, { enabled: true, botId: bot.id })).binding!.reminder).toMatchObject({ enabled: true, time: "21:30" });
    });

    test("a platform without a reply window refuses it", async () => {
      const connection = await h.connection();
      const bot = await h.bot();
      await expect(service.put(connection.id, { enabled: true, botId: bot.id, reminder: { enabled: true, time: "20:00" } })).rejects.toMatchObject({ code: "external_reminder_unsupported" });
      expect(await h.prisma.externalMessagingBinding.count({ where: { connectionId: connection.id } })).toBe(0);
    });

    test.each(["25:00", "7:30", "20:60", "evening"])("the time %s is refused", async (time) => {
      const connection = await h.connection({ replyWindow: true });
      const bot = await h.bot();
      await expect(service.put(connection.id, { enabled: true, botId: bot.id, reminder: { enabled: true, time } })).rejects.toMatchObject({ code: "external_reminder_time_invalid" });
    });
  });

  test("an unknown connection is not found", async () => {
    await expect(service.get(crypto.randomUUID())).rejects.toMatchObject({ code: "plugin_connection_unavailable" });
  });

  test("binding stores one entry per connection and shows only diagnostics", async () => {
    const connection = await h.connection();
    const bot = await h.bot();
    const view = await service.put(connection.id, { enabled: true, botId: bot.id });
    expect(view.binding).toEqual({
      enabled: true, botId: bot.id, inboundPolicy: "owner_only", status: "active",
      lastPolledAt: null, lastAcceptedAt: null, lastErrorCode: null, lastErrorAt: null, consecutiveFailures: 0, rejectedCounts: {}, reminder: { enabled: false, time: "20:00", lastSentAt: null, lastOutcome: null },
    });
    // Saving again edits the same entry.
    await service.put(connection.id, { enabled: false, botId: bot.id });
    expect(await h.prisma.externalMessagingBinding.count({ where: { connectionId: connection.id } })).toBe(1);
    expect((await service.get(connection.id)).binding!.enabled).toBe(false);
    // Nothing internal leaks: no cursor, lease or retry bookkeeping.
    expect(Object.keys((await service.get(connection.id)).binding!).sort()).toEqual(
      ["botId", "consecutiveFailures", "enabled", "inboundPolicy", "lastAcceptedAt", "lastErrorAt", "lastErrorCode", "lastPolledAt", "rejectedCounts", "reminder", "status"]
    );
  });

  test.each([
    ["a Bot that does not exist", async () => crypto.randomUUID()],
    ["an archived Bot", async () => (await h.bot({ status: "archived" })).id],
  ])("%s cannot be the target", async (_label, pick) => {
    const connection = await h.connection();
    await expect(service.put(connection.id, { enabled: true, botId: await pick() })).rejects.toMatchObject({ code: "external_target_unavailable" });
    expect(await h.prisma.externalMessagingBinding.count({ where: { connectionId: connection.id } })).toBe(0);
  });

  test("a subagent identity cannot be the target", async () => {
    const connection = await h.connection();
    const parent = await h.bot();
    const child = await h.bot();
    const channel = { id: await h.home(parent.id) };
    const run = await h.prisma.run.create({ data: { botId: parent.id, conversationId: parent.conversationId, channelId: channel.id, userMessageId: crypto.randomUUID(), status: "running" } });
    await h.prisma.subagent.create({
      data: { parentBotId: parent.id, childBotId: child.id, parentRunId: run.id, parentChannelId: channel.id, launchCallId: crypto.randomUUID(), description: "d", prompt: "p", subagentType: "general", outputPath: "/tmp/subagent-output" },
    });
    // The fixture really made a subagent, so the refusal below is the rule and not a skipped branch.
    expect(await h.prisma.subagent.count({ where: { childBotId: child.id } })).toBe(1);
    await expect(service.put(connection.id, { enabled: true, botId: child.id })).rejects.toMatchObject({ code: "external_target_unavailable" });
    expect(await h.prisma.externalMessagingBinding.count({ where: { connectionId: connection.id } })).toBe(0);
  });

  test("moving to another Bot keeps the cursor, clears the pause and the failure record", async () => {
    const connection = await h.connection();
    const first = await h.bot();
    const second = await h.bot();
    await h.prisma.externalMessagingBinding.create({
      data: { connectionId: connection.id, botId: first.id, status: "needs_attention", inboundCursor: "q:41", retryAckCursor: "q:42", retryCount: 7, retryFirstAt: new Date(), consecutiveFailures: 5, lastErrorCode: "external_target_unavailable", lastErrorAt: new Date() },
    });
    const view = await service.put(connection.id, { enabled: true, botId: second.id });
    expect(view.binding).toMatchObject({ botId: second.id, status: "active", consecutiveFailures: 0, lastErrorCode: null });
    expect(await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { connectionId: connection.id } })).toMatchObject({ inboundCursor: "q:41", retryAckCursor: null, retryCount: 0, retryFirstAt: null });
  });

  test("the earlier Bot's conversation is kept as history when the target changes", async () => {
    const connection = await h.connection();
    const first = await h.bot();
    const second = await h.bot();
    const channel = await h.prisma.channel.create({ data: { kind: "external_dm", directKey: `external:${crypto.randomUUID()}`, name: "old", members: { create: { botId: first.id, ordinal: 0 } } } });
    await h.prisma.externalChannelMapping.create({ data: { connectionId: connection.id, botId: first.id, peerId: "p", platform: "chat", channelId: channel.id } });
    await service.put(connection.id, { enabled: true, botId: first.id });
    await service.put(connection.id, { enabled: true, botId: second.id });
    expect(await h.prisma.externalChannelMapping.count({ where: { connectionId: connection.id, botId: first.id } })).toBe(1);
    expect((await h.prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).archivedAt).toBeNull();
  });

  test("deleting the binding leaves conversations and their messages alone", async () => {
    const connection = await h.connection();
    const bot = await h.bot();
    const channel = await h.prisma.channel.create({ data: { kind: "external_dm", directKey: `external:${crypto.randomUUID()}`, name: "keep", members: { create: { botId: bot.id, ordinal: 0 } } } });
    await h.prisma.externalChannelMapping.create({ data: { connectionId: connection.id, botId: bot.id, peerId: "p", platform: "chat", channelId: channel.id } });
    await service.put(connection.id, { enabled: true, botId: bot.id });
    await service.delete(connection.id);
    expect(await h.prisma.externalMessagingBinding.count({ where: { connectionId: connection.id } })).toBe(0);
    expect(await h.prisma.externalChannelMapping.count({ where: { connectionId: connection.id } })).toBe(1);
    // Deleting twice is harmless.
    await service.delete(connection.id);
  });
});
