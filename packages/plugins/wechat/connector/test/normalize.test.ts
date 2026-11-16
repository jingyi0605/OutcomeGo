import { describe, expect, test } from "bun:test";
import { validateExternalMessage } from "@outcomego/plugin-sdk/messaging";
import { normalizeInbound } from "../normalize";
import { ITEM_TYPE, type WechatInboundMessage, type WechatItem } from "../protocol";

const account = { ilinkBotId: "bot1@im.bot", ilinkUserId: "owner1@im.wechat" };
const RECEIVED = new Date("2026-11-16T08:00:00.000Z");
const text = (value: string): WechatItem => ({ type: ITEM_TYPE.text, text: value });
const wire = (overrides: Partial<WechatInboundMessage> = {}): WechatInboundMessage => ({
  messageId: "18446744073709551615",
  fromUserId: "owner1@im.wechat",
  toUserId: "bot1@im.bot",
  groupId: null,
  createTimeMs: Date.parse("2026-11-16T07:59:00.000Z"),
  contextToken: "ctx",
  sessionId: null,
  items: [text("hello")],
  unknownItemTypes: [],
  ...overrides,
});
const run = (message: WechatInboundMessage) => normalizeInbound(message, account, RECEIVED);

describe("what is dropped", () => {
  test("group messages", () => {
    expect(run(wire({ groupId: "g1@chatroom" }))).toEqual({ kind: "drop", reason: "group" });
  });
  test("the bot's own messages", () => {
    expect(run(wire({ fromUserId: "bot1@im.bot" }))).toEqual({ kind: "drop", reason: "self" });
  });
  test.each([
    ["no items", []],
    ["blank text", [text("   ")]],
    ["only types this client does not know", []],
  ])("a message with %s", (_label, items) => {
    expect(run(wire({ items: items as WechatItem[], unknownItemTypes: [99] }))).toEqual({ kind: "drop", reason: "empty" });
  });
});

describe("owner and identity", () => {
  test("only the scanning user is the account owner", () => {
    const owner = run(wire());
    const other = run(wire({ fromUserId: "someone-else@im.wechat" }));
    expect(owner.kind === "message" && owner.message.sender).toEqual({ id: "owner1@im.wechat", isAccountOwner: true });
    expect(other.kind === "message" && other.message.sender.isAccountOwner).toBe(false);
  });
  test("the peer is the sender, as a direct chat, with no invented name", () => {
    const result = run(wire());
    expect(result.kind === "message" && result.message.peer).toEqual({ id: "owner1@im.wechat", type: "direct" });
  });
  test("a look-alike id is not the owner", () => {
    for (const id of ["OWNER1@im.wechat", "owner1@im.wechat ", "owner1@im.wechat​"]) {
      const result = run(wire({ fromUserId: id }));
      expect(result.kind === "message" && result.message.sender.isAccountOwner).toBe(false);
    }
  });
});

describe("text", () => {
  test("text items join in order, one per line", () => {
    const result = run(wire({ items: [text("one"), { type: ITEM_TYPE.image }, text("two")] }));
    expect(result.kind === "message" && result.message.text).toBe("one\ntwo");
  });
  test("a transcribed voice note becomes text, an untranscribed one a named failure", () => {
    const spoken = run(wire({ items: [{ type: ITEM_TYPE.voice, voiceText: "turn on the lights" }] }));
    expect(spoken.kind === "message" && spoken.message.text).toBe("turn on the lights");
    const silent = run(wire({ items: [{ type: ITEM_TYPE.voice }] }));
    expect(silent.kind === "message" && silent.message).toMatchObject({ text: "", mediaFailures: [{ code: "wechat_voice_untranscribed" }] });
  });
});

describe("time", () => {
  test("uses the send time", () => {
    const result = run(wire());
    expect(result.kind === "message" && result.message.occurredAt).toBe("2026-11-16T07:59:00.000Z");
  });
  test("falls back to the stable receive time when the send time is missing or unreadable", () => {
    for (const createTimeMs of [null, Number.NaN, 8.64e15 + 1]) {
      const result = run(wire({ createTimeMs }));
      expect(result.kind === "message" && result.message.occurredAt).toBe(RECEIVED.toISOString());
    }
  });
  test("the same message normalizes identically on a replay", () => {
    expect(run(wire({ createTimeMs: null }))).toEqual(normalizeInbound(wire({ createTimeMs: null }), account, RECEIVED));
  });
});

describe("media and metadata", () => {
  test("images, files and video are listed in order for fetching", () => {
    const result = run(wire({ items: [{ type: ITEM_TYPE.image }, text("see"), { type: ITEM_TYPE.file, fileName: "a.pdf" }, { type: ITEM_TYPE.video }] }));
    expect(result.kind === "message" && result.media.map((entry) => [entry.index, entry.item.type])).toEqual([[0, ITEM_TYPE.image], [1, ITEM_TYPE.file], [2, ITEM_TYPE.video]]);
  });
  test("a message that is only a picture is kept", () => {
    expect(run(wire({ items: [{ type: ITEM_TYPE.image }] })).kind).toBe("message");
  });
  test("metadata holds only a non-sensitive summary", () => {
    const result = run(wire({ items: [text("x"), { type: ITEM_TYPE.image }], sessionId: "sess-secret", contextToken: "ctx-secret" }));
    expect(result.kind === "message" && result.message.providerMetadata).toEqual({ itemTypes: "text,image" });
    expect(JSON.stringify(result)).not.toContain("ctx-secret");
    expect(JSON.stringify(result)).not.toContain("sess-secret");
  });
  test("the result satisfies the Server's message contract", () => {
    const result = run(wire());
    expect(result.kind === "message" && validateExternalMessage(result.message).ok).toBe(true);
  });
  test("a 64-bit id survives as exact text", () => {
    const result = run(wire({ messageId: "9007199254740993" }));
    expect(result.kind === "message" && result.message.providerMessageId).toBe("9007199254740993");
  });
});
