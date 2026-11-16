import { EXTERNAL_EXCHANGE_NAME_PATTERN } from "@outcomego/plugin-sdk/messaging";

/** Reaches the Bot Computer's control API (adds the control token). */
export type ComputerFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Why an exchange transfer failed. `retryable` separates a computer that cannot be reached
 * right now (the whole message is retried) from a file that is permanently unusable (only that
 * attachment is dropped).
 */
export class ExternalExchangeError extends Error {
  constructor(
    readonly code:
      | "external_media_missing"
      | "external_media_too_large"
      | "external_media_mismatch"
      | "external_media_staging_failed"
      | "external_exchange_unavailable",
    readonly retryable: boolean
  ) {
    super(code);
    this.name = "ExternalExchangeError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Large media can take a while to cross the private Server-to-computer link. */
const TRANSFER_TIMEOUT_MS = 5 * 60_000;

const exchangePath = (connectionId: string, rest: string): string =>
  `/v1/mcp/connections/${encodeURIComponent(connectionId)}/exchange/${rest}`;

/**
 * Media bytes between the Server and a connector (specs/009 §2.3.3, §3.3.3). The connector owns
 * the files; this class only moves bytes over the computer's HTTP endpoints, which enforce the
 * path, symlink, name and size rules. It never sees a connector path.
 */
export class ExternalMediaExchange {
  constructor(private readonly computerFetch: ComputerFetch) {}

  /** Opens a connector's decrypted inbound file as a byte stream. */
  async openInbound(connectionId: string, exchangeName: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
    if (!EXTERNAL_EXCHANGE_NAME_PATTERN.test(exchangeName)) throw new ExternalExchangeError("external_media_missing", false);
    let response: Response;
    try {
      response = await this.request(exchangePath(connectionId, `inbound/${encodeURIComponent(exchangeName)}`), { method: "GET" });
    } catch {
      throw new ExternalExchangeError("external_exchange_unavailable", true);
    }
    if (response.ok && response.body) {
      const size = Number(response.headers.get("content-length"));
      return { body: response.body, size: Number.isSafeInteger(size) && size >= 0 ? size : -1 };
    }
    await response.body?.cancel().catch(() => {});
    // 404 is a file that is not there, 400 a name or path the computer refused: both are about
    // this one attachment. 413 is a file above the transfer cap.
    if (response.status === 404 || response.status === 400) throw new ExternalExchangeError("external_media_missing", false);
    if (response.status === 413) throw new ExternalExchangeError("external_media_too_large", false);
    throw new ExternalExchangeError("external_exchange_unavailable", true);
  }

  /**
   * Writes one Bot-sent asset into the delivery's outbound directory. The computer reports the
   * size and digest it actually stored; they must equal what the Server intended to send.
   */
  async stageOutbound(input: {
    connectionId: string;
    deliveryId: string;
    exchangeName: string;
    body: Uint8Array | Blob | ReadableStream<Uint8Array>;
    byteSize: number;
    sha256: string;
  }): Promise<void> {
    if (!UUID.test(input.deliveryId) || !EXTERNAL_EXCHANGE_NAME_PATTERN.test(input.exchangeName))
      throw new ExternalExchangeError("external_media_staging_failed", false);
    let response: Response;
    try {
      response = await this.request(
        exchangePath(input.connectionId, `outbound/${encodeURIComponent(input.deliveryId)}/${encodeURIComponent(input.exchangeName)}`),
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream", "content-length": String(input.byteSize) },
          body: input.body as BodyInit,
          // Streaming a request body needs half-duplex in the fetch spec.
          duplex: "half",
        } as RequestInit
      );
    } catch {
      throw new ExternalExchangeError("external_media_staging_failed", false);
    }
    const result = (await response.json().catch(() => ({}))) as { bytes?: unknown; sha256?: unknown };
    if (!response.ok || result.bytes !== input.byteSize || result.sha256 !== input.sha256)
      throw new ExternalExchangeError("external_media_staging_failed", false);
  }

  /** Removes a delivery's outbound directory. A failure only leaves files for the connector to age out. */
  async cleanupOutbound(connectionId: string, deliveryId: string): Promise<boolean> {
    if (!UUID.test(deliveryId)) return false;
    try {
      const response = await this.request(exchangePath(connectionId, `outbound/${encodeURIComponent(deliveryId)}`), {
        method: "DELETE",
      });
      await response.body?.cancel().catch(() => {});
      return response.ok;
    } catch {
      return false;
    }
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    return this.computerFetch(path, {
      ...init,
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      // Bun's fetch otherwise gives up after 300 seconds whatever the signal allows.
      timeout: false,
    } as RequestInit);
  }
}
