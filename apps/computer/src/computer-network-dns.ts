import { createSocket } from "node:dgram";
import { lookup as systemLookup, Resolver } from "node:dns/promises";
import type { LookupAddress, LookupAllOptions, LookupOneOptions } from "node:dns";
import { readFileSync, statSync } from "node:fs";
import { createConnection, createServer, isIP, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { Agent, request } from "node:https";
import { connect } from "node:tls";
import type { Duplex } from "node:stream";

export type DnsServerEndpoint = { host: string; port: number };
export type ResolvConfUpstreams = {
  direct: DnsServerEndpoint[];
  hasDockerEmbedded: boolean;
};

const isLoopbackOrUnspecified = (host: string): boolean => {
  const lower = host.toLowerCase();
  if (lower.startsWith("127.") || lower === "0.0.0.0") return true;
  if (lower === "::1" || lower === "::" || lower.startsWith("::ffff:127.")) return true;
  return /^0(:0)*:[01]$/.test(lower);
};

const parseEndpointToken = (raw: string): DnsServerEndpoint | undefined => {
  const token = raw.trim();
  if (!token || token.startsWith("host(")) return undefined;
  let host = token;
  let port = 53;
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(token);
  if (bracketed) {
    host = bracketed[1]!;
    port = Number(bracketed[2]!);
    if (isIP(host) !== 6) return undefined;
  } else if (isIP(token) === 0) {
    const colon = token.lastIndexOf(":");
    if (colon <= 0) return undefined;
    host = token.slice(0, colon);
    port = Number(token.slice(colon + 1));
    if (isIP(host) !== 4) return undefined;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  if (isIP(host) === 0 || isLoopbackOrUnspecified(host)) return undefined;
  return { host, port };
};

/** Parses `/etc/resolv.conf` (including Docker Engine's `# ExtServers: [...]`
 * comment) to find upstream DNS servers reachable directly from the marked
 * worker. Docker forwards non-`host(...)` ExtServers from inside the container's
 * network namespace without SO_MARK, so container policy routing breaks `127.0.0.11`
 * forwarding on WSL2, Lima/macOS, and hosts without host-loopback resolvers. */
export function parseResolvConf(content: string): ResolvConfUpstreams {
  const direct: DnsServerEndpoint[] = [];
  const seen = new Set<string>();
  let hasDockerEmbedded = false;
  const add = (endpoint: DnsServerEndpoint | undefined) => {
    if (!endpoint) return;
    const key = `${endpoint.host}|${endpoint.port}`;
    if (seen.has(key)) return;
    seen.add(key);
    direct.push(endpoint);
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const extMatch = /^#\s*ExtServers:\s*\[(.*)\]\s*$/.exec(trimmed);
    if (extMatch) {
      for (const token of extMatch[1]!.split(/\s+/)) add(parseEndpointToken(token));
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const code = trimmed.split(/[;#]/, 1)[0]!.trim();
    const parts = code.split(/\s+/);
    if (parts[0] === "nameserver" && parts[1]) {
      if (parts[1] === "127.0.0.11") hasDockerEmbedded = true;
      else add(parseEndpointToken(parts[1]));
    }
  }
  return { direct, hasDockerEmbedded };
}

const resolvCache = new Map<
  string,
  { mtimeMs: number; size: number; value: ResolvConfUpstreams }
>();

export function readResolvConfUpstreams(path = "/etc/resolv.conf"): ResolvConfUpstreams {
  try {
    const stat = statSync(path);
    const cached = resolvCache.get(path);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
    const value = parseResolvConf(readFileSync(path, "utf8"));
    resolvCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  } catch {
    return { direct: [], hasDockerEmbedded: true };
  }
}

export function formatDnsServerSpec(endpoint: DnsServerEndpoint): string {
  if (endpoint.port === 53) return endpoint.host;
  return endpoint.host.includes(":")
    ? `[${endpoint.host}]:${endpoint.port}`
    : `${endpoint.host}:${endpoint.port}`;
}

export function orderDnsServers(
  servers: readonly DnsServerEndpoint[],
  preferIpv4 = !globalIpv6Address()
): DnsServerEndpoint[] {
  if (!preferIpv4 || servers.length <= 1) return [...servers];
  const v4: DnsServerEndpoint[] = [];
  const v6: DnsServerEndpoint[] = [];
  for (const server of servers) (isIP(server.host) === 6 ? v6 : v4).push(server);
  return [...v4, ...v6];
}

const hostsCache = new Map<
  string,
  { mtimeMs: number; size: number; entries: Map<string, LookupAddress[]> }
>();

const parseHostsFile = (content: string): Map<string, LookupAddress[]> => {
  const entries = new Map<string, LookupAddress[]>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]!.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const address = parts[0]!;
    const family = isIP(address);
    if (family !== 4 && family !== 6) continue;
    for (let i = 1; i < parts.length; i++) {
      const name = parts[i]!.toLowerCase();
      let list = entries.get(name);
      if (!list) {
        list = [];
        entries.set(name, list);
      }
      if (!list.some((item) => item.address === address)) list.push({ address, family });
    }
  }
  return entries;
};

export function lookupHostsFile(hostname: string, hostsPath = "/etc/hosts"): LookupAddress[] {
  try {
    const stat = statSync(hostsPath);
    let cached = hostsCache.get(hostsPath);
    if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      cached = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        entries: parseHostsFile(readFileSync(hostsPath, "utf8")),
      };
      hostsCache.set(hostsPath, cached);
    }
    return cached.entries.get(hostname.toLowerCase()) ?? [];
  } catch {
    return [];
  }
}

/** A global IPv6 address on a real interface; link-local and unique-local are not routable. */
export function globalIpv6Address(): string | undefined {
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? [])
      if (entry.family === "IPv6" && !entry.internal && !/^(?:f[cd]|fe[89ab])/i.test(entry.address))
        return entry.address;
  return undefined;
}

