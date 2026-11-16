import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeAesKey, downloadUrl, MediaError, WechatMedia } from "../media";
import { StateStore } from "../state";

let root: string;
let store: StateStore;
const DELIVERY = "22222222-2222-4222-8222-222222222222";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encrypt = (plain: Uint8Array, key: Buffer) => {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
};
const rawKeyParam = (key: Buffer) => key.toString("base64");
const hexKeyParam = (key: Buffer) => Buffer.from(key.toString("hex")).toString("base64");

/** A CDN that serves bytes by parameter, and records what it was asked. */
const cdn = (files: Record<string, Uint8Array | (() => Response)>) => {
  const requests: string[] = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    requests.push(`${init.method} ${input}`);
    const param = new URL(input).searchParams.get("encrypted_query_param") ?? "";
    const served = files[param];
    if (!served) return new Response("nope", { status: 404 });
    return typeof served === "function" ? served() : new Response(served as unknown as BodyInit);
  };
  return { requests, fetchImpl };
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wechat-media-"));
  store = new StateStore(join(root, "state"));
  await store.prepare();
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("keys", () => {
  const key = randomBytes(16);
  test("both transport encodings of the same key decode to it", () => {
    expect(decodeAesKey(rawKeyParam(key))).toEqual(key);
    expect(decodeAesKey(hexKeyParam(key))).toEqual(key);
  });
  test.each([["empty", ""], ["short", Buffer.from("abc").toString("base64")], ["32 bytes that are not hex text", Buffer.alloc(32, 1).toString("base64")], ["junk", "%%%"]])("a key that is %s is refused", (_label, value) => {
    expect(decodeAesKey(value)).toBeNull();
  });
});

describe("download address", () => {
  test("a full address is used when it is on a WeChat host", () => {
    expect(downloadUrl({ fullUrl: "https://novac2c.cdn.weixin.qq.com/c2c/x?y=1" })).toBe("https://novac2c.cdn.weixin.qq.com/c2c/x?y=1");
  });
  test.each(["http://novac2c.cdn.weixin.qq.com/x", "https://evil.test/x", "https://weixin.qq.com.evil.test/x", "https://u:p@novac2c.cdn.weixin.qq.com/x"])("%s is refused", (url) => {
    expect(downloadUrl({ fullUrl: url })).toBeNull();
  });
  test("an encrypted parameter is placed on the CDN, escaped", () => {
    const url = downloadUrl({ encryptQueryParam: "a b&c=d" })!;
    expect(new URL(url).hostname).toBe("novac2c.cdn.weixin.qq.com");
    expect(new URL(url).searchParams.get("encrypted_query_param")).toBe("a b&c=d");
  });
  test("nothing to fetch from means no address", () => {
    expect(downloadUrl({})).toBeNull();
  });
});

