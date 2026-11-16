import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ToolContext } from "@outcomego/messaging";
import { ExternalDeliveryService } from "../../src/services/external-messaging/delivery";
import { ExternalInboundMessageService } from "../../src/services/external-messaging/inbound";
import type { CallHostTool } from "../../src/services/external-messaging/poller";
import { createHarness, databaseUrl, entry, message, structured, type Harness } from "./fixtures";

const PNG_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe.skipIf(!databaseUrl)("outbound delivery", () => {
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

  /** What the connector's deliver tool does, and how often it was asked to. */
  const deliverTool = (behaviour: (input: Record<string, unknown>) => unknown | Promise<unknown>) => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const callHostTool: CallHostTool = async (_connection, tool, args) => {
      calls.push({ tool, args });
      const result = await behaviour(args);
      if (result instanceof Error) throw result;
      return result;
    };
    return { calls, callHostTool };
  };
  const sent = () => structured({ status: "sent", providerMessageIds: ["wx-1"], note: "provider_accepted" });

  const chat = async (options: { media?: boolean; platform?: string } = {}) => {
    const bot = await h.bot();
    const connection = await h.connection({ media: options.media, platform: options.platform });
    const binding = await h.bind(connection.id, bot.id);
    // A real conversation: the owner writes first, which creates the chat and a run.
    const result = await inbound.accept({ binding: { id: binding.id, botId: bot.id, connectionId: connection.id }, platform: options.platform ?? "chat", platformLabel: "Chat" }, entry(message()));
    if (result.status !== "accepted") throw new Error("setup failed");
    const mapping = await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: connection.id } });
    const home = await h.home(bot.id);
    const context = (callId = crypto.randomUUID()): ToolContext => ({
      runId: result.runId!, botId: bot.id, conversationId: bot.conversationId, channelId: home,
      deliveryId: null, origin: "user", callId, replyToMessageId: null, isFork: false,
    });
    return { bot, connection, binding, mapping, home, runId: result.runId!, context };
  };
  const service = (tool: CallHostTool, timing?: { renewMs?: number; deliverTimeoutMs?: number }, instanceId = "test") =>
    new ExternalDeliveryService({ prisma: h.prisma, messaging: h.messaging, assets: h.assets, exchange: h.exchange as never, callHostTool: tool, instanceId, timing });
  const row = (callId: string) => h.prisma.externalOutboundDelivery.findUniqueOrThrow({ where: { callId: `external-delivery:${callId}` } });
  /** Waits until the connector has been asked, i.e. the delivery is in flight. */
  const inFlight = async (callId: string) => {
    for (let i = 0; i < 200; i++) {
      const found = await h.prisma.externalOutboundDelivery.findUnique({ where: { callId: `external-delivery:${callId}` } });
      if (found?.status === "sending") return found;
      await Bun.sleep(10);
    }
    throw new Error("the delivery never reached the connector");
  };
  const agentMessages = (channelId: string) => h.prisma.channelMessage.findMany({ where: { channelId, sender: "agent" } });
  const text = (content: string) => ({ type: "text", content } as never);

  describe("outcomes", () => {
    test("a send the connector accepts is recorded as sent, everywhere it is shown", async () => {
      const c = await chat();
      const tool = deliverTool(sent);
      const callId = crypto.randomUUID();
      const outcome = await service(tool.callHostTool).send({ context: c.context(callId), input: text("hello from the bot"), mappingId: c.mapping.id });
      const stored = await row(callId);
      expect(outcome).toMatchObject({ id: stored.id, platform: "chat", status: "sent", messageId: stored.channelMessageId });
      expect(stored).toMatchObject({ status: "sent", errorCode: null, deliveryLeaseOwner: null, deliveryLeaseExpiresAt: null, botId: c.bot.id, mappingId: c.mapping.id, runId: c.runId });
      expect(stored.providerResult).toEqual({ providerMessageIds: ["wx-1"], note: "provider_accepted" });
      expect(stored.startedAt).not.toBeNull();
      expect(stored.completedAt).not.toBeNull();
      expect(tool.calls).toEqual([{ tool: "chat_deliver", args: { deliveryId: stored.id, peerId: "peer-1", text: "hello from the bot" } }]);
      const messages = await agentMessages(c.home);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.metadata).toMatchObject({ externalDelivery: { id: stored.id, status: "sent", code: null } });
      const events = await h.prisma.event.findMany({ where: { topic: "external.delivery.updated", entityId: stored.id }, orderBy: { sequence: "asc" } });
      expect(events.map((event) => (event.payload as { status: string }).status)).toEqual(["pending", "sent"]);
    });

    test("a reply also sent to the outside chat raises no push in the app, but a reply written only in the app does", async () => {
      const c = await chat();
      await service(deliverTool(sent).callHostTool).send({ context: c.context(), input: text("heard it elsewhere"), mappingId: c.mapping.id });
      expect(await h.prisma.channelNotification.count({ where: { channelId: c.home } })).toBe(0);
      await h.messaging.sendVisible(c.context(), text("only here"));
      expect(await h.prisma.channelNotification.count({ where: { channelId: c.home } })).toBeGreaterThan(0);
    });

    test("a refusal from the connector is recorded as failed with its own code, and starts no recovery wake", async () => {
      const c = await chat();
      const tool = deliverTool(() => structured({ status: "failed", code: "chat_context_expired", message: "The reply window has closed.\u0007" }));
      const callId = crypto.randomUUID();
      const outcome = await service(tool.callHostTool).send({ context: c.context(callId), input: text("late reply"), mappingId: c.mapping.id });
      expect(outcome).toMatchObject({ status: "failed", reason: "chat_context_expired" });
      expect(await row(callId)).toMatchObject({ status: "failed", errorCode: "chat_context_expired", errorMessage: "The reply window has closed.", deliveryLeaseOwner: null });
      expect((await agentMessages(c.home))[0]!.metadata).toMatchObject({ externalDelivery: { status: "failed", code: "chat_context_expired" } });
      expect(await h.prisma.inboxEvent.count({ where: { botId: c.bot.id, type: "channel.delivery_failed" } })).toBe(0);
    });

    test("an answer of 'uncertain' is kept as uncertain", async () => {
      const c = await chat();
      const callId = crypto.randomUUID();
      const outcome = await service(deliverTool(() => structured({ status: "uncertain", code: "chat_delivery_unknown", message: "no answer from the server" })).callHostTool).send({ context: c.context(callId), input: text("hi"), mappingId: c.mapping.id });
      expect(outcome).toMatchObject({ status: "uncertain", reason: "chat_delivery_unknown" });
      expect(await row(callId)).toMatchObject({ status: "uncertain", completedAt: expect.any(Date) });
    });

    test.each([
      ["a call that never answers", () => new Promise(() => {}), "external_delivery_timeout"],
      ["a tool that throws", () => new Error("connection reset"), "external_delivery_transport"],
      ["text that is not JSON", () => ({ content: [{ type: "text", text: "<html>bad gateway</html>" }] }), "external_delivery_unreadable"],
      ["a result with an unknown status", () => structured({ status: "maybe" }), "external_delivery_unreadable"],
      ["a tool error", () => ({ isError: true, content: [{ type: "text", text: "boom" }] }), "external_delivery_unreadable"],
    ])("%s after the call began is uncertain, and is never sent again", async (_label, behaviour, code) => {
      const c = await chat();
      const tool = deliverTool(behaviour as never);
      const svc = service(tool.callHostTool, { deliverTimeoutMs: 80 });
      const callId = crypto.randomUUID();
      const first = await svc.send({ context: c.context(callId), input: text("hi"), mappingId: c.mapping.id });
      expect(first).toMatchObject({ status: "uncertain", reason: code });
      // The tool is asked again with the same call: it answers from the record and sends nothing.
      const again = await svc.send({ context: c.context(callId), input: text("hi"), mappingId: c.mapping.id });
      expect(again).toMatchObject({ id: first.id, status: "uncertain" });
      expect(tool.calls).toHaveLength(1);
      expect(await agentMessages(c.home)).toHaveLength(1);
    });

    test("an error message never carries more than 500 characters or control characters", async () => {
      const c = await chat();
      const callId = crypto.randomUUID();
      await service(deliverTool(() => structured({ status: "failed", code: "chat_x", message: `${"é".repeat(900)}\n\u0000` })).callHostTool).send({ context: c.context(callId), input: text("hi"), mappingId: c.mapping.id });
      const stored = await row(callId);
      expect(stored.errorMessage!.length).toBeLessThanOrEqual(500);
      expect(stored.errorMessage).not.toMatch(/[\u0000-\u001f]/);
    });
  });

  describe("a call that is replayed", () => {
    test("returns the recorded result and sends nothing more", async () => {
      const c = await chat();
      const tool = deliverTool(sent);
      const svc = service(tool.callHostTool);
      const callId = crypto.randomUUID();
      const first = await svc.send({ context: c.context(callId), input: text("once"), mappingId: c.mapping.id });
      const second = await svc.send({ context: c.context(callId), input: text("once"), mappingId: c.mapping.id });
      expect(second).toMatchObject({ id: first.id, status: "sent" });
      expect(second.inProgress).toBeUndefined();
      expect(tool.calls).toHaveLength(1);
      expect(await agentMessages(c.home)).toHaveLength(1);
      expect(await h.prisma.externalOutboundDelivery.count({ where: { botId: c.bot.id } })).toBe(1);
    });

    test("while the first attempt is still running it says so, and does not start another", async () => {
      const c = await chat();
      let release!: (value: unknown) => void;
      const gate = new Promise((resolve) => (release = resolve));
      const tool = deliverTool(() => gate);
      const svc = service(tool.callHostTool);
      const callId = crypto.randomUUID();
      const running = svc.send({ context: c.context(callId), input: text("slow"), mappingId: c.mapping.id });
      await inFlight(callId);
      const replay = await svc.send({ context: c.context(callId), input: text("slow"), mappingId: c.mapping.id });
      expect(replay).toMatchObject({ status: "sending", inProgress: true });
      release(sent());
      expect((await running).status).toBe("sent");
      expect(tool.calls).toHaveLength(1);
    });

    test("two replays at the same moment still make one message and one delivery", async () => {
      const c = await chat();
      const tool = deliverTool(sent);
      const svc = service(tool.callHostTool);
      const callId = crypto.randomUUID();
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => svc.send({ context: c.context(callId), input: text("race"), mappingId: c.mapping.id }).catch((error: Error) => error)));
      expect(outcomes.filter((outcome) => outcome instanceof Error)).toEqual([]);
      expect(tool.calls).toHaveLength(1);
      expect(await agentMessages(c.home)).toHaveLength(1);
    });
  });

  describe("refused before the connector is involved", () => {
    const sentNothing = (tool: { calls: unknown[] }) => expect(tool.calls).toEqual([]);

    test("the binding is switched off", async () => {
      const c = await chat();
      await h.prisma.externalMessagingBinding.update({ where: { id: c.binding.id }, data: { enabled: false } });
      const tool = deliverTool(sent);
      expect(await service(tool.callHostTool).send({ context: c.context(), input: text("hi"), mappingId: c.mapping.id })).toMatchObject({ status: "failed", reason: "external_messaging_disabled" });
      sentNothing(tool);
    });

    test("the connection is not ready", async () => {
      const c = await chat();
      await h.prisma.pluginConnection.update({ where: { id: c.connection.id }, data: { status: "disconnected" } });
      const tool = deliverTool(sent);
      expect(await service(tool.callHostTool).send({ context: c.context(), input: text("hi"), mappingId: c.mapping.id })).toMatchObject({ status: "failed", reason: "external_connection_unavailable" });
      sentNothing(tool);
    });

    test("the text is longer than the connector accepts", async () => {
      const c = await chat();
      const tool = deliverTool(sent);
      expect(await service(tool.callHostTool).send({ context: c.context(), input: text("x".repeat(101)), mappingId: c.mapping.id })).toMatchObject({ status: "failed", reason: "external_delivery_unsupported" });
      sentNothing(tool);
    });

    test("a file the connector says it cannot send", async () => {
      const c = await chat({ media: false });
      const tool = deliverTool(sent);
      const outcome = await service(tool.callHostTool).send({ context: c.context(), input: { type: "attachment", url: PNG_URL, alt: "a picture" } as never, mappingId: c.mapping.id });
      expect(outcome).toMatchObject({ status: "failed", reason: "external_delivery_unsupported" });
      sentNothing(tool);
      expect(h.exchange.staged.filter((file) => file.deliveryId === outcome.id)).toEqual([]);
    });

    test("only text and attachments go out, and nothing is written for anything else", async () => {
      const c = await chat();
      const tool = deliverTool(sent);
      const before = (await agentMessages(c.home)).length;
      await expect(service(tool.callHostTool).send({ context: c.context(), input: { type: "widget", widget: { prompt: "ok?" } } as never, mappingId: c.mapping.id })).rejects.toMatchObject({ code: "external_channel_type_unsupported" });
      expect((await agentMessages(c.home)).length).toBe(before);
      sentNothing(tool);
    });

    test("an archived conversation refuses and writes nothing", async () => {
      const c = await chat();
      await h.prisma.channel.update({ where: { id: c.home }, data: { archivedAt: new Date() } });
      const tool = deliverTool(sent);
      await expect(service(tool.callHostTool).send({ context: c.context(), input: text("hi"), mappingId: c.mapping.id })).rejects.toMatchObject({ code: "external_channel_unavailable" });
      expect(await agentMessages(c.home)).toHaveLength(0);
      sentNothing(tool);
    });
  });

  describe("files", () => {
    test("an image is handed over by file, with its size and digest, and the staging area is cleaned up", async () => {
      const c = await chat();
      const tool = deliverTool(sent);
      const callId = crypto.randomUUID();
      const outcome = await service(tool.callHostTool).send({ context: c.context(callId), input: { type: "attachment", url: PNG_URL, alt: "the chart" } as never, mappingId: c.mapping.id });
      expect(outcome.status).toBe("sent");
      const [file] = h.exchange.staged.filter((staged) => staged.deliveryId === outcome.id);
      expect(file).toBeDefined();
      const args = tool.calls[0]!.args as { text?: string; media: Array<Record<string, unknown>> };
      expect(args.text).toBe("the chart");
      expect(args.media).toEqual([{ exchangeName: file!.name, fileName: expect.any(String), mimeType: "image/png", byteSize: file!.bytes, sha256: file!.sha256 }]);
      expect(file!.name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);
      expect(h.exchange.cleaned).toContain(outcome.id);
    });

    test("a file that cannot be staged fails the delivery before the connector is asked", async () => {
      const c = await chat();
      h.exchange.stageFailure = true;
      try {
        const tool = deliverTool(sent);
        const outcome = await service(tool.callHostTool).send({ context: c.context(), input: { type: "attachment", url: PNG_URL } as never, mappingId: c.mapping.id });
        expect(outcome).toMatchObject({ status: "failed", reason: "external_media_staging_failed" });
        expect(tool.calls).toEqual([]);
        expect(h.exchange.cleaned).toContain(outcome.id);
      } finally {
        h.exchange.stageFailure = false;
      }
    });
  });

  describe("leases", () => {
    test("while sending, the lease is renewed from the database clock", async () => {
      const c = await chat();
      let release!: (value: unknown) => void;
      const gate = new Promise((resolve) => (release = resolve));
      const svc = service(deliverTool(() => gate).callHostTool, { renewMs: 30 });
      const callId = crypto.randomUUID();
      const running = svc.send({ context: c.context(callId), input: text("slow"), mappingId: c.mapping.id });
      const stored = await inFlight(callId);
      await h.prisma.$executeRaw`UPDATE "outcomego_external_outbound_delivery" SET "deliveryLeaseExpiresAt" = (now() AT TIME ZONE 'UTC') + interval '2 seconds' WHERE "id" = ${stored.id}::uuid`;
      await Bun.sleep(150);
      const [renewed] = await h.prisma.$queryRaw<Array<{ seconds: number }>>`SELECT extract(epoch FROM "deliveryLeaseExpiresAt" - (now() AT TIME ZONE 'UTC'))::float8 AS seconds FROM "outcomego_external_outbound_delivery" WHERE "id" = ${stored.id}::uuid`;
      expect(renewed!.seconds).toBeGreaterThan(60);
      release(sent());
      await running;
    });

    test("a second dispatch of a delivery already being sent does not send again", async () => {
      const c = await chat();
      let release!: (value: unknown) => void;
      const gate = new Promise((resolve) => (release = resolve));
      const tool = deliverTool(() => gate);
      const svc = service(tool.callHostTool);
      const callId = crypto.randomUUID();
      const running = svc.send({ context: c.context(callId), input: text("slow"), mappingId: c.mapping.id });
      const stored = await inFlight(callId);
      const intruders = await Promise.all([svc.dispatch(stored.id, stored.deliveryLeaseOwner!), svc.dispatch(stored.id, "someone-else")]);
      expect(intruders.every((outcome) => outcome.status === "sending")).toBe(true);
      release(sent());
      expect((await running).status).toBe("sent");
      expect(tool.calls).toHaveLength(1);
    });

    test("deliveries whose lease ran out are settled without being sent: unsent ones fail, in-flight ones are uncertain", async () => {
      const c = await chat();
      const tool = deliverTool(sent);
      const svc = service(tool.callHostTool);
      const make = async (status: "pending" | "sending") => {
        const message = await h.prisma.channelMessage.create({ data: { channelId: c.home, sender: "agent", senderBotId: c.bot.id, content: status } });
        const created = await h.prisma.externalOutboundDelivery.create({
          data: { callId: `external-delivery:${crypto.randomUUID()}`, connectionId: c.connection.id, mappingId: c.mapping.id, botId: c.bot.id, channelMessageId: message.id, status, deliveryLeaseOwner: "dead-server", deliveryLeaseExpiresAt: new Date(Date.now() + 120_000) },
        });
        await h.prisma.$executeRaw`UPDATE "outcomego_external_outbound_delivery" SET "deliveryLeaseExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '5 seconds' WHERE "id" = ${created.id}::uuid`;
        return created;
      };
      const pending = await make("pending");
      const sending = await make("sending");
      const alive = await h.prisma.externalOutboundDelivery.create({
        data: { callId: `external-delivery:${crypto.randomUUID()}`, connectionId: c.connection.id, mappingId: c.mapping.id, botId: c.bot.id, status: "sending", deliveryLeaseOwner: "other-server", deliveryLeaseExpiresAt: new Date(Date.now() + 120_000),
          channelMessageId: (await h.prisma.channelMessage.create({ data: { channelId: c.home, sender: "agent", senderBotId: c.bot.id, content: "alive" } })).id },
      });
      await h.prisma.$executeRaw`UPDATE "outcomego_external_outbound_delivery" SET "deliveryLeaseExpiresAt" = (now() AT TIME ZONE 'UTC') + interval '60 seconds' WHERE "id" = ${alive.id}::uuid`;

      expect(await svc.recoverExpired()).toBe(2);
      expect(await h.prisma.externalOutboundDelivery.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "failed", errorCode: "external_delivery_abandoned", deliveryLeaseOwner: null });
      expect(await h.prisma.externalOutboundDelivery.findUniqueOrThrow({ where: { id: sending.id } })).toMatchObject({ status: "uncertain", errorCode: "external_delivery_interrupted", deliveryLeaseOwner: null });
      // Another Server's live delivery is left alone.
      expect(await h.prisma.externalOutboundDelivery.findUniqueOrThrow({ where: { id: alive.id } })).toMatchObject({ status: "sending", deliveryLeaseOwner: "other-server" });
      expect((await h.prisma.channelMessage.findUniqueOrThrow({ where: { id: pending.channelMessageId } })).metadata).toMatchObject({ externalDelivery: { status: "failed", code: "external_delivery_abandoned" } });
      // Nothing was sent, and running recovery again changes nothing.
      expect(tool.calls).toEqual([]);
      expect(await svc.recoverExpired()).toBe(0);
    });

    test("a result that arrives after recovery settled the delivery cannot overwrite it", async () => {
      const c = await chat();
      let release!: (value: unknown) => void;
      const gate = new Promise((resolve) => (release = resolve));
      const svc = service(deliverTool(() => gate).callHostTool);
      const callId = crypto.randomUUID();
      const running = svc.send({ context: c.context(callId), input: text("slow"), mappingId: c.mapping.id });
      const stored = await inFlight(callId);
      // This Server stalls; its lease runs out and another Server's recovery settles the delivery.
      await h.prisma.$executeRaw`UPDATE "outcomego_external_outbound_delivery" SET "deliveryLeaseExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "id" = ${stored.id}::uuid`;
      expect(await service(deliverTool(sent).callHostTool, undefined, "other").recoverExpired()).toBe(1);
      release(sent());
      const late = await running;
      expect(late).toMatchObject({ status: "uncertain" });
      expect(await row(callId)).toMatchObject({ status: "uncertain", errorCode: "external_delivery_interrupted" });
      expect((await agentMessages(c.home))[0]!.metadata).toMatchObject({ externalDelivery: { status: "uncertain" } });
    });
  });

  describe("addresses", () => {
    test("a platform with no messaging connector is left to the older path", async () => {
      const c = await chat();
      expect(await service(deliverTool(sent).callHostTool).resolveAddress(c.bot.id, "slack:C123")).toBeNull();
      expect(await service(deliverTool(sent).callHostTool).resolveAddress(c.bot.id, "no-colon")).toBeNull();
      expect(await service(deliverTool(sent).callHostTool).resolveAddress(c.bot.id, ":x")).toBeNull();
    });

    test("a known contact resolves to its conversation; a stranger is refused", async () => {
      const c = await chat({ platform: "addr1" });
      const svc = service(deliverTool(sent).callHostTool);
      expect(await svc.resolveAddress(c.bot.id, "addr1:peer-1")).toEqual({ mappingId: c.mapping.id });
      expect(await svc.resolveAddress(c.bot.id, "ADDR1:peer-1")).toEqual({ mappingId: c.mapping.id });
      await expect(svc.resolveAddress(c.bot.id, "addr1:nobody")).rejects.toMatchObject({ code: "external_peer_unknown" });
      // The platform alone means the contact this Bot is already talking to.
      expect(await svc.resolveAddress(c.bot.id, "addr1")).toEqual({ mappingId: c.mapping.id });
      // Another Bot has no account switched on for it, so it cannot send through this one.
      await expect(svc.resolveAddress((await h.bot()).id, "addr1:peer-1")).rejects.toMatchObject({ code: "external_binding_missing" });
    });

    test("an archived contact does not resolve", async () => {
      const c = await chat({ platform: "addr2" });
      await h.prisma.externalChannelMapping.update({ where: { id: c.mapping.id }, data: { status: "archived" } });
      await expect(service(deliverTool(sent).callHostTool).resolveAddress(c.bot.id, "addr2:peer-1")).rejects.toMatchObject({ code: "external_peer_unknown" });
    });

    test("sending from another conversation is recorded in the Bot's own chat, with the same record", async () => {
      const c = await chat({ platform: "addr3" });
      const dm = await h.prisma.channel.create({ data: { kind: "group", name: "room", members: { create: { botId: c.bot.id, ordinal: 0 } } } });
      const tool = deliverTool(sent);
      const callId = crypto.randomUUID();
      const outcome = await service(tool.callHostTool).send({
        context: { ...c.context(callId), channelId: dm.id, replyToMessageId: "not-in-this-chat", isFork: true },
        input: { type: "text", content: "from home", reply_to: "a-missing-address" } as never,
        mappingId: c.mapping.id,
      });
      expect(outcome.status).toBe("sent");
      expect((await agentMessages(c.home)).map((message) => message.content)).toEqual(["from home"]);
      // Nothing about a private send is written into the room it was asked for from.
      expect(await agentMessages(dm.id)).toHaveLength(0);
      expect(tool.calls[0]!.args).toMatchObject({ peerId: "peer-1", text: "from home" });
    });
  });

  describe("lifecycle", () => {
    test("removing a connection fails unfinished sends and deletes the rest, leaving the Bot's chat and its history", async () => {
      const c = await chat();
      const message = await h.prisma.channelMessage.create({ data: { channelId: c.home, sender: "agent", senderBotId: c.bot.id, content: "unsent" } });
      const unfinished = await h.prisma.externalOutboundDelivery.create({ data: { callId: `external-delivery:${crypto.randomUUID()}`, connectionId: c.connection.id, mappingId: c.mapping.id, botId: c.bot.id, channelMessageId: message.id, deliveryLeaseOwner: "x", deliveryLeaseExpiresAt: new Date(Date.now() + 60_000) } });
      const svc = service(deliverTool(sent).callHostTool);
      await h.prisma.$transaction(async (tx) => {
        await svc.prepareConnectionRemoval(tx, c.connection.id);
        await tx.pluginConnection.delete({ where: { id: c.connection.id } });
      });
      expect((await h.prisma.channel.findUniqueOrThrow({ where: { id: c.home } })).archivedAt).toBeNull();
      // History stays readable; the records that pointed at the connection are gone.
      expect(await h.prisma.channelMessage.count({ where: { channelId: c.home } })).toBeGreaterThan(0);
      expect((await h.prisma.channelMessage.findUniqueOrThrow({ where: { id: message.id } })).metadata).toMatchObject({ externalDelivery: { id: unfinished.id, status: "failed", code: "external_connection_removed" } });
      for (const count of await Promise.all([
        h.prisma.externalMessagingBinding.count({ where: { connectionId: c.connection.id } }),
        h.prisma.externalChannelMapping.count({ where: { connectionId: c.connection.id } }),
        h.prisma.externalMessageReceipt.count({ where: { connectionId: c.connection.id } }),
        h.prisma.externalOutboundDelivery.count({ where: { connectionId: c.connection.id } }),
      ])) expect(count).toBe(0);
    });

    // Chats from the earlier one-chat-per-contact design stay as history and can still be archived.
    const legacy = async () => {
      const c = await chat();
      const channel = await h.prisma.channel.create({ data: { kind: "external_dm", directKey: `external:${crypto.randomUUID()}`, name: "Old", members: { create: { botId: c.bot.id, ordinal: 0 } } } });
      await h.prisma.externalChannelMapping.update({ where: { id: c.mapping.id }, data: { channelId: channel.id } });
      return { c, channel };
    };

    test("archiving an earlier external chat archives its mapping, and restoring brings both back", async () => {
      const { c, channel } = await legacy();
      const svc = service(deliverTool(sent).callHostTool);
      await svc.setChannelArchived(channel.id, true);
      expect((await h.prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).archivedAt).not.toBeNull();
      expect((await h.prisma.externalChannelMapping.findUniqueOrThrow({ where: { id: c.mapping.id } })).status).toBe("archived");
      await svc.setChannelArchived(channel.id, false);
      expect((await h.prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).archivedAt).toBeNull();
      expect((await h.prisma.externalChannelMapping.findUniqueOrThrow({ where: { id: c.mapping.id } })).status).toBe("active");
    });

    test("removing a connection archives any earlier external chat it had", async () => {
      const { c, channel } = await legacy();
      await h.prisma.$transaction(async (tx) => {
        await service(deliverTool(sent).callHostTool).prepareConnectionRemoval(tx, c.connection.id);
        await tx.pluginConnection.delete({ where: { id: c.connection.id } });
      });
      expect((await h.prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).archivedAt).not.toBeNull();
    });

    test("only external conversations can be archived this way", async () => {
      const bot = await h.bot();
      const dm = { id: await h.home(bot.id) };
      await expect(service(deliverTool(sent).callHostTool).setChannelArchived(dm.id, true)).rejects.toMatchObject({ code: "external_channel_not_found" });
      expect((await h.prisma.channel.findUniqueOrThrow({ where: { id: dm.id } })).archivedAt).toBeNull();
    });
  });
});
