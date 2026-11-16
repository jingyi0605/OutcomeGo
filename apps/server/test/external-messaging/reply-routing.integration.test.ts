import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { renderControlResult } from "@outcomego/contracts/tool-results";
import { ExternalDeliveryService } from "../../src/services/external-messaging/delivery";
import { ExternalInboundMessageService } from "../../src/services/external-messaging/inbound";
import type { CallHostTool } from "../../src/services/external-messaging/poller";
import { InternalToolService } from "../../src/services/internal-tool-service";
import { createHarness, databaseUrl, entry, message, structured, type Harness } from "./fixtures";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe.skipIf(!databaseUrl)("SendToUser from and to an external chat", () => {
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

  const world = async (platform = `p${crypto.randomUUID().slice(0, 6)}`) => {
    const bot = await h.bot();
    const connection = await h.connection({ platform });
    const binding = await h.bind(connection.id, bot.id);
    // The Bot's own chat in the app, where cards and requests belong.
    const dm = await h.prisma.channel.create({ data: { kind: "bot_dm", directKey: `bot:${bot.id}`, name: "home", members: { create: { botId: bot.id, ordinal: 0 } } } });
    const accepted = await inbound.accept({ binding: { id: binding.id, botId: bot.id, connectionId: connection.id }, platform, platformLabel: "Chat" }, entry(message()));
    if (accepted.status !== "accepted") throw new Error("setup failed");
    const mapping = await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: connection.id } });
    // Tools only run inside a turn that is in progress.
    await h.prisma.run.update({ where: { id: accepted.runId! }, data: { status: "running" } });
    const homeRun = await h.prisma.run.create({ data: { botId: bot.id, conversationId: bot.conversationId, channelId: dm.id, userMessageId: crypto.randomUUID(), status: "running" } });
    return { bot, connection, binding, dm, mapping, platform, externalRunId: accepted.runId!, homeRunId: homeRun.id };
  };
  type World = Awaited<ReturnType<typeof world>>;

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
  const wakes: string[] = [];
  const tools = (callHostTool: CallHostTool, fallback?: () => Promise<unknown>) => {
    const delivery = new ExternalDeliveryService({ prisma: h.prisma, messaging: h.messaging, assets: h.assets, exchange: h.exchange as never, callHostTool, instanceId: "test" });
    const legacy = { deliverConnectedChannel: fallback ?? (async () => { throw new Error("the older connector path must not be used"); }) };
    const messaging = Object.assign(Object.create(h.messaging), { enqueueChannelDeliveryFailure: async () => (wakes.push("recovery-wake"), "recovery-run") });
    return new InternalToolService(h.prisma, messaging as never, {} as never, async () => {}, {} as never, {} as never, {} as never, legacy as never, undefined, undefined, undefined, undefined, delivery);
  };
  /** Runs the tool; a failure is thrown as the original error so its `code` can be checked. */
  const send = async (service: InternalToolService, w: World, args: Record<string, unknown>, from: "external" | "home" = "external", callId = crypto.randomUUID()) => {
    const exit = await Effect.runPromiseExit(service.execute({
      runId: from === "external" ? w.externalRunId : w.homeRunId, botId: w.bot.id, conversationId: w.bot.conversationId,
      channelId: from === "external" ? w.mapping.channelId : w.dm.id, deliveryId: null, tool: "SendToUser", arguments: args, callId,
    } as never));
    if (Exit.isSuccess(exit)) return exit.value as Record<string, any>;
    throw Cause.squash(exit.cause);
  };
  const agentMessages = (channelId: string) => h.prisma.channelMessage.findMany({ where: { channelId, sender: "agent" }, orderBy: { sequence: "asc" } });

  describe("replying in the external chat", () => {
    test("plain text goes to the contact, and the Bot is told it was accepted", async () => {
      const w = await world();
      const c = connector();
      const result = await send(tools(c.callHostTool), w, { type: "text", content: "on it" });
      expect(result).toMatchObject({ sent: true, external: { platform: w.platform, status: "sent" } });
      expect(result.delivery_failed).toBeUndefined();
      expect(c.calls).toEqual([{ deliveryId: result.external.id, peerId: "peer-1", text: "on it" }]);
      expect((await agentMessages(w.mapping.channelId)).map((m) => m.content)).toEqual(["on it"]);
      expect(renderControlResult("SendToUser", result, { type: "text" })).toContain(`Message accepted by ${w.platform}`);
    });

    test("a failed send is reported as failed, not sent, and starts no recovery wake", async () => {
      const w = await world();
      wakes.length = 0;
      const c = connector(() => structured({ status: "failed", code: "chat_context_expired", message: "closed" }));
      const result = await send(tools(c.callHostTool), w, { type: "text", content: "too late" });
      expect(result).toMatchObject({ sent: false, delivery_failed: true, external: { status: "failed", reason: "chat_context_expired" } });
      expect(wakes).toEqual([]);
      expect(await h.prisma.inboxEvent.count({ where: { botId: w.bot.id, type: "channel.delivery_failed" } })).toBe(0);
      const rendered = renderControlResult("SendToUser", result, { type: "text" });
      expect(rendered).toContain("was not sent (chat_context_expired)");
      expect(rendered).not.toContain("accepted");
    });

    test("an unknown result tells the Bot not to send it again", async () => {
      const w = await world();
      const c = connector(() => new Error("connection reset"));
      const result = await send(tools(c.callHostTool), w, { type: "text", content: "maybe" });
      expect(result).toMatchObject({ sent: false, delivery_failed: true, external: { status: "uncertain" } });
      expect(renderControlResult("SendToUser", result, { type: "text" })).toContain("Do not send it again");
    });

    test("the same call again returns the earlier answer without sending", async () => {
      const w = await world();
      const c = connector();
      const service = tools(c.callHostTool);
      const callId = crypto.randomUUID();
      const first = await send(service, w, { type: "text", content: "once" }, "external", callId);
      const again = await send(service, w, { type: "text", content: "once" }, "external", callId);
      expect(again.external.id).toBe(first.external.id);
      expect(c.calls).toHaveLength(1);
      expect(await agentMessages(w.mapping.channelId)).toHaveLength(1);
    });

    test("a picture goes out as a file", async () => {
      const w = await world();
      const c = connector();
      // Attachments are files on the Bot's computer, named by a file:// address.
      const file = `${h.root}/chart-${crypto.randomUUID().slice(0, 6)}.png`;
      await Bun.write(file, PNG);
      const result = await send(tools(c.callHostTool), w, { type: "attachment", url: `file://${file}`, alt: "chart" });
      expect(result.external.status).toBe("sent");
      expect(c.calls[0]).toMatchObject({ text: "chart", media: [{ mimeType: "image/png" }] });
    });

    test.each(["widget", "secret-request"])(
      "%s without to: \"dm\" is refused, tells the Bot where to send it, and writes nothing",
      async (type) => {
        const w = await world();
        const c = connector();
        const before = (await agentMessages(w.mapping.channelId)).length;
        const args: Record<string, unknown> = type === "widget"
          ? { type, widget: { prompt: "ok?", options: [{ label: "Yes" }, { label: "No" }] } }
          : { type, secret: { name: "API_KEY", label: "Key" } };
        await expect(send(tools(c.callHostTool), w, args)).rejects.toMatchObject({ code: "external_channel_type_unsupported" });
        expect((await agentMessages(w.mapping.channelId)).length).toBe(before);
        expect(c.calls).toEqual([]);
        expect(await h.prisma.externalOutboundDelivery.count({ where: { botId: w.bot.id } })).toBe(0);
      }
    );
  });

  describe("to: \"dm\"", () => {
    test("text goes to the Bot's chat in the app and nowhere outside", async () => {
      const w = await world();
      const c = connector();
      const result = await send(tools(c.callHostTool), w, { type: "text", content: "for your eyes only", to: "dm" });
      expect(result.sent).toBe(true);
      expect(result.external).toBeUndefined();
      expect((await agentMessages(w.dm.id)).map((m) => m.content)).toEqual(["for your eyes only"]);
      expect(await agentMessages(w.mapping.channelId)).toHaveLength(0);
      expect(c.calls).toEqual([]);
      expect(await h.prisma.externalOutboundDelivery.count({ where: { botId: w.bot.id } })).toBe(0);
    });

    test("a card is allowed there, unlike from a group", async () => {
      const w = await world();
      const result = await send(tools(connector().callHostTool), w, { type: "widget", widget: { prompt: "Which one?", options: [{ label: "A" }, { label: "B" }] }, to: "dm" });
      expect(result.sent).toBe(true);
      const cards = await agentMessages(w.dm.id);
      expect(cards).toHaveLength(1);
      expect(cards[0]!.metadata).toMatchObject({ type: "widget" });
    });

    test("a secret request is checked against the Bot's own chat, not the external one", async () => {
      const w = await world();
      const result = await send(tools(connector().callHostTool), w, { type: "secret-request", secret: { name: "API_KEY", label: "API key" }, to: "dm" });
      expect(result.sent).toBe(true);
      expect((await agentMessages(w.dm.id))[0]!.metadata).toMatchObject({ type: "secret-request" });
      expect(await agentMessages(w.mapping.channelId)).toHaveLength(0);
    });

    test("without a chat of its own in the app there is nowhere to put it", async () => {
      const w = await world();
      await h.prisma.channel.update({ where: { id: w.dm.id }, data: { archivedAt: new Date() } });
      await expect(send(tools(connector().callHostTool), w, { type: "text", content: "x", to: "dm" })).rejects.toThrow();
      expect(await agentMessages(w.mapping.channelId)).toHaveLength(0);
    });
  });

  describe("an explicit address", () => {
    test("platform:peer from the app chat reaches the contact through the same service", async () => {
      const w = await world();
      const c = connector();
      const result = await send(tools(c.callHostTool), w, { type: "text", content: "heads up", channel: `${w.platform}:peer-1` }, "home");
      expect(result).toMatchObject({ sent: true, external: { platform: w.platform, status: "sent" } });
      expect(c.calls[0]).toMatchObject({ peerId: "peer-1", text: "heads up" });
      expect((await agentMessages(w.mapping.channelId)).map((m) => m.content)).toEqual(["heads up"]);
      expect(await agentMessages(w.dm.id)).toHaveLength(0);
    });

    test("failure and doubt are reported exactly as for an automatic reply, with no recovery wake", async () => {
      const w = await world();
      wakes.length = 0;
      const failed = await send(tools(connector(() => structured({ status: "failed", code: "chat_x", message: "no" })).callHostTool), w, { type: "text", content: "a", channel: `${w.platform}:peer-1` }, "home");
      expect(failed).toMatchObject({ sent: false, delivery_failed: true, external: { status: "failed" } });
      const unsure = await send(tools(connector(() => new Error("down")).callHostTool), w, { type: "text", content: "b", channel: `${w.platform}:peer-1` }, "home");
      expect(unsure).toMatchObject({ sent: false, delivery_failed: true, external: { status: "uncertain" } });
      expect(wakes).toEqual([]);
    });

    test("a contact who has never written is refused before anything is sent", async () => {
      const w = await world();
      const c = connector();
      await expect(send(tools(c.callHostTool), w, { type: "text", content: "hi", channel: `${w.platform}:stranger` }, "home")).rejects.toMatchObject({ code: "external_peer_unknown" });
      expect(c.calls).toEqual([]);
      expect(await agentMessages(w.mapping.channelId)).toHaveLength(0);
    });

    test("a platform without messaging keeps using the older connector path", async () => {
      const w = await world();
      let used = 0;
      const result = await send(tools(connector().callHostTool, async () => (used++, { connectionId: "c1", toolName: "send_text" })), w, { type: "text", content: "hi", channel: "slack:C123" }, "home");
      expect(used).toBe(1);
      expect(result).toMatchObject({ sent: true, channel: "slack:C123" });
      expect(result.external).toBeUndefined();
    });

    test("a card cannot be addressed to an outside chat", async () => {
      const w = await world();
      const c = connector();
      const result = await send(tools(c.callHostTool, async () => ({ connectionId: "c1", toolName: "x" })), w, { type: "widget", widget: { prompt: "?", options: [{ label: "Yes" }] }, channel: `${w.platform}:peer-1` }, "home").catch((error) => error);
      expect(c.calls).toEqual([]);
      expect(await agentMessages(w.mapping.channelId)).toHaveLength(0);
      expect(result).toBeDefined();
    });
  });

  describe("rooms keep their own limit", () => {
    test("a card with to: \"dm\" from a group room is still refused, and nothing is written", async () => {
      const bot = await h.bot();
      const dm = await h.prisma.channel.create({ data: { kind: "bot_dm", directKey: `bot:${bot.id}`, name: "home", members: { create: { botId: bot.id, ordinal: 0 } } } });
      const room = await h.prisma.channel.create({ data: { kind: "group", name: "room", members: { create: { botId: bot.id, ordinal: 0 } } } });
      try {
        const run = await h.prisma.run.create({ data: { botId: bot.id, conversationId: bot.conversationId, channelId: room.id, userMessageId: crypto.randomUUID(), status: "running" } });
        const exit = await Effect.runPromiseExit(tools(connector().callHostTool).execute({
          runId: run.id, botId: bot.id, conversationId: bot.conversationId, channelId: room.id, deliveryId: null, tool: "SendToUser",
          arguments: { type: "widget", widget: { prompt: "?", options: [{ label: "Yes" }] }, to: "dm" }, callId: crypto.randomUUID(),
        } as never));
        if (!Exit.isFailure(exit)) throw new Error("the card should have been refused");
        expect(String(Cause.squash(exit.cause))).toMatch(/dm_text_only|text messages only/);
        expect(await agentMessages(dm.id)).toHaveLength(0);
      } finally {
        await h.prisma.channel.deleteMany({ where: { id: { in: [room.id, dm.id] } } });
      }
    });
  });

  describe("other cards the owner must answer", () => {
    const tool = async (service: InternalToolService, w: World, name: string, args: Record<string, unknown>) => {
      const exit = await Effect.runPromiseExit(service.execute({ runId: w.externalRunId, botId: w.bot.id, conversationId: w.bot.conversationId, channelId: w.mapping.channelId, deliveryId: null, tool: name, arguments: args, callId: crypto.randomUUID() } as never));
      if (Exit.isSuccess(exit)) return exit.value as Record<string, any>;
      throw Cause.squash(exit.cause);
    };

    test("a request for the owner to take over the computer is placed in the app chat, not the outside chat", async () => {
      const w = await world();
      const c = connector();
      await tool(tools(c.callHostTool), w, "request_box_help", { reason: "captcha", instruction: "Please solve the captcha." });
      const cards = await agentMessages(w.dm.id);
      expect(cards).toHaveLength(1);
      expect(cards[0]!.metadata).toMatchObject({ type: "computer-handoff" });
      expect(await agentMessages(w.mapping.channelId)).toHaveLength(0);
      expect(c.calls).toEqual([]);
    });
  });

  test("a normal chat is untouched: no delivery, no external field", async () => {
    const w = await world();
    const c = connector();
    const result = await send(tools(c.callHostTool), w, { type: "text", content: "plain" }, "home");
    expect(result.sent).toBe(true);
    expect(result.external).toBeUndefined();
    expect(c.calls).toEqual([]);
    expect((await agentMessages(w.dm.id)).map((m) => m.content)).toEqual(["plain"]);
  });
});
