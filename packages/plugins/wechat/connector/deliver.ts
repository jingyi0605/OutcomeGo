import { constants } from "node:fs";
import { open, readFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { ExternalDeliverInput, ExternalDeliverResult } from "@outcomego/plugin-sdk/messaging";
import type { WechatAccount } from "./account";
import { WechatApi, WechatApiError } from "./api";
import { MediaError, WechatMedia } from "./media";
import type { PeerBook } from "./peers";
import { DELIVERY_LOG_LIMIT, ITEM_TYPE, MAX_DELIVERY_TEXT_CHARS, SEND_RATE_LIMIT, SEND_RATE_WINDOW_MS, UPLOAD_MEDIA_TYPE } from "./protocol";
import { splitText } from "./split";
import type { StateStore } from "./state";

const LOG = "deliveries.ndjson";

type LogRecord =
  | { t: "started"; id: string; at: string }
  | { t: "result"; id: string; at: string; result: ExternalDeliverResult };

const failed = (code: string, message: string): ExternalDeliverResult => ({ status: "failed", code, message });
const uncertain = (code: string, message: string): ExternalDeliverResult => ({ status: "uncertain", code, message });

/**
 * The record that makes a delivery happen at most once. `started` is written, and flushed, before the
 * first provider request, so a crash mid-send leaves a trace that says "this may have gone out".
 */
export class DeliveryLog {
  private records = new Map<string, { started: boolean; result?: ExternalDeliverResult }>();
  private order: string[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: StateStore) {}

  async load(): Promise<void> {
    let raw = "";
    try {
      raw = await readFile(this.store.path(LOG), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.records.clear();
    this.order = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const record = JSON.parse(line) as LogRecord;
        if (record.t !== "started" && record.t !== "result") continue;
        const entry = this.records.get(record.id) ?? { started: false };
        if (!this.records.has(record.id)) this.order.push(record.id);
        if (record.t === "started") entry.started = true;
        else entry.result = record.result;
        this.records.set(record.id, entry);
      } catch {
        // A line cut off by a crash: everything before it still counts.
        break;
      }
    }
  }

  get(id: string) {
    return this.records.get(id);
  }

  private append(record: LogRecord): Promise<void> {
    const write = this.tail.then(async () => {
      const handle = await open(this.store.path(LOG), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, 0o600);
      try {
        await handle.write(`${JSON.stringify(record)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const entry = this.records.get(record.id) ?? { started: false };
      if (!this.records.has(record.id)) this.order.push(record.id);
      if (record.t === "started") entry.started = true;
      else entry.result = record.result;
      this.records.set(record.id, entry);
    });
    this.tail = write.catch(() => {});
    return write;
  }

  markStarted(id: string, at: Date): Promise<void> {
    return this.append({ t: "started", id, at: at.toISOString() });
  }

  async recordResult(id: string, at: Date, result: ExternalDeliverResult): Promise<void> {
    await this.append({ t: "result", id, at: at.toISOString(), result });
    await this.compactIfNeeded();
  }

  /** Keeps the newest records. Rewritten atomically so a crash never leaves a half file. */
  private async compactIfNeeded(): Promise<void> {
    if (this.order.length <= DELIVERY_LOG_LIMIT * 1.2) return;
    const keep = this.order.slice(-DELIVERY_LOG_LIMIT);
    const lines: string[] = [];
    const now = new Date().toISOString();
    for (const id of keep) {
      const entry = this.records.get(id)!;
      if (entry.started) lines.push(JSON.stringify({ t: "started", id, at: now }));
      if (entry.result) lines.push(JSON.stringify({ t: "result", id, at: now, result: entry.result }));
    }
    const temporary = this.store.path(`${LOG}.${randomBytes(4).toString("hex")}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handle.writeFile(`${lines.join("\n")}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.tail.catch(() => {});
    await rename(temporary, this.store.path(LOG));
    const dropped = this.order.slice(0, -DELIVERY_LOG_LIMIT);
    for (const id of dropped) this.records.delete(id);
    this.order = keep;
  }
}

export interface DelivererOptions {
  account: Pick<WechatAccount, "canSend" | "status" | "inCooldown" | "peers" | "api" | "ownerId">;
  api: WechatApi;
  peers: PeerBook;
  media: WechatMedia;
  log: DeliveryLog;
  now?: () => Date;
}

/**
 * Sends the Bot's reply. The rule above every other: a message is never sent twice. Anything that can be
 * decided before the first provider request is a plain refusal; once a request may have left, any answer
 * short of a clear success is "uncertain", and nothing here ever retries.
 */
export class WechatDeliverer {
  private readonly now: () => Date;
  private sentAt: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: DelivererOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** One delivery at a time, so two replies cannot interleave their parts. */
  deliver(input: ExternalDeliverInput): Promise<ExternalDeliverResult> {
    const run = this.queue.then(() => this.deliverNow(input));
    this.queue = run.catch(() => {});
    return run;
  }

  private async deliverNow(input: ExternalDeliverInput): Promise<ExternalDeliverResult> {
    const { account, peers, media, log, api } = this.options;
    const known = log.get(input.deliveryId);
    if (known?.result) return known.result;
    // Started but never finished: the process died while sending. It may have gone out.
    if (known?.started) {
      const result = uncertain("wechat_delivery_interrupted", "The delivery was interrupted; it may or may not have been sent.");
      await log.recordResult(input.deliveryId, this.now(), result);
      return result;
    }

    const refusal = await this.check(input);
    if (refusal) return this.finish(input.deliveryId, refusal);
    const token = peers.replyToken(input.peerId, this.now())!;

    const text = (input.text ?? "").trim();
    const chunks = splitText(text);
    const files = input.media ?? [];

    // Load and check every file before anything is uploaded or sent.
    const plain: Array<{ bytes: Buffer }> = [];
    try {
      for (const file of files) plain.push({ bytes: await media.readOutbound(input.deliveryId, file.exchangeName, { byteSize: file.byteSize, sha256: file.sha256 }) });
    } catch (error) {
      if (error instanceof MediaError) return this.finish(input.deliveryId, failed("wechat_media_invalid", "A file for this message could not be verified."));
      throw error;
    }

    const planned = chunks.length + files.length;
    if (this.recentSends() + planned > SEND_RATE_LIMIT)
      return this.finish(input.deliveryId, failed("wechat_rate_limited", "Too many messages were sent in the last minute; nothing was sent."));

    // Upload first: nothing has been sent yet, so a failure here is a clean refusal.
    const items: Array<Record<string, unknown>> = [];
    try {
      for (const index of files.keys()) {
        const prepared = media.prepareUpload(plain[index]!.bytes);
        const slot = await api.getUploadUrl({
          media_type: UPLOAD_MEDIA_TYPE.image,
          rawsize: prepared.rawSize,
          rawfilemd5: prepared.rawMd5,
          filesize: prepared.cipherSize,
          aeskey: prepared.keyParam,
        });
        const reference = await media.upload(slot.uploadParam, slot.uploadFullUrl, prepared.cipher);
        items.push({
          type: ITEM_TYPE.image,
          image_item: { media: { encrypt_query_param: reference, aes_key: Buffer.from(prepared.keyParam).toString("base64") }, mid_size: prepared.cipherSize },
        });
      }
    } catch (error) {
      if (error instanceof WechatApiError && error.kind === "session_expired") return this.finish(input.deliveryId, failed("wechat_session_expired", "The WeChat session has expired."));
      return this.finish(input.deliveryId, failed("wechat_media_upload_failed", "A file could not be uploaded; nothing was sent."));
    }

    // The point of no return: from the first request on, the message may reach the contact.
    await log.markStarted(input.deliveryId, this.now());
    const parts: Array<Array<Record<string, unknown>>> = [...chunks.map((chunk) => [WechatApi.textItem(chunk)]), ...items.map((item) => [item])];
    let sent = 0;
    for (const [index, part] of parts.entries()) {
      try {
        await api.sendMessage({ toUserId: input.peerId, clientId: `ot-${input.deliveryId}-${index}`, contextToken: token.token, items: part });
        sent += 1;
        this.sentAt.push(this.now().getTime());
      } catch (error) {
        return this.finish(input.deliveryId, await this.afterFailure(error, input.peerId, sent, parts.length));
      }
    }
    return this.finish(input.deliveryId, { status: "sent", note: "provider_accepted" });
  }

  /** Everything decidable before any request: account state, who the reply is for, and whether there is anything to say. */
  private async check(input: ExternalDeliverInput): Promise<ExternalDeliverResult | null> {
    const { account, peers } = this.options;
    if (account.inCooldown()) return failed("wechat_session_expired", "The WeChat session has expired; the account needs to be linked again.");
    if (!account.canSend) return failed("wechat_not_ready", "The WeChat account is not ready to send.");
    const text = (input.text ?? "").trim();
    if (!text && !(input.media?.length)) return failed("wechat_delivery_empty", "There is nothing to send.");
    if (Array.from(text).length > MAX_DELIVERY_TEXT_CHARS) return failed("wechat_text_too_long", "The message is longer than one delivery may be.");
    // Only still images are enabled until files and video are shown to arrive (P7).
    if ((input.media ?? []).some((file) => !file.mimeType.startsWith("image/"))) return failed("wechat_media_invalid", "This kind of file cannot be sent over WeChat yet.");
    const state = peers.tokenState(input.peerId, this.now());
    if (state === "missing") return failed("wechat_context_missing", "This contact has not written since the account was linked, so there is nothing to reply to.");
    if (state === "expired") return failed("wechat_context_expired", "The reply window has closed; the contact needs to write first.");
    return null;
  }

  /** What a refusal after some parts were sent means. The first part failing for sure means nothing went out. */
  private async afterFailure(error: unknown, peerId: string, sent: number, total: number): Promise<ExternalDeliverResult> {
    if (error instanceof WechatApiError && error.kind === "session_expired") {
      // On a send, -14 means this contact's reply window, not the whole account (P9, unverified).
      await this.options.peers.invalidateToken(peerId);
      return sent === 0
        ? failed("wechat_context_expired", "The reply window has closed; the contact needs to write first.")
        : uncertain("wechat_partial_delivery", `Only ${sent} of ${total} parts were sent before the reply window closed.`);
    }
    if (error instanceof WechatApiError && error.kind === "business")
      return sent === 0
        ? failed("wechat_send_rejected", `WeChat refused the message (code ${error.code ?? "unknown"}); nothing was sent.`)
        : uncertain("wechat_partial_delivery", `Only ${sent} of ${total} parts were sent before WeChat refused one (code ${error.code ?? "unknown"}).`);
    // Network trouble, a bad response, an HTTP error: the request may or may not have been processed.
    return uncertain("wechat_delivery_unknown", sent === 0 ? "WeChat did not answer clearly; the message may or may not have been sent." : `WeChat stopped answering after ${sent} of ${total} parts.`);
  }

  private recentSends(): number {
    const cutoff = this.now().getTime() - SEND_RATE_WINDOW_MS;
    this.sentAt = this.sentAt.filter((time) => time > cutoff);
    return this.sentAt.length;
  }

  private async finish(id: string, result: ExternalDeliverResult): Promise<ExternalDeliverResult> {
    await this.options.log.recordResult(id, this.now(), result);
    return result;
  }
}

