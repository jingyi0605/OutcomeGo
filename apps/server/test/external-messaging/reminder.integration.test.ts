import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ExternalDeliveryService } from "../../src/services/external-messaging/delivery";
import { ExternalInboundMessageService } from "../../src/services/external-messaging/inbound";
import { ExternalReminderService, isRenewalReply, localTime, REMINDER_TEXT } from "../../src/services/external-messaging/reminder";
import { createHarness, databaseUrl, entry, message, structured, type Harness } from "./fixtures";
import type { CallHostTool } from "../../src/services/external-messaging/poller";

describe("renewal replies", () => {
  test.each(["1", " 1 ", "１", "。", "👍", "11", "ok", "OK", "好", "好的", "收到", "[微笑]", "", "   ", "你好", "hi", "是", "不用", "ab", "嗯嗯", "okay", "1.。!"])("%j is only an acknowledgement", (text) => {
    expect(isRenewalReply(text)).toBe(true);
  });
  test.each(["hello", "查一下天气", "12345", "yes please", "好的，帮我查一下", "1 2 3 4 5", "你好吗", "abc", "[a b]", "是的，谢谢"])("%j is a real message", (text) => {
    expect(isRenewalReply(text)).toBe(false);
  });
});

describe("local time", () => {
  test("uses the user's zone for the date and the minutes", () => {
    const at = new Date("2026-11-16T15:30:00Z");
    expect(localTime(at, "Asia/Shanghai")).toEqual({ date: "2026-11-16", minutes: 23 * 60 + 30 });
    expect(localTime(at, "America/Los_Angeles")).toEqual({ date: "2026-11-16", minutes: 7 * 60 + 30 });
    expect(localTime(new Date("2026-11-16T17:00:00Z"), "Asia/Shanghai").date).toBe("2026-11-17");
    expect(localTime(at, "Not/AZone")).toEqual(localTime(at, "UTC"));
  });
});

