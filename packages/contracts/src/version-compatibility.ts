export const AITEAMOS_API_PROTOCOL_VERSION = 2;

export interface AiTeamOSClientCompatibilityPolicy {
  minimumClientVersion?: string | null;
  maximumClientVersionExclusive?: string | null;
  recommendedClientVersion?: string | null;
  minimumServerVersion?: string | null;
}

interface ParsedAiTeamOSVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  normalized: string;
}

const VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const parseAiTeamOSVersion = (value: string | null | undefined): ParsedAiTeamOSVersion | null => {
  if (!value) return null;
  const match = value.trim().match(VERSION_PATTERN);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  const prerelease = match[4]?.split(".") ?? [];
  const normalized = `${major}.${minor}.${patch}${
    prerelease.length ? `-${prerelease.join(".")}` : ""
  }`;
  return {
    major,
    minor,
    patch,
    prerelease,
    normalized,
  };
};

const compareNumericIdentifiers = (left: string, right: string) =>
  left.length === right.length ? (left < right ? -1 : 1) : left.length - right.length;

const compareParsedVersions = (
  left: ParsedAiTeamOSVersion,
  right: ParsedAiTeamOSVersion
): number => {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
        ? 1
        : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return compareNumericIdentifiers(a, b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
};

export const normalizeAiTeamOSVersion = (value: string): string | null =>
  parseAiTeamOSVersion(value)?.normalized ?? null;

export const isAiTeamOSVersion = (value: string): boolean =>
  normalizeAiTeamOSVersion(value) !== null;

export const compareAiTeamOSVersions = (left: string, right: string): number | null => {
  const a = parseAiTeamOSVersion(left);
  const b = parseAiTeamOSVersion(right);
  return a && b ? compareParsedVersions(a, b) : null;
};

/**
 * Patch releases in the same minor line are compatible unless a release widens the window.
 *
 * Prereleases of a line sort below its `.0` release (`0.1.0-beta.1 < 0.1.0`), so the lower bound
 * is `X.Y.0-0`, the smallest prerelease of the line. A bound of plain `X.Y.0` would reject every
 * beta of its own line, including a client and server on the identical version.
 */
export const defaultAiTeamOSCompatibilityWindow = (
  releaseVersion: string
): { minimum: string; maximumExclusive: string } | null => {
  const parsed = parseAiTeamOSVersion(releaseVersion);
  if (!parsed) return null;
  return {
    minimum: `${parsed.major}.${parsed.minor}.0-0`,
    maximumExclusive: `${parsed.major}.${parsed.minor + 1}.0-0`,
  };
};

export type AiTeamOSCompatibilityState =
  | "compatible"
  | "update-recommended"
  | "client-update-required"
  | "server-update-required"
  | "unknown";

export const aiTeamOSCompatibility = (
  clientVersion: string,
  serverVersion: string | null,
  serverProtocolVersion: number | null = AITEAMOS_API_PROTOCOL_VERSION,
  policy: AiTeamOSClientCompatibilityPolicy = {}
): AiTeamOSCompatibilityState => {
  const client = parseAiTeamOSVersion(clientVersion);
  const server = parseAiTeamOSVersion(serverVersion);
  if (!client || !server || !Number.isInteger(serverProtocolVersion)) return "unknown";

  if ((serverProtocolVersion as number) > AITEAMOS_API_PROTOCOL_VERSION) {
    return "client-update-required";
  }
  if ((serverProtocolVersion as number) < AITEAMOS_API_PROTOCOL_VERSION) {
    return "server-update-required";
  }

  const serverWindow = defaultAiTeamOSCompatibilityWindow(server.normalized);
  const clientWindow = defaultAiTeamOSCompatibilityWindow(client.normalized);
  const minimumClient = parseAiTeamOSVersion(
    policy.minimumClientVersion ?? serverWindow?.minimum ?? ""
  );
  const maximumClient = parseAiTeamOSVersion(
    policy.maximumClientVersionExclusive ?? serverWindow?.maximumExclusive ?? ""
  );
  const minimumServer = parseAiTeamOSVersion(
    policy.minimumServerVersion ?? clientWindow?.minimum ?? ""
  );
  if (!minimumClient || !maximumClient || !minimumServer) return "unknown";

  if (compareParsedVersions(client, minimumClient) < 0) return "client-update-required";
  if (
    compareParsedVersions(client, maximumClient) >= 0 ||
    compareParsedVersions(server, minimumServer) < 0
  ) {
    return "server-update-required";
  }
  return client.normalized === server.normalized ? "compatible" : "update-recommended";
};
