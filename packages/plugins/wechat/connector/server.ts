import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createToolValidator } from "@outcomego/plugin-sdk/json-schema";
import { WechatAccount } from "./account";
import { WechatApi } from "./api";
import { DeliveryLog, WechatDeliverer } from "./deliver";
import { JournalStore } from "./journal";
import { WechatMedia } from "./media";
import { PeerBook } from "./peers";
import { ReceiveService } from "./receive";
import { Spool } from "./spool";
import { StateStore } from "./state";
import { wechatTools, type MessagingHandlers } from "./tools";

const SERVER_VERSION = "0.1.0";
const MAX_ERROR_CHARS = 300;

export async function serveWechat(
  account: WechatAccount,
  options: { messaging?: MessagingHandlers; transport?: Transport } = {}
) {
  const tools = wechatTools(account, options.messaging);
  const entries = new Map(tools.map((entry) => [entry.name, { entry, validate: createToolValidator(entry.inputSchema) }]));
  const server = new Server({ name: "openteam-wechat", version: SERVER_VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ run, shape, ...definition }) => definition),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const match = entries.get(request.params.name);
      if (!match) throw new Error("Unknown WeChat tool");
      const args = request.params.arguments ?? {};
      const validation = match.validate(args);
      if (!validation.valid) throw new Error(`Invalid tool arguments: ${validation.errorMessage}`);
      const value = await match.entry.run(args);
      const text = JSON.stringify(value);
      // Host lifecycle results are a single text item; messaging results also carry the structured form.
      return match.entry.shape === "structured"
        ? { content: [{ type: "text", text }], structuredContent: value as Record<string, unknown> }
        : { content: [{ type: "text", text }] };
    } catch (error) {
      // Only a short, token-free message leaves the process.
      const message = error instanceof Error ? error.message : "WeChat tool failed";
      return { isError: true, content: [{ type: "text", text: account.redact(message).slice(0, MAX_ERROR_CHARS) }] };
    }
  });
  server.onclose = () => {
    void account.close();
  };
  await server.connect(options.transport ?? new StdioServerTransport());
  return server;
}

export interface Assembly {
  account: WechatAccount;
  receive: ReceiveService;
  messaging: MessagingHandlers;
  spool: Spool;
  close(): Promise<void>;
}

/**
 * Builds every part of the connector on one state directory. The tool server and the tests share it,
 * so what is tested is what runs. `fetchImpl` is for tests only: the product always talks to WeChat.
 */
export async function assemble(directory: string, options: { fetch?: import("./api").WechatFetch; now?: () => Date } = {}): Promise<Assembly> {
  const store = new StateStore(directory);
  await store.prepare();
  const api = new WechatApi({ fetch: options.fetch });
  const peers = new PeerBook(store);
  const spool = await Spool.open(store);
  const journal = new JournalStore(store);
  const media = new WechatMedia(store, options.fetch);
  const receive = new ReceiveService({ api, store, spool, journal, media, peers, now: options.now });
  const account = new WechatAccount({ api, store, peers, collaborators: receive, now: options.now });
  receive.attach(account);
  const log = new DeliveryLog(store);
  await log.load();
  const deliverer = new WechatDeliverer({ account, api, peers, media, log, now: options.now });
  await account.initialize();
  await media.sweepOutbound().catch(() => {});
  // A paused account is probed once its cool-down ends, even if nobody calls a tool first.
  receive.scheduleProbe();
  return {
    account,
    receive,
    spool,
    messaging: { poll: (input) => receive.poll(input), deliver: (input) => deliverer.deliver(input) },
    async close() {
      await receive.close();
      await account.close();
      await spool.close();
    },
  };
}

export async function runServer() {
  process.umask(0o077);
  const directory = process.env.OPENTEAM_PLUGIN_STATE_DIR;
  if (!directory) throw new Error("WeChat connector needs OPENTEAM_PLUGIN_STATE_DIR");
  const assembly = await assemble(directory);
  const stop = () => {
    void assembly.close().finally(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await serveWechat(assembly.account, { messaging: assembly.messaging });
}

if (import.meta.main) {
  try {
    await runServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "WeChat connector could not start");
    process.exitCode = 1;
  }
}
