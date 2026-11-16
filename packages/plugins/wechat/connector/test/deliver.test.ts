import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DeliveryLog, WechatDeliverer } from "../deliver";
import { REPLY_WINDOW_MS } from "../peers";
import { createWorld, until, type Connector, type World } from "./fixtures/harness";

const OWNER = "owner1@im.wechat";
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let world: World;
let c: Connector;
let deliverer: WechatDeliverer;
let log: DeliveryLog;

const build = async (opts: { reply?: boolean } = {}) => {
  c = await world.start({ link: true });
  await until(() => c.account.status().state === "ready", "ready");
  if (opts.reply !== false) await c.peers.observe({ peerId: OWNER, isAccountOwner: true, at: new Date(world.clock.now), contextToken: "ctx-owner" });
  log = new DeliveryLog(c.store);
  await log.load();
  deliverer = new WechatDeliverer({ account: c.account, api: c.api, peers: c.peers, media: c.media, log, now: () => new Date(world.clock.now) });
};
const sentTexts = () => world.sim.sent.flatMap((message) => message.items.map((item) => (item as { text_item?: { text: string } }).text_item?.text));
const run = (input: Partial<Parameters<WechatDeliverer["deliver"]>[0]> = {}) => deliverer.deliver({ deliveryId: D1, peerId: OWNER, text: "hello", ...input });

beforeEach(async () => {
  world = await createWorld();
});
afterEach(() => world.cleanup());

