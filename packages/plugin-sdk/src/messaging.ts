/**
 * Wire protocol between the Server's external messaging service (specs/009) and a
 * packaged connector. The Server and connectors share these types and parsers so
 * neither side re-implements validation.
 *
 * Deliberately absent from every type here: reply credentials, download URLs and
 * connection or platform identifiers. Credentials stay in the connector's private
 * state, and the Server trusts only the Connection it called.
 */
import { createHash } from "node:crypto";
import {
  EXTERNAL_CODE_PATTERN,
  EXTERNAL_CURSOR_MAX_CHARS,
  EXTERNAL_DISPLAY_NAME_INPUT_MAX_CHARS,
  EXTERNAL_DISPLAY_NAME_MAX_CHARS,
  EXTERNAL_ERROR_MESSAGE_MAX_CHARS,
  EXTERNAL_EXCHANGE_NAME_PATTERN,
  EXTERNAL_ID_MAX_CHARS,
  EXTERNAL_LIST_PEERS_DEFAULT_LIMIT,
  EXTERNAL_LIST_PEERS_MAX_LIMIT,
  EXTERNAL_MEDIA_FAILURE_MAX_ENTRIES,
  EXTERNAL_MEDIA_MAX_ENTRIES,
  EXTERNAL_METADATA_MAX_KEYS,
  EXTERNAL_METADATA_VALUE_MAX_CHARS,
  EXTERNAL_NOTE_MAX_CHARS,
  EXTERNAL_POLL_BATCH_LIMIT,
  EXTERNAL_PROVIDER_MESSAGE_IDS_MAX,
  EXTERNAL_TEXT_MAX_CHARS,
} from "./messaging-limits";

export * from "./messaging-limits";

export type ExternalPeerType = "direct" | "group" | "channel";

export interface ExternalInboundMedia {
  /** File name under exchange/inbound; matches EXTERNAL_EXCHANGE_NAME_PATTERN. */
  exchangeName: string;
  fileName: string;
  mimeType?: string;
  byteSize: number;
  /** SHA-256 of the plaintext bytes, lowercase hex. */
  sha256: string;
}

export interface ExternalMediaFailure {
  fileName?: string;
  /** Machine-readable reason, e.g. `wechat_media_download_failed`. */
  code: string;
}

export interface ExternalMessage {
  providerMessageId: string;
  peer: { id: string; type: ExternalPeerType; displayName?: string };
  sender: { id: string; displayName?: string; isAccountOwner: boolean };
  text: string;
  /** ISO 8601 */
  occurredAt: string;
  media?: ExternalInboundMedia[];
  mediaFailures?: ExternalMediaFailure[];
  providerMetadata?: Record<string, string | number | boolean>;
}

export interface ExternalInboundEnvelope {
  /** Opaque. The Server saving it means this message and everything before it is handled. */
  ackCursor: string;
  message: ExternalMessage;
}

export interface ExternalPollInput {
  /** The last acknowledged cursor, or null when none has been saved. */
  cursor: string | null;
  limit: number;
  waitMs: number;
}

export interface ExternalPollResult {
  messages: ExternalInboundEnvelope[];
  /** When true the Server clears its acknowledgement cursor, e.g. the queue was rebuilt. */
  resetCursor?: boolean;
}

export interface ExternalOutboundMedia {
  /** File name under exchange/outbound/<deliveryId>/. */
  exchangeName: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export interface ExternalDeliverInput {
  deliveryId: string;
  peerId: string;
  text?: string;
  media?: ExternalOutboundMedia[];
}

export type ExternalDeliverResult =
  | { status: "sent"; providerMessageIds?: string[]; note?: string }
  | { status: "failed"; code: string; message: string }
  | { status: "uncertain"; code: string; message: string };

/** Input of the read-only, Bot-visible `list_peers` tool. */
export interface ExternalListPeersInput {
  limit?: number;
  afterPeerId?: string;
}

export interface ExternalPeerSummary {
  /** Stable routing identifier, usable as `<platform>:<peerId>`. Not a reply credential. */
  peerId: string;
  displayName: string;
  lastObservedAt: string;
  isAccountOwner: boolean;
  /** Whether a reply context is available right now. */
  canReply: boolean;
}

export interface ExternalListPeersResult {
  peers: ExternalPeerSummary[];
  nextAfterPeerId: string | null;
}

export type ExternalMessageRejectionCode = "external_message_invalid" | "external_message_too_large";

export class ExternalProtocolError extends Error {
  constructor(
    readonly code: "external_poll_invalid" | "external_deliver_invalid" | "external_peers_invalid",
    message: string
  ) {
    super(message);
    this.name = "ExternalProtocolError";
  }
}

type Invalid = { ok: false; code: ExternalMessageRejectionCode; providerMessageId?: string };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const idText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= EXTERNAL_ID_MAX_CHARS ? value : null;

const isoInstant = (value: unknown): boolean =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  !Number.isNaN(Date.parse(value));

const optionalText = (value: unknown, max: number): string | undefined | null => {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= max ? value : null;
};

/** Control characters other than newline and tab are dropped from untrusted text. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export const stripControlCharacters = (value: string): string => value.replace(CONTROL_CHARACTERS, "");

/** Single-line values (names, file names): all control characters, including newlines, go. */
export const sanitizeExternalLabel = (value: string, maxChars: number): string => {
  const cleaned = Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim());
  return cleaned.slice(0, maxChars).join("");
};

