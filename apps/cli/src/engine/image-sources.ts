import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { DEFAULT_IMAGE_PREFIX } from "../constants";

interface RegistrySource {
  registry: string;
  repository: string;
  reference: string;
  digest: string;
}

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const manifestTypes = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sampleBytes = 256 * 1024;

export const imageSourcesPath = (composeFile: string) => `${composeFile}.images-${hash(readFileSync(composeFile))}.json`;

export const hasImageSources = (path: string) => lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

export const registrySources = (reference: string): RegistrySource[] => {
  const match = /^([a-z0-9][a-z0-9./_-]*)(?::[\w.-]+)?@(sha256:[a-f0-9]{64})$/.exec(reference);
  if (!match) return [];
  const name = match[1]!;
  const digest = match[2]!;
  const source = (registry: string, repository: string, original?: string): RegistrySource => ({
    registry, repository, digest, reference: original ?? `${registry}/${repository}@${digest}`,
  });
  if (["computer", "server", "worker", "migrate"].some(service => name === `${DEFAULT_IMAGE_PREFIX}-${service}`) && name.startsWith("ghcr.io/")) {
    const repository = name.slice("ghcr.io/".length);
    return [source("ghcr.io", repository, reference), source("ghcr.nju.edu.cn", repository), source("m.daocloud.io", name)];
  }
  const officialName = /^(?:docker\.io\/library\/|library\/)?(alpine|postgres|caddy)$/.exec(name)?.[1];
  if (!officialName) return [];
  const repository = `library/${officialName}`;
  return [source("registry-1.docker.io", repository, reference), source("docker.nju.edu.cn", repository), source("m.daocloud.io", `docker.io/${repository}`)];
};

type Request = (url: URL, options: RequestInit) => Promise<Response>;
type Layer = { digest: string; size: number };
type Manifest = {
  manifests?: { digest: string; platform?: { os: string; architecture: string } }[];
  layers?: Layer[];
};

const readBounded = async (response: Response, limit: number, sample = false) => {
  if (!response.body) throw new Error("Missing registry response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!sample && size + value.length > limit) throw new Error("Registry response exceeded its size limit");
      const chunk = value.subarray(0, limit - size);
      chunks.push(chunk);
      size += chunk.length;
      if (sample && size === limit) break;
    }
    return Buffer.concat(chunks, size);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
};

const permittedTokenHost = (registry: string, hostname: string) =>
  hostname === registry || (registry === "registry-1.docker.io" && hostname === "auth.docker.io");

const httpsUrl = (address: string, base?: URL) => {
  const url = new URL(address, base);
  if (url.protocol !== "https:" || url.port || url.username || url.password || !url.hostname.includes(".") || isIP(url.hostname)) {
    throw new Error("Invalid registry URL");
  }
  return url;
};

const registryClient = (source: RegistrySource, signal: AbortSignal, request: Request) => {
  const base = `https://${source.registry}/v2/${source.repository}`;
  let token: string | undefined;
  const send = (url: URL, headers: Record<string, string> = {}) => request(url, { headers, signal, redirect: "manual" });
  const authorize = async (challenge: string) => {
    if (!/^Bearer\s/i.test(challenge)) throw new Error("Unsupported registry authentication");
    const realm = /\brealm="([^"]+)"/i.exec(challenge)?.[1];
    if (!realm) throw new Error("Missing registry token endpoint");
    const url = httpsUrl(realm);
    if (!permittedTokenHost(source.registry, url.hostname)) throw new Error("Unexpected registry token endpoint");
    const service = /\bservice="([^"]+)"/i.exec(challenge)?.[1];
    if (service) url.searchParams.set("service", service);
    url.searchParams.set("scope", `repository:${source.repository}:pull`);
    const response = await requireSuccess(await send(url));
    const data = JSON.parse((await readBounded(response, 16 * 1024)).toString());
    const value = data.token ?? data.access_token;
    if (typeof value !== "string" || !/^[a-z0-9._~+/-]+=*$/i.test(value)) throw new Error("Invalid registry token");
    token = value;
  };
  return async (path: string, headers: Record<string, string>, followBlobRedirects = false) => {
    const sendRegistry = (url: URL) => send(url, token ? { ...headers, Authorization: `Bearer ${token}` } : headers);
    let url = new URL(`${base}/${path}`);
    let response = await sendRegistry(url);
    if (response.status === 401 && !token) {
      const challenge = response.headers.get("WWW-Authenticate") ?? "";
      void response.body?.cancel().catch(() => undefined);
      await authorize(challenge);
      response = await sendRegistry(url);
    }
    for (let redirects = 0; followBlobRedirects && redirects < 3 && response.status >= 300 && response.status < 400; redirects++) {
      const location = response.headers.get("Location");
      void response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("Missing blob redirect location");
      url = httpsUrl(location, url);
      response = await send(url, headers);
    }
    return requireSuccess(response);
  };
};