describe("a good send", () => {
  test("sends the text with the contact's reply token and reports it accepted", async () => {
    await build();
    expect(await run({ text: "on it" })).toEqual({ status: "sent", note: "provider_accepted" });
    expect(world.sim.sent).toHaveLength(1);
    expect(world.sim.sent[0]).toMatchObject({ toUserId: OWNER, contextToken: "ctx-owner", clientId: `ot-${D1}-0` });
    expect(sentTexts()).toEqual(["on it"]);
  });

  test("a long text goes as several messages, in order, each within the limit", async () => {
    await build();
    const text = Array.from({ length: 6 }, (_, i) => `Part ${i}. ${"word ".repeat(120)}`).join("\n\n");
    expect((await run({ text })).status).toBe("sent");
    expect(world.sim.sent.length).toBeGreaterThan(1);
    for (const piece of sentTexts()) expect(Array.from(piece!).length).toBeLessThanOrEqual(1800);
    expect(world.sim.sent.map((message) => message.clientId)).toEqual(world.sim.sent.map((_, i) => `ot-${D1}-${i}`));
    expect(sentTexts().join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ").trim());
  });

  test("the result carries no token, cursor or account detail", async () => {
    await build();
    const text = JSON.stringify(await run());
    for (const secret of ["ctx-owner", world.sim.account.botToken, "buf-"]) expect(text).not.toContain(secret);
  });
});

describe("refused before anything is sent", () => {
  const nothingSent = () => expect(world.sim.sent).toEqual([]);

  test("a contact who has not written has no reply context", async () => {
    await build({ reply: false });
    expect(await run()).toMatchObject({ status: "failed", code: "wechat_context_missing" });
    nothingSent();
  });

  test("the window has closed", async () => {
    await build();
    world.clock.now += REPLY_WINDOW_MS + 1;
    expect(await run()).toMatchObject({ status: "failed", code: "wechat_context_expired" });
    nothingSent();
  });

  test("a message with nothing in it", async () => {
    await build();
    for (const text of ["", "   \n "]) expect(await run({ deliveryId: crypto.randomUUID(), text })).toMatchObject({ status: "failed", code: "wechat_delivery_empty" });
    nothingSent();
  });

  test("a message longer than one delivery may be", async () => {
    await build();
    expect(await run({ text: "x".repeat(9001) })).toMatchObject({ status: "failed", code: "wechat_text_too_long" });
    nothingSent();
  });

  test("an account that is not linked, or in its cool-down", async () => {
    await build();
    await c.account.reportSessionExpired();
    expect(await run()).toMatchObject({ status: "failed", code: "wechat_session_expired" });
    nothingSent();
  });

  test("an account that was never linked", async () => {
    c = await world.start();
    log = new DeliveryLog(c.store);
    await log.load();
    deliverer = new WechatDeliverer({ account: c.account, api: c.api, peers: c.peers, media: c.media, log });
    expect(await run()).toMatchObject({ status: "failed", code: "wechat_not_ready" });
    nothingSent();
  });

  test("more than twenty messages in a minute", async () => {
    await build();
    for (let i = 0; i < 20; i++) expect((await run({ deliveryId: crypto.randomUUID(), text: `m${i}` })).status).toBe("sent");
    expect(await run({ deliveryId: crypto.randomUUID(), text: "one too many" })).toMatchObject({ status: "failed", code: "wechat_rate_limited" });
    expect(world.sim.sent).toHaveLength(20);
    world.clock.now += 61_000;
    expect((await run({ deliveryId: crypto.randomUUID(), text: "a minute later" })).status).toBe("sent");
  });

  test("a delivery whose parts would pass the limit is refused whole, not half sent", async () => {
    await build();
    for (let i = 0; i < 18; i++) await run({ deliveryId: crypto.randomUUID(), text: `m${i}` });
    const before = world.sim.sent.length;
    const result = await run({ deliveryId: crypto.randomUUID(), text: Array.from({ length: 5 }, () => "word ".repeat(300)).join("\n\n") });
    expect(result).toMatchObject({ status: "failed", code: "wechat_rate_limited" });
    expect(world.sim.sent).toHaveLength(before);
  });
});

describe("a send that may or may not have gone out", () => {
  test.each([
    ["the connection drops", () => world.sim.failTransport("ilink/bot/sendmessage")],
    ["the server answers with an error status", () => world.sim.failHttp("ilink/bot/sendmessage", 502)],
    ["the answer is unreadable", () => world.sim.respondRaw("ilink/bot/sendmessage", "<html>")],
  ])("%s: the result is uncertain, and nothing is retried", async (_label, arrange) => {
    await build();
    arrange();
    expect(await run()).toMatchObject({ status: "uncertain", code: "wechat_delivery_unknown" });
    expect(world.sim.requests.filter((request) => request.url.pathname.endsWith("sendmessage"))).toHaveLength(1);
  });

  test("a clear refusal of the first part is a plain failure", async () => {
    await build();
    world.sim.failNext("ilink/bot/sendmessage", 40001);
    expect(await run()).toMatchObject({ status: "failed", code: "wechat_send_rejected" });
  });

  test("a refusal after some parts went out is uncertain, and says how many", async () => {
    await build();
    const text = Array.from({ length: 3 }, () => "word ".repeat(300)).join("\n\n");
    // The second part is refused; the first has already gone out.
    world.sim.intercept = ({ url, count }) => (url.pathname.endsWith("sendmessage") && count === 2 ? Response.json({ ret: 40001 }) : undefined);
    const result = await run({ text });
    expect(result).toMatchObject({ status: "uncertain", code: "wechat_partial_delivery" });
    expect((result as { message: string }).message).toContain("1 of");
    expect(world.sim.sent).toHaveLength(1);
  });

  test("the reply window closing on the first part fails and forgets that contact's token", async () => {
    await build();
    world.sim.failNext("ilink/bot/sendmessage", -14);
    expect(await run()).toMatchObject({ status: "failed", code: "wechat_context_expired" });
    expect(c.peers.tokenState(OWNER, new Date(world.clock.now))).toBe("missing");
    // The account itself is untouched by a refusal about one contact.
    expect(c.account.canSend).toBe(true);
    expect(c.account.status().state).not.toBe("needs_pairing");
  });
});

describe("once and only once", () => {
  test("the same delivery asked again returns the recorded result and sends nothing", async () => {
    await build();
    const first = await run({ text: "once" });
    const again = await run({ text: "once" });
    expect(again).toEqual(first);
    expect(world.sim.sent).toHaveLength(1);
  });

  test("a recorded failure is also returned as it was, not tried again", async () => {
    await build({ reply: false });
    const first = await run();
    await c.peers.observe({ peerId: OWNER, isAccountOwner: true, at: new Date(world.clock.now), contextToken: "now-there-is-one" });
    expect(await run()).toEqual(first);
    expect(world.sim.sent).toEqual([]);
  });

  test("two asks at the same moment send once", async () => {
    await build();
    const results = await Promise.all([run({ text: "race" }), run({ text: "race" }), run({ text: "race" })]);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(world.sim.sent).toHaveLength(1);
  });

  test("a process that died mid-send says uncertain afterwards, and does not send again", async () => {
    await build();
    // The send began and its start was recorded, but no result: the process was killed.
    await log.markStarted(D1, new Date(world.clock.now));
    const restarted = new DeliveryLog(c.store);
    await restarted.load();
    const after = new WechatDeliverer({ account: c.account, api: c.api, peers: c.peers, media: c.media, log: restarted, now: () => new Date(world.clock.now) });
    expect(await after.deliver({ deliveryId: D1, peerId: OWNER, text: "hello" })).toMatchObject({ status: "uncertain", code: "wechat_delivery_interrupted" });
    expect(world.sim.sent).toEqual([]);
    // And that answer is now the recorded one.
    expect(restarted.get(D1)?.result?.status).toBe("uncertain");
  });

  test("the record survives a restart: a finished delivery is not sent again", async () => {
    await build();
    await run({ text: "before restart" });
    const restarted = new DeliveryLog(c.store);
    await restarted.load();
    const after = new WechatDeliverer({ account: c.account, api: c.api, peers: c.peers, media: c.media, log: restarted, now: () => new Date(world.clock.now) });
    expect(await after.deliver({ deliveryId: D1, peerId: OWNER, text: "before restart" })).toEqual({ status: "sent", note: "provider_accepted" });
    expect(world.sim.sent).toHaveLength(1);
  });

  test("the start is on disk before the first request leaves", async () => {
    await build();
    const seen: boolean[] = [];
    world.sim.intercept = async ({ url }) => {
      if (url.pathname.endsWith("sendmessage")) seen.push((await readFile(c.store.path("deliveries.ndjson"), "utf8")).includes('"t":"started"'));
    };
    await run();
    expect(seen).toEqual([true]);
  });

  test("a damaged last line in the record loses only that line", async () => {
    await build();
    await run({ text: "kept" });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(c.store.path("deliveries.ndjson"), '{"t":"result","id":"x","re');
    const restarted = new DeliveryLog(c.store);
    await restarted.load();
    expect(restarted.get(D1)?.result?.status).toBe("sent");
  });

  test("the record keeps only the most recent deliveries", async () => {
    await build();
    for (let i = 0; i < 620; i++) await log.recordResult(`d-${i}`, new Date(world.clock.now), { status: "sent" });
    const restarted = new DeliveryLog(c.store);
    await restarted.load();
    expect(restarted.get("d-619")?.result?.status).toBe("sent");
    expect(restarted.get("d-0")).toBeUndefined();
    expect((await readFile(c.store.path("deliveries.ndjson"), "utf8")).split("\n").filter(Boolean).length).toBeLessThan(700);
  }, 30_000);
});

describe("pictures", () => {
  const stage = async (deliveryId: string, name: string, bytes: Uint8Array) => {
    await mkdir(c.store.path("exchange", "outbound", deliveryId), { recursive: true });
    await writeFile(c.store.path("exchange", "outbound", deliveryId, name), bytes);
    return { exchangeName: name, fileName: "chart.png", mimeType: "image/png", byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  };

  test("text first, then the picture, which the contact's device could decrypt", async () => {
    await build();
    const file = await stage(D1, "0-a.png", PNG);
    expect((await run({ text: "the chart", media: [file] })).status).toBe("sent");
    expect(world.sim.sent).toHaveLength(2);
    expect(sentTexts()[0]).toBe("the chart");
    const picture = world.sim.sent[1]!.items[0] as { type: number; image_item: { media: { encrypt_query_param: string; aes_key: string } } };
    expect(picture.type).toBe(2);
    expect(world.sim.cdn.has(picture.image_item.media.encrypt_query_param)).toBe(true);
    // The key sent in the message opens exactly what was uploaded.
    const { createDecipheriv } = await import("node:crypto");
    const key = Buffer.from(Buffer.from(picture.image_item.media.aes_key, "base64").toString("utf8"), "hex");
    const decipher = createDecipheriv("aes-128-ecb", key, null);
    expect(Buffer.concat([decipher.update(world.sim.cdn.get(picture.image_item.media.encrypt_query_param)!), decipher.final()])).toEqual(PNG);
  });

  test("a picture alone is enough", async () => {
    await build();
    const file = await stage(D1, "0-a.png", PNG);
    expect((await run({ text: undefined, media: [file] })).status).toBe("sent");
    expect(world.sim.sent).toHaveLength(1);
  });

  test("a file that does not match what the Server described is refused before any request", async () => {
    await build();
    const file = await stage(D1, "0-a.png", PNG);
    expect(await run({ media: [{ ...file, sha256: "f".repeat(64) }] })).toMatchObject({ status: "failed", code: "wechat_media_invalid" });
    expect(world.sim.requests.filter((request) => /sendmessage|getuploadurl/.test(request.url.pathname))).toEqual([]);
  });

  test("a file that is missing, or a link out of the folder, is refused", async () => {
    await build();
    const file = await stage(D1, "0-a.png", PNG);
    expect(await run({ deliveryId: D2, media: [file] })).toMatchObject({ status: "failed", code: "wechat_media_invalid" });
    expect(world.sim.sent).toEqual([]);
  });

  test("anything that is not a still image is refused for now", async () => {
    await build();
    const file = await stage(D1, "0-a.mp4", randomBytes(100));
    expect(await run({ media: [{ ...file, mimeType: "video/mp4" }] })).toMatchObject({ status: "failed", code: "wechat_media_invalid" });
    expect(world.sim.sent).toEqual([]);
  });

  test("an upload that fails sends nothing at all, not even the text", async () => {
    await build();
    const file = await stage(D1, "0-a.png", PNG);
    world.sim.failNext("ilink/bot/getuploadurl", 500);
    expect(await run({ text: "with a picture", media: [file] })).toMatchObject({ status: "failed", code: "wechat_media_upload_failed" });
    expect(world.sim.sent).toEqual([]);
  });

  test("a picture the CDN will not take sends nothing either", async () => {
    await build();
    const file = await stage(D1, "0-a.png", PNG);
    world.sim.intercept = ({ url }) => (url.hostname.startsWith("novac2c") ? new Response("", { status: 500 }) : undefined);
    expect(await run({ media: [file] })).toMatchObject({ status: "failed", code: "wechat_media_upload_failed" });
    expect(world.sim.sent).toEqual([]);
  });
});