/** Holding an address is not evidence of a working path; prove one hop before advertising AAAA. */
export async function probeIpv6Route(
  host = "2606:4700:4700::1111",
  port = 443,
  timeoutMs = 2000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, family: 6, timeout: timeoutMs });
    const finish = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** QNAME of the single question, lowercased without a trailing dot. */
export function questionName(query: Buffer): string | undefined {
  let offset = 12;
  const labels: string[] = [];
  while (offset < query.length) {
    const length = query[offset]!;
    if (!length) return offset + 5 <= query.length ? labels.join(".").toLowerCase() : undefined;
    // Compression is invalid in a question; refuse rather than guess.
    if (length > 63 || offset + 1 + length >= query.length) return undefined;
    labels.push(query.subarray(offset + 1, offset + 1 + length).toString("ascii"));
    offset += length + 1;
  }
  return undefined;
}

/** QTYPE of the single question, as an offset-free answer to "is this an AAAA lookup?". */
export function questionType(query: Buffer): number | undefined {
  let offset = 12;
  while (offset < query.length) {
    const length = query[offset]!;
    if (!length) return offset + 5 <= query.length ? query.readUInt16BE(offset + 1) : undefined;
    // Compression is invalid in a question; refuse rather than guess.
    if (length > 63) return undefined;
    offset += length + 1;
  }
  return undefined;
}

/** NOERROR/NODATA. Used instead of an unroutable AAAA set the computer cannot connect to. */
export function dnsNodata(query: Buffer): Buffer {
  let offset = 12;
  while (offset < query.length && query[offset]) {
    if (query[offset]! > 63) throw new Error("Invalid DNS query");
    offset += query[offset]! + 1;
  }
  const end = offset + 5;
  if (end > query.length) throw new Error("Invalid DNS query");
  const reply = Buffer.alloc(end);
  query.copy(reply, 0, 0, end);
  reply[2] = (query[2]! & 0x79) | 0x80; // QR; preserve opcode and RD
  reply[3] = 0x80; // RA; NOERROR
  reply.writeUInt16BE(1, 4);
  reply.writeUInt16BE(0, 6);
  reply.writeUInt16BE(0, 8);
  reply.writeUInt16BE(0, 10);
  return reply;
}

/** DNS wire messages travel over HTTPS through the same leased exit as TCP.
 * No system lookup or direct fallback is performed, including on timeout. */
