import { describe, expect, test } from "bun:test";
import {
  connectorHostTools,
  parsePluginDefinition,
  type PluginConnectorDefinition,
  type PluginDefinition,
} from "../src";
import {
  EXTERNAL_LIST_PEERS_MAX_LIMIT,
  ExternalProtocolError,
  externalMessagePayloadHash,
  normalizeExternalListPeersInput,
  normalizeExternalMessage,
  parseExternalDeliverResult,
  parseExternalListPeersResult,
  parseExternalPollResult,
  validateExternalMessage,
  type ExternalMessage,
} from "../src/messaging";

const connector = (overrides: Partial<PluginConnectorDefinition> = {}): PluginConnectorDefinition => ({
  key: "chat",
  name: "Chat",
  transport: "stdio",
  auth: "none",
  endpoint: "",
  tools: [],
  persistentState: true,
  configuration: { command: "bun", args: ["server.mjs"] },
  messaging: {
    platform: "chat",
    inbound: { pollTool: "chat_poll_inbound", maxWaitSeconds: 20 },
    outbound: { deliverTool: "chat_deliver_message", maxTextChars: 9000, media: { kinds: ["image"], maxBytes: 1024 } },
  },
  ...overrides,
});

const plugin = (entry: PluginConnectorDefinition): PluginDefinition => ({
  key: "chat-plugin",
  version: "1.0.0",
  name: "Chat",
  description: "Fixture",
  publisher: "Example",
  category: "Test",
  featured: false,
  components: ["mcp"],
  skills: [],
  connections: [entry],
});

const message = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  providerMessageId: "9007199254740993",
  peer: { id: "peer-1", type: "direct", displayName: "Alice" },
  sender: { id: "peer-1", isAccountOwner: true },
  text: "hello",
  occurredAt: "2026-11-16T08:00:00.000Z",
  ...overrides,
});

describe("manifest messaging block", () => {
  test("a valid declaration passes and hides both tools from Bots", () => {
    const parsed = parsePluginDefinition(plugin(connector()));
    expect(connectorHostTools(parsed.connections[0])).toEqual(["chat_poll_inbound", "chat_deliver_message"]);
  });

  test.each([
    ["non-stdio transport", { transport: "http", endpoint: "https://example.test/mcp" } as const],
    ["missing persistent state", { persistentState: undefined }],
    ["persistent state disabled", { persistentState: false }],
    [
      "identical tools",
      { messaging: { ...connector().messaging!, inbound: { pollTool: "same" }, outbound: { deliverTool: "same", maxTextChars: 10 } } },
    ],
    ["bad platform", { messaging: { ...connector().messaging!, platform: "Bad Platform" } }],
    [
      "empty tool name",
      { messaging: { ...connector().messaging!, inbound: { pollTool: "" } } },
    ],
    [
      "wait above 25 seconds",
      { messaging: { ...connector().messaging!, inbound: { pollTool: "p", maxWaitSeconds: 26 } } },
    ],
    [
      "maxTextChars zero",
      { messaging: { ...connector().messaging!, outbound: { deliverTool: "d", maxTextChars: 0 } } },
    ],
    [
      "maxTextChars above 20000",
      { messaging: { ...connector().messaging!, outbound: { deliverTool: "d", maxTextChars: 20_001 } } },
    ],
    [
      "unknown media kind",
      {
        messaging: {
          ...connector().messaging!,
          outbound: { deliverTool: "d", maxTextChars: 10, media: { kinds: ["sticker" as never], maxBytes: 1 } },
        },
      },
    ],
    [
      "tool reused from the device link",
      {
        deviceLink: {
          startTool: "chat_poll_inbound",
          finishTool: "f",
          statusTool: "s",
          cancelTool: "c",
          removeTool: "r",
          instructions: "Scan",
        },
      },
    ],
  ] as const)("rejects %s", (_name, overrides) => {
    expect(() => parsePluginDefinition(plugin(connector(overrides as Partial<PluginConnectorDefinition>)))).toThrow();
  });
});