describe.skipIf(!databaseUrl)("daily reminder", () => {
  let h: Harness;
  let inbound: ExternalInboundMessageService;
  beforeAll(async () => {
    h = await createHarness();
    inbound = new ExternalInboundMessageService({
      prisma: h.prisma, messaging: h.messaging, assets: h.assets, exchange: h.exchange,
      computerFetch: async () => new Response("{}"), interruptRun: async () => {},
    });
  });
  afterAll(() => h.cleanup());
  // Every pass looks at all switched-on bindings, so each test starts with the earlier ones off.
  beforeEach(async () => {
    await h.prisma.externalMessagingBinding.updateMany({ where: { botId: { in: h.bots } }, data: { reminderEnabled: false } });
  });

  const ZONE = "Asia/Shanghai";
  /** 20:30 on 16 November in the zone above. */
  const EVENING = new Date("2026-11-16T12:30:00Z");

  const setup = async (options: { reminder?: boolean; time?: string } = {}) => {
    const bot = await h.bot();
    const connection = await h.connection({ replyWindow: true });
    const binding = await h.bind(connection.id, bot.id, { reminderEnabled: options.reminder !== false, reminderTime: options.time ?? "20:00" });
    const context = { binding: { id: binding.id, botId: bot.id, connectionId: connection.id }, platform: "chat", platformLabel: "Chat" };
    // The owner wrote once, long enough ago to be "not today".
    const first = await inbound.accept(context, entry(message({ providerMessageId: `first-${crypto.randomUUID()}`, text: "hello" })));
    if (first.status !== "accepted") throw new Error("setup failed");
    const mapping = await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: connection.id } });
    await h.prisma.externalChannelMapping.update({ where: { id: mapping.id }, data: { lastInboundAt: new Date("2026-11-15T09:00:00Z") } });
    return { bot, connection, binding, context, mapping };
  };
  const connector = (behaviour: () => unknown = () => structured({ status: "sent", providerMessageIds: ["1"] })) => {
    const calls: Array<Record<string, unknown>> = [];
    const callHostTool: CallHostTool = async (_c, _t, args) => {
      calls.push(args);
      const value = behaviour();
      if (value instanceof Error) throw value;
      return value;
    };
    return { calls, callHostTool };
  };
  const reminders = (tool: CallHostTool, at: Date = EVENING) => {
    const delivery = new ExternalDeliveryService({ prisma: h.prisma, messaging: h.messaging, assets: h.assets, exchange: h.exchange as never, callHostTool: tool, instanceId: "test" });
    return new ExternalReminderService({ prisma: h.prisma, delivery, timeZone: async () => ZONE, now: () => at });
  };
  const binding = (id: string) => h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id } });
  const notices = (botId: string) => h.prisma.channelMessage.findMany({ where: { senderBotId: botId, metadata: { path: ["externalNotice"], equals: "reminder" } } });

  test("at the chosen time, with nothing written today, one reminder goes to the contact and is recorded", async () => {
    const s = await setup();
    const c = connector();
    expect(await reminders(c.callHostTool).tick()).toBe(1);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ peerId: "peer-1", text: REMINDER_TEXT });
    const recorded = await notices(s.bot.id);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.metadata).toMatchObject({ externalDelivery: { status: "sent" } });
    expect(await binding(s.binding.id)).toMatchObject({ lastReminderOn: "2026-11-16", lastReminderOutcome: "sent" });
  });

  test("it is sent once a day, however often it is checked, and the next day again", async () => {
    const s = await setup();
    const c = connector();
    const service = reminders(c.callHostTool);
    await service.tick();
    await service.tick();
    await reminders(c.callHostTool, new Date("2026-11-16T13:30:00Z")).tick();
    expect(c.calls).toHaveLength(1);
    await reminders(c.callHostTool, new Date("2026-11-17T12:30:00Z")).tick();
    expect(c.calls).toHaveLength(2);
    expect((await binding(s.binding.id)).lastReminderOn).toBe("2026-11-17");
  });

  test("two Servers checking at once send one", async () => {
    await setup();
    const c = connector();
    await Promise.all([reminders(c.callHostTool).tick(), reminders(c.callHostTool).tick(), reminders(c.callHostTool).tick()]);
    expect(c.calls).toHaveLength(1);
  });

  test("nothing is sent when the person already wrote today", async () => {
    const s = await setup();
    await h.prisma.externalChannelMapping.update({ where: { id: s.mapping.id }, data: { lastInboundAt: new Date("2026-11-16T03:00:00Z") } });
    const c = connector();
    expect(await reminders(c.callHostTool).tick()).toBe(0);
    expect(c.calls).toEqual([]);
    expect((await binding(s.binding.id)).lastReminderOn).toBeNull();
  });

  test("nothing is sent before the time, long after it, or when the switch is off", async () => {
    const due = await setup({ time: "20:00" });
    const early = await setup({ time: "21:00" });
    const late = await setup({ time: "08:00" });
    const off = await setup({ reminder: false });
    const c = connector();
    await reminders(c.callHostTool).tick();
    // Only the one that is due got it: 21:00 has not come, 08:00 is long past, the last is switched off.
    expect(c.calls).toHaveLength(1);
    expect(await notices(due.bot.id)).toHaveLength(1);
    for (const s of [early, late, off]) expect(await notices(s.bot.id)).toHaveLength(0);
  });

  test("a platform with no reply window never gets one", async () => {
    const s = await setup();
    await h.prisma.pluginInstallation.updateMany({ where: { connections: { some: { id: s.connection.id } } }, data: { manifest: { key: "plain", name: "Chat", version: "1.0.0", skills: [], connections: [{ key: "chat", name: "Chat", transport: "stdio", auth: "none", endpoint: "", tools: [], persistentState: true, messaging: { platform: "chat", inbound: { pollTool: "chat_poll" }, outbound: { deliverTool: "chat_deliver", maxTextChars: 100 } } }] } as never } });
    const c = connector();
    expect(await reminders(c.callHostTool).tick()).toBe(0);
    expect(c.calls).toEqual([]);
  });

  test("a failed send is recorded and not tried again that day", async () => {
    const s = await setup();
    const c = connector(() => structured({ status: "failed", code: "chat_context_expired", message: "window closed" }));
    await reminders(c.callHostTool).tick();
    await reminders(c.callHostTool).tick();
    expect(c.calls).toHaveLength(1);
    expect(await binding(s.binding.id)).toMatchObject({ lastReminderOutcome: "failed" });
    expect((await notices(s.bot.id))[0]!.metadata).toMatchObject({ externalDelivery: { status: "failed", code: "chat_context_expired" } });
  });

  test("the reminder in the app chat is not an unread message", async () => {
    const s = await setup();
    await reminders(connector().callHostTool).tick();
    const { channelUnreadCounts } = await import("../../src/services/snapshot/message-queries");
    const home = await h.home(s.bot.id);
    expect((await channelUnreadCounts(h.prisma, [home])).get(home) ?? 0).toBe(0);
  });

  describe("the answer", () => {
    const remind = async () => {
      const s = await setup();
      await reminders(connector().callHostTool).tick();
      return s;
    };
    const userMessages = (s: Awaited<ReturnType<typeof setup>>) => h.prisma.channelMessage.count({ where: { sender: "user", externalReceipts: { some: { connectionId: s.connection.id } } } });
    const wakes = (s: Awaited<ReturnType<typeof setup>>) => h.prisma.inboxEvent.count({ where: { botId: s.bot.id, type: "user.message" } });

    test.each(["1", "。", "ok", "好的"])("%j after a reminder keeps the channel open and wakes nobody", async (text) => {
      const s = await remind();
      const before = { messages: await userMessages(s), wakes: await wakes(s) };
      const result = await inbound.accept(s.context, entry(message({ providerMessageId: `answer-${crypto.randomUUID()}`, text })));
      expect(result).toEqual({ status: "accepted", runId: null });
      expect({ messages: await userMessages(s), wakes: await wakes(s) }).toEqual(before);
      // It counts as the person having written: the reminder is answered.
      expect((await h.prisma.externalChannelMapping.findUniqueOrThrow({ where: { id: s.mapping.id } })).lastInboundAt!.getTime()).toBeGreaterThan(Date.parse("2026-11-16T00:00:00Z"));
    });

    test("a real message after a reminder is handled as usual", async () => {
      const s = await remind();
      const before = await wakes(s);
      const result = await inbound.accept(s.context, entry(message({ providerMessageId: `real-${crypto.randomUUID()}`, text: "what's on my calendar" })));
      expect(result.status).toBe("accepted");
      expect((result as { runId: string | null }).runId).not.toBeNull();
      expect(await wakes(s)).toBe(before + 1);
    });

    test("only the first answer is swallowed: a later '1' is an ordinary message", async () => {
      const s = await remind();
      await inbound.accept(s.context, entry(message({ providerMessageId: `a1-${crypto.randomUUID()}`, text: "1" })));
      const second = await inbound.accept(s.context, entry(message({ providerMessageId: `a2-${crypto.randomUUID()}`, text: "1" })));
      expect((second as { runId: string | null }).runId).not.toBeNull();
    });

    test("without a reminder waiting, '1' is an ordinary message", async () => {
      const s = await setup();
      const result = await inbound.accept(s.context, entry(message({ providerMessageId: `plain-${crypto.randomUUID()}`, text: "1" })));
      expect((result as { runId: string | null }).runId).not.toBeNull();
    });

    test("after a reminder that failed, '1' is an ordinary message", async () => {
      const s = await setup();
      await reminders(connector(() => structured({ status: "failed", code: "chat_context_expired", message: "x" })).callHostTool).tick();
      const result = await inbound.accept(s.context, entry(message({ providerMessageId: `after-fail-${crypto.randomUUID()}`, text: "1" })));
      expect((result as { runId: string | null }).runId).not.toBeNull();
    });

    test("a reminder from days ago is no longer being answered", async () => {
      const s = await remind();
      await h.prisma.externalMessagingBinding.update({ where: { id: s.binding.id }, data: { lastReminderAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });
      const result = await inbound.accept(s.context, entry(message({ providerMessageId: `old-${crypto.randomUUID()}`, text: "1" })));
      expect((result as { runId: string | null }).runId).not.toBeNull();
    });

    test("a picture is never taken for an acknowledgement", async () => {
      const s = await remind();
      const result = await inbound.accept(s.context, entry(message({ providerMessageId: `pic-${crypto.randomUUID()}`, text: "1", mediaFailures: [{ code: "chat_media_download_failed" }] })));
      expect((result as { runId: string | null }).runId).not.toBeNull();
    });

    test("a redelivery of the answer is a duplicate", async () => {
      const s = await remind();
      const answer = message({ providerMessageId: `dup-${crypto.randomUUID()}`, text: "1" });
      expect(await inbound.accept(s.context, entry(answer))).toEqual({ status: "accepted", runId: null });
      expect(await inbound.accept(s.context, entry(answer))).toEqual({ status: "duplicate" });
    });
  });
});
