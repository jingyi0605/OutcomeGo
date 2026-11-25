import { createHash } from "node:crypto";
import { basename } from "node:path";
import { verify, type Bundle } from "sigstore";
import { withBunCryptoVerifyCompatibility } from "./bun-crypto";
import { normalizeRepository, normalizeVersion } from "./config";
import { CliError } from "./errors";
import {
  fetchWithHeaderTimeout,
  looksLikeChecksums,
  looksLikeCompose,
  looksLikeJsonObject,
  releaseAssetCandidates,
} from "./release-sources";
import { LOCAL_RELEASE_KEY_ID, LOCAL_RELEASE_PUBLIC_KEY, localReleaseSigningPayload } from "./release-signing-key";

export interface ReleaseArtifact {
  version: string;
  composeUrl: string;
  checksumUrl: string;
  signatureUrl: string | null;
  compose: string;
}

export class ReleaseVerificationError extends CliError {}

export const releaseComposeUrl = (repository: string, version: string): string =>
  `https://github.com/${normalizeRepository(repository)}/releases/download/v${normalizeVersion(version)}/outcomego-compose.yaml`;

const fetchText = async (
  url: string,
  accept = "text/plain",
  signal?: AbortSignal,
  options: {
    preferredMirror?: { current: string | null };
    validateMirror?: (text: string) => boolean;
  } = {}
): Promise<string> => {
  const candidates = releaseAssetCandidates(url, options.preferredMirror?.current);
  let lastError: CliError | null = null;
  for (const candidate of candidates) {
    if (signal?.aborted) {
      throw new CliError(`Could not download ${url}: download cancelled`);
    }
    let response: Response;
    try {
      response = await fetchWithHeaderTimeout(
        fetch,
        candidate.url,
        {
          headers: { accept, "user-agent": "outcomego-cli" },
          redirect: "follow",
        },
        signal,
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
      lastError = new CliError(`Could not download ${url} (HTTP ${response.status})`);
      if (candidate.direct && (response.status === 404 || response.status === 410)) {
        throw lastError;
      }
      continue;
    }
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      // A body that stalls or drops after the headers fails here.
      lastError = new CliError(
        `Could not download ${url}: ${error instanceof Error ? error.message : error}`
      );
      continue;
    }
    if (!candidate.direct && options.validateMirror && !options.validateMirror(body)) {
      lastError = new CliError(`Could not download ${url}: mirror returned unexpected content`);
      continue;
    }
    if (options.preferredMirror && candidate.mirror) {
      options.preferredMirror.current = candidate.mirror;
    }
    return body;
  }
  throw lastError ?? new CliError(`Could not download ${url}`);
};

const escapedPattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const verifyReleaseSignature = async (options: {
  repository: string;
  version: string;
  compose: string;
  serializedBundle: string;
}): Promise<void> => {
  await verifyArtifactSignature({
    repository: options.repository,
    version: options.version,
    artifact: Buffer.from(options.compose),
    serializedBundle: options.serializedBundle,
  });
};

export const verifyArtifactSignature = async (options: {
  repository: string;
  version: string;
  artifact: Uint8Array;
  serializedBundle: string;
}): Promise<void> => {
  let bundle: Bundle;
  try {
    bundle = JSON.parse(options.serializedBundle) as Bundle;
  } catch {
    throw new CliError("The release signature bundle is not valid JSON");
  }
  const keyHint = bundle.verificationMaterial?.publicKey?.hint;
  const normalizedRepository = normalizeRepository(options.repository);
  if (keyHint === LOCAL_RELEASE_KEY_ID && normalizedRepository === "jingyi0605/OutcomeGo") {
    throw new CliError(
      "The historical local release signature is bound to raghavpillai/openteam and cannot authenticate an OutcomeGo release"
    );
  }
  if (!bundle.verificationMaterial?.tlogEntries?.length) {
    throw new CliError("The release signature bundle has no transparency-log entry");
  }
  if (keyHint !== undefined && keyHint !== LOCAL_RELEASE_KEY_ID) {
    throw new CliError("Untrusted local release signing key");
  }
  const identity = `https://github.com/${normalizeRepository(options.repository)}/.github/workflows/release.yml@refs/tags/v${normalizeVersion(options.version)}`;
  try {
    const local = keyHint === LOCAL_RELEASE_KEY_ID;
    await withBunCryptoVerifyCompatibility(() =>
      verify(bundle, local ? localReleaseSigningPayload(options.repository, options.version, options.artifact) : Buffer.from(options.artifact), local ? {
        keySelector: hint => hint === LOCAL_RELEASE_KEY_ID ? LOCAL_RELEASE_PUBLIC_KEY : undefined,
        ctLogThreshold: 0,
        tlogThreshold: 1,
      } : {
        certificateIssuer: "https://token.actions.githubusercontent.com",
        certificateIdentityURI: `^${escapedPattern(identity)}$`,
        ctLogThreshold: 1,
        tlogThreshold: 1,
      })
    );
  } catch (error) {
    throw new CliError(
      `Sigstore verification failed for OutcomeGo ${options.version}: ${error instanceof Error ? error.message : error}`
    );
  }
};