/**
 * Checks the structure and limits of an inbound message. Unknown fields are dropped.
 * Run `normalizeExternalMessage` on the result before hashing or storing it.
 */
export function validateExternalMessage(
  value: unknown
): { ok: true; message: ExternalMessage } | Invalid {
  const source = record(value);
  const providerMessageId = idText(source?.providerMessageId) ?? undefined;
  const invalid = (code: ExternalMessageRejectionCode = "external_message_invalid"): Invalid => ({
    ok: false,
    code,
    ...(providerMessageId ? { providerMessageId } : {}),
  });
  if (!source || !providerMessageId) return invalid();

  const peer = record(source.peer);
  const sender = record(source.sender);
  if (!peer || !sender) return invalid();
  const peerId = idText(peer.id);
  const senderId = idText(sender.id);
  if (!peerId || !senderId) return invalid();
  if (peer.type !== "direct" && peer.type !== "group" && peer.type !== "channel") return invalid();
  if (typeof sender.isAccountOwner !== "boolean") return invalid();
  const peerName = optionalText(peer.displayName, EXTERNAL_DISPLAY_NAME_INPUT_MAX_CHARS);
  const senderName = optionalText(sender.displayName, EXTERNAL_DISPLAY_NAME_INPUT_MAX_CHARS);
  if (peerName === null || senderName === null) return invalid();

  if (typeof source.text !== "string") return invalid();
  if (!isoInstant(source.occurredAt)) return invalid();

  let media: ExternalInboundMedia[] | undefined;
  if (source.media !== undefined) {
    if (!Array.isArray(source.media) || source.media.length > EXTERNAL_MEDIA_MAX_ENTRIES) return invalid();
    media = [];
    for (const candidate of source.media) {
      const item = record(candidate);
      const mimeType = optionalText(item?.mimeType, 255);
      if (
        !item ||
        typeof item.exchangeName !== "string" ||
        !EXTERNAL_EXCHANGE_NAME_PATTERN.test(item.exchangeName) ||
        typeof item.fileName !== "string" ||
        item.fileName.length > EXTERNAL_ID_MAX_CHARS ||
        mimeType === null ||
        typeof item.byteSize !== "number" ||
        !Number.isSafeInteger(item.byteSize) ||
        item.byteSize < 0 ||
        typeof item.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(item.sha256)
      )
        return invalid();
      media.push({
        exchangeName: item.exchangeName,
        fileName: item.fileName,
        ...(mimeType ? { mimeType } : {}),
        byteSize: item.byteSize,
        sha256: item.sha256,
      });
    }
  }

  let mediaFailures: ExternalMediaFailure[] | undefined;
  if (source.mediaFailures !== undefined) {
    if (!Array.isArray(source.mediaFailures) || source.mediaFailures.length > EXTERNAL_MEDIA_FAILURE_MAX_ENTRIES)
      return invalid();
    mediaFailures = [];
    for (const candidate of source.mediaFailures) {
      const item = record(candidate);
      const fileName = optionalText(item?.fileName, EXTERNAL_ID_MAX_CHARS);
      if (!item || fileName === null || typeof item.code !== "string" || !EXTERNAL_CODE_PATTERN.test(item.code))
        return invalid();
      mediaFailures.push({ ...(fileName ? { fileName } : {}), code: item.code });
    }
  }

  let providerMetadata: Record<string, string | number | boolean> | undefined;
  if (source.providerMetadata !== undefined) {
    const metadata = record(source.providerMetadata);
    if (!metadata || Object.keys(metadata).length > EXTERNAL_METADATA_MAX_KEYS) return invalid();
    const entries = Object.entries(metadata);
    providerMetadata = {};
    for (const [key, entry] of entries) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) return invalid();
      if (typeof entry === "string") {
        if (entry.length > EXTERNAL_METADATA_VALUE_MAX_CHARS) return invalid();
      } else if (typeof entry === "number") {
        if (!Number.isFinite(entry)) return invalid();
      } else if (typeof entry !== "boolean") return invalid();
      providerMetadata[key] = entry;
    }
  }

  // Length is judged last so that a structurally broken message is reported as invalid, not as large.
  if (Array.from(source.text).length > EXTERNAL_TEXT_MAX_CHARS) return invalid("external_message_too_large");

  return {
    ok: true,
    message: {
      providerMessageId,
      peer: { id: peerId, type: peer.type, ...(peerName ? { displayName: peerName } : {}) },
      sender: {
        id: senderId,
        ...(senderName ? { displayName: senderName } : {}),
        isAccountOwner: sender.isAccountOwner,
      },
      text: source.text,
      occurredAt: source.occurredAt as string,
      ...(media ? { media } : {}),
      ...(mediaFailures ? { mediaFailures } : {}),
      ...(providerMetadata ? { providerMetadata } : {}),
    },
  };
}