export function createDnsExchange(
  client: { open(host: string, port: number, signal?: AbortSignal): Promise<Duplex> },
  options: {
    routeKey?: () => string | null;
    timeoutMs?: number;
    ipv6?: () => boolean;
    resolver?: () => "docker" | "doh";
    dohHost?: string;
    dockerResolver?: string;
    dockerResolverPort?: number;
    resolvConfPath?: string;
    upstreamResolvers?: () => ResolvConfUpstreams;
  } = {}
) {
  type Job = {
    query: Buffer;
    resolve: (result: Buffer) => void;
    reject: (error: Error) => void;
    controller: AbortController;
    deadline: number;
    timer?: ReturnType<typeof setTimeout>;
    request?: ReturnType<typeof request>;
    slot?: Slot;
    done: boolean;
  };
  type Slot = { agent: Agent; job?: Job; raw?: Duplex; socket?: Duplex };
  type Pool = { key: string; slots: Slot[]; jobs: Set<Job>; queue: Job[]; closed: boolean };
  let pool: Pool | undefined,
    closed = false;
  const routeKey = options.routeKey ?? (() => "selected-route");
  // Advertising AAAA the current exit cannot route makes every dual-stack name
  // fail. Only unresolved IPv6 lookups are withheld; A, HTTPS and CNAME pass through.
  const ipv6 = options.ipv6 ?? (() => true);
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new Error("Invalid DNS deadline");
  const resolver = options.resolver ?? (() => "doh");
  const dohHost = options.dohHost ?? "doh.pub";
  const explicitDockerResolver = options.dockerResolver !== undefined;
  const dockerResolver = options.dockerResolver ?? "127.0.0.11";
  const dockerResolverPort = options.dockerResolverPort ?? 53;
  const getUpstreams =
    options.upstreamResolvers ??
    (() => readResolvConfUpstreams(options.resolvConfPath ?? "/etc/resolv.conf"));

  const udpDnsQuery = (
    endpoint: DnsServerEndpoint,
    query: Buffer,
    signal: AbortSignal,
    budgetMs: number
  ): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("DNS cancelled"));
        return;
      }
      const socket = createSocket(isIP(endpoint.host) === 6 ? "udp6" : "udp4");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const close = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        try {
          socket.close();
        } catch {}
      };
      const fail = (error: Error) => {
        close();
        reject(error);
      };
      const abort = () => fail(new Error("DNS cancelled"));
      socket.on("error", () => fail(new Error("Docker DNS unavailable")));
      socket.on("message", (response) => {
        if (
          response.length < 12 ||
          response.readUInt16BE(0) !== query.readUInt16BE(0) ||
          !(response[2]! & 0x80)
        ) {
          fail(new Error("Invalid Docker DNS response"));
          return;
        }
        close();
        resolve(response);
      });
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => fail(new Error("Docker DNS timeout")), Math.max(1, budgetMs));
      socket.send(query, endpoint.port, endpoint.host, (error) => {
        if (error) fail(new Error("Docker DNS unavailable"));
      });
    });

  const tcpDnsQuery = (
    endpoint: DnsServerEndpoint,
    query: Buffer,
    signal: AbortSignal,
    budgetMs: number
  ): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("DNS cancelled"));
        return;
      }
      const socket = createConnection({ host: endpoint.host, port: endpoint.port });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let buffered = Buffer.alloc(0);
      const close = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        socket.destroy();
      };
      const fail = (error: Error) => {
        close();
        reject(error);
      };
      const abort = () => fail(new Error("DNS cancelled"));
      socket.on("error", () => fail(new Error("Docker DNS TCP unavailable")));
      socket.on("close", () => fail(new Error("Docker DNS TCP closed")));
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.length < 2) return;
        const size = buffered.readUInt16BE(0);
        if (size < 12 || size > 65535) {
          fail(new Error("Invalid Docker DNS TCP response"));
          return;
        }
        if (buffered.length < size + 2) return;
        const response = buffered.subarray(2, size + 2);
        if (response.readUInt16BE(0) !== query.readUInt16BE(0) || !(response[2]! & 0x80)) {
          fail(new Error("Invalid Docker DNS TCP response"));
          return;
        }
        close();
        resolve(Buffer.from(response));
      });
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => fail(new Error("Docker DNS timeout")), Math.max(1, budgetMs));
      const frame = Buffer.allocUnsafe(query.length + 2);
      frame.writeUInt16BE(query.length, 0);
      query.copy(frame, 2);
      socket.write(frame);
    });

  const exchangeWithEndpoint = async (
    endpoint: DnsServerEndpoint,
    query: Buffer,
    signal: AbortSignal,
    budgetMs: number
  ): Promise<Buffer> => {
    const started = performance.now();
    const reply = await udpDnsQuery(endpoint, query, signal, budgetMs);
    if ((reply[2]! & 0x02) !== 0) {
      const remaining = budgetMs - (performance.now() - started);
      if (remaining > 50 && !signal.aborted) {
        try {
          return await tcpDnsQuery(endpoint, query, signal, remaining);
        } catch {
          return reply;
        }
      }
    }
    return reply;
  };

  const dockerDns = async (query: Buffer, signal: AbortSignal): Promise<Buffer> => {
    const deadline = performance.now() + timeoutMs;
    const dockerLocal: DnsServerEndpoint = { host: dockerResolver, port: dockerResolverPort };
    if (explicitDockerResolver && !options.upstreamResolvers && !options.resolvConfPath) {
      return exchangeWithEndpoint(dockerLocal, query, signal, timeoutMs);
    }
    const upstreams = getUpstreams();
    const direct = orderDnsServers(upstreams.direct);
    if (direct.length === 0) {
      return exchangeWithEndpoint(dockerLocal, query, signal, timeoutMs);
    }
    const name = questionName(query);
    if (upstreams.hasDockerEmbedded && name && !name.includes(".")) {
      const localBudget = Math.min(300, Math.max(1, deadline - performance.now()));
      try {
        const localReply = await exchangeWithEndpoint(dockerLocal, query, signal, localBudget);
        const rcode = localReply[3]! & 0x0f;
        if (rcode !== 2 && rcode !== 3) return localReply;
      } catch {
        // Not a Docker-local service name; fall through to direct upstream DNS.
      }
    }
    let lastError: Error | undefined;
    let lastServfail: Buffer | undefined;
    for (let i = 0; i < direct.length; i++) {
      if (signal.aborted) throw new Error("DNS cancelled");
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      const serversLeft = direct.length - i;
      const budget =
        serversLeft === 1
          ? remaining
          : Math.min(remaining, Math.max(1000, Math.floor(remaining / serversLeft)));
      try {
        const reply = await exchangeWithEndpoint(direct[i]!, query, signal, budget);
        if ((reply[3]! & 0x0f) !== 2) return reply;
        lastServfail = reply;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Docker DNS unavailable");
      }
    }
    if (lastServfail) return lastServfail;
    throw lastError ?? new Error("Docker DNS timeout");
  };

  const agentFor = (owner: Pool, slot: Slot) => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1, timeout: 10_000 });
    agent.createConnection = () => {
      // Always return a prepared TLS socket synchronously. An undefined return
      // can make alternate HTTP runtimes open their own direct connection.
      const raw = slot.raw;
      slot.raw = undefined;
      if (!raw || owner.closed || slot.job?.done || routeKey() !== owner.key) {
        raw?.destroy();
        throw new Error("DNS connection unavailable");
      }
      const socket = connect({ socket: raw, servername: dohHost });
      slot.socket = socket;
      return socket;
    };
    return agent;
  };
  const finish = (owner: Pool, job: Job, error?: Error, result?: Buffer) => {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    owner.jobs.delete(job);
    const queued = owner.queue.indexOf(job);
    if (queued >= 0) owner.queue.splice(queued, 1);
    if (error) {
      job.controller.abort();
      job.request?.destroy(error);
      job.slot?.agent.destroy();
      job.slot?.raw?.destroy();
      job.slot?.socket?.destroy();
    }
    if (job.slot) {
      const slot = job.slot;
      slot.job = undefined;
      if (error && !owner.closed) slot.agent = agentFor(owner, slot);
    }
    error ? job.reject(error) : job.resolve(result!);
    pump(owner);
  };
  const dispose = (owner: Pool) => {
    owner.closed = true;
    for (const slot of owner.slots) {
      slot.agent.destroy();
      slot.raw?.destroy();
      slot.socket?.destroy();
    }
    for (const job of [...owner.jobs]) finish(owner, job, new Error("DNS route changed"));
  };
  const syncRoute = () => {
    if (pool && pool.key !== routeKey()) {
      dispose(pool);
      pool = undefined;
    }
  };
  const pump = (owner: Pool) => {
    if (owner.closed) return;
    for (const slot of owner.slots) {
      if (slot.job || !owner.queue.length) continue;
      const job = owner.queue.shift()!;
      if (performance.now() >= job.deadline) {
        finish(owner, job, new Error("DNS timeout"));
        continue;
      }
      slot.job = job;
      job.slot = slot;
      if (routeKey() !== owner.key) {
        dispose(owner);
        return;
      }
      if (resolver() === "docker") {
        void dockerDns(job.query, job.controller.signal)
          .then((result) => {
            if (routeKey() !== owner.key) dispose(owner);
            else finish(owner, job, undefined, result);
          })
          .catch((error) =>
            finish(owner, job, error instanceof Error ? error : new Error("DNS unavailable"))
          );
        continue;
      }
      void (async () => {
        if (!slot.socket || slot.socket.destroyed) {
          const raw = await client.open(dohHost, 443, job.controller.signal);
          if (job.done || owner.closed || routeKey() !== owner.key) {
            raw.destroy();
            if (!job.done) dispose(owner);
            return;
          }
          if (performance.now() >= job.deadline) {
            raw.destroy();
            finish(owner, job, new Error("DNS timeout"));
            return;
          }
          slot.raw = raw;
        }
        const req = request(
          {
            hostname: dohHost,
            path: "/dns-query",
            method: "POST",
            agent: slot.agent,
            headers: {
              "content-type": "application/dns-message",
              accept: "application/dns-message",
              "content-length": job.query.length,
            },
          },
          (response) => {
            if (job.done) {
              response.destroy();
              return;
            }
            if (
              response.statusCode !== 200 ||
              !response.headers["content-type"]?.startsWith("application/dns-message") ||
              (response.headers["content-encoding"] &&
                response.headers["content-encoding"] !== "identity")
            ) {
              response.destroy();
              finish(owner, job, new Error("DNS unavailable"));
              return;
            }
            const chunks: Buffer[] = [];
            let length = 0;
            response.on("data", (chunk: Buffer) => {
              length += chunk.length;
              if (length > 65535) response.destroy(new Error("DNS response too large"));
              else chunks.push(chunk);
            });
            response.on("error", (error) => finish(owner, job, error));
            response.on("aborted", () => finish(owner, job, new Error("DNS interrupted")));
            response.on("end", () => {
              if (job.done) return;
              if (performance.now() >= job.deadline) {
                finish(owner, job, new Error("DNS timeout"));
                return;
              }
              const result = Buffer.concat(chunks);
              if (
                result.length < 12 ||
                result.readUInt16BE(0) !== job.query.readUInt16BE(0) ||
                !(result[2]! & 0x80)
              )
                finish(owner, job, new Error("Invalid DNS response"));
              else if (routeKey() !== owner.key) {
                dispose(owner);
              } else {
                if (response.headers.connection?.toLowerCase() === "close") {
                  slot.agent.destroy();
                  slot.socket?.destroy();
                  slot.socket = undefined;
                  slot.agent = agentFor(owner, slot);
                }
                finish(owner, job, undefined, result);
              }
            });
          }
        );
        job.request = req;
        req.on("error", (error) => finish(owner, job, error));
        req.end(job.query);
      })().catch((error) =>
        finish(owner, job, error instanceof Error ? error : new Error("DNS unavailable"))
      );
    }
  };
  const exchange = (query: Buffer): Promise<Buffer> => {
    if (query.length < 12 || query.length > 4096 || query[2]! & 0x80 || query.readUInt16BE(4) !== 1)
      return Promise.reject(new Error("Invalid DNS query"));
    if (questionType(query) === 28 && !ipv6()) return Promise.resolve(dnsNodata(query));
    syncRoute();
    const key = routeKey();
    if (closed || !key) return Promise.reject(new Error("DNS route unavailable"));
    if (!pool) {
      pool = { key, slots: [], jobs: new Set(), queue: [], closed: false };
      for (let i = 0; i < 2; i++) {
        const slot = {} as Slot;
        slot.agent = agentFor(pool, slot);
        pool.slots.push(slot);
      }
    }
    const owner = pool;
    if (owner.jobs.size >= 64) return Promise.reject(new Error("DNS capacity exceeded"));
    return new Promise((resolve, reject) => {
      const job: Job = {
        query: Buffer.from(query),
        resolve,
        reject,
        controller: new AbortController(),
        deadline: performance.now() + timeoutMs,
        done: false,
      };
      owner.jobs.add(job);
      owner.queue.push(job);
      // Includes queueing and tunnel establishment; a timed-out dial is cancelled.
      job.timer = setTimeout(() => finish(owner, job, new Error("DNS timeout")), timeoutMs);
      pump(owner);
    });
  };
  exchange.syncRoute = syncRoute;
  exchange.close = () => {
    closed = true;
    if (pool) dispose(pool);
    pool = undefined;
  };
  return exchange;
}

