/**
 * iLink wire constants and types.
 *
 * iLink has no public specification. Everything here follows the reference client
 * (Tencent/openclaw-weixin) as described in
 * specs/009.1-微信iLink消息服务集成/docs/20261116-iLink协议事实与探测清单.md. Values the document marks
 * as unverified (P1–P11) are collected below so a probe result changes one line, not the logic.
 */

export const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
export const ILINK_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

/** Connector version reported in `base_info.channel_version` and the app headers. */
export const CHANNEL_VERSION = "1.0.0";
/** P1/P8: header values come from the reference package's declared fields and are not yet verified. */
export const ILINK_APP_ID = "bot";
/** Reference clients encode `major.minor.patch` as `(major << 16) | (minor << 8) | patch`. */
export const ILINK_CLIENT_VERSION = String((1 << 16) | (0 << 8) | 0);
/** P1: the QR request method differs between reference versions; GET is the documented early form. */
export const QR_REQUEST_METHOD: "GET" | "POST" = "GET";
export const QR_BOT_TYPE = "3";

/** Reference session-expiry code. Its meaning differs by endpoint (P9); callers decide. */
export const ILINK_SESSION_EXPIRED = -14;

export const ENDPOINTS = {
  getBotQrcode: "ilink/bot/get_bot_qrcode",
  getQrcodeStatus: "ilink/bot/get_qrcode_status",
  getUpdates: "ilink/bot/getupdates",
  sendMessage: "ilink/bot/sendmessage",
  getUploadUrl: "ilink/bot/getuploadurl",
  notifyStart: "ilink/bot/msg/notifystart",
  notifyStop: "ilink/bot/msg/notifystop",
} as const;
export type Endpoint = keyof typeof ENDPOINTS;

/** Message item types of the reference protocol. */
export const ITEM_TYPE = { text: 1, image: 2, voice: 3, file: 4, video: 5 } as const;
/** `message_type` and `message_state` on outbound messages. */
export const MESSAGE_TYPE_BOT = 2;
export const MESSAGE_STATE_FINISH = 2;
/** `media_type` for `getuploadurl`. */
export const UPLOAD_MEDIA_TYPE = { image: 1, video: 2, file: 3, voice: 4 } as const;

export type QrStatus = "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";

export interface QrCodeResponse {
  /** Token passed back to `get_qrcode_status`. */
  qrcode: string;
  /** The text to encode into the QR image. */
  qrcodeContent: string;
}

export interface QrStatusResponse {
  status: QrStatus;
  /** Present once confirmed. */
  botToken?: string;
  baseUrl?: string;
  ilinkBotId?: string;
  ilinkUserId?: string;
  /** Present when the status asks the client to continue on another host. */
  redirectHost?: string;
}

export interface WechatMediaRef {
  encryptQueryParam?: string;
  /** Base64 of either the raw key bytes or of their hex text (P8). */
  aesKey?: string;
  fullUrl?: string;
}

export interface WechatItem {
  type: number;
  text?: string;
  /** Server transcription of a voice item. */
  voiceText?: string;
  media?: WechatMediaRef;
  fileName?: string;
  /** Declared plaintext size when the protocol gives one. */
  length?: number;
}

export interface WechatInboundMessage {
  /** Exact decimal text of the 64-bit `message_id`. */
  messageId: string;
  fromUserId: string;
  toUserId: string;
  groupId: string | null;
  createTimeMs: number | null;
  contextToken: string | null;
  sessionId: string | null;
  items: WechatItem[];
  /** Types of items this client does not understand; counted, never delivered. */
  unknownItemTypes: number[];
}

export interface GetUpdatesResult {
  messages: WechatInboundMessage[];
  /** Opaque; saved verbatim and never decoded. Null when the response had none. */
  nextBuffer: string | null;
  longPollingTimeoutMs: number | null;
  /** The client gave up waiting; treated as an empty poll. */
  timedOut: boolean;
}

export interface UploadUrlResponse {
  uploadParam: string | null;
  uploadFullUrl: string | null;
}

// --- Media (P7, P8: unverified) ---------------------------------------------------------------

/** Largest media file taken in or sent out, plaintext. */
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
/** Each file is fetched at most this many times before it is reported as failed. */
export const MEDIA_DOWNLOAD_ATTEMPTS = 3;
/**
 * Where a download without a full URL is fetched from, and how the parameter is passed. P8 is unverified:
 * the reference client builds `<cdn>/download?encrypted_query_param=<param>`.
 */
export const CDN_DOWNLOAD_PATH = "download";
export const CDN_UPLOAD_PATH = "upload";
export const CDN_PARAM = "encrypted_query_param";
/** The response header that carries the reference to an uploaded file. */
export const CDN_UPLOAD_RESULT_HEADER = "x-encrypted-param";
/**
 * P8: the AES key reaches us base64-encoded, and the reference clients disagree on whether it
 * encodes the 16 raw bytes or their 32-character hex text. Both are accepted on the way in.
 * Outgoing keys use the hex-text form, the one the reference client sends.
 */
export const OUTBOUND_KEY_ENCODING: "hex-text" | "raw" = "hex-text";
/** Only still images are enabled outbound until P7 shows files and video are delivered. */
export const OUTBOUND_MEDIA_KINDS = ["image"] as const;

// --- Sending (P5, P6: unverified) -------------------------------------------------------------

/**
 * `getuploadurl` request fields are taken from the reference client and are unverified (P7/P8):
 * media_type, rawsize, rawfilemd5, filesize, aeskey.
 */
/** Longest single message sent. P5: the real limit is unknown; this is the conservative default. */
export const TEXT_CHUNK_CHARS = 1800;
/** What the manifest allows in one delivery: at most this many chunks at the default size. */
export const MAX_DELIVERY_TEXT_CHARS = 9000;
/** At most this many provider messages in any 60 seconds. P5: unverified, conservative. */
export const SEND_RATE_LIMIT = 20;
export const SEND_RATE_WINDOW_MS = 60_000;
/** How many finished deliveries are remembered for idempotency. */
export const DELIVERY_LOG_LIMIT = 500;
