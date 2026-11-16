import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, type FileHandle } from "node:fs/promises";
import { join, sep } from "node:path";
import { Readable } from "node:stream";
import { CLIENT_CAPABILITIES } from "@outcomego/contracts/capabilities";
import {
  EXTERNAL_EXCHANGE_NAME_PATTERN,
} from "@outcomego/plugin-sdk/messaging";

/** Largest file the Server's asset store accepts; the exchange never carries more. */
export const EXCHANGE_MAX_BYTES = Math.max(
  CLIENT_CAPABILITIES.uploads.maxRegularBytes,
  CLIENT_CAPABILITIES.uploads.maxVideoBytes
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A rejected exchange request. `status` maps straight onto the HTTP response. */
export class ExchangeError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 500,
    readonly code:
      | "exchange_invalid_name"
      | "exchange_invalid_connection"
      | "exchange_invalid_delivery"
      | "exchange_unavailable"
      | "exchange_not_found"
      | "exchange_unsafe_path"
      | "exchange_too_large"
      | "exchange_write_failed"
  ) {
    super(code);
    this.name = "ExchangeError";
  }
}

const errno = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code;

/**
 * File exchange between the Server and a connector's private state directory
 * (specs/009 design §3.3.3). Everything lives under
 * `<state>/exchange/{inbound,outbound/<deliveryId>}`: the connector writes plaintext media into
 * `inbound`, the Server writes Bot-sent assets into `outbound/<deliveryId>`.
 *
 * Every component of every path is checked to be a real directory (never a symlink), file
 * names are restricted to a conservative pattern, and files are opened with O_NOFOLLOW and
 * re-checked with fstat so a swapped-in symlink cannot redirect a read or a write.
 */
export class McpExchange {
  constructor(
    /** Absolute path of the connector's account state directory. Need not exist yet. */
    private readonly stateDirectory: (connectionId: string) => string,
    private readonly maxBytes = EXCHANGE_MAX_BYTES
  ) {}