/** Strips control characters, truncates display names and writes a canonical timestamp. */
export const normalizeExternalMessage = (message: ExternalMessage): ExternalMessage => {
  const name = (value: string | undefined): { displayName?: string } => {
    const label = value === undefined ? "" : sanitizeExternalLabel(value, EXTERNAL_DISPLAY_NAME_MAX_CHARS);
    return label ? { displayName: label } : {};
  };
  return {
    ...message,
    peer: { id: message.peer.id, type: message.peer.type, ...name(message.peer.displayName) },
    sender: { id: message.sender.id, ...name(message.sender.displayName), isAccountOwner: message.sender.isAccountOwner },
    text: stripControlCharacters(message.text),
    occurredAt: new Date(message.occurredAt).toISOString(),
    ...(message.media
      ? { media: message.media.map((item) => ({ ...item, fileName: sanitizeExternalLabel(item.fileName, EXTERNAL_ID_MAX_CHARS) })) }
      : {}),
    ...(message.mediaFailures
      ? {
          mediaFailures: message.mediaFailures.map((item) => ({
            ...(item.fileName ? { fileName: sanitizeExternalLabel(item.fileName, EXTERNAL_ID_MAX_CHARS) } : {}),
            code: item.code,
          })),
        }
      : {}),
  };
};

const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * Hash used for duplicate-versus-conflict detection. Covers identity, text, timestamp and
 * media content only, so a re-delivery that differs in display names, exchange file names,
 * failure notes or metadata is still a duplicate. Hash a normalized message.
 */
export const externalMessagePayloadHash = (message: ExternalMessage): string =>
  sha256Hex(
    JSON.stringify([
      message.providerMessageId,
      message.peer.id,
      message.peer.type,
      message.sender.id,
      message.sender.isAccountOwner,
      message.text,
      message.occurredAt,
      (message.media ?? []).map((item) => [item.sha256, item.byteSize]),
    ])
  );

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = record(value);
  if (object)
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

export type ExternalPollEntry =
  | { ackCursor: string; message: ExternalMessage }
  | {
      ackCursor: string;
      /** The message failed validation but can still be acknowledged as rejected. */
      invalid: { code: ExternalMessageRejectionCode; providerMessageId?: string; payloadHash: string };
    };

export interface ParsedExternalPollResult {
  messages: ExternalPollEntry[];
  resetCursor: boolean;
}

/**
 * Validates a poll tool result. A malformed envelope (no usable ackCursor, wrong shape)
 * makes the whole result unusable and throws. A message with a usable ackCursor but an
 * invalid body is returned as `invalid` so the Server can reject it and move on.
 */
export function parseExternalPollResult(
  value: unknown,
  options: { limit?: number } = {}
): ParsedExternalPollResult {
  const result = record(value);
  if (!result || !Array.isArray(result.messages))
    throw new ExternalProtocolError("external_poll_invalid", "Poll result must contain a messages array");
  const limit = options.limit ?? EXTERNAL_POLL_BATCH_LIMIT;
  if (result.messages.length > limit)
    throw new ExternalProtocolError("external_poll_invalid", "Poll result exceeds the requested limit");
  if (result.resetCursor !== undefined && typeof result.resetCursor !== "boolean")
    throw new ExternalProtocolError("external_poll_invalid", "resetCursor must be a boolean");
  const seen = new Set<string>();
  const messages = result.messages.map((candidate): ExternalPollEntry => {
    const envelope = record(candidate);
    const ackCursor = envelope?.ackCursor;
    if (typeof ackCursor !== "string" || !ackCursor || ackCursor.length > EXTERNAL_CURSOR_MAX_CHARS || seen.has(ackCursor))
      throw new ExternalProtocolError("external_poll_invalid", "Envelope needs a unique ackCursor");
    seen.add(ackCursor);
    const checked = validateExternalMessage(envelope?.message);
    if (checked.ok) return { ackCursor, message: checked.message };
    return {
      ackCursor,
      invalid: {
        code: checked.code,
        ...(checked.providerMessageId ? { providerMessageId: checked.providerMessageId } : {}),
        payloadHash: sha256Hex(stableStringify(envelope?.message)),
      },
    };
  });
  return { messages, resetCursor: result.resetCursor === true };
}

