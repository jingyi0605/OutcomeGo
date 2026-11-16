import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createWorld, until, type Connector, type World } from "./fixtures/harness";

let world: World;
let c: Connector;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(() => world.cleanup());

const owner = "owner1@im.wechat";
const ids = (connector: Connector) => connector.spool.read(0, 100).map((item) => item.message.providerMessageId);
const msg = (messageId: string, text = `text ${messageId}`, extra: Record<string, unknown> = {}) => ({ messageId, fromUserId: owner, text, ...extra });
const imageItem = (param: string, key: Buffer, length?: number) => ({ type: 2, image_item: { media: { encrypt_query_param: param, aes_key: key.toString("base64") }, ...(length ? { len: length } : {}) } });
const encrypt = (plain: Uint8Array, key: Buffer) => {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("taking messages in", () => {
  test("messages are queued in order with exact ids, the owner flag, and a reply context", async () => {
    c = await world.start({ link: true });
    world.sim.enqueue(msg("18446744073709551615", "first"));
    world.sim.enqueue(msg("18446744073709551614", "second"));
    await until(() => ids(c).length === 2, "two messages");
    expect(ids(c)).toEqual(["18446744073709551615", "18446744073709551614"]);
    const [first] = c.spool.read(0, 1);
    expect(first!.message).toMatchObject({ text: "first", peer: { id: owner, type: "direct" }, sender: { id: owner, isAccountOwner: true } });
    expect(first!.ackCursor).toMatch(/:1$/);
    expect(c.peers.replyToken(owner, new Date(world.clock.now))?.token).toBe("ctx-18446744073709551614");
  });

  test("the provider cursor is saved after the batch, and the journal is gone", async () => {
    c = await world.start({ link: true });
    world.sim.enqueue(msg("1"));
    await until(() => ids(c).length === 1, "message");
    // The batch commits in order: queued, then the cursor, then the journal goes. Wait for the end of it.
    await until(async () => (await c.store.readCursor()).status === "ok" && (await c.journal.read()) === null, "batch committed");
    expect(await c.journal.read()).toBeNull();
    expect(await readdir(c.store.directory)).not.toContain("receive-journal.json");
  });

  test("what is not for the Bot is dropped and counted, not queued", async () => {
    c = await world.start({ link: true });
    world.sim.enqueue({ messageId: "1", fromUserId: owner, groupId: "g@chatroom", text: "group" });
    world.sim.enqueue({ messageId: "2", fromUserId: "bot1@im.bot", text: "echo of my own reply" });
    world.sim.enqueue({ messageId: "3", fromUserId: owner, items: [{ type: 99 }] });
    world.sim.enqueue(msg("4", "kept"));
    await until(() => ids(c).includes("4"), "kept message");
    expect(ids(c)).toEqual(["4"]);
    expect(c.account.status().dropped).toEqual({ group: 1, self: 1, empty: 1, duplicate: 0 });
  });

  test("a message from someone who is not the owner is passed on, marked as such", async () => {
    c = await world.start({ link: true });
    world.sim.enqueue({ messageId: "1", fromUserId: "stranger@im.wechat", text: "hi" });
    await until(() => ids(c).length === 1, "message");
    expect(c.spool.read(0, 1)[0]!.message.sender.isAccountOwner).toBe(false);
  });

  test("a message the provider hands over again is queued once", async () => {
    c = await world.start({ link: true });
    world.sim.enqueue(msg("1"));
    await until(() => ids(c).length === 1, "first delivery");
    // The provider replays an old position and sends it again.
    await c.store.writeCursor("");
    await Bun.sleep(120);
    expect(ids(c)).toEqual(["1"]);
  });

  test("the account reports ready after the first good poll", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    expect(c.account.status().lastPollOkAt).not.toBeNull();
  });
});