describe("inbound", () => {
  const key = randomBytes(16);
  const image = randomBytes(5000);

  test("decrypts to a file named by us, with the size and digest of the plaintext", async () => {
    const server = cdn({ p1: encrypt(image, key) });
    const media = new WechatMedia(store, server.fetchImpl);
    const result = await media.fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, image.length, "7-0");
    expect(result).toEqual({ exchangeName: "7-0", byteSize: image.length, sha256: sha(image), head: image.subarray(0, 16) });
    expect(await readFile(store.path("exchange", "inbound", "7-0"))).toEqual(image);
    expect((await stat(store.path("exchange", "inbound", "7-0"))).mode & 0o777).toBe(0o600);
    expect(await readdir(store.path("tmp"))).toEqual([]);
  });

  test("accepts the hex-text key form too", async () => {
    const media = new WechatMedia(store, cdn({ p1: encrypt(image, key) }).fetchImpl);
    expect((await media.fetchInbound({ encryptQueryParam: "p1", aesKey: hexKeyParam(key) }, undefined, "1-0")).sha256).toBe(sha(image));
  });

  test("a file whose size is an exact block multiple round-trips", async () => {
    const exact = randomBytes(64);
    const media = new WechatMedia(store, cdn({ p1: encrypt(exact, key) }).fetchImpl);
    expect((await media.fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, 64, "1-0")).byteSize).toBe(64);
  });

  test("an empty file round-trips", async () => {
    const media = new WechatMedia(store, cdn({ p1: encrypt(Buffer.alloc(0), key) }).fetchImpl);
    expect((await media.fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, 0, "1-0")).byteSize).toBe(0);
  });

  test("the wrong key is a decryption failure and leaves no file", async () => {
    const media = new WechatMedia(store, cdn({ p1: encrypt(image, key) }).fetchImpl);
    await expect(media.fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(randomBytes(16)) }, undefined, "2-0")).rejects.toMatchObject({ code: "wechat_media_decrypt_failed" });
    expect(await readdir(store.path("exchange", "inbound"))).toEqual([]);
    expect(await readdir(store.path("tmp"))).toEqual([]);
  });

  test("a truncated download is a decryption failure, not a short file", async () => {
    const media = new WechatMedia(store, cdn({ p1: encrypt(image, key).subarray(0, 4001) }).fetchImpl);
    await expect(media.fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, undefined, "3-0")).rejects.toMatchObject({ code: "wechat_media_decrypt_failed" });
    expect(await readdir(store.path("exchange", "inbound"))).toEqual([]);
  });

  test("a declared size over the limit is refused without a request", async () => {
    const server = cdn({ p1: encrypt(image, key) });
    await expect(new WechatMedia(store, server.fetchImpl, undefined, 1000).fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, 1001, "4-0")).rejects.toMatchObject({ code: "wechat_media_too_large" });
    expect(server.requests).toEqual([]);
  });

  test("a download that turns out larger than allowed is stopped as it streams, and not retried", async () => {
    const server = cdn({ p1: encrypt(randomBytes(3000), key) });
    const media = new WechatMedia(store, server.fetchImpl, undefined, 1000);
    await expect(media.fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, undefined, "5-0")).rejects.toMatchObject({ code: "wechat_media_too_large" });
    expect(server.requests).toHaveLength(1);
    expect(await readdir(store.path("exchange", "inbound"))).toEqual([]);
    expect(await readdir(store.path("tmp"))).toEqual([]);
  });

  test("a failing download is tried three times, then reported", async () => {
    const server = cdn({ p1: () => new Response("bad", { status: 502 }) });
    await expect(new WechatMedia(store, server.fetchImpl).fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, undefined, "6-0")).rejects.toMatchObject({ code: "wechat_media_download_failed" });
    expect(server.requests).toHaveLength(3);
  });

  test("a download that works on the second try succeeds", async () => {
    let calls = 0;
    const server = cdn({ p1: () => (++calls === 1 ? new Response("bad", { status: 503 }) : new Response(encrypt(image, key) as unknown as BodyInit)) });
    expect((await new WechatMedia(store, server.fetchImpl).fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, undefined, "8-0")).sha256).toBe(sha(image));
  });

  test("a transport error counts as a failed download", async () => {
    const media = new WechatMedia(store, async () => { throw new TypeError("reset"); });
    await expect(media.fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, undefined, "9-0")).rejects.toMatchObject({ code: "wechat_media_download_failed" });
  });

  test("the request refuses redirects", async () => {
    const seen: RequestInit[] = [];
    await new WechatMedia(store, async (_url, init) => (seen.push(init), new Response(encrypt(image, key) as unknown as BodyInit))).fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, undefined, "1-1");
    expect(seen[0]!.redirect).toBe("error");
  });

  test.each([
    ["no key", { encryptQueryParam: "p1" }, "wechat_media_decrypt_failed"],
    ["a key of the wrong size", { encryptQueryParam: "p1", aesKey: Buffer.from("abc").toString("base64") }, "wechat_media_decrypt_failed"],
    ["no address", { aesKey: "" }, "wechat_media_download_failed"],
    ["an address off WeChat", { fullUrl: "https://evil.test/x", aesKey: rawKeyParam(key) }, "wechat_media_download_failed"],
  ])("%s is refused before any request", async (_label, ref, code) => {
    const server = cdn({ p1: encrypt(image, key) });
    await expect(new WechatMedia(store, server.fetchImpl).fetchInbound(ref, undefined, "1-2")).rejects.toMatchObject({ code });
    expect(server.requests).toEqual([]);
  });

  test.each(["../x", "a/b", ".hidden", "", "x".repeat(121)])("the file name %j is refused", async (name) => {
    await expect(new WechatMedia(store, cdn({}).fetchImpl).fetchInbound({ encryptQueryParam: "p1", aesKey: rawKeyParam(key) }, undefined, name)).rejects.toBeInstanceOf(MediaError);
  });
});

