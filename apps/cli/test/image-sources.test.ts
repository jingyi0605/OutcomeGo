import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { DEFAULT_IMAGE_PREFIX } from "../src/constants";
import { pullDeploymentImage, rankImageSources, registrySources } from "../src/engine/image-sources";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sample = new Uint8Array(256 * 1024);
const layer = digest("layer");
const manifest = JSON.stringify({ layers: [{ digest: layer, size: 8 * 1024 ** 2 }] });
const index = JSON.stringify({ manifests: [{ digest: digest(manifest), platform: { os: "linux", architecture: "amd64" } }] });
const image = `${DEFAULT_IMAGE_PREFIX}-computer@${digest(index)}`;
const [official, university, daoCloud] = registrySources(image);

test("catalogs distinguish GHCR and Docker Hub and preserve the pinned digest", () => {
  expect([official, university, daoCloud].map(source => source?.registry)).toEqual(["ghcr.io", "ghcr.nju.edu.cn", "m.daocloud.io"]);
  expect(registrySources(`postgres:17-alpine@${digest(index)}`).map(source => [source.registry, source.repository])).toEqual([
    ["registry-1.docker.io", "library/postgres"], ["docker.nju.edu.cn", "library/postgres"], ["m.daocloud.io", "docker.io/library/postgres"],
  ]);
  expect(registrySources(`${DEFAULT_IMAGE_PREFIX}-computer:latest`)).toEqual([]);
  expect(registrySources(`ghcr.io/another/private@${digest(index)}`)).toEqual([]);
});

test("ranks transfer samples and rejects altered manifests and limited mirrors", async () => {
  const fetcher = async (address: URL, options: RequestInit) => {
    if (address.hostname === "m.daocloud.io") return new Response(null, { status: 429 });
    if (address.pathname.endsWith(digest(index))) return new Response(index);
    if (address.pathname.endsWith(digest(manifest))) return new Response(manifest);
    expect(address.pathname).toEndWith(`/blobs/${layer}`);
    expect(new Headers(options.headers).get("Range")).toBe("bytes=0-262143");
    if (address.hostname === "ghcr.io") await sleep(50);
    return new Response(sample, { status: 206 });
  };
  const sources = registrySources(image);
  expect(await rankImageSources(sources, "amd64", undefined, fetcher)).toEqual([university!.reference, official!.reference]);
  expect(await rankImageSources(sources, "amd64", undefined, async () => new Response("modified"))).toEqual([image]);
});

test("ranks both mirrors and retains a slower source if the fastest pull fails", async () => {
  const fetcher = async (address: URL) => {
    if (address.pathname.endsWith(digest(index))) return new Response(index);
    if (address.pathname.endsWith(digest(manifest))) return new Response(manifest);
    if (address.hostname === "ghcr.io") await sleep(50);
    if (address.hostname === "m.daocloud.io") await sleep(100);
    return new Response(sample, { status: 206 });
  };
  const selected: string[] = [];
  expect(await pullDeploymentImage(image, {
    cached: () => false,
    rank: (sources, architecture, signal) => rankImageSources(sources, architecture, signal, fetcher),
    pull: async reference => { selected.push(reference); return reference === daoCloud!.reference; },
    architecture: "x64",
  })).toBe(daoCloud!.reference);
  expect(selected).toEqual([university!.reference, official!.reference, daoCloud!.reference]);
});

test("uses scoped anonymous registry auth without accepting an arbitrary token realm", async () => {
  const requested: string[] = [];
  const fetcher = async (address: URL, options: RequestInit) => {
    requested.push(address.href);
    if (address.hostname === "m.daocloud.io") return new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="https://unknown.invalid/token"' } });
    if (address.hostname === "ghcr.nju.edu.cn") return new Response(null, { status: 403 });
    if (address.pathname === "/token") {
      expect(address.searchParams.get("scope")).toBe(`repository:${official!.repository}:pull`);
      return Response.json({ token: "anonymous-token" });
    }
    if (new Headers(options.headers).get("Authorization") !== "Bearer anonymous-token") {
      return new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="ignored"' } });
    }
    if (address.pathname.endsWith(digest(index))) return new Response(index);
    if (address.pathname.endsWith(digest(manifest))) return new Response(manifest);
    return new Response(sample, { status: 206 });
  };
  expect(await rankImageSources(registrySources(image), "amd64", undefined, fetcher)).toEqual([image]);
  expect(requested.some(address => address.includes("unknown.invalid"))).toBe(false);
  expect(requested.filter(address => new URL(address).pathname === "/token")).toHaveLength(1);
});

test("uses a cached digest and falls back through mirrors to the official source", async () => {
  const attempted: string[] = [];
  const sources = [university!.reference, daoCloud!.reference, image];
  const pull = async (reference: string) => { attempted.push(reference); return reference === image; };
  const rank = async () => sources;
  expect(await pullDeploymentImage(image, { cached: reference => reference === daoCloud!.reference, pull, rank })).toBe(daoCloud!.reference);
  expect(attempted).toEqual([]);
  expect(await pullDeploymentImage(image, { cached: () => false, pull, rank })).toBe(image);
  expect(attempted).toEqual(sources);
});

test("stops ranking and avoids fallback on cancellation", async () => {
  const controller = new AbortController();
  const ranking = rankImageSources(registrySources(image), "amd64", controller.signal, async (_address, options) => {
    await sleep(3_000, undefined, { signal: options.signal! });
    return new Response(index);
  });
  controller.abort();
  await expect(ranking).rejects.toThrow();

  const pulling = new AbortController();
  const attempted: string[] = [];
  await expect(pullDeploymentImage(image, {
    cached: () => false, rank: async () => [university!.reference, image], signal: pulling.signal,
    pull: async reference => { attempted.push(reference); pulling.abort(); return false; },
  })).rejects.toThrow();
  expect(attempted).toEqual([university!.reference]);
});
