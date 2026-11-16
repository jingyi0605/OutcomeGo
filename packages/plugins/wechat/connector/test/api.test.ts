import { describe, expect, test } from "bun:test";
import { baseUrlFromHost, isAllowedWechatUrl, WechatApi, WechatApiError } from "../api";
import { IlinkSimulator } from "./fixtures/ilink-simulator";

const api = (sim: IlinkSimulator, token = "tok-secret") => new WechatApi({ fetch: sim.fetch, token });

const failure = async (action: Promise<unknown>): Promise<WechatApiError> => {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(WechatApiError);
    return error as WechatApiError;
  }
  throw new Error("expected the call to fail");
};

describe("host validation", () => {
  test.each([
    ["https://ilinkai.weixin.qq.com", true],
    ["https://novac2c.cdn.weixin.qq.com/c2c", true],
    ["https://weixin.qq.com", true],
    ["http://ilinkai.weixin.qq.com", false],
    ["https://weixin.qq.com.evil.test", false],
    ["https://evilweixin.qq.com", false],
    ["https://ilinkai.weixin.qq.com.evil.test/x", false],
    ["https://user:pw@ilinkai.weixin.qq.com", false],
    ["https://evil.test/@ilinkai.weixin.qq.com", false],
    ["ftp://ilinkai.weixin.qq.com", false],
    ["not a url", false],
    ["", false],
  ])("%s -> %s", (value, allowed) => {
    expect(isAllowedWechatUrl(value)).toBe(allowed);
  });

  test("a redirect host is accepted only when it resolves inside weixin.qq.com", () => {
    expect(baseUrlFromHost("acct.weixin.qq.com")).toBe("https://acct.weixin.qq.com");
    expect(baseUrlFromHost("evil.test")).toBeNull();
    expect(baseUrlFromHost("a.weixin.qq.com/../x")).toBeNull();
    expect(baseUrlFromHost("a.weixin.qq.com:8443")).toBeNull();
  });

  test("the client refuses a foreign base URL at construction and on switch", () => {
    expect(() => new WechatApi({ baseUrl: "https://evil.test" })).toThrow(WechatApiError);
    expect(() => new WechatApi({}).setBaseUrl("http://ilinkai.weixin.qq.com")).toThrow(WechatApiError);
  });

  test("a request never leaves weixin.qq.com even after a switch", async () => {
    const sim = new IlinkSimulator();
    const client = api(sim);
    client.setBaseUrl("https://acct.weixin.qq.com");
    await client.getUpdates("", 1000);
    expect(sim.requests.every((request) => request.url.hostname.endsWith(".weixin.qq.com"))).toBe(true);
    expect(sim.requests[0]!.url.hostname).toBe("acct.weixin.qq.com");
  });
});

describe("request shape", () => {
  test("business POSTs carry the auth headers and base_info", async () => {
    const sim = new IlinkSimulator();
    await api(sim).getUpdates("opaque-buf", 1000);
    const request = sim.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("authorizationtype")).toBe("ilink_bot_token");
    expect(request.headers.get("authorization")).toBe("Bearer tok-secret");
    expect(request.headers.get("ilink-app-id")).toBeTruthy();
    expect(request.headers.get("ilink-app-clientversion")).toBeTruthy();
    expect(JSON.parse(request.body)).toEqual({ get_updates_buf: "opaque-buf", base_info: { channel_version: expect.any(String) } });
  });

  test("X-WECHAT-UIN is a base64 uint32 and differs on every request", async () => {
    const sim = new IlinkSimulator();
    const client = api(sim);
    for (let i = 0; i < 40; i++) await client.getUpdates("", 1000);
    const values = sim.requests.map((request) => request.headers.get("x-wechat-uin")!);
    expect(new Set(values).size).toBeGreaterThan(35);
    for (const value of values) {
      const decoded = Buffer.from(value, "base64").toString();
      expect(decoded).toMatch(/^\d{1,10}$/);
      expect(Number(decoded)).toBeLessThanOrEqual(0xffffffff);
    }
  });

  test("no Authorization header is sent before an account is linked", async () => {
    const sim = new IlinkSimulator();
    await new WechatApi({ fetch: sim.fetch }).getBotQrcode();
    expect(sim.requests[0]!.headers.get("authorization")).toBeNull();
  });

  test("every request refuses redirects", async () => {
    const seen: RequestInit[] = [];
    const client = new WechatApi({ fetch: async (_url, init) => (seen.push(init), Response.json({ ret: 0, msgs: [] })) });
    await client.getUpdates("", 1000);
    expect(seen[0]!.redirect).toBe("error");
  });

  test("a redirect response is a network failure, not a followed request", async () => {
    const sim = new IlinkSimulator();
    sim.redirectNext("ilink/bot/getupdates", "https://evil.test/steal");
    expect((await failure(api(sim).getUpdates("", 1000))).kind).toBe("network");
    expect(sim.requests.some((request) => request.url.hostname === "evil.test")).toBe(false);
  });
});