describe("outbound files", () => {
  const bytes = randomBytes(300);
  const stage = async (name: string, content: Uint8Array = bytes) => {
    await mkdir(store.path("exchange", "outbound", DELIVERY), { recursive: true });
    await writeFile(store.path("exchange", "outbound", DELIVERY, name), content);
  };
  const media = () => new WechatMedia(store, cdn({}).fetchImpl);

  test("a staged file with the right size and digest is read", async () => {
    await stage("0-a.png");
    expect(await media().readOutbound(DELIVERY, "0-a.png", { byteSize: 300, sha256: sha(bytes) })).toEqual(bytes);
  });
  test.each([
    ["the wrong size", { byteSize: 299, sha256: "" }],
    ["the wrong digest", { byteSize: 300, sha256: "f".repeat(64) }],
  ])("a file with %s is refused", async (_label, expected) => {
    await stage("0-a.png");
    await expect(media().readOutbound(DELIVERY, "0-a.png", { byteSize: expected.byteSize, sha256: expected.sha256 || sha(bytes) })).rejects.toMatchObject({ code: "wechat_media_invalid" });
  });
  test("a missing file, a bad name and a bad delivery id are refused", async () => {
    await expect(media().readOutbound(DELIVERY, "absent.png", { byteSize: 1, sha256: "a".repeat(64) })).rejects.toMatchObject({ code: "wechat_media_invalid" });
    await stage("0-a.png");
    for (const name of ["../0-a.png", "a/b", ""]) await expect(media().readOutbound(DELIVERY, name, { byteSize: 300, sha256: sha(bytes) })).rejects.toMatchObject({ code: "wechat_media_invalid" });
    await expect(media().readOutbound("../etc", "0-a.png", { byteSize: 300, sha256: sha(bytes) })).rejects.toMatchObject({ code: "wechat_media_invalid" });
  });
  test("a symlink is refused even when it points at an identical file", async () => {
    await writeFile(join(root, "outside.png"), bytes);
    await mkdir(store.path("exchange", "outbound", DELIVERY), { recursive: true });
    await symlink(join(root, "outside.png"), store.path("exchange", "outbound", DELIVERY, "0-link.png"));
    await expect(media().readOutbound(DELIVERY, "0-link.png", { byteSize: 300, sha256: sha(bytes) })).rejects.toMatchObject({ code: "wechat_media_invalid" });
  });
  test("a delivery folder that is a symlink out of the exchange is refused", async () => {
    await mkdir(join(root, "elsewhere"));
    await writeFile(join(root, "elsewhere", "0-a.png"), bytes);
    await mkdir(store.path("exchange", "outbound"), { recursive: true });
    await symlink(join(root, "elsewhere"), store.path("exchange", "outbound", DELIVERY));
    await expect(media().readOutbound(DELIVERY, "0-a.png", { byteSize: 300, sha256: sha(bytes) })).rejects.toMatchObject({ code: "wechat_media_invalid" });
  });
  test("a file over the size limit is refused", async () => {
    await stage("0-a.png");
    await expect(new WechatMedia(store, cdn({}).fetchImpl, undefined, 100).readOutbound(DELIVERY, "0-a.png", { byteSize: 300, sha256: sha(bytes) })).rejects.toMatchObject({ code: "wechat_media_invalid" });
  });
});