export function dnsFailure(query: Buffer): Buffer {
  const reply = Buffer.alloc(12);
  query.copy(reply, 0, 0, Math.min(query.length, 2));
  reply[2] = 0x80 | (query.length > 2 ? query[2]! & 1 : 0);
  reply[3] = 0x82; // Recursion available; SERVFAIL, never an alternate resolver.
  return reply;
}

/** Both UDP and length-prefixed TCP DNS; bounded admission and idle lifetimes. */
export async function startComputerDns(
  exchange: (query: Buffer) => Promise<Buffer>,
  port = 5353,
  hosts: string[] = ["127.0.0.1", "::1"]
) {
  let active = 0,
    closing = false;
  let boundPort = port,
    boundTcpPort = port;
  const sockets = new Set<Socket>();
  const udp: ReturnType<typeof createSocket>[] = [];
  const tcp: ReturnType<typeof createServer>[] = [];
  const resolve = async (query: Buffer) => {
    if (closing || active >= 64 || query.length > 4096) return dnsFailure(query);
    active++;
    try {
      return await exchange(query);
    } catch {
      return dnsFailure(query);
    } finally {
      active--;
    }
  };
  try {
    for (const host of hosts) {
      const datagram = createSocket(host.includes(":") ? "udp6" : "udp4");
      udp.push(datagram);
      datagram.on("error", () => {});
      datagram.on("message", (query, peer) => {
        void resolve(query).then((response) => {
          if (!closing) datagram.send(response, peer.port, peer.address, () => {});
        });
      });
      await new Promise<void>((yes, no) => {
        datagram.once("error", no);
        datagram.bind(boundPort, host, () => {
          datagram.off("error", no);
          boundPort = datagram.address().port;
          yes();
        });
      });
      const server = createServer((socket) => {
        if (sockets.size >= 64) {
          socket.destroy();
          return;
        }
        sockets.add(socket);
        socket.on("error", () => {});
        socket.once("close", () => sockets.delete(socket));
        socket.setTimeout(10_000, () => socket.destroy());
        let buffered = Buffer.alloc(0),
          pending = 0;
        socket.on("data", (chunk) => {
          buffered = Buffer.concat([buffered, chunk]);
          if (buffered.length > 8192) {
            socket.destroy();
            return;
          }
          while (buffered.length >= 2) {
            const size = buffered.readUInt16BE(0);
            if (size < 12 || size > 4096 || pending >= 4) {
              socket.destroy();
              return;
            }
            if (buffered.length < size + 2) return;
            const query = Buffer.from(buffered.subarray(2, size + 2));
            buffered = buffered.subarray(size + 2);
            pending++;
            void resolve(query).then((response) => {
              pending--;
              if (socket.destroyed) return;
              const prefix = Buffer.alloc(2);
              prefix.writeUInt16BE(response.length);
              socket.write(Buffer.concat([prefix, response]));
            });
          }
        });
      });
      tcp.push(server);
      await new Promise<void>((yes, no) => {
        server.once("error", no);
        // Port zero requests an independent kernel allocation in each transport.
        // A UDP allocation does not reserve that number in the TCP namespace.
        server.listen({ host, port: boundTcpPort, ipv6Only: true }, () => {
          server.off("error", no);
          boundTcpPort = (server.address() as { port: number }).port;
          yes();
        });
      });
    }
  } catch (error) {
    closing = true;
    for (const socket of udp) {
      try {
        socket.close();
      } catch {}
    }
    for (const server of tcp) server.close();
    for (const socket of sockets) socket.destroy();
    throw error;
  }
  return {
    port: boundPort,
    tcpPort: boundTcpPort,
    close() {
      closing = true;
      for (const socket of udp) socket.close();
      for (const server of tcp) server.close();
      for (const socket of sockets) socket.destroy();
    },
  };
}