  /** Streams an inbound file. The caller owns the returned body. */
  async readInbound(connectionId: string, name: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
    this.assertConnection(connectionId);
    this.assertName(name);
    const directory = await this.directory(connectionId, ["exchange", "inbound"], { create: false });
    const handle = await this.openFile(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new ExchangeError(400, "exchange_unsafe_path");
      if (stats.size > this.maxBytes) throw new ExchangeError(413, "exchange_too_large");
      if (stats.size === 0) {
        await handle.close();
        return { body: new Response(new Uint8Array(0)).body!, size: 0 };
      }
      // Opened by descriptor: a later swap of the path cannot change what is streamed.
      const stream = handle.createReadStream({ autoClose: true, start: 0, end: stats.size - 1 });
      return { body: Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, size: stats.size };
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  }

  /** Writes an outbound file atomically (temp file, fsync, rename) with mode 0600. */
  async writeOutbound(
    connectionId: string,
    deliveryId: string,
    name: string,
    body: ReadableStream<Uint8Array> | null,
    declaredSize?: number
  ): Promise<{ bytes: number; sha256: string }> {
    this.assertConnection(connectionId);
    this.assertDelivery(deliveryId);
    this.assertName(name);
    if (!body) throw new ExchangeError(400, "exchange_invalid_name");
    if (declaredSize !== undefined && declaredSize > this.maxBytes) throw new ExchangeError(413, "exchange_too_large");
    const directory = await this.directory(connectionId, ["exchange", "outbound", deliveryId], { create: true });
    const target = join(directory, name);
    const existing = await lstat(target).catch((error) => {
      if (errno(error) === "ENOENT") return undefined;
      throw error;
    });
    if (existing && !existing.isFile()) throw new ExchangeError(400, "exchange_unsafe_path");
    const temporary = join(directory, `.${randomBytes(8).toString("hex")}.tmp`);
    let handle: FileHandle | undefined;
    try {
      handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      const hash = createHash("sha256");
      let bytes = 0;
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > this.maxBytes) {
          await reader.cancel().catch(() => {});
          throw new ExchangeError(413, "exchange_too_large");
        }
        hash.update(value);
        await handle.write(value);
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, target);
      return { bytes, sha256: hash.digest("hex") };
    } catch (error) {
      await handle?.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      if (error instanceof ExchangeError) throw error;
      throw new ExchangeError(500, "exchange_write_failed");
    }
  }

  /** Removes one delivery's outbound directory. Missing is fine; anything unsafe is refused. */
  async removeOutbound(connectionId: string, deliveryId: string): Promise<void> {
    this.assertConnection(connectionId);
    this.assertDelivery(deliveryId);
    const parent = await this.directory(connectionId, ["exchange", "outbound"], { create: false }).catch((error) => {
      if (error instanceof ExchangeError && error.code === "exchange_not_found") return undefined;
      throw error;
    });
    if (!parent) return;
    const target = join(parent, deliveryId);
    const stats = await lstat(target).catch((error) => {
      if (errno(error) === "ENOENT") return undefined;
      throw error;
    });
    if (!stats) return;
    if (!stats.isDirectory()) throw new ExchangeError(400, "exchange_unsafe_path");
    await rm(target, { recursive: true, force: true });
  }

  private assertConnection(connectionId: string): void {
    if (!UUID.test(connectionId)) throw new ExchangeError(400, "exchange_invalid_connection");
  }

  private assertDelivery(deliveryId: string): void {
    if (!UUID.test(deliveryId)) throw new ExchangeError(400, "exchange_invalid_delivery");
  }

  private assertName(name: string): void {
    if (!EXTERNAL_EXCHANGE_NAME_PATTERN.test(name)) throw new ExchangeError(400, "exchange_invalid_name");
  }

  private async openFile(path: string, flags: number): Promise<FileHandle> {
    try {
      return await open(path, flags);
    } catch (error) {
      const code = errno(error);
      if (code === "ENOENT") throw new ExchangeError(404, "exchange_not_found");
      // O_NOFOLLOW reports a final symlink as ELOOP (or EMLINK on some platforms).
      if (code === "ELOOP" || code === "EMLINK" || code === "ENOTDIR") throw new ExchangeError(400, "exchange_unsafe_path");
      throw error;
    }
  }

  /**
   * Resolves `<state>/<segments...>` after checking each existing component is a real directory.
   * The state directory itself must already exist: only connectors that declared persistent
   * state get one, and the exchange never creates it.
   */
  private async directory(
    connectionId: string,
    segments: readonly string[],
    options: { create: boolean }
  ): Promise<string> {
    const state = this.stateDirectory(connectionId);
    const stateStats = await lstat(state).catch((error) => {
      if (errno(error) === "ENOENT") return undefined;
      throw error;
    });
    if (!stateStats) throw new ExchangeError(409, "exchange_unavailable");
    if (!stateStats.isDirectory()) throw new ExchangeError(400, "exchange_unsafe_path");
    let current = state;
    for (const segment of segments) {
      current = join(current, segment);
      let stats = await lstat(current).catch((error) => {
        if (errno(error) === "ENOENT") return undefined;
        throw error;
      });
      if (!stats) {
        if (!options.create) throw new ExchangeError(404, "exchange_not_found");
        await mkdir(current, { mode: 0o700 }).catch((error) => {
          if (errno(error) !== "EEXIST") throw error;
        });
        stats = await lstat(current);
      }
      if (!stats.isDirectory()) throw new ExchangeError(400, "exchange_unsafe_path");
    }
    // Belt and braces: the resolved location must still sit inside the state directory.
    const [realState, realCurrent] = await Promise.all([realpath(state), realpath(current)]);
    if (realCurrent !== realState && !realCurrent.startsWith(realState + sep))
      throw new ExchangeError(400, "exchange_unsafe_path");
    return current;
  }
}
