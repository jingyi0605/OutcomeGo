import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble, serveWechat, type Assembly } from "../server";
import { until } from "./fixtures/harness";
import { IlinkSimulator } from "./fixtures/ilink-simulator";

/**
 * Drives the real tool surface through a full life of the connector (link, receive, list, deliver) and
 * then searches everything that was returned or printed for values that must never leave the process.
 */
const OWNER = "owner1@im.wechat";
const D1 = "11111111-1111-4111-8111-111111111111";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let root: string;
let sim: IlinkSimulator;
let assembly: Assembly;
let client: Client;
const outputs: string[] = [];
/** What each Bot-readable tool returned, kept apart because they are held to a stricter rule. */
const botReadable: string[] = [];
const logged: string[] = [];
const realError = console.error;
const realWarn = console.warn;
const realLog = console.log;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  outputs.push(JSON.stringify(result));
  if (name === "connection_status") botReadable.push(JSON.stringify(result));
  return result as { isError?: boolean; content: Array<{ text: string }>; structuredContent?: any };
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wechat-secrets-"));
  sim = new IlinkSimulator();
  outputs.length = 0;
  botReadable.length = 0;
  logged.length = 0;
  for (const method of ["error", "warn", "log"] as const) console[method] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  assembly = await assemble(join(root, "state"), { fetch: sim.fetch });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await serveWechat(assembly.account, { messaging: assembly.messaging, transport: b });
  client = new Client({ name: "test", version: "0" });
  await client.connect(a);
});
afterEach(async () => {
  console.error = realError;
  console.warn = realWarn;
  console.log = realLog;
  await client.close().catch(() => {});
  await assembly.close();
  await rm(root, { recursive: true, force: true });
});

describe("nothing secret leaves through a tool or a log", () => {
  test("a whole life of the connector", async () => {
    // Link by scanning.
    sim.qrStatuses = [{ status: "wait" }, { status: "scaned" }, { status: "confirmed" }];
    const started = JSON.parse((await call("wechat_start_link")).content[0]!.text);
    await call("wechat_finish_link", { sessionId: started.sessionId });
    await until(() => assembly.account.isLinked, "linked");
    await call("wechat_link_status");

    // A picture and text arrive; one picture cannot be decrypted.
    const key = randomBytes(16);
    const cipher = createCipheriv("aes-128-ecb", key, null);
    sim.cdn.set("pic", Buffer.concat([cipher.update(PNG), cipher.final()]));
    sim.enqueue({ messageId: "7200000000000000001", fromUserId: OWNER, contextToken: "ctx-secret", items: [
      { type: 1, text_item: { text: "hello" } },
      { type: 2, image_item: { media: { encrypt_query_param: "pic", aes_key: key.toString("base64") } } },
      { type: 2, image_item: { media: { encrypt_query_param: "missing", aes_key: key.toString("base64") } } },
    ] });
    await until(() => assembly.spool.read(0, 5).length === 1, "message queued");
    await until(() => assembly.account.status().state === "ready", "ready");

    // Read what the Bot may read, and what the Server reads.
    await call("connection_status");
    await call("list_peers");
    const polled = await call("wechat_poll_inbound", { cursor: null, limit: 20, waitMs: 0 });
    await call("wechat_poll_inbound", { cursor: polled.structuredContent.messages[0].ackCursor, limit: 20, waitMs: 0 });

    // Send, fail, and send again.
    await call("wechat_deliver_message", { deliveryId: D1, peerId: OWNER, text: "reply" });
    sim.failNext("ilink/bot/sendmessage", 7);
    await call("wechat_deliver_message", { deliveryId: "33333333-3333-4333-8333-333333333333", peerId: OWNER, text: "refused" });
    await call("wechat_deliver_message", { deliveryId: D1, peerId: OWNER, text: "reply" });
    await call("wechat_deliver_message", { deliveryId: "44444444-4444-4444-8444-444444444444", peerId: "nobody@im.wechat", text: "x" });
    // A tool failure, and a session that expires.
    await call("wechat_poll_inbound", { cursor: null, limit: 999, waitMs: 0 });
    await assembly.account.reportSessionExpired();
    await call("wechat_deliver_message", { deliveryId: "55555555-5555-4555-8555-555555555555", peerId: OWNER, text: "late" });
    await call("connection_status");
    await call("list_peers");

    const everything = [...outputs, ...logged].join("\n");
    const secrets: Record<string, string> = {
      "the bot token": sim.account.botToken,
      "the reply token": "ctx-secret-reply-token",
      "the provider cursor": "buf-",
      "the QR payload": sim.qr.content,
      "the QR token": sim.qr.qrcode,
      "an encryption key (hex)": key.toString("hex"),
      "an encryption key (base64)": key.toString("base64"),
      "an upload or download parameter": "encrypt_query_param",
      "the owner's raw id in a Bot-readable status": "",
    };
    for (const [what, value] of Object.entries(secrets)) {
      if (!value) continue;
      expect({ what, found: everything.includes(value) }).toEqual({ what, found: false });
    }
    // The account ids may appear only where a route needs them (the peer id), never the bot id or user id of the account.
    expect(everything).not.toContain(sim.account.ilinkBotId);
    // And the Bot-readable status carries no peer identifier at all.
    expect(botReadable.length).toBe(2);
    for (const text of botReadable) expect(text).not.toContain(OWNER);
  });

  test("the files on disk that hold secrets are owner-only", async () => {
    sim.qrStatuses = [{ status: "confirmed" }];
    const started = JSON.parse((await call("wechat_start_link")).content[0]!.text);
    await call("wechat_finish_link", { sessionId: started.sessionId });
    await until(() => assembly.account.isLinked, "linked");
    sim.enqueue({ messageId: "7200000000000000002", fromUserId: OWNER, text: "hi" });
    await until(() => assembly.spool.read(0, 5).length === 1, "queued");
    await call("wechat_deliver_message", { deliveryId: D1, peerId: OWNER, text: "reply" });
    const { stat } = await import("node:fs/promises");
    const state = join(root, "state");
    for (const name of await readdir(state)) {
      const info = await stat(join(state, name));
      if (info.isFile()) expect({ name, mode: info.mode & 0o077 }).toEqual({ name, mode: 0 });
    }
    expect((await stat(state)).mode & 0o077).toBe(0);
  });

  test("an error from a tool does not repeat the arguments it was given", async () => {
    const result = await call("wechat_poll_inbound", { cursor: "very-secret-looking-cursor-value", limit: 999, waitMs: 0 });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("very-secret-looking-cursor-value");
  });

  test("the provider cursor on disk is not printed by any tool even after the loop has saved one", async () => {
    sim.qrStatuses = [{ status: "confirmed" }];
    const started = JSON.parse((await call("wechat_start_link")).content[0]!.text);
    await call("wechat_finish_link", { sessionId: started.sessionId });
    await until(() => assembly.account.isLinked, "linked");
    sim.enqueue({ messageId: "7200000000000000003", fromUserId: OWNER, text: "hi" });
    await until(async () => (await readFile(join(root, "state", "cursor.json"), "utf8").catch(() => "")).includes("buf-"), "cursor saved");
    await call("connection_status");
    await call("list_peers");
    await call("wechat_link_status");
    expect(outputs.join("\n")).not.toContain("buf-");
  });
});
