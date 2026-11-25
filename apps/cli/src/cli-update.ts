import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { normalizeRepository, normalizeVersion } from "./config";
import { DEFAULT_REPOSITORY } from "./constants";
import { deployErrorExitCodes } from "./deploy-events";
import { CliError } from "./errors";
import { cliTranslate } from "./localization";
import { verifyArtifactSignature } from "./release";
import {
  fetchWithHeaderTimeout,
  looksLikeChecksums,
  looksLikeJsonObject,
  releaseAssetCandidates,
} from "./release-sources";

export const CLI_UPDATE_SOURCE_ENV = "OUTCOMEGO_CLI_UPDATE_SOURCE";
export const CLI_UPDATE_TARGET_ENV = "OUTCOMEGO_CLI_UPDATE_TARGET";
export const CLI_UPDATE_VERSION_ENV = "OUTCOMEGO_CLI_UPDATE_VERSION";
export const CLI_UPDATE_FOLLOWER_PID_ENV = "OUTCOMEGO_CLI_UPDATE_FOLLOWER_PID";
export const DESKTOP_CLI_VERSION_ENV = "OUTCOMEGO_DESKTOP_CLI_VERSION";
export const DESKTOP_CLI_PREPARE_ENV = "OUTCOMEGO_DESKTOP_CLI_PREPARE";

