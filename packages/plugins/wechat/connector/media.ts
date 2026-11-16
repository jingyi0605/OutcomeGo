import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { EXTERNAL_EXCHANGE_NAME_PATTERN } from "@outcomego/plugin-sdk/messaging";
import { isAllowedWechatUrl, WechatApiError, type WechatFetch } from "./api";
import {
  CDN_DOWNLOAD_PATH,
  CDN_PARAM,
  CDN_UPLOAD_PATH,
  CDN_UPLOAD_RESULT_HEADER,
  ILINK_CDN_BASE_URL,
  MEDIA_DOWNLOAD_ATTEMPTS,
  MEDIA_MAX_BYTES,
  OUTBOUND_KEY_ENCODING,
  type WechatMediaRef,
} from "./protocol";
import type { StateStore } from "./state";

/** Why one file did not come in. Maps straight to the `wechat_*` failure codes of design §5.1. */
export type MediaFailureCode = "wechat_media_too_large" | "wechat_media_download_failed" | "wechat_media_decrypt_failed";

export class MediaError extends Error {
  constructor(readonly code: MediaFailureCode | "wechat_media_invalid" | "wechat_media_upload_failed") {
    super(code);
    this.name = "MediaError";
  }
}

/**
 * The 16-byte AES key from its transport form. P8 (unverified): the field is base64 of either the raw
 * key or of the key's 32-character hex text; both decode to 16 bytes here, anything else is refused.
 */
export function decodeAesKey(encoded: string): Buffer | null {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 16) return bytes;
  const asText = bytes.toString("utf8");
  if (bytes.length === 32 && /^[0-9a-fA-F]{32}$/.test(asText)) return Buffer.from(asText, "hex");
  return null;
}

/** Where a download is fetched from: a full URL the server gave us, or the CDN plus the encrypted parameter. */
export function downloadUrl(ref: WechatMediaRef, cdn = ILINK_CDN_BASE_URL): string | null {
  if (ref.fullUrl) return isAllowedWechatUrl(ref.fullUrl) ? ref.fullUrl : null;
  if (!ref.encryptQueryParam) return null;
  const url = new URL(`${cdn.replace(/\/+$/, "")}/${CDN_DOWNLOAD_PATH}`);
  url.searchParams.set(CDN_PARAM, ref.encryptQueryParam);
  return isAllowedWechatUrl(url.toString()) ? url.toString() : null;
}

export interface FetchedMedia {
  exchangeName: string;
  byteSize: number;
  sha256: string;
  /** The first bytes of the plaintext, enough to tell what kind of file it is. */
  head: Buffer;
}