describe("validateExternalMessage", () => {
  test("accepts a minimal message and drops unknown fields", () => {
    const result = validateExternalMessage({ ...message(), replyToken: "secret", extra: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.message)).not.toContain("secret");
  });

  test.each([
    ["missing id", message({ providerMessageId: "" })],
    ["oversized id", message({ providerMessageId: "x".repeat(257) })],
    ["unknown peer type", message({ peer: { id: "p", type: "thread" } })],
    ["non-boolean owner flag", message({ sender: { id: "p", isAccountOwner: "yes" } })],
    ["bad timestamp", message({ occurredAt: "yesterday" })],
    ["media with a path-like exchange name", message({ media: [{ exchangeName: "../x", fileName: "a", byteSize: 1, sha256: "a".repeat(64) }] })],
    ["media digest not hex", message({ media: [{ exchangeName: "a", fileName: "a", byteSize: 1, sha256: "Z".repeat(64) }] })],
    ["media with a negative size", message({ media: [{ exchangeName: "a", fileName: "a", byteSize: -1, sha256: "a".repeat(64) }] })],
    ["metadata with an object value", message({ providerMetadata: { a: { nested: true } } })],
    ["metadata with 17 keys", message({ providerMetadata: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i])) })],
    ["metadata value over 256 chars", message({ providerMetadata: { a: "x".repeat(257) } })],
  ])("rejects %s as invalid", (_name, value) => {
    expect(validateExternalMessage(value)).toMatchObject({ ok: false, code: "external_message_invalid" });
  });

  test("text over 20000 characters is too large, and the id is kept for the receipt", () => {
    expect(validateExternalMessage(message({ text: "x".repeat(20_001) }))).toEqual({
      ok: false,
      code: "external_message_too_large",
      providerMessageId: "9007199254740993",
    });
    expect(validateExternalMessage(message({ text: "x".repeat(20_000) })).ok).toBe(true);
  });
});

describe("payloadHash", () => {
  const normalized = (overrides: Record<string, unknown> = {}): ExternalMessage => {
    const result = validateExternalMessage(message(overrides));
    if (!result.ok) throw new Error("fixture must validate");
    return normalizeExternalMessage(result.message);
  };
  const media = { exchangeName: "1-0", fileName: "a.png", byteSize: 4, sha256: "a".repeat(64) };

  test("ignores display names, exchange names, failures and metadata", () => {
    const base = externalMessagePayloadHash(normalized({ media: [media] }));
    expect(
      externalMessagePayloadHash(
        normalized({
          peer: { id: "peer-1", type: "direct", displayName: "Renamed" },
          media: [{ ...media, exchangeName: "9-9", fileName: "other.png" }],
          mediaFailures: [{ code: "wechat_media_download_failed" }],
          providerMetadata: { itemTypes: "text" },
        })
      )
    ).toBe(base);
  });

  test("changes with identity, text, timestamp and media content", () => {
    const base = externalMessagePayloadHash(normalized());
    for (const overrides of [
      { providerMessageId: "2" },
      { text: "different" },
      { occurredAt: "2026-11-16T08:00:01.000Z" },
      { sender: { id: "peer-1", isAccountOwner: false } },
      { media: [media] },
    ])
      expect(externalMessagePayloadHash(normalized(overrides))).not.toBe(base);
  });

  test("normalization removes control characters and canonicalizes the timestamp", () => {
    const value = normalized({ text: "a\u0000b\u0007c\nd\te", occurredAt: "2026-11-16T16:00:00+08:00" });
    expect(value.text).toBe("abc\nd\te");
    expect(value.occurredAt).toBe("2026-11-16T08:00:00.000Z");
    expect(externalMessagePayloadHash(value)).toBe(externalMessagePayloadHash(normalized({ text: "abc\nd\te" })));
  });

  test("display names are single-line and truncated to 120 characters", () => {
    const value = normalized({ peer: { id: "p", type: "direct", displayName: `A\nB${"x".repeat(200)}` } });
    expect(value.peer.displayName!.startsWith("A B")).toBe(true);
    expect(Array.from(value.peer.displayName!).length).toBe(120);
  });
});