/** Validates a deliver tool result. Anything unparseable must be treated as `uncertain` by the caller. */
export function parseExternalDeliverResult(value: unknown): ExternalDeliverResult {
  const result = record(value);
  const bad = (reason: string): never => {
    throw new ExternalProtocolError("external_deliver_invalid", reason);
  };
  if (!result) return bad("Deliver result must be an object");
  if (result.status === "sent") {
    let providerMessageIds: string[] | undefined;
    if (result.providerMessageIds !== undefined) {
      if (
        !Array.isArray(result.providerMessageIds) ||
        result.providerMessageIds.length > EXTERNAL_PROVIDER_MESSAGE_IDS_MAX ||
        result.providerMessageIds.some((id) => !idText(id))
      )
        return bad("providerMessageIds is invalid");
      providerMessageIds = result.providerMessageIds as string[];
    }
    const note = optionalText(result.note, EXTERNAL_NOTE_MAX_CHARS);
    if (note === null) return bad("note is invalid");
    return {
      status: "sent",
      ...(providerMessageIds ? { providerMessageIds } : {}),
      ...(note ? { note } : {}),
    };
  }
  if (result.status === "failed" || result.status === "uncertain") {
    if (typeof result.code !== "string" || !EXTERNAL_CODE_PATTERN.test(result.code)) return bad("code is invalid");
    if (typeof result.message !== "string") return bad("message is invalid");
    return {
      status: result.status,
      code: result.code,
      message: Array.from(stripControlCharacters(result.message)).slice(0, EXTERNAL_ERROR_MESSAGE_MAX_CHARS).join(""),
    };
  }
  return bad("Unknown deliver status");
}

/** Validates a `list_peers` result; the Server never calls this tool, but connectors and tests share the shape. */
export function parseExternalListPeersResult(value: unknown): ExternalListPeersResult {
  const result = record(value);
  const bad = (reason: string): never => {
    throw new ExternalProtocolError("external_peers_invalid", reason);
  };
  if (!result || !Array.isArray(result.peers) || result.peers.length > EXTERNAL_LIST_PEERS_MAX_LIMIT)
    return bad("peers must be an array within the page limit");
  const peers = result.peers.map((candidate): ExternalPeerSummary => {
    const peer = record(candidate);
    const peerId = idText(peer?.peerId);
    if (
      !peer ||
      !peerId ||
      typeof peer.displayName !== "string" ||
      !isoInstant(peer.lastObservedAt) ||
      typeof peer.isAccountOwner !== "boolean" ||
      typeof peer.canReply !== "boolean"
    )
      return bad("peer entry is invalid");
    return {
      peerId,
      displayName: sanitizeExternalLabel(peer.displayName as string, EXTERNAL_DISPLAY_NAME_MAX_CHARS),
      lastObservedAt: peer.lastObservedAt as string,
      isAccountOwner: peer.isAccountOwner as boolean,
      canReply: peer.canReply as boolean,
    };
  });
  const next = result.nextAfterPeerId;
  if (next !== null && !idText(next)) return bad("nextAfterPeerId is invalid");
  return { peers, nextAfterPeerId: next as string | null };
}

/** Clamps `list_peers` arguments; invalid values fall back to defaults instead of failing a read-only query. */
export const normalizeExternalListPeersInput = (
  value: unknown
): { limit: number; afterPeerId: string | null } => {
  const input = record(value) ?? {};
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(EXTERNAL_LIST_PEERS_MAX_LIMIT, Math.max(1, Math.trunc(input.limit)))
      : EXTERNAL_LIST_PEERS_DEFAULT_LIMIT;
  return { limit, afterPeerId: idText(input.afterPeerId) };
};

/** JSON Schema for the Bot-visible `list_peers` tool, shared by every messaging connector. */
export const EXTERNAL_LIST_PEERS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: EXTERNAL_LIST_PEERS_MAX_LIMIT,
      description: `Page size, default ${EXTERNAL_LIST_PEERS_DEFAULT_LIMIT}.`,
    },
    afterPeerId: { type: "string", description: "Return peers after this peerId, from a previous nextAfterPeerId." },
  },
  additionalProperties: false,
} as const;
