import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { downloadRelease } from "../src/release";
import { GITHUB_RELEASE_MIRRORS, releaseAssetCandidates } from "../src/release-sources";

const compose = `name: outcomego
services:
  server:
    image: ghcr.io/example/outcomego-server:\${OUTCOMEGO_VERSION}
    volumes:
      - outcomego_workspace:/workspace
`;

test("builds mirror fallback candidates only for canonical GitHub Release URLs", () => {
  const githubUrl = "https://github.com/owner/repo/releases/download/v1.2.3/outcomego-compose.yaml";
  const candidates = releaseAssetCandidates(githubUrl);
  expect(candidates[0]).toEqual({ url: githubUrl, direct: true, mirror: null });
  expect(candidates.slice(1, 1 + GITHUB_RELEASE_MIRRORS.length).map((item) => item.url)).toEqual(
    GITHUB_RELEASE_MIRRORS.map((mirror) => `${mirror}${githubUrl}`)
  );
  expect(candidates.at(-1)).toEqual({ url: githubUrl, direct: true, mirror: null });

  const sticky = releaseAssetCandidates(githubUrl, GITHUB_RELEASE_MIRRORS[1]);
  expect(sticky[0]).toEqual({
    url: `${GITHUB_RELEASE_MIRRORS[1]}${githubUrl}`,
    direct: false,
    mirror: GITHUB_RELEASE_MIRRORS[1],
  });
  expect(sticky.at(-1)).toEqual({ url: githubUrl, direct: true, mirror: null });

  const localUrl = "http://127.0.0.1:9999/outcomego-compose.yaml";
  expect(releaseAssetCandidates(localUrl)).toEqual([
    { url: localUrl, direct: true, mirror: null },
    { url: localUrl, direct: true, mirror: null },
  ]);
});

test("downloadRelease falls back to a GitHub mirror on ECONNRESET and skips corrupt mirror HTML pages", async () => {
  const originalFetch = globalThis.fetch;
  const sha = createHash("sha256").update(compose).digest("hex");
  const checksums = `${sha}  outcomego-compose.yaml\n`;
  const requested: string[] = [];

  const mockFetch = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requested.push(url);
    // Direct GitHub resets the connection.
    if (url.startsWith("https://github.com/")) {
      throw new Error("ECONNRESET: The socket connection was closed unexpectedly.");
    }
    // First mirror returns an HTML block page with HTTP 200.
    if (url.startsWith(GITHUB_RELEASE_MIRRORS[0])) {
      return new Response("<html><body>Rate limited</body></html>", { status: 200 });
    }
    // Second mirror serves the real release files.
    if (url.startsWith(GITHUB_RELEASE_MIRRORS[1])) {
      if (url.endsWith("/outcomego-compose.yaml")) return new Response(compose, { status: 200 });
      if (url.endsWith("/SHA256SUMS")) return new Response(checksums, { status: 200 });
    }
    return new Response("bad gateway", { status: 502 });
  };
  globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect });

  try {
    const release = await downloadRelease({
      repository: "owner/repo",
      version: "1.2.3",
      allowUnsigned: true,
    });
    expect(release.compose).toBe(compose);
    expect(requested.some((url) => url.startsWith("https://github.com/"))).toBe(true);
    expect(requested.some((url) => url.startsWith(GITHUB_RELEASE_MIRRORS[0]))).toBe(true);
    expect(requested.some((url) => url.startsWith(GITHUB_RELEASE_MIRRORS[1]))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadRelease fails immediately on direct GitHub 404 without trying mirrors", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const mockFetch = async (input: Parameters<typeof fetch>[0]) => {
    requested.push(String(input));
    return new Response("Not Found", { status: 404 });
  };
  globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect });

  try {
    await expect(
      downloadRelease({
        repository: "owner/repo",
        version: "9.9.9",
        allowUnsigned: true,
      })
    ).rejects.toThrow("HTTP 404");
    expect(requested.every((url) => url.startsWith("https://github.com/"))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