describe("parseExternalPollResult", () => {
  test("returns valid envelopes in order and the reset flag", () => {
    const result = parseExternalPollResult({
      messages: [
        { ackCursor: "q:1", message: message() },
        { ackCursor: "q:2", message: message({ providerMessageId: "2" }) },
      ],
      resetCursor: true,
    });
    expect(result.resetCursor).toBe(true);
    expect(result.messages.map((entry) => entry.ackCursor)).toEqual(["q:1", "q:2"]);
    expect(result.messages.every((entry) => "message" in entry)).toBe(true);
  });

  test("a bad message with a usable cursor is returned as invalid so it can be rejected and skipped", () => {
    const result = parseExternalPollResult({
      messages: [{ ackCursor: "q:1", message: message({ occurredAt: "nope" }) }, { ackCursor: "q:2", message: "junk" }],
    });
    expect(result.messages[0]).toMatchObject({
      ackCursor: "q:1",
      invalid: { code: "external_message_invalid", providerMessageId: "9007199254740993" },
    });
    expect((result.messages[0] as { invalid: { payloadHash: string } }).invalid.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.messages[1]).toMatchObject({ ackCursor: "q:2", invalid: { code: "external_message_invalid" } });
    expect("providerMessageId" in (result.messages[1] as { invalid: object }).invalid).toBe(false);
  });

  test.each([
    ["not an object", "x"],
    ["messages missing", {}],
    ["too many messages", { messages: Array.from({ length: 21 }, (_, i) => ({ ackCursor: `q:${i}`, message: message() })) }],
    ["envelope without cursor", { messages: [{ message: message() }] }],
    ["empty cursor", { messages: [{ ackCursor: "", message: message() }] }],
    ["cursor over 2048 chars", { messages: [{ ackCursor: "x".repeat(2049), message: message() }] }],
    ["duplicate cursors", { messages: [{ ackCursor: "q:1", message: message() }, { ackCursor: "q:1", message: message() }] }],
    ["non-boolean reset", { messages: [], resetCursor: "yes" }],
  ])("throws for %s", (_name, value) => {
    expect(() => parseExternalPollResult(value)).toThrow(ExternalProtocolError);
  });
});

describe("parseExternalDeliverResult", () => {
  test("parses the three statuses", () => {
    expect(parseExternalDeliverResult({ status: "sent", providerMessageIds: ["1"], note: "provider_accepted", extra: 1 })).toEqual({
      status: "sent",
      providerMessageIds: ["1"],
      note: "provider_accepted",
    });
    expect(parseExternalDeliverResult({ status: "failed", code: "wechat_context_expired", message: "closed" })).toEqual({
      status: "failed",
      code: "wechat_context_expired",
      message: "closed",
    });
    expect(parseExternalDeliverResult({ status: "uncertain", code: "wechat_delivery_unknown", message: "x".repeat(900) })).toMatchObject({
      status: "uncertain",
      message: "x".repeat(500),
    });
  });

  test.each([
    ["null", null],
    ["unknown status", { status: "queued" }],
    ["failed without a code", { status: "failed", message: "m" }],
    ["failed with an unsafe code", { status: "failed", code: "Has Spaces", message: "m" }],
    ["sent with non-string ids", { status: "sent", providerMessageIds: [1] }],
    ["sent with too many ids", { status: "sent", providerMessageIds: Array.from({ length: 21 }, (_, i) => `${i + 1}`) }],
  ])("throws for %s", (_name, value) => {
    expect(() => parseExternalDeliverResult(value)).toThrow(ExternalProtocolError);
  });
});

describe("list_peers contract", () => {
  test("parses a page and sanitizes names", () => {
    const result = parseExternalListPeersResult({
      peers: [{ peerId: "p1", displayName: "WeChat\nuser", lastObservedAt: "2026-11-16T08:00:00.000Z", isAccountOwner: true, canReply: false }],
      nextAfterPeerId: null,
    });
    expect(result.peers[0]!.displayName).toBe("WeChat user");
  });

  test("rejects results that carry no page cursor field or malformed peers", () => {
    expect(() => parseExternalListPeersResult({ peers: [{ peerId: "p1" }], nextAfterPeerId: null })).toThrow(ExternalProtocolError);
    expect(() => parseExternalListPeersResult({ peers: [], nextAfterPeerId: "" })).toThrow(ExternalProtocolError);
  });

  test("input falls back to defaults and clamps the page size", () => {
    expect(normalizeExternalListPeersInput(undefined)).toEqual({ limit: 20, afterPeerId: null });
    expect(normalizeExternalListPeersInput({ limit: 9999, afterPeerId: "p9" })).toEqual({
      limit: EXTERNAL_LIST_PEERS_MAX_LIMIT,
      afterPeerId: "p9",
    });
    expect(normalizeExternalListPeersInput({ limit: -4 }).limit).toBe(1);
  });
});