describe("getUpdates", () => {
  test("keeps 64-bit message ids exact and parses text items", async () => {
    const sim = new IlinkSimulator();
    sim.enqueue({ messageId: "18446744073709551615", fromUserId: "owner1@im.wechat", text: "hello" });
    sim.enqueue({ messageId: "9007199254740993", fromUserId: "owner1@im.wechat", text: "again" });
    const result = await api(sim).getUpdates("", 1000);
    expect(result.messages.map((message) => message.messageId)).toEqual(["18446744073709551615", "9007199254740993"]);
    expect(result.messages[0]!.items).toEqual([{ type: 1, text: "hello" }]);
    expect(result.messages[0]!.contextToken).toBe("ctx-18446744073709551615");
    expect(result.nextBuffer).toMatch(/^buf-/);
    expect(result.longPollingTimeoutMs).toBe(35_000);
    expect(result.timedOut).toBe(false);
  });

  test("an absent context token and unknown item types are tolerated", async () => {
    const sim = new IlinkSimulator();
    sim.enqueue({ messageId: "1", fromUserId: "u", contextToken: null, items: [{ type: 1, text_item: { text: "x" } }, { type: 99 }, { type: 7 }] });
    const [message] = (await api(sim).getUpdates("", 1000)).messages;
    expect(message!.contextToken).toBeNull();
    expect(message!.items).toHaveLength(1);
    expect(message!.unknownItemTypes).toEqual([99, 7]);
  });

  test("a group message keeps its group id so the receive loop can drop it", async () => {
    const sim = new IlinkSimulator();
    sim.enqueue({ messageId: "2", fromUserId: "u", groupId: "g1@chatroom", text: "x" });
    expect((await api(sim).getUpdates("", 1000)).messages[0]!.groupId).toBe("g1@chatroom");
  });

  test("entries without an id or sender are skipped, not fatal", async () => {
    const sim = new IlinkSimulator();
    sim.respondRaw("ilink/bot/getupdates", '{"ret":0,"msgs":[{"from_user_id":"u"},{"message_id":5},"junk",null,{"message_id":6,"from_user_id":"u","item_list":[]}],"get_updates_buf":"b"}');
    expect((await api(sim).getUpdates("", 1000)).messages.map((message) => message.messageId)).toEqual(["6"]);
  });

  test("the buffer is returned verbatim and an empty one is null", async () => {
    const sim = new IlinkSimulator();
    sim.respondRaw("ilink/bot/getupdates", '{"ret":0,"msgs":[],"get_updates_buf":"AbC+/= weird"}');
    expect((await api(sim).getUpdates("", 1000)).nextBuffer).toBe("AbC+/= weird");
    sim.respondRaw("ilink/bot/getupdates", '{"ret":0,"msgs":[],"get_updates_buf":""}');
    expect((await api(sim).getUpdates("", 1000)).nextBuffer).toBeNull();
  });

  test("the client's own timeout is an empty poll, not a failure", async () => {
    const sim = new IlinkSimulator();
    sim.holdGetUpdates = true;
    const result = await api(sim).getUpdates("", 30);
    expect(result).toEqual({ messages: [], nextBuffer: null, longPollingTimeoutMs: null, timedOut: true });
  });
});