/** Lookup for the marked relay worker in server mode. Uses direct upstream
 * resolvers from `/etc/resolv.conf` (`# ExtServers`) when present so c-ares
 * sockets carry `SO_MARK` instead of going through `127.0.0.11` forwarding. */
export function createSystemLookup(
  options: {
    resolvConfPath?: string;
    hostsPath?: string;
    upstreamResolvers?: () => ResolvConfUpstreams;
    ipv6?: () => boolean;
    dockerResolver?: string;
    dockerResolverPort?: number;
    timeoutMs?: number;
  } = {}
): typeof systemLookup {
  const getUpstreams =
    options.upstreamResolvers ??
    (() => readResolvConfUpstreams(options.resolvConfPath ?? "/etc/resolv.conf"));
  const hostsPath = options.hostsPath ?? "/etc/hosts";
  const dockerLocal: DnsServerEndpoint = {
    host: options.dockerResolver ?? "127.0.0.11",
    port: options.dockerResolverPort ?? 53,
  };
  const timeoutMs = options.timeoutMs ?? 2500;
  const allowIpv6 = options.ipv6 ?? (() => Boolean(globalIpv6Address()));

  const resolveVia = async (
    servers: readonly DnsServerEndpoint[],
    hostname: string,
    family: number | undefined,
    budgetMs: number
  ): Promise<LookupAddress[]> => {
    const resolver = new Resolver({ timeout: budgetMs, tries: 1 });
    resolver.setServers(servers.map(formatDnsServerSpec));
    const want4 = family !== 6;
    const want6 = family === 6 || (family !== 4 && allowIpv6());
    const queries: Promise<LookupAddress[]>[] = [];
    if (want4) {
      queries.push(
        resolver.resolve4(hostname).then(
          (ips) => ips.map((address) => ({ address, family: 4 })),
          () => []
        )
      );
    }
    if (want6) {
      queries.push(
        resolver.resolve6(hostname).then(
          (ips) => ips.map((address) => ({ address, family: 6 })),
          () => []
        )
      );
    }
    const results = await Promise.all(queries);
    const seen = new Set<string>();
    const addresses: LookupAddress[] = [];
    for (const group of results) {
      for (const entry of group) {
        if (isIP(entry.address) && !seen.has(entry.address)) {
          seen.add(entry.address);
          addresses.push(entry);
        }
      }
    }
    return addresses;
  };

  const fn = async (
    hostname: string,
    lookupOptions?: number | LookupOneOptions | LookupAllOptions
  ): Promise<LookupAddress | LookupAddress[]> => {
    const all = typeof lookupOptions === "object" && lookupOptions !== null && Boolean(lookupOptions.all);
    const rawFamily =
      typeof lookupOptions === "number"
        ? lookupOptions
        : typeof lookupOptions === "object" && lookupOptions !== null
          ? lookupOptions.family
          : undefined;
    const family = rawFamily === 4 || rawFamily === "IPv4" ? 4 : rawFamily === 6 || rawFamily === "IPv6" ? 6 : undefined;
    const literalFamily = isIP(hostname);
    if (literalFamily === 4 || literalFamily === 6) {
      const entry: LookupAddress = { address: hostname, family: literalFamily };
      return all ? [entry] : entry;
    }
    const upstreams = getUpstreams();
    const direct = orderDnsServers(upstreams.direct);
    if (direct.length === 0) {
      return systemLookup(hostname, lookupOptions as never);
    }
    const fromHosts = lookupHostsFile(hostname, hostsPath).filter(
      (entry) => !family || entry.family === family
    );
    if (fromHosts.length > 0) return all ? fromHosts : fromHosts[0]!;
    if (upstreams.hasDockerEmbedded && !hostname.includes(".")) {
      const local = await resolveVia([dockerLocal], hostname, family, 300);
      if (local.length > 0) return all ? local : local[0]!;
    }
    const resolved = await resolveVia(direct, hostname, family, timeoutMs);
    if (resolved.length > 0) return all ? resolved : resolved[0]!;
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
      hostname,
    });
  };
  return fn as unknown as typeof systemLookup;
}
