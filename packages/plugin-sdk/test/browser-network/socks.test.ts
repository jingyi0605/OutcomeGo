import { expect, test } from "bun:test";
import { createConnection, createServer, type Socket } from "node:net";
import { createBrowserProxy } from "../../src/browser-network/socks";

const greeting = Buffer.from([5, 1, 0]);

type Client = { socket: Socket; reply: Buffer[] };

function connect(port: number, clients: Client[]) {
  const socket = createConnection({ host: "127.0.0.1", port });
  const entry: Client = { socket, reply: [] };
  socket.on("data", (chunk) => entry.reply.push(chunk));
  socket.on("error", () => {});
  clients.push(entry);
  return new Promise<Client>((resolve, reject) => {
    socket.once("connect", () => resolve(entry));
    socket.once("error", reject);
  });
}

const admitted = (clients: Client[]) =>
  clients.filter((client) => client.reply[0]?.[0] === 5 && client.reply[0]?.[1] === 0).length;

test("rejected connections release capacity instead of leaking slots", async () => {
  const proxy = createBrowserProxy(async () => {
    throw new Error("unused");
  }, 2);
  const port = await proxy.listen(0);
  const clients: Client[] = [];
  try {
    for (let round = 0; round < 3; round++) {
      const burst: Client[] = [];
      for (let index = 0; index < 6; index++) await connect(port, burst);
      for (const client of burst) client.socket.write(greeting);
      await Bun.sleep(150);
      // The limit is not degraded by the rejected connections of earlier rounds.
      expect(admitted(burst)).toBe(2);
      for (const client of burst) client.socket.destroy();
      await Bun.sleep(50);
      clients.push(...burst);
    }
  } finally {
    for (const client of clients) client.socket.destroy();
    await proxy.close();
  }
}, 15_000);

test("abandoned half-open clients release their slot immediately", async () => {
  const proxy = createBrowserProxy(async () => {
    throw new Error("unused");
  }, 1);
  const port = await proxy.listen(0);
  const clients: Client[] = [];
  try {
    // Holds the only slot, never sends a greeting, then gives up.
    const first = await connect(port, clients);
    first.socket.end();
    await Bun.sleep(100);
    const burst: Client[] = [];
    const second = await connect(port, burst);
    second.socket.write(greeting);
    await Bun.sleep(150);
    expect(admitted(burst)).toBe(1);
    clients.push(...burst);
  } finally {
    for (const client of clients) client.socket.destroy();
    await proxy.close();
  }
}, 15_000);

// A peer that accepts and then never answers a FIN, like some TLS servers (login.microsoftonline.com).
async function silentPeer() {
  const sockets: Socket[] = [];
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("error", () => {});
    socket.on("data", () => {});
    sockets.push(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    sockets,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

const dial = (port: number) =>
  new Promise<Socket>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port, allowHalfOpen: true });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });

/** Greets, requests CONNECT 127.0.0.1:<port>, and resolves once the tunnel is established. */
function tunnel(gateway: number, port: number, clients: Client[]) {
  return new Promise<Client>(async (resolve, reject) => {
    const entry = await connect(gateway, clients);
    let stage = 0;
    entry.socket.on("data", () => {
      if (stage === 0) {
        stage = 1;
        entry.socket.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, port >> 8, port & 255]));
      } else if (stage === 1) {
        stage = 2;
        resolve(entry);
      }
    });
    entry.socket.once("close", () => stage < 2 && reject(new Error("closed before tunnel")));
    entry.socket.write(greeting);
  });
}

const active = (proxy: ReturnType<typeof createBrowserProxy>) => proxy.stats().active;

test("a half-closed tunnel whose peer never answers the FIN releases its slot", async () => {
  const peer = await silentPeer();
  const proxy = createBrowserProxy((_host, port) => dial(port), 3, 300);
  const port = await proxy.listen(0);
  const clients: Client[] = [];
  try {
    // Fill every slot with tunnels the client then half-closes; the peer stays silent.
    for (let index = 0; index < 3; index++) {
      const entry = await tunnel(port, peer.port, clients);
      entry.socket.end();
    }
    await Bun.sleep(100);
    expect(active(proxy)).toBe(3);
    await Bun.sleep(500);
    expect(active(proxy)).toBe(0);
    expect(proxy.stats().reaped).toBe(3);
    // Capacity is usable again.
    const again = await tunnel(port, peer.port, clients);
    expect(again.reply.length).toBeGreaterThan(0);
  } finally {
    for (const client of clients) client.socket.destroy();
    peer.close();
    await proxy.close();
  }
}, 15_000);

test("a half-closed tunnel that is still moving data is not reclaimed", async () => {
  const peer = await silentPeer();
  const proxy = createBrowserProxy((_host, port) => dial(port), 3, 300);
  const port = await proxy.listen(0);
  const clients: Client[] = [];
  try {
    const entry = await tunnel(port, peer.port, clients);
    entry.socket.write("a");
    entry.socket.end();
    // The peer keeps streaming a long response after the client half-closed.
    const writer = setInterval(() => peer.sockets[0]?.write("x"), 100);
    await Bun.sleep(900);
    clearInterval(writer);
    expect(active(proxy)).toBe(1);
    expect(proxy.stats().reaped).toBe(0);
    await Bun.sleep(500);
    expect(active(proxy)).toBe(0);
  } finally {
    for (const client of clients) client.socket.destroy();
    peer.close();
    await proxy.close();
  }
}, 15_000);

test("an idle open tunnel is never reclaimed", async () => {
  const peer = await silentPeer();
  const proxy = createBrowserProxy((_host, port) => dial(port), 3, 200);
  const port = await proxy.listen(0);
  const clients: Client[] = [];
  try {
    await tunnel(port, peer.port, clients);
    await Bun.sleep(700);
    expect(active(proxy)).toBe(1);
    expect(proxy.stats().reaped).toBe(0);
  } finally {
    for (const client of clients) client.socket.destroy();
    peer.close();
    await proxy.close();
  }
}, 15_000);

test("stats report peak usage and limit rejections", async () => {
  const proxy = createBrowserProxy(async () => {
    throw new Error("unused");
  }, 2);
  const port = await proxy.listen(0);
  const clients: Client[] = [];
  try {
    for (let index = 0; index < 4; index++) await connect(port, clients);
    await Bun.sleep(100);
    const stats = proxy.stats();
    expect(stats.limit).toBe(2);
    expect(stats.peak).toBe(2);
    expect(stats.rejected).toBe(2);
  } finally {
    for (const client of clients) client.socket.destroy();
    await proxy.close();
  }
}, 15_000);