const checksumFor = (contents: string, filename: string): string | null => {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match?.[1] && match[2] === filename) return match[1].toLowerCase();
  }
  return null;
};

export const validateCompose = (contents: string): void => {
  if (contents.length < 100 || contents.length > 1_000_000) {
    throw new CliError("The downloaded Compose file has an unexpected size");
  }
  if (!/^name:\s*outcomego\s*$/m.test(contents)) {
    throw new CliError("The downloaded Compose file is not an OutcomeGo release bundle");
  }
  if (!contents.includes("OUTCOMEGO_VERSION") || !contents.includes("outcomego_workspace")) {
    throw new CliError("The downloaded Compose file is missing required OutcomeGo configuration");
  }
};

export const downloadRelease = async (options: {
  repository: string;
  version: string;
  composeUrl?: string;
  checksumUrl?: string;
  signatureUrl?: string;
  allowUnsigned?: boolean;
  signal?: AbortSignal;
}): Promise<ReleaseArtifact> => {
  const version = normalizeVersion(options.version);
  const composeUrl = options.composeUrl ?? releaseComposeUrl(options.repository, version);
  const checksumUrl = options.checksumUrl ?? new URL("SHA256SUMS", composeUrl).toString();
  const signatureUrl = options.allowUnsigned
    ? null
    : (options.signatureUrl ?? `${composeUrl}.sigstore.json`);
  const preferredMirror = { current: null as string | null };
  const [compose, checksums, signature] = await Promise.all([
    fetchText(composeUrl, "text/plain", options.signal, {
      preferredMirror,
      validateMirror: looksLikeCompose,
    }),
    fetchText(checksumUrl, "text/plain", options.signal, {
      preferredMirror,
      validateMirror: looksLikeChecksums,
    }),
    signatureUrl
      ? fetchText(signatureUrl, "application/json", options.signal, {
          preferredMirror,
          validateMirror: looksLikeJsonObject,
        })
      : Promise.resolve(null),
  ]);
  try {
    validateCompose(compose);
    const filename = basename(new URL(composeUrl).pathname);
    const expected = checksumFor(checksums, filename);
    if (!expected) throw new CliError(`${checksumUrl} does not contain a checksum for ${filename}`);
    const actual = createHash("sha256").update(compose).digest("hex");
    if (actual !== expected) throw new CliError(`Checksum verification failed for ${composeUrl}`);
    if (signature) {
      await verifyReleaseSignature({
        repository: options.repository,
        version,
        compose,
        serializedBundle: signature,
      });
    }
  } catch (error) {
    throw new ReleaseVerificationError(error instanceof Error ? error.message : String(error));
  }
  return { version, composeUrl, checksumUrl, signatureUrl, compose };
};

export const latestReleaseVersion = async (repository: string): Promise<string> => {
  const normalized = normalizeRepository(repository);
  const body = await fetchText(
    `https://api.github.com/repos/${normalized}/releases/latest`,
    "application/vnd.github+json"
  );
  let tag: unknown;
  try {
    tag = (JSON.parse(body) as { tag_name?: unknown }).tag_name;
  } catch {
    throw new CliError(`GitHub returned an invalid latest release response for ${normalized}`);
  }
  if (typeof tag !== "string") throw new CliError(`No latest release was found for ${normalized}`);
  return normalizeVersion(tag);
};
