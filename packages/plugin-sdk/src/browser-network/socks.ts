import { createServer, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import ipaddr from "ipaddr.js";

/** How long a half-closed tunnel may stay silent before the gateway reclaims its slot. */
export const HALF_CLOSE_IDLE_MS = 15_000;

/** Loopback-only SOCKS5 CONNECT gateway. It never chooses or falls back to a route. */
export function createBrowserProxy(
  open: (host: string, port: number) => Promise<Duplex>,
  limit = 80,
  halfCloseIdleMs = HALF_CLOSE_IDLE_MS
) {
  const clients = new Set<Socket>();
  const counters = { peak: 0, rejected: 0, reaped: 0 };
  const server = createServer({ allowHalfOpen: true }, (client) => {
    client.setNoDelay(true);
    let timer: ReturnType<typeof setTimeout> | undefined,
      halfClosed: ReturnType<typeof setTimeout> | undefined,
      upstream: Duplex | undefined;
    // Release capacity before admission: a rejected connection must not stay in the
    // set, because this set is the only capacity measure and, under computer-wide
    // routing, every container connection fails once it is exhausted.
    client.once("close", () => {
      clearTimeout(timer);
      clearTimeout(halfClosed);
      clients.delete(client);
      upstream?.destroy();
    });
    client.on("error", () => {});
    clients.add(client);
    if (clients.size > limit) {
      counters.rejected++;
      client.destroy();
      return;
    }
    counters.peak = Math.max(counters.peak, clients.size);
    let stage = 0,
      bytes = Buffer.alloc(0),
      busy = false;
    // An abandoned half-open request must not hold a slot for the full idle window.
    client.once("end", () => {
      if (!upstream) client.destroy();
    });
    timer = setTimeout(() => client.destroy(), 30_000);
    timer.unref();
    const reject = (code = 1) => {
      client.end(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]));
    };
    const data = (chunk: Buffer) => {
      if (busy) return;
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 65536) {
        client.destroy();
        return;
      }
      if (stage === 0) {
        if (bytes.length < 2) return;
        const count = bytes[1]!;
        if (bytes[0] !== 5 || !count) {
          client.destroy();
          return;
        }
        if (bytes.length < 2 + count) return;
        if (!bytes.subarray(2, 2 + count).includes(0)) {
          client.end(Buffer.from([5, 255]));
          return;
        }
        bytes = bytes.subarray(2 + count);
        stage = 1;
        client.write(Buffer.from([5, 0]));
      }
      if (bytes.length < 4) return;
      if (bytes[0] !== 5 || bytes[2] !== 0 || bytes[1] !== 1) {
        reject(7);
        return;
      }
      const kind = bytes[3];
      let size: number, host: string;
      if (kind === 1) size = 4;
      else if (kind === 4) size = 16;
      else if (kind === 3) {
        if (bytes.length < 5) return;
        size = bytes[4]!;
        if (!size) {
          reject(8);
          return;
        }
      } else {
        reject(8);
        return;
      }
      const offset = kind === 3 ? 5 : 4;
      if (bytes.length < offset + size + 2) return;
      try {
        host =
          kind === 3
            ? new TextDecoder("utf-8", { fatal: true }).decode(
                bytes.subarray(offset, offset + size)
              )
            : ipaddr.fromByteArray([...bytes.subarray(offset, offset + size)]).toString();
      } catch {
        reject(8);
        return;
      }
      const port = bytes.readUInt16BE(offset + size);
      if (!port || /[\s\x00-\x1f\x7f/@?#%\\]/.test(host)) {
        reject(8);
        return;
      }
      const pending = bytes.subarray(offset + size + 2);
      busy = true;
      client.pause();
      client.off("data", data);
      void open(host, port).then(
        (socket) => {
          upstream = socket;
          clearTimeout(timer);
          if (client.destroyed) {
            socket.destroy();
            return;
          }
          socket.on("error", () => client.destroy());
          socket.once("close", () => client.destroy());
          // Both sides are dialed with allowHalfOpen, so a FIN is forwarded but the slot is
          // only freed once the peer answers with its own FIN. Some servers never do, which
          // leaves the socket in FIN-WAIT-2 and the slot taken forever. Once either side has
          // ended, reclaim the slot after a silent period; traffic keeps the tunnel alive.
          let halfClosing = false;
          const rearm = () => {
            // Data can still flush while the client is being destroyed; a timer armed then
            // would outlive the connection's close handler and count a reclaim twice.
            if (!halfClosing || client.destroyed) return;
            clearTimeout(halfClosed);
            halfClosed = setTimeout(() => {
              if (client.destroyed) return;
              counters.reaped++;
              client.destroy();
            }, halfCloseIdleMs);
            halfClosed.unref();
          };
          const startHalfClose = () => {
            halfClosing = true;
            rearm();
          };
          client.once("end", startHalfClose);
          socket.once("end", startHalfClose);
          client.on("data", rearm);
          socket.on("data", rearm);
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (pending.length) socket.write(pending);
          client.pipe(socket).pipe(client);
          client.resume();
        },
        () => {
          if (!client.destroyed) reject(1);
        }
      );
    };
    client.on("data", data);
  });
  return {
    listen: (port = 18791) =>
      new Promise<number>((resolve, reject) => {
        const events = server as unknown as import("node:events").EventEmitter;
        events.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          events.off("error", reject);
          resolve((server.address() as import("node:net").AddressInfo).port);
        });
      }),
    /** Capacity use since start; `rejected` and `reaped` only ever increase. */
    stats: () => ({ active: clients.size, limit, ...counters }),
    close: () => {
      for (const client of clients) client.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
    server,
  };
}
