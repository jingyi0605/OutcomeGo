import { Database } from "bun:sqlite";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

const DIRECT_JID = /^[0-9]+@(s\.whatsapp\.net|lid)$/;
const CHAT_JID = /^[0-9][0-9-]*@(s\.whatsapp\.net|lid|g\.us|newsletter)$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 5_000;
const BATCH_SIZE = 50;

type IncomingEvent = {
  id: string;
  kind: "message.received";
  resourceId: string;
  actor?: string;
  messageId: string;
  text: string;
  occurredAt: string;
  receivedAt: string;
};

/** wacli v0.26 emits this webhook after a live message is stored, not during history sync. */
export function incomingEvent(raw: unknown, now = new Date()): IncomingEvent | undefined {
  if (!raw || typeof raw !== "object") return;
  const msg = raw as Record<string, unknown>;
  if (
    msg.EventType !== undefined ||
    msg.FromMe !== false ||
    msg.Edited ||
    msg.Revoked ||
    msg.ReactionToID ||
    msg.ReactionEmoji ||
    msg.PollVote ||
    msg.PollAdd
  )
    return;
  const { Chat, ID, Timestamp, SenderJID } = msg;
  if (
    typeof Chat !== "string" ||
    Chat.length > 200 ||
    !CHAT_JID.test(Chat) ||
    typeof ID !== "string" ||
    !ID ||
    ID.length > 200 ||
    typeof Timestamp !== "string" ||
    !Number.isFinite(Date.parse(Timestamp))
  )
    return;
  const media = msg.Media as { Type?: unknown; Caption?: unknown } | null;
  const text =
    (typeof msg.Text === "string" && msg.Text.trim() ? msg.Text : undefined) ??
    (typeof media?.Caption === "string" && media.Caption.trim() ? media.Caption : undefined) ??
    (typeof media?.Type === "string" ? `[${media.Type.slice(0, 40)}]` : undefined) ??
    (msg.Location
      ? "[location]"
      : msg.Poll
        ? "[poll]"
        : msg.Call
          ? "[call message]"
          : Array.isArray(msg.Buttons) && msg.Buttons.length
            ? "[interactive message]"
            : undefined);
  if (!text) return;
  const actor =
    typeof SenderJID === "string" && SenderJID.length <= 200 && DIRECT_JID.test(SenderJID)
      ? SenderJID
      : DIRECT_JID.test(Chat)
        ? Chat
        : undefined;
  return {
    id: createHash("sha256")
      .update(JSON.stringify([Chat, ID]))
      .digest("hex"),
    kind: "message.received",
    resourceId: Chat,
    ...(actor ? { actor } : {}),
    messageId: ID,
    text: text.slice(0, 2_000),
    occurredAt: Timestamp,
    receivedAt: now.toISOString(),
  };
}

/** Private, per-account outbox. A cursor acknowledges only the batch the host committed. */
export class WhatsAppInboundEvents {
  private readonly db: Database;
  private readonly secret = randomBytes(32).toString("hex");
  private readonly server: ReturnType<typeof Bun.serve>;
  private readonly waiters = new Set<() => void>();
  private closed = false;

  constructor(store: string) {
    this.db = new Database(join(store, "inbound-events.sqlite"), { strict: true });
    try {
      this.db.exec(`PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS inbound_events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
          received_ms INTEGER NOT NULL, body TEXT NOT NULL
        );`);
      this.server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        maxRequestBodySize: 512 * 1024,
        fetch: (request) => this.receive(request),
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  get syncArgs() {
    return [
      "--webhook",
      new URL("/incoming", this.server.url).href,
      "--webhook-allow-private",
      "--webhook-events",
      "message",
      "--webhook-secret",
      this.secret,
    ];
  }

  private async receive(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/incoming")
      return new Response(null, { status: 404 });
    const signature = request.headers
      .get("x-wacli-signature")
      ?.match(/^sha256=([a-f0-9]{64})$/)?.[1];
    if (!signature) return new Response(null, { status: 401 });
    const body = Buffer.from(await request.arrayBuffer());
    const expected = createHmac("sha256", this.secret).update(body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
      return new Response(null, { status: 401 });
    let value: unknown;
    try {
      value = JSON.parse(body.toString("utf8"));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (this.closed) return new Response(null, { status: 503 });
    const now = new Date();
    const event = incomingEvent(value, now);
    if (event) {
      const inserted = this.db.transaction(() => {
        const result = this.db.run(
          "INSERT OR IGNORE INTO inbound_events (event_id, received_ms, body) VALUES (?, ?, ?)",
          [event.id, now.getTime(), JSON.stringify(event)]
        );
        this.prune(now.getTime());
        this.db.run(
          `DELETE FROM inbound_events WHERE seq < (
          SELECT seq FROM inbound_events ORDER BY seq DESC LIMIT 1 OFFSET ?
        )`,
          [MAX_PENDING - 1]
        );
        return result.changes;
      })();
      if (inserted) for (const wake of this.waiters) wake();
    }
    return new Response(null, { status: 204 });
  }

  private prune(now: number) {
    this.db.run("DELETE FROM inbound_events WHERE received_ms < ?", [now - RETENTION_MS]);
  }

  async poll(cursor: unknown, waitMs = 0, signal?: AbortSignal) {
    const after = cursor === null || cursor === undefined ? 0 : cursor;
    if (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0)
      throw new Error("Invalid WhatsApp event cursor");
    const batch = () => {
      const rows = this.closed
        ? []
        : this.db
            .query<{ seq: number; body: string }, [number, number]>(
              "SELECT seq, body FROM inbound_events WHERE seq > ? ORDER BY seq LIMIT ?"
            )
            .all(after, BATCH_SIZE);
      return {
        events: rows.map((row) => JSON.parse(row.body) as IncomingEvent),
        cursor: rows.at(-1)?.seq ?? cursor ?? null,
      };
    };
    if (!this.closed) {
      this.prune(Date.now());
      if (after > 0) this.db.run("DELETE FROM inbound_events WHERE seq <= ?", [after]);
    }
    const initial = batch();
    if (initial.events.length || this.closed || !waitMs || signal?.aborted) return initial;
    await new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        signal?.removeEventListener("abort", wake);
        resolve();
      };
      const timer = setTimeout(wake, waitMs);
      this.waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
      if (signal?.aborted) wake();
    });
    return batch();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const wake of this.waiters) wake();
    await this.server.stop(true);
    this.db.close();
  }
}
