import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ExternalInboundMessageService } from "../../src/services/external-messaging/inbound";
import { ExternalInboundPoller, type CallHostTool } from "../../src/services/external-messaging/poller";
import { bindingView } from "../../src/services/external-messaging/views";
import { createHarness, databaseUrl, message, type Harness } from "./fixtures";

// Fake values that must never appear in logs, diagnostics or the bookkeeping tables.
const BODY = "BODY-private-text-7f3a";
const URL_SECRET = "https://cdn.example.test/dl?encrypted_query_param=FAKE-DOWNLOAD-TOKEN-91c2";
const CREDENTIAL = "FAKE-CREDENTIAL-bearer-5d8e";
const LEAKS = [BODY, URL_SECRET, "FAKE-DOWNLOAD-TOKEN-91c2", CREDENTIAL];

const leaked = (value: unknown) => {
  const text = JSON.stringify(value);
  return LEAKS.filter((needle) => text.includes(needle));
};

describe.skipIf(!databaseUrl)("external messaging redaction", () => {
  let h: Harness;
  let real: ExternalInboundMessageService;
  const never = (_ms: number, signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));

  beforeAll(async () => {
    h = await createHarness();
    real = new ExternalInboundMessageService({
      prisma: h.prisma, messaging: h.messaging, assets: h.assets, exchange: h.exchange,
      computerFetch: async () => new Response("{}"), interruptRun: async () => {},
    });
  });
  afterAll(() => h.cleanup());

  const poller = (callHostTool: CallHostTool) =>
    new ExternalInboundPoller({ prisma: h.prisma, callHostTool, inbound: real, sleep: never });

  /** Runs `action` while recording everything written through console.* */
  const captureLogs = async (action: () => Promise<void>) => {
    const lines: string[] = [];
    const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    const record = (...args: unknown[]) => void lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    Object.assign(console, { log: record, info: record, warn: record, error: record });
    try {
      await action();
    } finally {
      Object.assign(console, originals);
    }
    return lines;
  };

  test("a failing connector's reason text reaches neither the log nor the diagnostics", async () => {
    const bot = await h.bot();
    const connection = await h.connection();
    const binding = await h.bind(connection.id, bot.id);
    const failing: CallHostTool = async () => ({
      isError: true,
      content: [{ type: "text", text: `poll_broken: could not fetch ${URL_SECRET} with ${CREDENTIAL} for ${BODY}` }],
    });
    const logs = await captureLogs(async () => {
      await poller(failing).iterate(binding.id, 0);
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(leaked(logs)).toEqual([]);

    const row = await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } });
    expect(row.lastErrorCode).toBe("external_poll_failed");
    expect(leaked(row)).toEqual([]);
    expect(leaked(bindingView(row))).toEqual([]);
  });

  test("a thrown transport error with a URL in its message stays out of the log", async () => {
    const bot = await h.bot();
    const connection = await h.connection();
    const binding = await h.bind(connection.id, bot.id);
    const throwing: CallHostTool = async () => {
      throw new Error(`fetch failed: ${URL_SECRET} ${CREDENTIAL}`);
    };
    const logs = await captureLogs(async () => {
      await poller(throwing).iterate(binding.id, 0);
    });
    expect(leaked(logs)).toEqual([]);
    expect(leaked(await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } }))).toEqual([]);
  });

  test("diagnostics expose no cursor, lease or retry bookkeeping", async () => {
    const bot = await h.bot();
    const connection = await h.connection();
    const binding = await h.bind(connection.id, bot.id, { inboundCursor: "q:secret-cursor-1" });
    const row = await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } });
    const view = bindingView(row);
    expect(JSON.stringify(view)).not.toContain("secret-cursor-1");
    expect(Object.keys(view).sort()).toEqual(
      ["botId", "consecutiveFailures", "enabled", "inboundPolicy", "lastAcceptedAt", "lastErrorAt", "lastErrorCode", "lastPolledAt", "rejectedCounts", "reminder", "status"].sort()
    );
  });

  test("an accepted message keeps its text only in the chat, not in Receipt, Binding or Mapping", async () => {
    const bot = await h.bot();
    const connection = await h.connection();
    const binding = await h.bind(connection.id, bot.id);
    const inbound = message({
      providerMessageId: "redaction-1",
      text: BODY,
      providerMetadata: { downloadUrl: URL_SECRET, replyToken: CREDENTIAL },
    });
    const result = await real.accept(
      { binding: { id: binding.id, botId: bot.id, connectionId: connection.id }, platform: "chat", platformLabel: "Chat" },
      { ackCursor: "q:1", message: inbound }
    );
    expect(result.status).toBe("accepted");

    const receipts = await h.prisma.externalMessageReceipt.findMany({ where: { connectionId: connection.id } });
    const bindingRow = await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } });
    const mappings = await h.prisma.externalChannelMapping.findMany({ where: { connectionId: connection.id } });
    expect(receipts.length).toBe(1);
    expect(leaked(receipts)).toEqual([]);
    expect(leaked(bindingRow)).toEqual([]);
    expect(leaked(mappings)).toEqual([]);

    // The conversation itself keeps the text, as the requirements say.
    const stored = await h.prisma.channelMessage.findMany({ where: { externalReceipts: { some: { connectionId: connection.id } } } });
    expect(stored.some((row) => row.content.includes(BODY))).toBe(true);
    // Provider-private metadata is not carried into the message either.
    expect(leaked(stored.map((row) => row.metadata))).toEqual([]);
  });

  test("a refused message leaves a rejection code, never its text", async () => {
    const bot = await h.bot();
    const connection = await h.connection();
    const binding = await h.bind(connection.id, bot.id);
    const stranger = message({ providerMessageId: "redaction-2", text: BODY, sender: { id: "other", isAccountOwner: false } });
    await real.accept(
      { binding: { id: binding.id, botId: bot.id, connectionId: connection.id }, platform: "chat", platformLabel: "Chat" },
      { ackCursor: "q:2", message: stranger }
    );
    const receipts = await h.prisma.externalMessageReceipt.findMany({ where: { connectionId: connection.id } });
    expect(receipts[0]?.status).toBe("rejected");
    expect(leaked(receipts)).toEqual([]);
    expect(leaked(await h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id: binding.id } }))).toEqual([]);
  });
});
