import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadEngineAsset } from "../src/engine/managed-assets";

const filename = "outcomego-engine-windows-x64.tar.gz";

test.each([
  ["SHA256SUMS", 404, "ASSET_VERIFICATION_FAILED"],
  [`${filename}.sigstore.json`, 404, "ASSET_VERIFICATION_FAILED"],
  [filename, 404, "ASSET_VERIFICATION_FAILED"],
  [filename, 410, "ASSET_VERIFICATION_FAILED"],
  [filename, 503, "ASSET_DOWNLOAD_FAILED"],
] as const)("classifies %s HTTP %i as %s", async (missingFile, status, code) => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-missing-engine-asset-"));
  const originalFetch = globalThis.fetch;
  const mockFetch = async (input: Parameters<typeof fetch>[0]) => String(input).endsWith(`/${missingFile}`)
    ? new Response(null, { status })
    : new Response("", { status: 200 });
  globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect });

  try {
    await expect(downloadEngineAsset(directory, filename, undefined, "1.2.3")).rejects.toMatchObject({
      code,
      ...(status !== 503 ? { detail: expect.stringContaining(`v1.2.3: ${missingFile} (HTTP ${status})`) } : {}),
    });
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});
