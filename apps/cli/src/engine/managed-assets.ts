import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { cliReleaseAssetUrl } from "../cli-update";
import { normalizeVersion } from "../config";
import { CLI_VERSION, DEFAULT_REPOSITORY } from "../constants";
import { cliTranslate } from "../localization";
import { verifyArtifactSignature } from "../release";
import { EngineError } from "./types";

export const validateEngineArtifact = async (filename: string, bytes: Uint8Array, checksums: string, verify: () => Promise<void>) => {
  const matches = checksums.split(/\r?\n/).flatMap(line => {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    return match?.[2] === filename ? [match[1]!.toLowerCase()] : [];
  });
  if (!bytes.length || matches.length !== 1 || matches[0] !== createHash("sha256").update(bytes).digest("hex"))
    throw new EngineError("ASSET_VERIFICATION_FAILED");
  try { await verify(); } catch { throw new EngineError("ASSET_VERIFICATION_FAILED"); }
};

export type EngineAssetLoader = (directory: string, filename: string, signal?: AbortSignal, version?: string) => Promise<string>;

export const downloadEngineAsset: EngineAssetLoader = async (directory, filename, signal, version = CLI_VERSION) => {
  if (filename !== basename(filename)) throw new EngineError("ASSET_VERIFICATION_FAILED");
  const release = normalizeVersion(version);
  const url = cliReleaseAssetUrl(DEFAULT_REPOSITORY, release, filename);
  const deadline = AbortSignal.timeout(15 * 60_000);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const fetchBounded = async (address: string, limit: number, path?: string): Promise<Buffer> => {
    const response = await fetch(address, { signal: abort });
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel().catch(() => undefined);
      throw new EngineError("ASSET_VERIFICATION_FAILED", `${cliTranslate("Required engine release file is missing.")} v${release}: ${basename(new URL(address).pathname)} (HTTP ${response.status})`);
    }
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) throw new EngineError("ASSET_DOWNLOAD_FAILED");
    let length = 0;
    const buffers: Buffer[] = [];
    const source = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream);
    if (path) {
      await pipeline(source, new Transform({ transform(chunk: Buffer, _encoding, next) {
        length += chunk.length;
        next(length > limit ? new EngineError("ASSET_DOWNLOAD_FAILED") : null, chunk);
      } }), createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal: abort });
      return readFile(path);
    }
    for await (const chunk of source) {
      length += chunk.length;
      if (length > limit) throw new EngineError("ASSET_DOWNLOAD_FAILED");
      buffers.push(Buffer.from(chunk));
    }
    return Buffer.concat(buffers);
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, filename);
  const temporary = `${destination}.${randomUUID()}.part`;
  const maximumAssetBytes = 768 * 1024 ** 2;
  try {
    const checksums = (await fetchBounded(new URL("SHA256SUMS", url).href, 1024 * 1024)).toString();
    const serializedBundle = (await fetchBounded(`${url}.sigstore.json`, 1024 * 1024)).toString();
    const verify = (bytes: Uint8Array) => validateEngineArtifact(filename, bytes, checksums, () => verifyArtifactSignature({
      repository: DEFAULT_REPOSITORY, version: release, artifact: bytes, serializedBundle,
    }));
    const cachedFile = await lstat(destination).catch(() => null);
    const cached = cachedFile?.isFile() && cachedFile.size <= maximumAssetBytes ? await readFile(destination) : null;
    if (cached) {
      try { await verify(cached); return destination; } catch {}
    }
    const bytes = await fetchBounded(url, maximumAssetBytes, temporary);
    await verify(bytes);
    abort.throwIfAborted();
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    if (signal?.aborted) throw new EngineError("CANCELLED");
    if (error instanceof EngineError) throw error;
    throw new EngineError("ASSET_DOWNLOAD_FAILED");
  } finally { await rm(temporary, { force: true }); }
};
