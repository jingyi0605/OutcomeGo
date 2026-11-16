/** Limits shared by the manifest validator, the Server and connectors. Browser-safe: no Node imports. */

/** Address prefix and display key of a messaging platform. */
export const EXTERNAL_PLATFORM_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
/** File names inside a connector's exchange directory. */
export const EXTERNAL_EXCHANGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
/** Tool names a manifest may reference. */
export const EXTERNAL_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
/** Machine-readable codes a connector reports, e.g. `wechat_context_expired`. */
export const EXTERNAL_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,99}$/;

export const EXTERNAL_TEXT_MAX_CHARS = 20_000;
export const EXTERNAL_ID_MAX_CHARS = 256;
export const EXTERNAL_DISPLAY_NAME_MAX_CHARS = 120;
/** Display names are accepted up to this length and truncated afterwards. */
export const EXTERNAL_DISPLAY_NAME_INPUT_MAX_CHARS = 1024;
export const EXTERNAL_CURSOR_MAX_CHARS = 2048;
export const EXTERNAL_METADATA_MAX_KEYS = 16;
export const EXTERNAL_METADATA_VALUE_MAX_CHARS = 256;
export const EXTERNAL_MEDIA_MAX_ENTRIES = 100;
export const EXTERNAL_MEDIA_FAILURE_MAX_ENTRIES = 100;
export const EXTERNAL_PROVIDER_MESSAGE_IDS_MAX = 20;
export const EXTERNAL_ERROR_MESSAGE_MAX_CHARS = 500;
export const EXTERNAL_NOTE_MAX_CHARS = 200;

/** Server-side poll batch size and long-poll window. */
export const EXTERNAL_POLL_BATCH_LIMIT = 20;
export const EXTERNAL_POLL_DEFAULT_WAIT_SECONDS = 20;
export const EXTERNAL_POLL_MAX_WAIT_SECONDS = 25;
/** A deliver call that runs longer than this is recorded as `uncertain`. */
export const EXTERNAL_DELIVER_TIMEOUT_MS = 60_000;

/** `maxTextChars` in a manifest's `messaging.outbound`. */
export const EXTERNAL_OUTBOUND_TEXT_MAX_CHARS = 20_000;

export const EXTERNAL_MEDIA_KINDS = ["image", "video", "audio", "file"] as const;

/** The only read-only Bot tool a messaging connector may expose for peer lookup. */
export const EXTERNAL_LIST_PEERS_TOOL = "list_peers";
export const EXTERNAL_LIST_PEERS_DEFAULT_LIMIT = 20;
export const EXTERNAL_LIST_PEERS_MAX_LIMIT = 100;
