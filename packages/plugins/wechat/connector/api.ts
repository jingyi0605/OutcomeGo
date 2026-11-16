import { randomBytes } from "node:crypto";
import { identifier, LosslessJsonError, parseLosslessJson, type LosslessValue } from "./json";
import {
  CHANNEL_VERSION,
  ENDPOINTS,
  ILINK_APP_ID,
  ILINK_BASE_URL,
  ILINK_CLIENT_VERSION,
  ILINK_SESSION_EXPIRED,
  ITEM_TYPE,
  MESSAGE_STATE_FINISH,
  MESSAGE_TYPE_BOT,
  QR_BOT_TYPE,
  QR_REQUEST_METHOD,
  type Endpoint,
  type GetUpdatesResult,
  type QrCodeResponse,
  type QrStatus,
  type QrStatusResponse,
  type UploadUrlResponse,
  type WechatInboundMessage,
  type WechatItem,
  type WechatMediaRef,
} from "./protocol";

export type WechatFetch = (input: string, init: RequestInit) => Promise<Response>;

/** How a request failed. `endpoint` and the business code are safe to log; nothing else is. */
export type WechatApiErrorKind = "network" | "http" | "business" | "session_expired" | "invalid_response";

export class WechatApiError extends Error {
  constructor(
    readonly kind: WechatApiErrorKind,
    readonly endpoint: Endpoint | "cdn",
    /** Business code or HTTP status; never a message body. */
    readonly code?: number,
    /** The client's own deadline passed. For a long poll that is an empty result, not a failure. */
    readonly timedOut = false
  ) {
    super(`iLink ${endpoint} failed: ${kind}${code === undefined ? "" : ` (${code})`}`);
    this.name = "WechatApiError";
  }
}

/** HTTPS and a `weixin.qq.com` host, with no credentials in the URL. */
export const isAllowedWechatUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "weixin.qq.com" || url.hostname.endsWith(".weixin.qq.com"))
    );
  } catch {
    return false;
  }
};

/** A host the server asked us to continue on, as a base URL, only if it passes the same check. */
export const baseUrlFromHost = (host: string): string | null => {
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) return null;
  const url = `https://${host}`;
  return isAllowedWechatUrl(url) ? url : null;
};

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface WechatApiOptions {
  fetch?: WechatFetch;
  baseUrl?: string;
  /** Bot token; absent while no account is linked. */
  token?: string;
  /** Default per-request timeout. */
  timeoutMs?: number;
}

/** The one place iLink business requests are made. */
export class WechatApi {
  private readonly fetchImpl: WechatFetch;
  private base: string;
  private token: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: WechatApiOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.base = options.baseUrl ?? ILINK_BASE_URL;
    if (!isAllowedWechatUrl(this.base)) throw new WechatApiError("invalid_response", "getBotQrcode");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  get baseUrl(): string {
    return this.base;
  }