export const desktopCliCarrierPath = (
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string => platform === "win32"
  ? win32.resolve(environment.LOCALAPPDATA?.trim() || win32.join(home, "AppData", "Local"), "OutcomeGo", "bin", "outcomego.exe")
  : resolve(home, ".local", "bin", "outcomego");

export const verifyDesktopCliVersion = (expected: string, actual: string): void => {
  try {
    if (normalizeVersion(expected) === normalizeVersion(actual)) return;
  } catch {}
  throw new CliError(
    `CLI_VERSION_MISMATCH: ${cliTranslate("The desktop app requires a compatible CLI version.")}`,
    deployErrorExitCodes.CLI_VERSION_MISMATCH
  );
};

const MAX_COMPRESSED_CLI_BYTES = 128 * 1024 * 1024;
const MAX_CLI_BYTES = 256 * 1024 * 1024;
const MAX_RELEASE_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface StagedCliUpdate {
  source: string;
  target: string;
  version: string;
}

export interface CliPromotion extends StagedCliUpdate {
  followerPid: number | null;
}

export const isBunStandaloneExecutable = (
  argv: readonly string[] = process.argv,
  versions: Readonly<Record<string, string | undefined>> = process.versions
): boolean => {
  const runtimeFlag =
    typeof Bun !== "undefined" &&
    Boolean((Bun as unknown as { isStandaloneExecutable?: boolean }).isStandaloneExecutable);
  const entrypoint = argv[1]?.replaceAll("\\", "/") ?? "";
  const virtualEntrypoint =
    entrypoint.startsWith("/$bunfs/root/") || /^[A-Za-z]:\/~BUN\/root\//i.test(entrypoint);
  return runtimeFlag || (Boolean(versions.bun) && virtualEntrypoint);
};

const samePath = (left: string, right: string, platform = process.platform): boolean => {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
};

export const isStandaloneCliExecutable = (
  argv: readonly string[] = process.argv,
  executable = process.execPath,
  versions: Readonly<Record<string, string | undefined>> = process.versions,
  platform = process.platform,
  standaloneExecutable = isBunStandaloneExecutable(argv, versions)
): boolean =>
  !versions.electron &&
  (standaloneExecutable || (Boolean(argv[1]) && samePath(argv[1] as string, executable, platform)));

export const cliAssetName = (
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch
): string => {
  if (platform === "win32" && ["x64", "arm64"].includes(architecture)) {
    return "outcomego-windows-x64.exe";
  }
  if (!["darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(architecture)) {
    throw new CliError(`OutcomeGo does not publish a CLI for ${platform}/${architecture}`);
  }
  return `outcomego-${platform}-${architecture}`;
};

export const cliReleaseAssetUrl = (repository: string, version: string, filename: string): string =>
  `https://github.com/${normalizeRepository(repository)}/releases/download/v${normalizeVersion(version)}/${filename}`;

const fetchBodyWithFallback = async (
  fetcher: Fetcher,
  url: string,
  accept: string,
  maximumBytes: number,
  options: {
    preferredMirror: { current: string | null };
    allowMissing?: boolean;
    validateMirror?: (bytes: Uint8Array) => boolean;
  }
): Promise<Uint8Array | null> => {
  const candidates = releaseAssetCandidates(url, options.preferredMirror.current);
  let lastError: CliError | null = null;
  let mirrorMissing = 0;
  for (const candidate of candidates) {
    let response: Response;
    try {
      response = await fetchWithHeaderTimeout(
        fetcher as typeof fetch,
        candidate.url,
        { headers: { accept, "user-agent": "outcomego-cli" }, redirect: "follow" },
        AbortSignal.timeout(120_000),
        15_000
      );
    } catch (error) {
      lastError = new CliError(
        `Could not download ${url}: ${error instanceof Error ? error.message : error}`
      );
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (candidate.direct && response.status === 404 && options.allowMissing) {
        return null;
      }
      if (!candidate.direct && response.status === 404 && options.allowMissing) {
        mirrorMissing++;
      }
      lastError = new CliError(`Could not download ${url} (HTTP ${response.status})`);
      if (candidate.direct && (response.status === 404 || response.status === 410)) {
        throw lastError;
      }
      continue;
    }
    let body: Uint8Array;
    try {
      body = await readBody(response, url, maximumBytes);
    } catch (error) {
      lastError =
        error instanceof CliError
          ? error
          : new CliError(`Could not download ${url}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    if (!candidate.direct && options.validateMirror && !options.validateMirror(body)) {
      lastError = new CliError(`Could not download ${url}: mirror returned unexpected content`);
      continue;
    }
    if (candidate.mirror) options.preferredMirror.current = candidate.mirror;
    return body;
  }
  if (options.allowMissing && mirrorMissing >= 2) return null;
  throw lastError ?? new CliError(`Could not download ${url}`);
};

const readBody = async (
  response: Response,
  url: string,
  maximumBytes: number
): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new CliError(`The downloaded CLI asset from ${url} is unexpectedly large`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > maximumBytes) {
    throw new CliError(`The downloaded CLI asset from ${url} has an unexpected size`);
  }
  return body;
};

const checksumFor = (contents: string, filename: string): string | null => {
  const matches = contents.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match?.[1] || !match[2]) return [];
    const path = match[2].replaceAll("\\", "/");
    return path === filename || path.endsWith(`/${filename}`) ? [match[1].toLowerCase()] : [];
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
};

const assertChecksum = (contents: Uint8Array, checksums: string, filename: string): void => {
  const expected = checksumFor(checksums, filename);
  if (!expected) throw new CliError(`SHA256SUMS does not contain one checksum for ${filename}`);
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== expected) throw new CliError(`Checksum verification failed for ${filename}`);
};

const candidateVersion = async (
  executable: string,
  args = ["--version"]
): Promise<{ status: number | null; stdout: string; detail: string | null }> =>
  new Promise((resolvePromise) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let detail: string | null = null;
    let bytes = 0;
    const timer = setTimeout(() => {
      detail = "version check timed out";
      child.kill();
    }, 15_000);
    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      bytes += chunk.byteLength;
      if (bytes > MAX_VERSION_OUTPUT_BYTES) {
        detail = "version check produced too much output";
        child.kill();
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    const events = child as unknown as {
      on(event: "error", listener: (error: Error) => void): void;
      on(event: "close", listener: (status: number | null, signal: string | null) => void): void;
    };
    events.on("error", (error) => {
      detail = error.message;
    });
    events.on("close", (status, signal) => {
      clearTimeout(timer);
      resolvePromise({
        status,
        stdout,
        detail: detail || stderr.trim() || (signal ? `terminated by ${signal}` : null),
      });
    });
  });

export const downloadCliArtifact = async (options: {
  repository: string;
  version: string;
  assetUrl?: string;
  checksumUrl?: string;
  signatureUrl?: string;
  allowUnsigned?: boolean;
  fetcher?: Fetcher;
  platform?: NodeJS.Platform;
  architecture?: NodeJS.Architecture;
}): Promise<{ bytes: Uint8Array; filename: string }> => {
  const version = normalizeVersion(options.version);
  const filename = cliAssetName(options.platform, options.architecture);
  const assetUrl = options.assetUrl ?? cliReleaseAssetUrl(options.repository, version, filename);
  const checksumUrl = options.checksumUrl ?? new URL("SHA256SUMS", assetUrl).toString();
  const signatureUrl = options.allowUnsigned
    ? null
    : (options.signatureUrl ?? `${assetUrl}.sigstore.json`);
  const fetcher = options.fetcher ?? fetch;
  const compressedUrl = `${assetUrl}.gz`;
  const preferredMirror = { current: null as string | null };
  const decoder = new TextDecoder();
  const [compressedBytes, checksumBytes, signatureBytes] = await Promise.all([
    fetchBodyWithFallback(fetcher, compressedUrl, "application/gzip", MAX_COMPRESSED_CLI_BYTES, {
      preferredMirror,
      allowMissing: true,
      validateMirror: (data) => data.byteLength >= 2 && data[0] === 0x1f && data[1] === 0x8b,
    }),
    fetchBodyWithFallback(fetcher, checksumUrl, "text/plain", MAX_RELEASE_METADATA_BYTES, {
      preferredMirror,
      validateMirror: (data) => looksLikeChecksums(decoder.decode(data)),
    }),
    signatureUrl
      ? fetchBodyWithFallback(
          fetcher,
          signatureUrl,
          "application/json",
          MAX_RELEASE_METADATA_BYTES,
          {
            preferredMirror,
            validateMirror: (data) => looksLikeJsonObject(decoder.decode(data)),
          }
        )
      : Promise.resolve(null),
  ]);
  const checksums = decoder.decode(checksumBytes!);
  const signature = signatureBytes ? decoder.decode(signatureBytes) : null;
  let bytes: Uint8Array;
  if (compressedBytes) {
    assertChecksum(compressedBytes, checksums, `${filename}.gz`);
    try {
      bytes = gunzipSync(compressedBytes, { maxOutputLength: MAX_CLI_BYTES });
    } catch {
      throw new CliError(`Could not decompress ${filename}.gz`);
    }
  } else {
    const rawBytes = await fetchBodyWithFallback(
      fetcher,
      assetUrl,
      "application/octet-stream",
      MAX_CLI_BYTES,
      { preferredMirror }
    );
    bytes = rawBytes!;
  }
  if (bytes.byteLength > MAX_CLI_BYTES) {
    throw new CliError(`The decompressed CLI asset ${filename} is unexpectedly large`);
  }
  assertChecksum(bytes, checksums, filename);
  if (signature) {
    await verifyArtifactSignature({
      repository: options.repository,
      version,
      artifact: bytes,
      serializedBundle: signature,
    });
  }
  return { bytes, filename };
};

export const stageCliUpdate = async (options: {
  repository: string;
  version: string;
  executable?: string;
  assetUrl?: string;
  checksumUrl?: string;
  signatureUrl?: string;
  allowUnsigned?: boolean;
  fetcher?: Fetcher;
  platform?: NodeJS.Platform;
  architecture?: NodeJS.Architecture;
  validateCandidate?: typeof candidateVersion;
}): Promise<StagedCliUpdate> => {
  const target = resolve(options.executable ?? process.execPath);
  const version = normalizeVersion(options.version);
  const artifact = await downloadCliArtifact({
    repository: options.repository,
    version,
    assetUrl: options.assetUrl,
    checksumUrl: options.checksumUrl,
    signatureUrl: options.signatureUrl,
    allowUnsigned: options.allowUnsigned,
    fetcher: options.fetcher,
    platform: options.platform,
    architecture: options.architecture,
  });
  const source = join(dirname(target), `.${basename(target)}.update-${version}-${randomUUID()}`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(source, "wx", 0o700);
    writeFileSync(descriptor, artifact.bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    chmodSync(source, 0o755);
    const result = await (options.validateCandidate ?? candidateVersion)(source);
    const output = result.stdout.trim();
    if (result.status !== 0 || output !== version) {
      const detail = result.detail || output || `exit ${result.status ?? "unknown"}`;
      throw new CliError(`The staged OutcomeGo CLI did not report version ${version}: ${detail}`);
    }
    return { source, target, version };
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(source, { force: true });
    throw error;
  }
};

export const cliPromotionEnvironment = (
  staged: StagedCliUpdate,
  followerPid = process.pid
): NodeJS.ProcessEnv => ({
  [CLI_UPDATE_SOURCE_ENV]: staged.source,
  [CLI_UPDATE_TARGET_ENV]: staged.target,
  [CLI_UPDATE_VERSION_ENV]: staged.version,
  [CLI_UPDATE_FOLLOWER_PID_ENV]: String(followerPid),
});

export const readCliPromotion = (
  environment: NodeJS.ProcessEnv = process.env,
  executable = process.execPath,
  cliVersion: string,
  platform = process.platform
): CliPromotion | null => {
  const sourceValue = environment[CLI_UPDATE_SOURCE_ENV]?.trim();
  const targetValue = environment[CLI_UPDATE_TARGET_ENV]?.trim();
  const versionValue = environment[CLI_UPDATE_VERSION_ENV]?.trim();
  if (!sourceValue && !targetValue && !versionValue) return null;
  if (!sourceValue || !targetValue || !versionValue) {
    throw new CliError("The staged CLI update environment is incomplete");
  }
  const source = resolve(sourceValue);
  const target = resolve(targetValue);
  const version = normalizeVersion(versionValue);
  if (
    !samePath(source, executable, platform) ||
    samePath(source, target, platform) ||
    !samePath(dirname(source), dirname(target), platform) ||
    !basename(source).startsWith(`.${basename(target)}.update-`) ||
    version !== normalizeVersion(cliVersion)
  ) {
    throw new CliError("The staged CLI update environment is invalid");
  }
  const follower = Number(environment[CLI_UPDATE_FOLLOWER_PID_ENV]);
  return {
    source,
    target,
    version,
    followerPid: Number.isSafeInteger(follower) && follower > 0 ? follower : null,
  };
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const scheduleWindowsRemoval = (path: string): void => {
  try {
    const cleanup = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Wait-Process -Id $env:OUTCOMEGO_DELETE_PID -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $env:OUTCOMEGO_DELETE_PATH -Force -ErrorAction SilentlyContinue",
      ],
      {
        detached: true,
        env: {
          ...process.env,
          OUTCOMEGO_DELETE_PID: String(process.pid),
          OUTCOMEGO_DELETE_PATH: path,
        },
        stdio: "ignore",
        windowsHide: true,
      }
    );
    (cleanup as unknown as { on(event: "error", listener: () => void): void }).on(
      "error",
      () => undefined
    );
    cleanup.unref();
  } catch {
    // A failed cleanup does not affect the installed CLI or its retained backup.
  }
};

export const removeCurrentCli = (
  options: {
    executable?: string;
    argv?: readonly string[];
    versions?: Readonly<Record<string, string | undefined>>;
    platform?: NodeJS.Platform;
    standaloneExecutable?: boolean;
  } = {}
): string | null => {
  const executable = resolve(options.executable ?? process.execPath);
  const argv = options.argv ?? process.argv;
  const versions = options.versions ?? process.versions;
  const platform = options.platform ?? process.platform;
  const standaloneExecutable =
    options.standaloneExecutable ?? isBunStandaloneExecutable(argv, versions);
  if (!isStandaloneCliExecutable(argv, executable, versions, platform, standaloneExecutable)) {
    return null;
  }
  rmSync(`${executable}.previous`, { force: true });
  if (platform === "win32") scheduleWindowsRemoval(executable);
  else rmSync(executable);
  return executable;
};

export const waitForCliFollowerToExit = async (
  promotion: CliPromotion,
  platform = process.platform
): Promise<void> => {
  if (platform !== "win32" || !promotion.followerPid) return;
  const deadline = Date.now() + 30_000;
  while (processIsAlive(promotion.followerPid)) {
    if (Date.now() >= deadline) {
      throw new CliError("The previous OutcomeGo CLI process did not exit for the Windows update");
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 100));
  }
};

export const promoteStagedCli = (promotion: CliPromotion, platform = process.platform): string => {
  if (!existsSync(promotion.source) || !existsSync(promotion.target)) {
    throw new CliError("The staged or installed OutcomeGo CLI is missing");
  }
  if (platform === "win32") {
    const backup = `${promotion.target}.previous`;
    const next = `${promotion.target}.${randomUUID()}.next`;
    try {
      copyFileSync(promotion.source, next);
      rmSync(backup, { force: true });
      renameSync(promotion.target, backup);
      try {
        renameSync(next, promotion.target);
      } catch (error) {
        renameSync(backup, promotion.target);
        throw error;
      }
      scheduleWindowsRemoval(promotion.source);
      return backup;
    } catch (error) {
      throw error;
    } finally {
      rmSync(next, { force: true });
    }
  }
  const backup = `${promotion.target}.previous`;
  const nextBackup = `${backup}.${randomUUID()}.next`;
  try {
    copyFileSync(promotion.target, nextBackup);
    chmodSync(nextBackup, 0o755);
    renameSync(nextBackup, backup);
    renameSync(promotion.source, promotion.target);
    chmodSync(promotion.target, 0o755);
    return backup;
  } finally {
    rmSync(nextBackup, { force: true });
  }
};

export const removeStagedCli = (staged: StagedCliUpdate, platform = process.platform): void => {
  try {
    if (!samePath(staged.source, staged.target, platform)) rmSync(staged.source, { force: true });
  } catch {
    if (platform === "win32") scheduleWindowsRemoval(staged.source);
  }
};

export const prepareDesktopCli = async (options: {
  version: string;
  target?: string;
  stage?: typeof stageCliUpdate;
  inspect?: typeof candidateVersion;
  supportsBootstrap?: (executable: string) => Promise<boolean>;
}): Promise<string> => {
  const version = normalizeVersion(options.version);
  const target = options.target ?? desktopCliCarrierPath();
  const supportsBootstrap = options.supportsBootstrap ?? (async executable => {
    const bootstrap = await candidateVersion(executable, ["bootstrap", "--help"]);
    if (bootstrap.status !== 0 || !bootstrap.stdout.includes("bootstrap --json-progress")) return false;
    const managed = await candidateVersion(executable, ["engine", "start", "--help"]);
    return managed.status === 0 && managed.stdout.includes("outcomego engine start");
  });
  if (existsSync(target)) {
    const current = await (options.inspect ?? candidateVersion)(target);
    if (current.status === 0 && current.stdout.trim() === version && await supportsBootstrap(target)) return target;
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const staged = await (options.stage ?? stageCliUpdate)({ repository: DEFAULT_REPOSITORY, version, executable: target });
  try {
    if (!await supportsBootstrap(staged.source)) verifyDesktopCliVersion(version, "");
    if (existsSync(target)) promoteStagedCli({ ...staged, followerPid: null });
    else renameSync(staged.source, target);
    return target;
  } finally {
    removeStagedCli(staged);
  }
};
