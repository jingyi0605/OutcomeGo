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
import {
  fetchWithHeaderTimeout,
  looksLikeChecksums,
  looksLikeJsonObject,
  releaseAssetCandidates,
} from "../release-sources";
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
  let preferredMirror: string | null = null;
  const fetchBounded = async (
    address: string,
    limit: number,
    path?: string,
    validateMirror?: (bytes: Buffer) => boolean
  ): Promise<Buffer> => {
    const candidates = releaseAssetCandidates(address, preferredMirror);
    let lastError: EngineError | null = null;
    for (const candidate of candidates) {
      if (signal?.aborted) throw new EngineError("CANCELLED");
      try {
        const response = await fetchWithHeaderTimeout(
          fetch,
          candidate.url,
          { headers: { "user-agent": "outcomego-cli" }, redirect: "follow" },
          abort,
          15_000
        );
        if (response.status === 404 || response.status === 410) {
          await response.body?.cancel().catch(() => undefined);
          if (candidate.direct) {
            throw new EngineError(
              "ASSET_VERIFICATION_FAILED",
              `${cliTranslate("Required engine release file is missing.")} v${release}: ${basename(new URL(address).pathname)} (HTTP ${response.status})`
            );
          }
          lastError = new EngineError("ASSET_DOWNLOAD_FAILED");
          continue;
        }
        if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) {
          await response.body?.cancel().catch(() => undefined);
          lastError = new EngineError("ASSET_DOWNLOAD_FAILED");
          continue;
        }
        let length = 0;
        const buffers: Buffer[] = [];
        const source = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream);
        let result: Buffer;
        if (path) {
          await rm(path, { force: true });
          await pipeline(source, new Transform({ transform(chunk: Buffer, _encoding, next) {
            length += chunk.length;
            next(length > limit ? new EngineError("ASSET_DOWNLOAD_FAILED") : null, chunk);
          } }), createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal: abort });
          result = await readFile(path);
        } else {
          for await (const chunk of source) {
            length += chunk.length;
            if (length > limit) throw new EngineError("ASSET_DOWNLOAD_FAILED");
            buffers.push(Buffer.from(chunk));
          }
          result = Buffer.concat(buffers);
        }
        if (!candidate.direct && validateMirror && !validateMirror(result)) {
          if (path) await rm(path, { force: true });
          lastError = new EngineError("ASSET_DOWNLOAD_FAILED");
          continue;
        }
        if (candidate.mirror) preferredMirror = candidate.mirror;
        return result;
      } catch (error) {
        if (path) await rm(path, { force: true });
        if (signal?.aborted) throw new EngineError("CANCELLED");
        if (error instanceof EngineError && error.code === "ASSET_VERIFICATION_FAILED") throw error;
        lastError = error instanceof EngineError ? error : new EngineError("ASSET_DOWNLOAD_FAILED");
      }
    }
    throw lastError ?? new EngineError("ASSET_DOWNLOAD_FAILED");
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, filename);
  const temporary = `${destination}.${randomUUID()}.part`;
  const maximumAssetBytes = 768 * 1024 ** 2;
  try {
    const checksums = (
      await fetchBounded(new URL("SHA256SUMS", url).href, 1024 * 1024, undefined, (bytes) =>
        looksLikeChecksums(bytes.toString("utf8"))
      )
    ).toString();
    const serializedBundle = (
      await fetchBounded(`${url}.sigstore.json`, 1024 * 1024, undefined, (bytes) =>
        looksLikeJsonObject(bytes.toString("utf8"))
      )
    ).toString();
    const verify = (bytes: Uint8Array) => validateEngineArtifact(filename, bytes, checksums, () => verifyArtifactSignature({
      repository: DEFAULT_REPOSITORY, version: release, artifact: bytes, serializedBundle,
    }));
    const cachedFile = await lstat(destination).catch(() => null);
    const cached = cachedFile?.isFile() && cachedFile.size <= maximumAssetBytes ? await readFile(destination) : null;
    if (cached) {
      try { await verify(cached); return destination; } catch {}
    }
    const bytes = await fetchBounded(
      url,
      maximumAssetBytes,
      temporary,
      filename.endsWith(".tar.gz")
        ? (data) => data.byteLength >= 2 && data[0] === 0x1f && data[1] === 0x8b
        : undefined
    );
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
