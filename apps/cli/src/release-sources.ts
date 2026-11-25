export const GITHUB_RELEASE_MIRRORS = [
  "https://ghfast.top/",
  "https://cdn.gh-proxy.org/",
  "https://ghproxy.net/",
  "https://gh-proxy.org/",
] as const;

const githubReleaseAssetPattern =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/.+$/;

export interface ReleaseCandidate {
  url: string;
  direct: boolean;
  mirror: string | null;
}

export const isGithubReleaseAssetUrl = (url: string): boolean =>
  githubReleaseAssetPattern.test(url);

/**
 * Candidate URLs for downloading a release asset.
 *
 * Canonical GitHub Release URLs try direct first (or a sticky working mirror
 * within the same download session), fall back across Mainland China mirrors
 * when direct encounters a transient network error, and retry direct once at
 * the end. Non-GitHub URLs are only retried directly without third-party mirrors.
 */
export const releaseAssetCandidates = (
  url: string,
  preferredMirror?: string | null
): ReleaseCandidate[] => {
  if (!isGithubReleaseAssetUrl(url)) {
    return [
      { url, direct: true, mirror: null },
      { url, direct: true, mirror: null },
    ];
  }
  const mirrors =
    preferredMirror &&
    GITHUB_RELEASE_MIRRORS.includes(preferredMirror as (typeof GITHUB_RELEASE_MIRRORS)[number])
      ? [preferredMirror, ...GITHUB_RELEASE_MIRRORS.filter((item) => item !== preferredMirror)]
      : [...GITHUB_RELEASE_MIRRORS];
  const mirrorCandidates = mirrors.map((mirror) => ({
    url: `${mirror}${url}`,
    direct: false,
    mirror,
  }));
  if (preferredMirror) {
    return [...mirrorCandidates, { url, direct: true, mirror: null }];
  }
  return [
    { url, direct: true, mirror: null },
    ...mirrorCandidates,
    { url, direct: true, mirror: null },
  ];
};

export const fetchWithHeaderTimeout = async (
  fetcher: typeof fetch,
  url: string,
  init: Omit<RequestInit, "signal">,
  signal: AbortSignal | undefined,
  headerTimeoutMs: number
): Promise<Response> => {
  const headerAbort = new AbortController();
  const timer = setTimeout(
    () => headerAbort.abort(new Error(`Request timed out after ${headerTimeoutMs}ms`)),
    headerTimeoutMs
  );
  const combined = signal ? AbortSignal.any([signal, headerAbort.signal]) : headerAbort.signal;
  try {
    const response = await fetcher(url, { ...init, signal: combined });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
};

export const looksLikeChecksums = (text: string): boolean => /^[a-f0-9]{64}\s+/im.test(text);

export const looksLikeJsonObject = (text: string): boolean => {
  if (!text.trimStart().startsWith("{")) return false;
  try {
    const parsed = JSON.parse(text);
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
};

export const looksLikeCompose = (text: string): boolean => /^name:\s*outcomego\s*$/m.test(text);