  /** Switches the host, e.g. to an account-specific one. Refuses anything outside weixin.qq.com. */
  setBaseUrl(value: string): void {
    if (!isAllowedWechatUrl(value)) throw new WechatApiError("invalid_response", "getQrcodeStatus");
    this.base = value.replace(/\/+$/, "");
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  /** Fresh on every request: a random uint32 in decimal, base64 encoded. */
  static uin(): string {
    return Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString("base64");
  }

  private headers(withBody: boolean): Record<string, string> {
    return {
      ...(withBody ? { "Content-Type": "application/json" } : {}),
      AuthorizationType: "ilink_bot_token",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      "X-WECHAT-UIN": WechatApi.uin(),
      "iLink-App-Id": ILINK_APP_ID,
      "iLink-App-ClientVersion": ILINK_CLIENT_VERSION,
    };
  }

  private baseInfo() {
    return { channel_version: CHANNEL_VERSION };
  }

  private url(endpoint: Endpoint, query?: Record<string, string>): string {
    const url = new URL(`${this.base.replace(/\/+$/, "")}/${ENDPOINTS[endpoint]}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    if (!isAllowedWechatUrl(url.toString())) throw new WechatApiError("invalid_response", endpoint);
    return url.toString();
  }

  /**
   * Sends one request and returns the parsed body. Redirects are refused (a redirect could
   * carry the bearer token to another host), the body is size-capped, and `ret`/`errcode`
   * non-zero is a failure.
   */
  private async request(
    endpoint: Endpoint,
    options: { method: "GET" | "POST"; query?: Record<string, string>; body?: unknown; timeoutMs?: number; businessOk?: boolean; signal?: AbortSignal }
  ): Promise<Record<string, LosslessValue>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(endpoint, options.query), {
        method: options.method,
        headers: this.headers(options.body !== undefined),
        ...(options.body !== undefined ? { body: JSON.stringify({ ...(options.body as object), base_info: this.baseInfo() }) } : {}),
        redirect: "error",
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs)])
          : AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof WechatApiError) throw error;
      const name = (error as Error | undefined)?.name;
      throw new WechatApiError("network", endpoint, undefined, name === "TimeoutError" || name === "AbortError");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new WechatApiError("http", endpoint, response.status);
    }
    let text: string;
    try {
      text = await readCapped(response, endpoint);
    } catch (error) {
      const name = (error as Error | undefined)?.name;
      throw error instanceof WechatApiError
        ? error
        : new WechatApiError("network", endpoint, undefined, name === "TimeoutError" || name === "AbortError");
    }
    let parsed: LosslessValue;
    try {
      parsed = parseLosslessJson(text);
    } catch (error) {
      if (error instanceof LosslessJsonError) throw new WechatApiError("invalid_response", endpoint);
      throw error;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new WechatApiError("invalid_response", endpoint);
    const body = parsed as Record<string, LosslessValue>;
    if (!options.businessOk) {
      const ret = numeric(body.ret);
      const errcode = numeric(body.errcode);
      const code = ret !== 0 && ret !== null ? ret : errcode !== 0 && errcode !== null ? errcode : 0;
      if (code === ILINK_SESSION_EXPIRED) throw new WechatApiError("session_expired", endpoint, code);
      if (code !== 0) throw new WechatApiError("business", endpoint, code);
    }
    return body;
  }

  async getBotQrcode(): Promise<QrCodeResponse> {
    const body = await this.request("getBotQrcode", {
      method: QR_REQUEST_METHOD,
      ...(QR_REQUEST_METHOD === "GET" ? { query: { bot_type: QR_BOT_TYPE } } : { body: { bot_type: QR_BOT_TYPE } }),
    });
    const qrcode = text(body.qrcode);
    const qrcodeContent = text(body.qrcode_img_content);
    if (!qrcode || !qrcodeContent) throw new WechatApiError("invalid_response", "getBotQrcode");
    return { qrcode, qrcodeContent };
  }

  /** One long-poll slice of the QR status; the caller loops. Client timeout is "still waiting". */
  async getQrcodeStatus(qrcode: string, timeoutMs = 35_000, signal?: AbortSignal): Promise<QrStatusResponse> {
    let body: Record<string, LosslessValue>;
    try {
      body = await this.request("getQrcodeStatus", { method: "GET", query: { qrcode }, timeoutMs, signal });
    } catch (error) {
      if (error instanceof WechatApiError && error.timedOut) return { status: "wait" };
      throw error;
    }
    const status = body.status;
    if (!["wait", "scaned", "confirmed", "expired", "scaned_but_redirect"].includes(status as string))
      throw new WechatApiError("invalid_response", "getQrcodeStatus");
    return {
      status: status as QrStatus,
      ...(text(body.bot_token) ? { botToken: text(body.bot_token)! } : {}),
      ...(text(body.baseurl) ? { baseUrl: text(body.baseurl)! } : {}),
      ...(identifier(body.ilink_bot_id) ? { ilinkBotId: identifier(body.ilink_bot_id)! } : {}),
      ...(identifier(body.ilink_user_id) ? { ilinkUserId: identifier(body.ilink_user_id)! } : {}),
      ...(text(body.redirect_host) ? { redirectHost: text(body.redirect_host)! } : {}),
    };
  }

  /**
   * One long poll. A client-side timeout is an empty result, not an error: the server holds the
   * request open by design. `buffer` is sent back untouched.
   */
  async getUpdates(buffer: string, timeoutMs: number, signal?: AbortSignal): Promise<GetUpdatesResult> {
    let body: Record<string, LosslessValue>;
    try {
      body = await this.request("getUpdates", { method: "POST", body: { get_updates_buf: buffer }, timeoutMs, signal });
    } catch (error) {
      if (error instanceof WechatApiError && error.timedOut)
        return { messages: [], nextBuffer: null, longPollingTimeoutMs: null, timedOut: true };
      throw error;
    }
    const messages = body.msgs === undefined || body.msgs === null ? [] : body.msgs;
    if (!Array.isArray(messages)) throw new WechatApiError("invalid_response", "getUpdates");
    const timeout = numeric(body.longpolling_timeout_ms);
    return {
      messages: messages.flatMap((entry) => {
        const parsed = parseInbound(entry);
        return parsed ? [parsed] : [];
      }),
      nextBuffer: typeof body.get_updates_buf === "string" && body.get_updates_buf ? body.get_updates_buf : null,
      longPollingTimeoutMs: timeout !== null && timeout > 0 ? timeout : null,
      timedOut: false,
    };
  }

  /** Sends already-built items. Success is `ret: 0`; iLink may return no message id (P5). */
  async sendMessage(input: { toUserId: string; clientId: string; contextToken: string; items: Array<Record<string, unknown>> }): Promise<void> {
    await this.request("sendMessage", {
      method: "POST",
      body: {
        msg: {
          from_user_id: "",
          to_user_id: input.toUserId,
          client_id: input.clientId,
          message_type: MESSAGE_TYPE_BOT,
          message_state: MESSAGE_STATE_FINISH,
          context_token: input.contextToken,
          item_list: input.items,
        },
      },
    });
  }

  static textItem(value: string): Record<string, unknown> {
    return { type: ITEM_TYPE.text, text_item: { text: value } };
  }

  async getUploadUrl(input: Record<string, unknown>): Promise<UploadUrlResponse> {
    const body = await this.request("getUploadUrl", { method: "POST", body: input });
    return { uploadParam: text(body.upload_param) ?? null, uploadFullUrl: text(body.upload_full_url) ?? null };
  }

  /** P10: not known to be required; a failure is the caller's to log, never to act on. */
  async notifyStart(): Promise<void> {
    await this.request("notifyStart", { method: "POST", body: {} });
  }

  async notifyStop(): Promise<void> {
    await this.request("notifyStop", { method: "POST", body: {} });
  }
}

const text = (value: LosslessValue | undefined): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const numeric = (value: LosslessValue | undefined): number | null =>
  typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : null;

const readCapped = async (response: Response, endpoint: Endpoint): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new WechatApiError("invalid_response", endpoint);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
};

const record = (value: LosslessValue | undefined): Record<string, LosslessValue> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, LosslessValue>) : null;

const parseMedia = (value: LosslessValue | undefined): WechatMediaRef | undefined => {
  const media = record(value);
  if (!media) return undefined;
  return {
    ...(text(media.encrypt_query_param) ? { encryptQueryParam: text(media.encrypt_query_param)! } : {}),
    ...(text(media.aes_key) ? { aesKey: text(media.aes_key)! } : {}),
    ...(text(media.full_url) ? { fullUrl: text(media.full_url)! } : {}),
  };
};

const parseItem = (value: LosslessValue): WechatItem | { unknown: number } | null => {
  const item = record(value);
  const type = numeric(item?.type);
  if (!item || type === null) return null;
  if (type === ITEM_TYPE.text) {
    const body = text(record(item.text_item)?.text);
    return body === undefined ? null : { type, text: body };
  }
  if (type === ITEM_TYPE.voice) {
    const voice = record(item.voice_item);
    return { type, ...(text(voice?.text) ? { voiceText: text(voice!.text)! } : {}), ...(parseMedia(voice?.media) ? { media: parseMedia(voice!.media)! } : {}) };
  }
  const field = type === ITEM_TYPE.image ? "image_item" : type === ITEM_TYPE.file ? "file_item" : type === ITEM_TYPE.video ? "video_item" : null;
  if (!field) return { unknown: type };
  const body = record(item[field]);
  const length = numeric(body?.len);
  return {
    type,
    ...(parseMedia(body?.media) ? { media: parseMedia(body!.media)! } : {}),
    ...(text(body?.file_name) ? { fileName: text(body!.file_name)! } : {}),
    ...(length !== null && length >= 0 ? { length } : {}),
  };
};

/** Returns null for an entry that cannot be an inbound message (no id or sender). */
const parseInbound = (value: LosslessValue): WechatInboundMessage | null => {
  const message = record(value);
  if (!message) return null;
  const messageId = identifier(message.message_id);
  const fromUserId = identifier(message.from_user_id);
  if (!messageId || !fromUserId) return null;
  const items: WechatItem[] = [];
  const unknownItemTypes: number[] = [];
  for (const entry of Array.isArray(message.item_list) ? message.item_list : []) {
    const parsed = parseItem(entry);
    if (!parsed) continue;
    if ("unknown" in parsed) unknownItemTypes.push(parsed.unknown);
    else items.push(parsed);
  }
  const created = numeric(message.create_time_ms);
  return {
    messageId,
    fromUserId,
    toUserId: identifier(message.to_user_id) ?? "",
    groupId: identifier(message.group_id),
    createTimeMs: created !== null && created > 0 ? created : null,
    contextToken: text(message.context_token) ?? null,
    sessionId: text(message.session_id) ?? null,
    items,
    unknownItemTypes,
  };
};
