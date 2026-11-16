import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connectorHostTools, type PluginConnectorDefinition } from "@outcomego/plugin-sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WechatAccount } from "../account";
import { WechatApi } from "../api";
import { PeerBook } from "../peers";
import { serveWechat } from "../server";
import { StateStore } from "../state";
import type { MessagingHandlers } from "../tools";
import { IlinkSimulator } from "./fixtures/ilink-simulator";

const SECRETS = { token: "{{SECRET_vbozf9ez}}", reply: "{{SECRET_orewu6rn}}", cursor: "provider-cursor-secret" };
const HOST_ONLY = ["wechat_start_link", "wechat_finish_link", "wechat_link_status", "wechat_cancel_link", "wechat_remove_account"];
const MESSAGING = ["wechat_poll_inbound", "wechat_deliver_message"];

let root: string;
let sim: IlinkSimulator;
let account: WechatAccount;
let store: StateStore;
let client: Client;

const connect = async (messaging?: MessagingHandlers) => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await serveWechat(account, { messaging, transport: b });
  client = new Client({ name: "test", version: "0" });
  await client.connect(a);
};

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result as { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: unknown };
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wechat-tools-"));
  sim = new IlinkSimulator();
  sim.account = { ...sim.account, botToken: SECRETS.token };
  store = new StateStore(join(root, "state"));
  account = new WechatAccount({ api: new WechatApi({ fetch: sim.fetch }), store, peers: new PeerBook(store), statusPollDelayMs: 1 });
  await account.initialize();
});
afterEach(async () => {
  await client?.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
});

const link = async () => {
  sim.qrStatuses = [{ status: "confirmed" }];
  const started = (await account.startLink()) as { sessionId: string };
  await account.finishLink(started.sessionId);
  for (let i = 0; i < 200 && !account.isLinked; i++) await Bun.sleep(5);
  await store.writeCursor(SECRETS.cursor);
  await account.peers.observe({ peerId: "owner1@im.wechat", isAccountOwner: true, at: new Date(), displayName: "Me", contextToken: SECRETS.reply });
  await account.peers.observe({ peerId: "stranger@im.wechat", isAccountOwner: false, at: new Date(), contextToken: SECRETS.reply + "-2" });
};

describe("discovery", () => {
  test("without the messaging handlers only status, list_peers and the five link tools exist", async () => {
    await connect();
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["connection_status", "list_peers", ...HOST_ONLY].sort());
  });

  test("with them, exactly the two host-only messaging tools are added", async () => {
    await connect({ poll: async () => ({ messages: [] }), deliver: async () => ({ status: "sent" }) });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toHaveLength(9);
    for (const name of MESSAGING) expect(names).toContain(name);
  });

  test("seven tools are host-only, two are Bot tools, and no direct-send tool exists", async () => {
    await connect({ poll: async () => ({ messages: [] }), deliver: async () => ({ status: "sent" }) });
    const tools = (await client.listTools()).tools;
    const hostOnly = tools.filter((tool) => tool._meta?.["outcomego/hostOnly"] === true);
    expect(hostOnly.map((tool) => tool.name).sort()).toEqual([...HOST_ONLY, ...MESSAGING].sort());
    for (const tool of hostOnly) expect(tool._meta?.["openteam/hostOnly"]).toBe(true);
    const bot = tools.filter((tool) => tool._meta?.["outcomego/hostOnly"] !== true);
    expect(bot.map((tool) => tool.name).sort()).toEqual(["connection_status", "list_peers"]);
    for (const tool of bot) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools.map((tool) => tool.name).filter((name) => /send|reply|message/i.test(name) && !MESSAGING.includes(name))).toEqual([]);
  });

  test("the manifest names every host-only tool so Servers filter them even without metadata", async () => {
    const manifest = (await Bun.file(new URL("../../plugin.json", import.meta.url)).json()) as { connections: PluginConnectorDefinition[] };
    const declared = connectorHostTools(manifest.connections[0]);
    for (const name of HOST_ONLY) expect(declared).toContain(name);
    for (const name of ["connection_status", "list_peers"]) expect(declared).not.toContain(name);
  });
});

describe("list_peers", () => {
  test("an empty book is an empty page", async () => {
    await connect();
    expect((await call("list_peers")).content[0]!.text).toBe(JSON.stringify({ peers: [], nextAfterPeerId: null }));
  });

  test("returns observed peers with a stable id, a fixed fallback name and a reply flag", async () => {
    await connect();
    await link();
    const page = JSON.parse((await call("list_peers")).content[0]!.text);
    expect(page.peers).toEqual([
      { peerId: "owner1@im.wechat", displayName: "Me", lastObservedAt: expect.any(String), isAccountOwner: true, canReply: true },
      { peerId: "stranger@im.wechat", displayName: "WeChat user", lastObservedAt: expect.any(String), isAccountOwner: false, canReply: false },
    ]);
    expect(page.nextAfterPeerId).toBeNull();
  });

  test("pages with limit and afterPeerId", async () => {
    await connect();
    await link();
    const first = JSON.parse((await call("list_peers", { limit: 1 })).content[0]!.text);
    expect(first.peers).toHaveLength(1);
    expect(first.nextAfterPeerId).toBe("owner1@im.wechat");
    const second = JSON.parse((await call("list_peers", { limit: 1, afterPeerId: first.nextAfterPeerId })).content[0]!.text);
    expect(second.peers.map((peer: { peerId: string }) => peer.peerId)).toEqual(["stranger@im.wechat"]);
    expect(second.nextAfterPeerId).toBeNull();
  });

  test("rejects an out-of-range limit and unknown arguments", async () => {
    await connect();
    expect((await call("list_peers", { limit: 0 })).isError).toBe(true);
    expect((await call("list_peers", { limit: 101 })).isError).toBe(true);
    expect((await call("list_peers", { sendTo: "x" })).isError).toBe(true);
  });

  test("makes no network request and writes nothing", async () => {
    await connect();
    await link();
    const requests = sim.requests.length;
    const before = await Bun.file(store.path("contexts.json")).text();
    await call("list_peers");
    await call("list_peers", { limit: 1 });
    await call("connection_status");
    expect(sim.requests.length).toBe(requests);
    expect(await Bun.file(store.path("contexts.json")).text()).toBe(before);
    expect(sim.sent).toEqual([]);
  });

  test("canReply goes false when the account cannot send", async () => {
    await connect();
    await link();
    await account.reportSessionExpired();
    const page = JSON.parse((await call("list_peers")).content[0]!.text);
    expect(page.peers.every((peer: { canReply: boolean }) => peer.canReply === false)).toBe(true);
  });
});