/** What a file is, from its first bytes. WeChat's own file names and types are not trusted. */
export function sniffMedia(head: Uint8Array): { extension: string; mimeType: string } | null {
  const bytes = Buffer.from(head);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return { extension: "png", mimeType: "image/png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: "jpg", mimeType: "image/jpeg" };
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) return { extension: "gif", mimeType: "image/gif" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return { extension: "webp", mimeType: "image/webp" };
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp") return { extension: "mp4", mimeType: "video/mp4" };
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { extension: "pdf", mimeType: "application/pdf" };
  return null;
}

const sha = () => createHash("sha256");

/** Media in both directions, and the exchange directory's rules. Holds no account state. */
export class WechatMedia {
  constructor(
    private readonly store: StateStore,
    private readonly fetchImpl: WechatFetch = (input, init) => fetch(input, init),
    private readonly cdnBase: string = ILINK_CDN_BASE_URL,
    private readonly maxBytes: number = MEDIA_MAX_BYTES
  ) {}

  // --- Inbound ----------------------------------------------------------------------------

  /**
   * Downloads, decrypts and stores one file as `exchange/inbound/<exchangeName>`. The name is made
   * here and never taken from WeChat. A declared size over the limit is refused without a request;
   * the real size is enforced while streaming.
   */
  async fetchInbound(ref: WechatMediaRef, declaredSize: number | undefined, exchangeName: string): Promise<FetchedMedia> {
    if (!EXTERNAL_EXCHANGE_NAME_PATTERN.test(exchangeName)) throw new MediaError("wechat_media_download_failed");
    if (declaredSize !== undefined && declaredSize > this.maxBytes) throw new MediaError("wechat_media_too_large");
    const url = downloadUrl(ref, this.cdnBase);
    const key = ref.aesKey ? decodeAesKey(ref.aesKey) : null;
    if (!url) throw new MediaError("wechat_media_download_failed");
    if (!key) throw new MediaError("wechat_media_decrypt_failed");
    let last: MediaError = new MediaError("wechat_media_download_failed");
    for (let attempt = 0; attempt < MEDIA_DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        return await this.downloadOnce(url, key, exchangeName);
      } catch (error) {
        if (!(error instanceof MediaError)) throw error;
        last = error;
        // A file that is too large stays too large; retrying only costs bandwidth.
        if (error.code === "wechat_media_too_large") break;
      }
    }
    throw last;
  }

  private async downloadOnce(url: string, key: Buffer, exchangeName: string): Promise<FetchedMedia> {
    const temporary = join(this.store.path("tmp"), `${exchangeName}.${randomBytes(4).toString("hex")}.part`);
    const target = join(this.store.path("exchange", "inbound"), exchangeName);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(120_000) });
    } catch {
      throw new MediaError("wechat_media_download_failed");
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new MediaError("wechat_media_download_failed");
    }
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      const decipher = createDecipheriv("aes-128-ecb", key, null);
      const hash = sha();
      let cipherBytes = 0;
      let plainBytes = 0;
      let head = Buffer.alloc(0);
      const reader = response.body.getReader();
      const emit = async (chunk: Buffer) => {
        if (!chunk.length) return;
        plainBytes += chunk.length;
        if (plainBytes > this.maxBytes) throw new MediaError("wechat_media_too_large");
        if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
        hash.update(chunk);
        await handle.write(chunk);
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          cipherBytes += value.byteLength;
          // The ciphertext is at most one block larger than the plaintext.
          if (cipherBytes > this.maxBytes + 16) throw new MediaError("wechat_media_too_large");
          await emit(decipher.update(value));
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        if (error instanceof MediaError) throw error;
        throw new MediaError("wechat_media_download_failed");
      }
      try {
        await emit(decipher.final());
      } catch (error) {
        if (error instanceof MediaError) throw error;
        // Bad padding or a length that is not a whole number of blocks: wrong key or damaged file.
        throw new MediaError("wechat_media_decrypt_failed");
      }
      await handle.sync();
      await handle.close();
      await rename(temporary, target);
      return { exchangeName, byteSize: plainBytes, sha256: hash.digest("hex"), head };
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  // --- Outbound ---------------------------------------------------------------------------

  /**
   * Opens a file the Server staged for this delivery. It must sit directly inside
   * `exchange/outbound/<deliveryId>/`, be a regular file (never a link), and match the declared size
   * and digest, or it is refused before anything leaves the machine.
   */
  async readOutbound(deliveryId: string, exchangeName: string, expected: { byteSize: number; sha256: string }): Promise<Buffer> {
    if (!/^[0-9a-f-]{36}$/i.test(deliveryId) || !EXTERNAL_EXCHANGE_NAME_PATTERN.test(exchangeName)) throw new MediaError("wechat_media_invalid");
    const directory = this.store.path("exchange", "outbound", deliveryId);
    try {
      const [real, parent] = await Promise.all([realpath(directory), realpath(this.store.path("exchange", "outbound"))]);
      if (!real.startsWith(parent + sep)) throw new MediaError("wechat_media_invalid");
      const path = join(directory, exchangeName);
      if (!(await lstat(path)).isFile()) throw new MediaError("wechat_media_invalid");
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size !== expected.byteSize || stats.size > this.maxBytes) throw new MediaError("wechat_media_invalid");
        const bytes = await handle.readFile();
        if (bytes.length !== expected.byteSize || sha().update(bytes).digest("hex") !== expected.sha256) throw new MediaError("wechat_media_invalid");
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError("wechat_media_invalid");
    }
  }

  /** The values `getuploadurl` needs for a plaintext, and the encrypted bytes to upload. */
  prepareUpload(plain: Buffer): { key: Buffer; keyParam: string; rawSize: number; rawMd5: string; cipherSize: number; cipher: Buffer } {
    const key = randomBytes(16);
    const encrypt = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([encrypt.update(plain), encrypt.final()]);
    return {
      key,
      keyParam: OUTBOUND_KEY_ENCODING === "hex-text" ? key.toString("hex") : key.toString("base64"),
      rawSize: plain.length,
      rawMd5: createHash("md5").update(plain).digest("hex"),
      cipherSize: encrypted.length,
      cipher: encrypted,
    };
  }

  /** Uploads encrypted bytes to the CDN and returns the reference the message item needs. */
  async upload(uploadParam: string | null, uploadFullUrl: string | null, cipher: Buffer): Promise<string> {
    const target = uploadFullUrl ?? (uploadParam ? this.uploadUrlFor(uploadParam) : null);
    if (!target || !isAllowedWechatUrl(target)) throw new MediaError("wechat_media_upload_failed");
    let response: Response;
    try {
      response = await this.fetchImpl(target, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: cipher as unknown as BodyInit,
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new MediaError("wechat_media_upload_failed");
    }
    await response.body?.cancel().catch(() => {});
    const reference = response.headers.get(CDN_UPLOAD_RESULT_HEADER);
    if (!response.ok || !reference) throw new MediaError("wechat_media_upload_failed");
    return reference;
  }

  private uploadUrlFor(param: string): string {
    const url = new URL(`${this.cdnBase.replace(/\/+$/, "")}/${CDN_UPLOAD_PATH}`);
    url.searchParams.set(CDN_PARAM, param);
    return url.toString();
  }

  /** Deletes inbound exchange files no queued message refers to, and outbound folders older than a day. */
  async sweepOutbound(maxAgeMs = 24 * 60 * 60_000): Promise<void> {
    const root = this.store.path("exchange", "outbound");
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(root).catch(() => [] as string[])) {
      const stats = await lstat(join(root, entry)).catch(() => null);
      if (stats && Date.now() - stats.mtimeMs > maxAgeMs) await rm(join(root, entry), { recursive: true, force: true });
    }
  }
}

export { WechatApiError };
