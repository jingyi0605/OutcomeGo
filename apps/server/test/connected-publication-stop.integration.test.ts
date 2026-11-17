import { expect, test } from "bun:test";
import { createPrismaClient, type Prisma } from "@outcomego/db";
import { stopRequestProgress } from "@outcomego/messaging";
import { Effect } from "effect";
import { InternalToolService } from "../src/services/internal-tool-service";
import { PluginConnectors } from "../src/services/plugin/connectors";
import { PluginTransport } from "../src/services/plugin/transport";
import { createReviewedEmailPlugin } from "./plugin/fixtures/reviewed-email-plugin";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const integration = test.skipIf(!url);
const gate = () => Promise.withResolvers<void>();

async function fixture(nativeFiles = false) {
  const db = createPrismaClient(url!);
  const bot = await db.bot.create({ data: {
    name: "Synthetic connected publication", status: "active", defaultDirectory: "/tmp", conversation: { create: {} },
  }, include: { conversation: true } });
  const channel = await db.channel.create({ data: {
    name: "Publication fixture", kind: "bot_dm", members: { create: { botId: bot.id, ordinal: 0 } },
  } });
  const root = await db.run.create({ data: {
    botId: bot.id, conversationId: bot.conversation!.id, channelId: channel.id,
    userMessageId: crypto.randomUUID(), origin: "user", status: "completed",
  } });
  const run = await db.run.create({ data: {
    botId: bot.id, conversationId: bot.conversation!.id, channelId: channel.id,
    userMessageId: crypto.randomUUID(), origin: "background_revival", status: "running",
  } });
  await db.inboxEvent.create({ data: {
    botId: bot.id, conversationId: bot.conversation!.id, runId: run.id,
    idempotencyKey: crypto.randomUUID(), type: "subagent.completed", payload: { taskContextRunId: root.id },
  } });
  const pluginKey = nativeFiles ? "gmail" : `publication-${crypto.randomUUID()}`;
  const installation = await db.pluginInstallation.create({ data: {
    pluginKey, version: "1.0.0", name: "Synthetic publisher", publisher: "Test",
    manifest: JSON.parse(JSON.stringify(createReviewedEmailPlugin(pluginKey))),
  } });
  const connection = await db.pluginConnection.create({ data: {
    installationId: installation.id, connectorKey: nativeFiles ? "gmail" : "email", name: "Publisher",
    transport: "http", endpoint: "https://fixture.invalid/mcp", authType: "none", status: "ready",
    toolSnapshot: [{ name: "send_message", description: "Send message", inputSchema: {
      type: "object", properties: { chat_id: { type: "string" }, text: { type: "string" } },
    } }],
  } });
  const input = {
    botId: bot.id, runId: run.id, callId: crypto.randomUUID(),
    address: `${connection.id}:${nativeFiles ? "owner@example.invalid" : "synthetic-room"}`, content: "Synthetic result",
  };
  const connector = (transportDb = db, http = { call: async () => ({ sent: true }) },
    token = async () => "synthetic-token") => {
    const transport = new PluginTransport(transportDb, http as never, "http://fixture.invalid");
    return new PluginConnectors(db, {} as never, () => { throw new Error("Unexpected connect"); },
      (callId, signal) => transport.executeInvocation(callId, signal), undefined, token);
  };
  return {
    db, bot, root, run, input, connection, connector,
    stop: () => db.$transaction(tx => stopRequestProgress(tx, bot.id, root.id)),
    invocation: () => db.pluginInvocation.findUnique({ where: { callId: `connected-channel:${input.callId}` } }),
    async cleanup() {
      await db.bot.delete({ where: { id: bot.id } });
      await db.channel.delete({ where: { id: channel.id } });
      await db.pluginInstallation.delete({ where: { id: installation.id } });
      await db.$disconnect();
    },
  };
}

integration("Stop committed before the text transport claim prevents the real connector RPC", async () => {
  const f = await fixture();
  const entered = gate(), release = gate();
  let calls = 0;
  const wrapped = new Proxy(f.db, { get(target, key) {
    if (key !== "pluginConnection") return Reflect.get(target, key);
    return new Proxy(target.pluginConnection, { get(model, method) {
      if (method !== "findUnique") return Reflect.get(model, method);
      return async (args: Parameters<typeof model.findUnique>[0]) => {
        const result = await model.findUnique(args);
        if (args.include?.installation) { entered.resolve(); await release.promise; }
        return result;
      };
    } });
  } });
  const pending = f.connector(wrapped, { call: async () => { calls++; return { sent: true }; } })
    .deliverConnectedChannel(f.input);
  try {
    await entered.promise;
    await f.stop();
    release.resolve();
    await expect(pending).rejects.toMatchObject({ code: "request_stopped" });
    expect(calls).toBe(0);
    expect(await f.invocation()).toMatchObject({ status: "failed" });
  } finally { release.resolve(); await pending.catch(() => undefined); await f.cleanup(); }
});

