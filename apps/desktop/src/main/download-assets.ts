const ASSET_PATH = /\/api\/v0\/assets\/[a-f0-9]{64}$/i;

/** Validate a renderer-provided asset URL against the server bases known by the main process. */
export const isTrustedAssetDownloadUrl = (
  value: string,
  trustedBases: readonly string[]
): boolean => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !ASSET_PATH.test(url.pathname)) {
      return false;
    }
    return trustedBases.some((candidate) => {
      try {
        const base = new URL(candidate);
        if (base.origin !== url.origin) return false;
        const prefix = base.pathname.replace(/\/+$/, "");
        return url.pathname === `${prefix}/api/v0/assets/${url.pathname.split("/").at(-1)}`;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
};
