import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit } from "effect";
import { assemble, serveWechat, type Assembly } from "../../../../packages/plugins/wechat/connector/server";
import { IlinkSimulator } from "../../../../packages/plugins/wechat/connector/test/fixtures/ilink-simulator";
import { ExternalDeliveryService } from "../../src/services/external-messaging/delivery";
import { ExternalInboundMessageService } from "../../src/services/external-messaging/inbound";
import { ExternalInboundPoller, type CallHostTool } from "../../src/services/external-messaging/poller";
import { InternalToolService } from "../../src/services/internal-tool-service";
import { createHarness, databaseUrl, type Harness } from "./fixtures";
import wechatManifest from "../../../../packages/plugins/wechat/plugin.json";

/**
 * The real WeChat connector, spoken to over the real MCP protocol, wired to the real Server services.
 * Only WeChat's own servers (the simulator) and the Bot computer's file endpoints are stand-ins.
 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const OWNER = "owner1@im.wechat";

describe.skipIf(!databaseUrl)("WeChat through the Server's external messaging", () => {
  let h: Harness;
  let root: string;
  let sim: IlinkSimulator;
  let connector: Assembly;
  let client: Client;
  let stateDirectory: string;
  /** The connector's clock. Tests move it instead of touching the global Date. */
  let skew = 0;

  /** Both sides of the file exchange are really the connector's own state directory. */
  const exchange = () => {
    const inboundDir = () => join(stateDirectory, "exchange", "inbound");
    return {
      async openInbound(_id: string, name: string) {
        const bytes = await readFile(join(inboundDir(), name));
        return { body: new Response(bytes as unknown as BodyInit).body!, size: bytes.length };
      },
      async stageOutbound(input: { deliveryId: string; exchangeName: string; body: Uint8Array | Blob | ReadableStream<Uint8Array> }) {
        await mkdir(join(stateDirectory, "exchange", "outbound", input.deliveryId), { recursive: true });
        await writeFile(join(stateDirectory, "exchange", "outbound", input.deliveryId, input.exchangeName), Buffer.from(await new Response(input.body as BodyInit).arrayBuffer()));
      },
      async cleanupOutbound(_id: string, deliveryId: string) {
        await rm(join(stateDirectory, "exchange", "outbound", deliveryId), { recursive: true, force: true });
        return true;
      },
    };
  };

  const callHostTool: CallHostTool = async (_connection, toolName, args) => (await client.callTool({ name: toolName, arguments: args })) as never;

  const start = async () => {
    connector = await assemble(stateDirectory, { fetch: sim.fetch, now: () => new Date(Date.now() + skew) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await serveWechat(connector.account, { messaging: connector.messaging, transport: b });
    client = new Client({ name: "server", version: "0" });
    await client.connect(a);
  };
  const stop = async () => {
    await client.close().catch(() => {});
    await connector.close();
  };

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.cleanup());
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wechat-e2e-"));
    stateDirectory = join(root, "state");
    sim = new IlinkSimulator();
    sim.emptyPollDelayMs = 30;
    skew = 0;
    await start();
  });
  afterEach(async () => {
    await stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const link = async () => {
    sim.qrStatuses = [{ status: "confirmed" }];
    const started = await connector.account.startLink();
    await connector.account.finishLink(started.sessionId);
    const deadline = Date.now() + 4000;
    while (!connector.account.isLinked && Date.now() < deadline) await Bun.sleep(5);
  };

  /** A WeChat connection as the real manifest declares it, bound to a Bot, with its poller and tools. */
  const world = async () => {
    const bot = await h.bot();
    const dm = { id: await h.home(bot.id) };
    const installId = crypto.randomUUID();
    await h.prisma.pluginInstallation.create({ data: { id: installId, pluginKey: `wechat-${installId.slice(0, 8)}`, version: "1.0.0", name: "WeChat", publisher: "t", manifest: wechatManifest as never } });
    h.installs.push(installId);
    const connection = await h.prisma.pluginConnection.create({ data: { installationId: installId, connectorKey: "wechat", name: "WeChat", transport: "stdio", authType: "none", status: "ready" } });
    const binding = await h.bind(connection.id, bot.id);
    const files = exchange();
    const inbound = new ExternalInboundMessageService({ prisma: h.prisma, messaging: h.messaging, assets: h.assets, exchange: files as never, computerFetch: async () => new Response("{}"), interruptRun: async () => {} });
    const poller = new ExternalInboundPoller({ prisma: h.prisma, callHostTool, inbound, sleep: (_ms, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })) });
    const delivery = new ExternalDeliveryService({ prisma: h.prisma, messaging: h.messaging, assets: h.assets, exchange: files as never, callHostTool, instanceId: "e2e" });
    const legacy = { deliverConnectedChannel: async () => { throw new Error("not used"); } };
    const tools = new InternalToolService(h.prisma, h.messaging as never, {} as never, async () => {}, {} as never, {} as never, {} as never, legacy as never, undefined, undefined, undefined, undefined, delivery);
    return { bot, dm, connection, binding, poller, delivery, tools };
  };
  type World = Awaited<ReturnType<typeof world>>;

  const pump = async (w: World, until: () => Promise<boolean>, label: string) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await w.poller.iterate(w.binding.id, 0);
      if (await until()) return;
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const messagesIn = (w: World) => h.prisma.channelMessage.findMany({ where: { externalReceipts: { some: { connectionId: w.connection.id } } }, orderBy: { sequence: "asc" } });
  const reply = async (w: World, runId: string, channelId: string, args: Record<string, unknown>) => {
    await h.prisma.run.update({ where: { id: runId }, data: { status: "running" } });
    const exit = await Effect.runPromiseExit(w.tools.execute({ runId, botId: w.bot.id, conversationId: w.bot.conversationId, channelId, deliveryId: null, tool: "SendToUser", arguments: args, callId: crypto.randomUUID() } as never));
    if (Exit.isSuccess(exit)) return exit.value as Record<string, any>;
    throw Cause.squash(exit.cause);
  };
  const wakeOf = async (w: World) => {
    const mapping = await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: w.connection.id } });
    const message = (await messagesIn(w)).at(-1)!;
    const wake = await h.prisma.inboxEvent.findFirstOrThrow({ where: { botId: w.bot.id, run: { externalReceipts: { some: { connectionId: w.connection.id } } } }, orderBy: { createdAt: "desc" } });
    return { mapping, message, runId: wake.runId, home: await h.home(w.bot.id) };
  };

  test("a WeChat message becomes a chat and wakes the Bot; the reply goes back to WeChat", async () => {
    await link();
    const w = await world();
    sim.enqueue({ messageId: "7300000000000000001", fromUserId: OWNER, text: "what time is it" });
    await pump(w, async () => (await messagesIn(w)).length === 1, "the message to arrive");

    const { mapping, message, runId, home } = await wakeOf(w);
    expect(message).toMatchObject({ sender: "user", content: "what time is it" });
    expect(mapping).toMatchObject({ peerId: OWNER, platform: "wechat" });
    expect((await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: w.binding.id } })).inboundCursor).toMatch(/:1$/);

    const result = await reply(w, runId!, home, { type: "text", content: "it is noon" });
    expect(result).toMatchObject({ sent: true, external: { platform: "wechat", status: "sent" } });
    expect(sim.sent).toHaveLength(1);
    expect(sim.sent[0]).toMatchObject({ toUserId: OWNER, contextToken: "ctx-7300000000000000001" });
    expect((sim.sent[0]!.items[0] as { text_item: { text: string } }).text_item.text).toBe("it is noon");
    const delivery = await h.prisma.externalOutboundDelivery.findFirstOrThrow({ where: { connectionId: w.connection.id } });
    expect(delivery).toMatchObject({ status: "sent", providerResult: { note: "provider_accepted" } });
    // The Server stored none of WeChat's secrets.
    const stored = JSON.stringify(await h.prisma.externalMessageReceipt.findMany({ where: { connectionId: w.connection.id } })) + JSON.stringify(delivery) + JSON.stringify(mapping);
    for (const secret of ["ctx-7300000000000000001", sim.account.botToken]) expect(stored).not.toContain(secret);
  });

  test("a picture goes in and a picture goes out", async () => {
    await link();
    const w = await world();
    const key = randomBytes(16);
    const cipher = createCipheriv("aes-128-ecb", key, null);
    sim.cdn.set("pic-in", Buffer.concat([cipher.update(PNG), cipher.final()]));
    sim.enqueue({ messageId: "7300000000000000002", fromUserId: OWNER, items: [{ type: 1, text_item: { text: "look" } }, { type: 2, image_item: { media: { encrypt_query_param: "pic-in", aes_key: key.toString("base64") } } }] });
    await pump(w, async () => (await messagesIn(w)).length === 1, "the picture message");
    const { mapping, message, runId, home } = await wakeOf(w);
    const attachments = (message.metadata as { attachments: Array<{ assetId: string; kind: string }> }).attachments;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.kind).toBe("image");
    expect((await h.assets.metadata(attachments[0]!.assetId)).byteSize).toBe(PNG.length);

    // Attachments must sit in a directory the asset store is allowed to read from.
    const file = join(h.root, `answer-${crypto.randomUUID().slice(0, 6)}.png`);
    await writeFile(file, PNG);
    const result = await reply(w, runId!, home, { type: "attachment", url: `file://${file}`, alt: "here it is" });
    expect(result.external.status).toBe("sent");
    expect(sim.sent).toHaveLength(2);
    expect((sim.sent[0]!.items[0] as { text_item: { text: string } }).text_item.text).toBe("here it is");
    const uploaded = (sim.sent[1]!.items[0] as { image_item: { media: { encrypt_query_param: string } } }).image_item.media.encrypt_query_param;
    expect(sim.cdn.has(uploaded)).toBe(true);
    // The staging folder was cleaned up once the delivery ended.
    expect(await readdir(join(stateDirectory, "exchange", "outbound"))).toEqual([]);
  });

  test("restarting the connector loses nothing and creates no second chat or message", async () => {
    await link();
    const w = await world();
    sim.enqueue({ messageId: "7300000000000000003", fromUserId: OWNER, text: "before the restart" });
    await pump(w, async () => (await messagesIn(w)).length === 1, "first message");
    const mappingBefore = await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: w.connection.id } });

    await stop();
    sim.enqueue({ messageId: "7300000000000000004", fromUserId: OWNER, text: "while it was down" });
    await start();
    await pump(w, async () => (await messagesIn(w)).length === 2, "second message after restart");

    expect((await messagesIn(w)).map((row) => row.content)).toEqual(["before the restart", "while it was down"]);
    expect(await h.prisma.externalChannelMapping.count({ where: { connectionId: w.connection.id } })).toBe(1);
    expect((await h.prisma.externalChannelMapping.findFirstOrThrow({ where: { connectionId: w.connection.id } })).id).toBe(mappingBefore.id);
    // The reply context survived the restart, so the Bot can still answer.
    const { runId, home } = await wakeOf(w);
    expect((await reply(w, runId!, home, { type: "text", content: "back" })).external.status).toBe("sent");
  });

  test("a message from someone who is not the account owner is refused by the Server", async () => {
    await link();
    const w = await world();
    sim.enqueue({ messageId: "7300000000000000005", fromUserId: "stranger@im.wechat", text: "let me in" });
    sim.enqueue({ messageId: "7300000000000000006", fromUserId: OWNER, text: "hello" });
    await pump(w, async () => (await messagesIn(w)).length === 1, "owner message");
    expect(await h.prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: w.connection.id, providerMessageId: "7300000000000000005" } })).toMatchObject({ status: "rejected", rejectionCode: "external_sender_not_allowed" });
    expect((await messagesIn(w)).map((row) => row.content)).toEqual(["hello"]);
    expect(await h.prisma.externalChannelMapping.count({ where: { connectionId: w.connection.id, peerId: "stranger@im.wechat" } })).toBe(0);
  });

  test("when the reply window has closed the Bot is told so, and nothing is sent", async () => {
    await link();
    const w = await world();
    sim.enqueue({ messageId: "7300000000000000007", fromUserId: OWNER, text: "hi" });
    await pump(w, async () => (await messagesIn(w)).length === 1, "message");
    const { runId, home } = await wakeOf(w);
    // Two days later, with no new message from the contact.
    skew = 2 * 24 * 60 * 60 * 1000;
    const result = await reply(w, runId!, home, { type: "text", content: "too late" });
    expect(result).toMatchObject({ sent: false, delivery_failed: true, external: { status: "failed", reason: "wechat_context_expired" } });
    expect(sim.sent).toEqual([]);
  });

  test("an uncertain send is reported as uncertain and is never repeated", async () => {
    await link();
    const w = await world();
    sim.enqueue({ messageId: "7300000000000000008", fromUserId: OWNER, text: "hi" });
    await pump(w, async () => (await messagesIn(w)).length === 1, "message");
    const { runId, home } = await wakeOf(w);
    sim.failTransport("ilink/bot/sendmessage");
    const result = await reply(w, runId!, home, { type: "text", content: "maybe" });
    expect(result).toMatchObject({ sent: false, delivery_failed: true, external: { status: "uncertain", reason: "wechat_delivery_unknown" } });
    expect(sim.requests.filter((request) => request.url.pathname.endsWith("sendmessage"))).toHaveLength(1);
    expect((await h.prisma.externalOutboundDelivery.findFirstOrThrow({ where: { connectionId: w.connection.id } })).status).toBe("uncertain");
  });

  test("the Bot cannot call the host-only tools, and sees only the read-only ones", async () => {
    const tools = (await client.listTools()).tools;
    const hostOnly = tools.filter((tool) => tool._meta?.["outcomego/hostOnly"] === true).map((tool) => tool.name);
    expect(hostOnly).toEqual(expect.arrayContaining(["wechat_poll_inbound", "wechat_deliver_message"]));
    expect(tools.filter((tool) => tool._meta?.["outcomego/hostOnly"] !== true).map((tool) => tool.name).sort()).toEqual(["connection_status", "list_peers"]);
    const messaging = (wechatManifest.connections[0] as { messaging: { inbound: { pollTool: string }; outbound: { deliverTool: string } } }).messaging;
    expect(messaging.inbound.pollTool).toBe("wechat_poll_inbound");
    expect(messaging.outbound.deliverTool).toBe("wechat_deliver_message");
  });

  test("list_peers shows who has written, without creating anything in the Server", async () => {
    await link();
    const w = await world();
    sim.enqueue({ messageId: "7300000000000000009", fromUserId: OWNER, text: "hi" });
    await pump(w, async () => (await messagesIn(w)).length === 1, "message");
    const channelsBefore = await h.prisma.channel.count();
    const peers = JSON.parse(((await client.callTool({ name: "list_peers", arguments: {} })) as { content: Array<{ text: string }> }).content[0]!.text);
    expect(peers.peers).toEqual([expect.objectContaining({ peerId: OWNER, isAccountOwner: true, canReply: true })]);
    expect(await h.prisma.channel.count()).toBe(channelsBefore);
    expect(await h.prisma.externalOutboundDelivery.count({ where: { connectionId: w.connection.id } })).toBe(0);
  });
});