integration("a claimed text publication lets Stop commit during RPC and records one completed receipt", async () => {
  const f = await fixture();
  const entered = gate(), release = gate();
  let calls = 0;
  const connector = f.connector(f.db, { call: async () => {
    calls++; entered.resolve(); await release.promise; return { sent: true };
  } });
  const pending = connector.deliverConnectedChannel(f.input);
  try {
    await entered.promise;
    expect(await f.invocation()).toMatchObject({ status: "running", error: "Executing" });
    await f.stop();
    expect((await f.db.run.findUniqueOrThrow({ where: { id: f.root.id } })).requestStoppedAt).not.toBeNull();
    await expect(connector.deliverConnectedChannel(f.input)).rejects.toMatchObject({ code: "connected_channel_delivery_replayed" });
    expect(await f.invocation()).toMatchObject({ status: "running", error: "Executing" });
    release.resolve();
    const result = await pending;
    expect(await connector.deliverConnectedChannel(f.input)).toEqual(result);
    expect(calls).toBe(1);
    expect(await f.invocation()).toMatchObject({ status: "completed", error: null });
  } finally { release.resolve(); await pending.catch(() => undefined); await f.cleanup(); }
});

integration("the real SendToUser entry replays its completed connected receipt after Stop without resending", async () => {
  const f = await fixture();
  let calls = 0;
  const connector = f.connector(f.db, { call: async () => { calls++; return { sent: true }; } });
  const tools = new InternalToolService(f.db, {} as never, {} as never, async () => {},
    {} as never, {} as never, {} as never, {
      deliverConnectedChannel: connector.deliverConnectedChannel,
    } as never);
  const request = {
    botId: f.bot.id, runId: f.run.id, conversationId: f.run.conversationId,
    channelId: f.run.channelId!, deliveryId: null, callId: f.input.callId, tool: "SendToUser",
    arguments: { type: "text", channel: f.input.address, content: f.input.content },
  };
  try {
    const result = await Effect.runPromise(tools.execute(request));
    await f.stop();
    expect(await Effect.runPromise(tools.execute(request))).toEqual(result);
    expect(calls).toBe(1);
  } finally { await f.cleanup(); }
});

integration("Stop during packaged runtime preparation prevents the subsequent text claim", async () => {
  const f = await fixture();
  const entered = gate(), release = gate();
  await f.db.pluginConnection.update({ where: { id: f.connection.id }, data: { transport: "stdio" } });
  const wrapped = new Proxy(f.db, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx =>
      operation(new Proxy(tx, { get(client, property) {
        if (property !== "pluginConnection") return Reflect.get(client, property);
        return new Proxy(client.pluginConnection, { get(model, method) {
          if (method !== "findUniqueOrThrow") return Reflect.get(model, method);
          return async (args: Parameters<typeof model.findUniqueOrThrow>[0]) => {
            const result = await model.findUniqueOrThrow(args);
            entered.resolve(); await release.promise;
            return result;
          };
        } });
      } })),
    );
  } });
  const pending = f.connector(wrapped).deliverConnectedChannel(f.input);
  try {
    await entered.promise;
    await f.stop();
    release.resolve();
    await expect(pending).rejects.toMatchObject({ code: "request_stopped" });
    expect(await f.invocation()).toMatchObject({ status: "failed" });
  } finally { release.resolve(); await pending.catch(() => undefined); await f.cleanup(); }
});

for (const stoppedFirst of [true, false]) integration(
  `${stoppedFirst ? "Stop before" : "Stop after"} the native file claim preserves the real publication boundary`,
  async () => {
    const f = await fixture(true);
    const entered = gate(), release = gate();
    const preparing = gate(), prepared = gate();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++; entered.resolve(); await release.promise; return Response.json({ id: "synthetic-message" });
    }) as unknown as typeof fetch;
    const connector = f.connector(f.db, undefined, async () => {
      if (stoppedFirst) { preparing.resolve(); await prepared.promise; }
      return "synthetic-token";
    });
    const input = { ...f.input, files: [{ assetId: "synthetic", name: "result.txt", mimeType: "text/plain", bytes: Buffer.from("Synthetic observation") }] };
    let pending: ReturnType<typeof connector.deliverConnectedChannel> | undefined;
    try {
      if (stoppedFirst) {
        pending = connector.deliverConnectedChannel(input);
        await preparing.promise;
        await f.stop();
        prepared.resolve();
        release.resolve();
        await expect(pending).rejects.toMatchObject({ code: "request_stopped" });
        expect(calls).toBe(0);
        expect(await f.invocation()).toBeNull();
      } else {
        pending = connector.deliverConnectedChannel(input);
        await entered.promise;
        expect(await f.invocation()).toMatchObject({ status: "running", error: "Executing" });
        await f.stop();
        await expect(connector.deliverConnectedChannel(input)).rejects.toThrow("uncertain");
        expect(await f.invocation()).toMatchObject({ status: "running", error: "Executing" });
        release.resolve();
        const result = await pending;
        expect(await connector.deliverConnectedChannel(input)).toEqual(result);
        expect(calls).toBe(1);
        expect(await f.invocation()).toMatchObject({ status: "completed" });
      }
    } finally {
      prepared.resolve(); release.resolve(); await pending?.catch(() => undefined);
      globalThis.fetch = originalFetch; await f.cleanup();
    }
  },
);
