import type { AssetKind, AssetRef } from "@outcomego/contracts";

export const outcomeAssetId = (sourceRef: string): string | null =>
  /^asset:([a-f0-9]{64})$/.exec(sourceRef)?.[1] ?? null;

interface AssetTransport {
  assetUrl: (id: string) => string;
  headers: () => HeadersInit;
  generation: () => number;
  expire: (token: string | null) => void;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

const extensions: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
  "image/gif": ".gif", "application/pdf": ".pdf", "text/plain": ".txt",
  "text/markdown": ".md", "application/json": ".json", "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

/** Receipt references retain a hash, so use authoritative headers rather than invented file metadata. */
export async function loadOutcomeAsset(sourceRef: string, transport: AssetTransport, signal: AbortSignal): Promise<AssetRef> {
  const assetId = outcomeAssetId(sourceRef);
  if (!assetId) throw new Error("Invalid asset reference");
  const generation = transport.generation();
  const headers = transport.headers();
  const token = new Headers(headers).get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const response = await (transport.fetch ?? fetch)(transport.assetUrl(assetId), {
    method: "HEAD", headers, signal, redirect: "error",
  });
  if (signal.aborted || generation !== transport.generation()) throw new DOMException("Asset request cancelled", "AbortError");
  if (response.status === 401) transport.expire(token);
  if (!response.ok) throw new Error(`Asset request failed (${response.status})`);
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const length = response.headers.get("content-length");
  const byteSize = length === null ? NaN : Number(length);
  if (!mimeType || !Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > 200 * 1024 * 1024)
    throw new Error("Asset metadata is unavailable");
  const kind: AssetKind = mimeType.startsWith("image/") ? "image" :
    mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" :
    mimeType === "application/pdf" ? "pdf" : mimeType.startsWith("text/") ? "text" : "file";
  // The original filename is not retained in a receipt; this is a content-addressed display name.
  return { assetId, fileName: `${assetId}${extensions[mimeType] ?? ""}`, mimeType, byteSize, kind };
}