describe("no secret leaves through any tool result", () => {
  test("status, peers and link tools never contain a token, reply token, cursor or QR payload", async () => {
    await connect({ poll: async () => ({ messages: [] }), deliver: async () => ({ status: "sent" }) });
    await link();
    const outputs = [
      await call("connection_status"),
      await call("list_peers"),
      await call("wechat_link_status"),
      await call("wechat_start_link"),
    ];
    for (const result of outputs) {
      const serialized = JSON.stringify(result);
      for (const secret of [...Object.values(SECRETS), SECRETS.reply + "-2", sim.qr.qrcode, sim.qr.content]) expect(serialized).not.toContain(secret);
    }
    expect((await call("connection_status")).content[0]!.text).not.toContain("owner1@im.wechat");
  });

  test("an error message cannot carry the bot token", async () => {
    await connect({
      poll: async () => {
        throw new Error(`upstream said ${SECRETS.token} is bad`);
      },
      deliver: async () => ({ status: "sent" }),
    });
    await link();
    const result = await call("wechat_poll_inbound", { cursor: null, limit: 5, waitMs: 0 });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRETS.token);
    expect(result.content[0]!.text.length).toBeLessThanOrEqual(300);
  });
});

describe("host lifecycle results", () => {
  test("each is one text item holding a JSON object, as the device-link contract requires", async () => {
    await connect();
    for (const name of ["wechat_start_link", "wechat_link_status"]) {
      const result = await call(name);
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      expect(typeof JSON.parse(result.content[0]!.text)).toBe("object");
      expect(result.structuredContent).toBeUndefined();
    }
  });

  test("start returns the session fields the host validates, in milliseconds", async () => {
    await connect();
    const started = JSON.parse((await call("wechat_start_link")).content[0]!.text);
    expect(started).toMatchObject({ sessionId: expect.any(String), challengeGeneration: 0 });
    expect(started.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Number.isSafeInteger(started.expiresAt) && started.expiresAt > Date.now()).toBe(true);
    expect(started.sessionExpiresAt).toBeGreaterThanOrEqual(started.expiresAt);
  });

  test("finish and cancel require a session id", async () => {
    await connect();
    expect((await call("wechat_finish_link", {})).isError).toBe(true);
    expect((await call("wechat_cancel_link", { sessionId: "" })).isError).toBe(true);
    const started = JSON.parse((await call("wechat_start_link")).content[0]!.text);
    expect(JSON.parse((await call("wechat_cancel_link", { sessionId: started.sessionId })).content[0]!.text)).toEqual({ cancelled: true });
  });

  test("remove empties the state directory", async () => {
    await connect();
    await link();
    expect(JSON.parse((await call("wechat_remove_account")).content[0]!.text)).toEqual({ removed: true });
    expect(account.isLinked).toBe(false);
  });
});

describe("messaging tools", () => {
  test("poll and deliver return structured content that mirrors their text", async () => {
    await connect({
      poll: async (input) => ({ messages: [], resetCursor: input.cursor === "stale" }),
      deliver: async (input) => ({ status: "failed", code: "wechat_context_missing", message: `no reply context for ${input.peerId}` }),
    });
    const polled = await call("wechat_poll_inbound", { cursor: "stale", limit: 20, waitMs: 0 });
    expect(polled.structuredContent).toEqual({ messages: [], resetCursor: true });
    expect(JSON.parse(polled.content[0]!.text)).toEqual(polled.structuredContent as object);
    const delivered = await call("wechat_deliver_message", { deliveryId: "d1", peerId: "owner1@im.wechat", text: "hi" });
    expect(delivered.structuredContent).toEqual({ status: "failed", code: "wechat_context_missing", message: "no reply context for owner1@im.wechat" });
  });

  test("arguments are validated before the handler runs", async () => {
    let calls = 0;
    await connect({ poll: async () => (calls++, { messages: [] }), deliver: async () => (calls++, { status: "sent" }) });
    for (const [name, args] of [
      ["wechat_poll_inbound", { cursor: null, limit: 21, waitMs: 0 }],
      ["wechat_poll_inbound", { cursor: null, limit: 5, waitMs: 25_001 }],
      ["wechat_poll_inbound", { limit: 5, waitMs: 0 }],
      ["wechat_deliver_message", { peerId: "p" }],
      ["wechat_deliver_message", { deliveryId: "d", peerId: "p", media: [{ exchangeName: "x" }] }],
      ["wechat_deliver_message", { deliveryId: "d", peerId: "p", extra: true }],
    ] as const) expect((await call(name, args)).isError).toBe(true);
    expect(calls).toBe(0);
  });

  test("an unknown tool is an error, not a crash", async () => {
    await connect();
    expect((await call("send_message", { text: "x" })).isError).toBe(true);
  });
});