const requireSuccess = async (response: Response) => {
  if (response.ok) return response;
  void response.body?.cancel().catch(() => undefined);
  throw new Error(`Registry returned HTTP ${response.status}`);
};

const sampleSource = async (source: RegistrySource, architecture: string, cancel: AbortSignal | undefined, request: Request) => {
  const deadline = AbortSignal.timeout(6_000);
  const signal = cancel ? AbortSignal.any([cancel, deadline]) : deadline;
  const get = registryClient(source, signal, request);
  const manifest = async (digest: string): Promise<Manifest> => {
    if (!digestPattern.test(digest)) throw new Error("Invalid image manifest digest");
    const response = await get(`manifests/${digest}`, { Accept: manifestTypes });
    const bytes = await readBounded(response, 512 * 1024);
    if (`sha256:${hash(bytes)}` !== digest) throw new Error("Image manifest digest mismatch");
    return JSON.parse(bytes.toString());
  };
  const release = await manifest(source.digest);
  const platform = release.manifests?.find(entry => entry.platform?.os === "linux" && entry.platform.architecture === architecture);
  const selected = platform ? await manifest(platform.digest) : release;
  const layer = selected.layers?.reduce<Layer | undefined>((largest, candidate) => (
    Number.isSafeInteger(candidate.size) && candidate.size > 0 && digestPattern.test(candidate.digest) && (!largest || candidate.size > largest.size)
      ? candidate : largest
  ), undefined);
  if (!layer) throw new Error("No downloadable layer for the target architecture");
  const length = Math.min(layer.size, sampleBytes);
  const started = performance.now();
  const response = await get(`blobs/${layer.digest}`, { Range: `bytes=0-${length - 1}`, "Accept-Encoding": "identity" }, true);
  const bytes = await readBounded(response, length, true);
  if (bytes.length !== length) throw new Error("Incomplete image layer sample");
  return length / Math.max(1, performance.now() - started);
};

export const rankImageSources = async (
  sources: readonly RegistrySource[],
  architecture: string,
  signal?: AbortSignal,
  request: Request = (url, options) => fetch(url, options)
) => {
  signal?.throwIfAborted();
  const [official] = sources;
  if (!official) return [];
  const test = (source: RegistrySource) => sampleSource(source, architecture, signal, request).catch(() => 0);
  const [baseline, ...speeds] = await Promise.all(sources.map(test));
  signal?.throwIfAborted();
  const ranked = sources.slice(1).map((source, index) => ({ source, speed: speeds[index] ?? 0 }))
    .filter(entry => entry.speed > 0);
  ranked.unshift({ source: official, speed: baseline! });
  return ranked.sort((left, right) => right.speed - left.speed).map(entry => entry.source.reference);
};

export const pullDeploymentImage = async (image: string, options: {
  cached: (reference: string) => boolean;
  pull: (reference: string) => Promise<boolean>;
  rank: (sources: readonly RegistrySource[], architecture: string, signal?: AbortSignal) => Promise<string[]>;
  signal?: AbortSignal;
  architecture?: string;
}) => {
  const { cached, pull, rank, signal, architecture = process.arch } = options;
  signal?.throwIfAborted();
  const sources = registrySources(image);
  if (!sources.length) return (await pull(image)) ? image : undefined;
  for (const { reference } of sources) {
    signal?.throwIfAborted();
    if (cached(reference)) return reference;
  }
  const ranked = await rank(sources, architecture === "x64" ? "amd64" : architecture, signal);
  const available = new Set(sources.map(source => source.reference));
  for (const reference of new Set([...ranked, image])) {
    if (!available.has(reference)) continue;
    signal?.throwIfAborted();
    const pulled = await pull(reference);
    signal?.throwIfAborted();
    if (pulled) return reference;
  }
  return undefined;
};