describe("outbound upload", () => {
  test("the encrypted bytes decrypt back with the key sent in the request", () => {
    const plain = randomBytes(1234);
    const prepared = new WechatMedia(store).prepareUpload(plain);
    expect(prepared.rawSize).toBe(1234);
    expect(prepared.rawMd5).toBe(createHash("md5").update(plain).digest("hex"));
    expect(prepared.cipherSize).toBe(prepared.cipher.length);
    expect(prepared.cipherSize % 16).toBe(0);
    expect(prepared.cipherSize).toBeGreaterThan(plain.length);
    const decipher = createDecipheriv("aes-128-ecb", Buffer.from(prepared.keyParam, "hex"), null);
    expect(Buffer.concat([decipher.update(prepared.cipher), decipher.final()])).toEqual(plain);
  });
  test("every upload uses a fresh key", () => {
    const media = new WechatMedia(store);
    const plain = randomBytes(64);
    expect(media.prepareUpload(plain).keyParam).not.toBe(media.prepareUpload(plain).keyParam);
  });
  test("returns the reference the CDN gives back", async () => {
    const seen: Array<{ url: string; type: string | null; size: number }> = [];
    const media = new WechatMedia(store, async (url, init) => {
      seen.push({ url, type: new Headers(init.headers).get("content-type"), size: (init.body as Buffer).length });
      return new Response("", { headers: { "x-encrypted-param": "download-ref" } });
    });
    expect(await media.upload("upload-param", null, randomBytes(48))).toBe("download-ref");
    expect(seen[0]).toMatchObject({ type: "application/octet-stream", size: 48 });
    expect(new URL(seen[0]!.url).hostname).toBe("novac2c.cdn.weixin.qq.com");
  });
  test.each([
    ["a CDN error", async () => new Response("", { status: 500, headers: { "x-encrypted-param": "x" } })],
    ["no reference header", async () => new Response("")],
    ["a transport error", async () => { throw new TypeError("down"); }],
  ])("%s is an upload failure", async (_label, respond) => {
    await expect(new WechatMedia(store, respond as never).upload("p", null, randomBytes(16))).rejects.toMatchObject({ code: "wechat_media_upload_failed" });
  });
  test("an upload address off WeChat is refused without a request", async () => {
    let called = 0;
    const media = new WechatMedia(store, async () => (called++, new Response("")));
    await expect(media.upload(null, "https://evil.test/up", randomBytes(16))).rejects.toMatchObject({ code: "wechat_media_upload_failed" });
    await expect(media.upload(null, null, randomBytes(16))).rejects.toMatchObject({ code: "wechat_media_upload_failed" });
    expect(called).toBe(0);
  });
  test("outbound folders older than the limit are swept and newer ones stay", async () => {
    const { utimes } = await import("node:fs/promises");
    await mkdir(store.path("exchange", "outbound", "old"), { recursive: true });
    await mkdir(store.path("exchange", "outbound", "recent"), { recursive: true });
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    await utimes(store.path("exchange", "outbound", "old"), twoDaysAgo, twoDaysAgo);
    await new WechatMedia(store).sweepOutbound();
    expect(await readdir(store.path("exchange", "outbound"))).toEqual(["recent"]);
  });
});

describe("what a file is", () => {
  const cases: Array<[string, string, string]> = [
    ["a PNG", "89504e470d0a1a0a0000000d", "png"],
    ["a JPEG", "ffd8ffe000104a464946", "jpg"],
    ["a GIF", "474946383961", "gif"],
    ["a WebP", "52494646000000005745425" + "0", "webp"],
    ["an MP4", "000000186674797069736f6d", "mp4"],
    ["a PDF", "255044462d312e34", "pdf"],
  ];
  test.each(cases)("%s is recognised from its first bytes", async (_label, hex, extension) => {
    const { sniffMedia } = await import("../media");
    expect(sniffMedia(Buffer.from(hex, "hex"))?.extension).toBe(extension);
  });
  test("anything else, or too little to tell, is unknown", async () => {
    const { sniffMedia } = await import("../media");
    expect(sniffMedia(Buffer.from("hello world"))).toBeNull();
    expect(sniffMedia(Buffer.alloc(0))).toBeNull();
    expect(sniffMedia(Buffer.from("89504e47", "hex"))).toBeNull();
  });
});