describe("the poll tool", () => {
  test("returns what follows the cursor, and acknowledging deletes", async () => {
    c = await world.start({ link: true });
    for (const id of ["1", "2", "3"]) world.sim.enqueue(msg(id));
    await until(() => ids(c).length === 3, "three queued");
    const first = await c.receive.poll({ cursor: null, limit: 2, waitMs: 0 });
    expect(first.messages.map((entry) => entry.message.providerMessageId)).toEqual(["1", "2"]);
    const second = await c.receive.poll({ cursor: first.messages[1]!.ackCursor, limit: 20, waitMs: 0 });
    expect(second.messages.map((entry) => entry.message.providerMessageId)).toEqual(["3"]);
    expect(ids(c)).toEqual(["3"]);
  });

  test("a cursor from another queue asks the Server to start over, and returns from the head", async () => {
    c = await world.start({ link: true });
    world.sim.enqueue(msg("1"));
    await until(() => ids(c).length === 1, "queued");
    const result = await c.receive.poll({ cursor: "some-old-queue:9", limit: 20, waitMs: 0 });
    expect(result.resetCursor).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  test("an empty queue waits for news and returns within a moment of it", async () => {
    c = await world.start({ link: true });
    const started = performance.now();
    const waiting = c.receive.poll({ cursor: null, limit: 20, waitMs: 5000 });
    setTimeout(() => world.sim.enqueue(msg("7000000000000000001")), 50);
    const result = await waiting;
    expect(result.messages.map((entry) => entry.message.providerMessageId)).toEqual(["7000000000000000001"]);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  test("it returns empty at the end of its wait", async () => {
    c = await world.start({ link: true });
    const result = await c.receive.poll({ cursor: null, limit: 20, waitMs: 60 });
    expect(result).toEqual({ messages: [] });
  });

  test("a newer poll releases the one that was waiting, empty", async () => {
    c = await world.start({ link: true });
    const older = c.receive.poll({ cursor: null, limit: 20, waitMs: 5000 });
    await Bun.sleep(30);
    const newer = c.receive.poll({ cursor: null, limit: 20, waitMs: 80 });
    expect(await older).toEqual({ messages: [] });
    expect(await newer).toEqual({ messages: [] });
  });

  test("an account that was never linked says so", async () => {
    c = await world.start();
    await expect(c.receive.poll({ cursor: null, limit: 20, waitMs: 0 })).rejects.toThrow("wechat_needs_pairing");
  });

  test("messages already fetched are still handed over after the session expired", async () => {
    c = await world.start({ link: true });
    world.sim.enqueue(msg("1"));
    await until(() => ids(c).length === 1, "queued");
    await c.account.reportSessionExpired();
    const result = await c.receive.poll({ cursor: null, limit: 20, waitMs: 0 });
    expect(result.messages).toHaveLength(1);
    // Once they are acknowledged and the queue is empty, it reports that pairing is needed.
    await expect(c.receive.poll({ cursor: result.messages[0]!.ackCursor, limit: 20, waitMs: 0 })).rejects.toThrow("wechat_needs_pairing");
  });
});

describe("when the provider fails", () => {
  test("the loop keeps trying and recovers on its own", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.failTransport("ilink/bot/getupdates", 3);
    await until(() => c.account.status().state === "recovering", "recovering");
    expect(c.account.status().consecutiveFailures).toBeGreaterThan(0);
    await until(() => c.account.status().state === "ready", "ready again");
    expect(c.account.status().consecutiveFailures).toBe(0);
    world.sim.enqueue(msg("7000000000000000002"));
    await until(() => ids(c).includes("7000000000000000002"), "message after recovery");
  });

  test("business and HTTP errors are retried too, and the cursor does not move", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.enqueue(msg("1"));
    await until(() => ids(c).length === 1, "first");
    const before = await c.store.readCursor();
    world.sim.failNext("ilink/bot/getupdates", 500, 2);
    world.sim.failHttp("ilink/bot/getupdates", 502, 2);
    await until(() => c.account.status().consecutiveFailures >= 1, "failure noticed");
    await until(() => c.account.status().state === "ready" && c.account.status().consecutiveFailures === 0, "recovered");
    expect(before.status).toBe("ok");
    expect(ids(c)).toEqual(["1"]);
  });

  test("a failing connector does not busy-loop", async () => {
    c = await world.start({ link: true, timing: { retryMs: 40, slowRetryMs: 40 } });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.failTransport("ilink/bot/getupdates", 1000);
    const before = world.sim.requests.length;
    await Bun.sleep(200);
    expect(world.sim.requests.length - before).toBeLessThan(15);
  });
});

describe("a full queue", () => {
  test("stops fetching, says so, and resumes once the Server has caught up", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    for (let i = 0; i < 500; i++) await c.spool.append({ providerMessageId: `fill-${i}`, peer: { id: owner, type: "direct" }, sender: { id: owner, isAccountOwner: true }, text: "x", occurredAt: new Date(world.clock.now).toISOString() }, new Date());
    world.sim.enqueue(msg("7000000000000000003"));
    await until(() => c.account.status().state === "backlogged", "backlogged");
    const before = world.sim.requests.filter((request) => request.url.pathname.endsWith("getupdates")).length;
    await Bun.sleep(150);
    expect(world.sim.requests.filter((request) => request.url.pathname.endsWith("getupdates")).length).toBe(before);
    expect(c.spool.has("7000000000000000003")).toBe(false);
    // The Server acknowledges most of them: below 80% the loop resumes and takes the waiting message.
    await c.spool.ack(c.spool.cursorFor(150));
    await until(() => c.spool.has("7000000000000000003"), "resumed", 6000);
    expect(c.account.status().state).toBe("ready");
  }, 30_000);
});

describe("when the session expires", () => {
  test("receiving stops and the account asks to be scanned again", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.failNext("ilink/bot/getupdates", -14);
    await until(() => c.account.status().state === "needs_pairing", "paused");
    expect(c.account.status().reason).toBe("session_expired");
    expect(c.account.canSend).toBe(false);
    await until(() => !c.receive.isRunning, "loop ended");
  });

  test("no request leaves while the cool-down runs", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.failNext("ilink/bot/getupdates", -14);
    await until(() => c.account.status().state === "needs_pairing", "paused");
    const before = world.sim.requests.length;
    await Bun.sleep(150);
    expect(world.sim.requests.length).toBe(before);
  });

  test("after the cool-down one probe decides: success resumes the account", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.failNext("ilink/bot/getupdates", -14);
    await until(() => c.account.status().state === "needs_pairing", "paused");
    world.clock.now += 61 * 60_000;
    expect(await c.receive.runProbe()).toBe("resumed");
    expect(c.account.status().state).not.toBe("needs_pairing");
    expect(c.account.canSend).toBe(true);
    await until(() => c.receive.isRunning, "loop restarted");
  });

  test("a probe that is refused again discards the credentials", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.failNext("ilink/bot/getupdates", -14);
    await until(() => c.account.status().state === "needs_pairing", "paused");
    world.sim.failNext("ilink/bot/getupdates", -14);
    world.clock.now += 61 * 60_000;
    expect(await c.receive.runProbe()).toBe("discarded");
    expect(c.account.isLinked).toBe(false);
    expect((await c.store.readAccount()).status).toBe("missing");
  });

  test("a probe that fails for another reason leaves the account paused to try later", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.failNext("ilink/bot/getupdates", -14);
    await until(() => c.account.status().state === "needs_pairing", "paused");
    world.sim.failTransport("ilink/bot/getupdates", 1);
    world.clock.now += 61 * 60_000;
    expect(await c.receive.runProbe()).toBe("later");
    expect(c.account.isLinked).toBe(true);
    expect(c.account.status().state).toBe("needs_pairing");
  });

  test("messages the probe is handed are queued, never thrown away", async () => {
    c = await world.start({ link: true });
    await until(() => c.account.status().state === "ready", "ready");
    world.sim.failNext("ilink/bot/getupdates", -14);
    await until(() => c.account.status().state === "needs_pairing", "paused");
    world.sim.enqueue(msg("7000000000000000004"));
    world.clock.now += 61 * 60_000;
    expect(await c.receive.runProbe()).toBe("resumed");
    await until(() => ids(c).includes("7000000000000000004"), "message queued");
    expect(ids(c).filter((id) => id === "7000000000000000004")).toHaveLength(1);
  });
});