describe("error mapping", () => {
  test("-14 is a session expiry, any other non-zero ret is a business error", async () => {
    const sim = new IlinkSimulator();
    sim.failNext("ilink/bot/getupdates", -14);
    expect(await failure(api(sim).getUpdates("", 1000))).toMatchObject({ kind: "session_expired", endpoint: "getUpdates", code: -14 });
    sim.failNext("ilink/bot/getupdates", 500);
    expect(await failure(api(sim).getUpdates("", 1000))).toMatchObject({ kind: "business", code: 500 });
  });

  test("errcode counts like ret", async () => {
    const sim = new IlinkSimulator();
    sim.respondRaw("ilink/bot/getupdates", '{"errcode":-14}');
    expect((await failure(api(sim).getUpdates("", 1000))).kind).toBe("session_expired");
  });

  test("HTTP errors, transport errors and bad bodies are told apart", async () => {
    const sim = new IlinkSimulator();
    sim.failHttp("ilink/bot/getupdates", 502);
    expect(await failure(api(sim).getUpdates("", 1000))).toMatchObject({ kind: "http", code: 502 });
    sim.failTransport("ilink/bot/getupdates");
    expect((await failure(api(sim).getUpdates("", 1000))).kind).toBe("network");
    sim.respondRaw("ilink/bot/getupdates", "<html>gateway</html>");
    expect((await failure(api(sim).getUpdates("", 1000))).kind).toBe("invalid_response");
    sim.respondRaw("ilink/bot/getupdates", '{"ret":0,"msgs":"nope"}');
    expect((await failure(api(sim).getUpdates("", 1000))).kind).toBe("invalid_response");
  });

  test("errors name the endpoint and code only, never the token or body", async () => {
    const sim = new IlinkSimulator();
    sim.respondRaw("ilink/bot/sendmessage", '{"ret":7,"errmsg":"leaked tok-secret ctx-private"}');
    const error = await failure(api(sim).sendMessage({ toUserId: "u", clientId: "c", contextToken: "ctx-private", items: [] }));
    const serialized = `${error.message} ${JSON.stringify(error)} ${error.stack}`;
    for (const secret of ["tok-secret", "ctx-private", "leaked"]) expect(serialized).not.toContain(secret);
  });

  test("an oversized response body is refused", async () => {
    const client = new WechatApi({ fetch: async () => new Response(new Uint8Array(9 * 1024 * 1024)) });
    expect((await failure(client.getUpdates("", 1000))).kind).toBe("invalid_response");
  });
});

describe("QR login", () => {
  test("requests a code and returns the token and the text to encode", async () => {
    const sim = new IlinkSimulator();
    expect(await new WechatApi({ fetch: sim.fetch }).getBotQrcode()).toEqual({ qrcode: "sim-qr-1", qrcodeContent: "https://sim.weixin.qq.com/qr/1" });
  });

  test("walks wait -> scaned -> confirmed and returns the account", async () => {
    const sim = new IlinkSimulator();
    sim.qrStatuses = [{ status: "wait" }, { status: "scaned" }, { status: "confirmed" }];
    const client = new WechatApi({ fetch: sim.fetch });
    expect((await client.getQrcodeStatus("q")).status).toBe("wait");
    expect((await client.getQrcodeStatus("q")).status).toBe("scaned");
    expect(await client.getQrcodeStatus("q")).toEqual({
      status: "confirmed",
      botToken: "sim-bot-token",
      baseUrl: "https://acct.weixin.qq.com",
      ilinkBotId: "bot1@im.bot",
      ilinkUserId: "owner1@im.wechat",
    });
  });

  test("expiry and redirect statuses pass through; an unknown status is invalid", async () => {
    const sim = new IlinkSimulator();
    sim.qrStatuses = [{ status: "expired" }, { status: "scaned_but_redirect", redirect_host: "acct.weixin.qq.com" }, { status: "teleported" }];
    const client = new WechatApi({ fetch: sim.fetch });
    expect((await client.getQrcodeStatus("q")).status).toBe("expired");
    expect(await client.getQrcodeStatus("q")).toEqual({ status: "scaned_but_redirect", redirectHost: "acct.weixin.qq.com" });
    expect((await failure(client.getQrcodeStatus("q"))).kind).toBe("invalid_response");
  });

  test("a client-side timeout while waiting for a scan means still waiting", async () => {
    const client = new WechatApi({ fetch: (_url, init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason))) });
    expect(await client.getQrcodeStatus("q", 20)).toEqual({ status: "wait" });
  });
});

describe("sending", () => {
  test("sends a finished bot message with the reply token", async () => {
    const sim = new IlinkSimulator();
    await api(sim).sendMessage({ toUserId: "owner1@im.wechat", clientId: "ot-1-0", contextToken: "ctx-9", items: [WechatApi.textItem("hi")] });
    const sent = JSON.parse(sim.requests[0]!.body).msg;
    expect(sent).toMatchObject({ to_user_id: "owner1@im.wechat", client_id: "ot-1-0", context_token: "ctx-9", message_type: 2, message_state: 2 });
    expect(sent.item_list).toEqual([{ type: 1, text_item: { text: "hi" } }]);
  });
});