describe("files", () => {
  const key = randomBytes(16);

  test("a picture is fetched, decrypted, named by us and queued with its size and digest", async () => {
    c = await world.start({ link: true });
    world.sim.cdn.set("pic-1", encrypt(PNG, key));
    world.sim.enqueue({ messageId: "1", fromUserId: owner, items: [{ type: 1, text_item: { text: "look" } }, imageItem("pic-1", key, PNG.length)] });
    await until(() => ids(c).length === 1, "message with picture");
    const [entry] = c.spool.read(0, 1);
    const media = entry!.message.media!;
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ exchangeName: "1-0", mimeType: "image/png", byteSize: PNG.length, sha256: createHash("sha256").update(PNG).digest("hex") });
    expect(media[0]!.fileName).toMatch(/^media-1\.png$/);
    expect(await readFile(c.store.path("exchange", "inbound", "1-0"))).toEqual(PNG);
  });

  test("a picture that cannot be fetched is reported, and the message still goes through", async () => {
    c = await world.start({ link: true });
    world.sim.enqueue({ messageId: "1", fromUserId: owner, items: [{ type: 1, text_item: { text: "look" } }, imageItem("not-there", key)] });
    await until(() => ids(c).length === 1, "message");
    const message = c.spool.read(0, 1)[0]!.message;
    expect(message.text).toBe("look");
    expect(message.media).toBeUndefined();
    expect(message.mediaFailures).toEqual([{ code: "wechat_media_download_failed" }]);
    expect(await readdir(c.store.path("exchange", "inbound"))).toEqual([]);
  });

  test("an undecryptable picture is reported as such", async () => {
    c = await world.start({ link: true });
    world.sim.cdn.set("pic-2", encrypt(PNG, key));
    world.sim.enqueue({ messageId: "1", fromUserId: owner, items: [imageItem("pic-2", randomBytes(16))] });
    await until(() => ids(c).length === 1, "message");
    expect(c.spool.read(0, 1)[0]!.message.mediaFailures).toEqual([{ code: "wechat_media_decrypt_failed" }]);
  });

  test("files of one message get distinct names, and are removed once acknowledged", async () => {
    c = await world.start({ link: true });
    world.sim.cdn.set("a", encrypt(PNG, key));
    world.sim.cdn.set("b", encrypt(Buffer.concat([PNG, Buffer.from([1])]), key));
    world.sim.enqueue({ messageId: "1", fromUserId: owner, items: [imageItem("a", key), imageItem("b", key)] });
    await until(() => ids(c).length === 1, "message");
    expect(c.spool.read(0, 1)[0]!.message.media!.map((file) => file.exchangeName)).toEqual(["1-0", "1-1"]);
    expect((await readdir(c.store.path("exchange", "inbound"))).sort()).toEqual(["1-0", "1-1"]);
    await c.receive.poll({ cursor: c.spool.cursorFor(1), limit: 20, waitMs: 0 });
    expect(await readdir(c.store.path("exchange", "inbound"))).toEqual([]);
  });

  test("a hostile file name from WeChat never becomes a path", async () => {
    c = await world.start({ link: true });
    world.sim.cdn.set("pic-3", encrypt(PNG, key));
    world.sim.enqueue({ messageId: "1", fromUserId: owner, items: [{ type: 4, file_item: { file_name: "../../etc/passwd\n.png", media: { encrypt_query_param: "pic-3", aes_key: key.toString("base64") } } }] });
    await until(() => ids(c).length === 1, "message");
    const media = c.spool.read(0, 1)[0]!.message.media![0]!;
    expect(media.exchangeName).toBe("1-0");
    expect(media.fileName).toMatch(/^[A-Za-z0-9_-]+\.png$/);
    expect(await readdir(c.store.path("exchange", "inbound"))).toEqual(["1-0"]);
  });

  test("a type that WeChat's name claims is not trusted over the bytes", async () => {
    c = await world.start({ link: true });
    world.sim.cdn.set("pic-4", encrypt(PNG, key));
    world.sim.enqueue({ messageId: "1", fromUserId: owner, items: [{ type: 4, file_item: { file_name: "report.pdf", media: { encrypt_query_param: "pic-4", aes_key: key.toString("base64") } } }] });
    await until(() => ids(c).length === 1, "message");
    expect(c.spool.read(0, 1)[0]!.message.media![0]).toMatchObject({ fileName: "report.png", mimeType: "image/png" });
  });
});
