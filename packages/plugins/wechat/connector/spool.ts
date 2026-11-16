import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { EXTERNAL_EXCHANGE_NAME_PATTERN, validateExternalMessage, type ExternalMessage } from "@outcomego/plugin-sdk/messaging";
import type { StateStore } from "./state";

/** Past these the receive loop stops fetching until the Server has caught up. */
export const MAX_QUEUE_ITEMS = 500;
export const MAX_EXCHANGE_BYTES = 1024 * 1024 * 1024;
/** Acknowledged message ids remembered so a provider replay is still recognised. */
export const SEEN_LIMIT = 2000;
const COMPACT_AFTER_RECORDS = 400;

export interface SpoolItem {
  seq: number;
  providerMessageId: string;
  message: ExternalMessage;
  enqueuedAt: string;
}

type JournalRecord =
  | { t: "queue"; id: string; next: number }
  | { t: "append"; seq: number; id: string; message: ExternalMessage; at: string }
  | { t: "ack"; seq: number }
  | { t: "seen"; id: string };

export interface SpoolStats {
  length: number;
  exchangeBytes: number;
  backlogged: boolean;
}

export type AckResult = { reset: false; removed: number } | { reset: true };

const mediaNames = (message: ExternalMessage): string[] => (message.media ?? []).map((item) => item.exchangeName);

/**
 * Durable queue between the receive loop and the Server's poll. One append-only journal
 * (`spool/journal.ndjson`) is the whole truth: a header naming the queue, one record per
 * message, one per acknowledgement. Every record is fsynced before the call returns, and a
 * torn tail from a crash is cut back to the last complete record on open.
 *
 * `ackCursor` is `<queueId>:<seq>`. The queueId changes whenever the queue is rebuilt, which is
 * how a Server holding a cursor from the old queue learns to start over.
 */
export class Spool {
  private queueId = "";
  private nextSeq = 1;
  private items: SpoolItem[] = [];
  /** Every provider message id that must not be queued again. */
  private seen = new Set<string>();
  /** Acknowledged ids in arrival order, for bounded eviction. */
  private acked: string[] = [];
  private pinned = new Set<string>();
  private handle: FileHandle | null = null;
  private records = 0;
  private waiters = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  /** Records dropped by tail recovery in `open`, for diagnostics. */
  recoveredDrops = 0;

  private constructor(
    private readonly store: StateStore,
    private readonly random: () => string
  ) {}

  static async open(store: StateStore, options: { random?: () => string } = {}): Promise<Spool> {
    const spool = new Spool(store, options.random ?? (() => randomBytes(8).toString("hex")));
    await spool.load();
    return spool;
  }

  private get journalPath(): string {
    return this.store.path("spool", "journal.ndjson");
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run);
    this.tail = next.catch(() => {});
    return next;
  }

  private async load(): Promise<void> {
    let raw = "";
    try {
      raw = await readFile(this.journalPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let validBytes = 0;
    let sawHeader = false;
    const live = new Map<number, SpoolItem>();
    for (const line of raw.split("\n")) {
      const lineBytes = Buffer.byteLength(line) + 1;
      // The last segment has no newline: it is a record cut off mid-write.
      if (validBytes + Buffer.byteLength(line) >= Buffer.byteLength(raw) && !raw.endsWith("\n")) break;
      if (line === "") {
        validBytes += lineBytes;
        continue;
      }
      const record = this.parseRecord(line);
      if (!record || (!sawHeader && record.t !== "queue")) break;
      validBytes += lineBytes;
      this.apply(record, live);
      sawHeader ||= record.t === "queue";
      this.records += 1;
    }
    this.recoveredDrops = raw.slice(validBytes).split("\n").filter(Boolean).length;
    this.items = [...live.values()].sort((a, b) => a.seq - b.seq);
    for (const item of this.items) this.seen.add(item.providerMessageId);
    if (!sawHeader) {
      await this.rebuild([]);
      return;
    }
    this.handle = await open(this.journalPath, constants.O_WRONLY | constants.O_APPEND, 0o600);
    if (validBytes < Buffer.byteLength(raw)) {
      await this.handle.truncate(validBytes);
      await this.handle.sync();
    }
    await this.sweepOrphans(new Set());
  }

  private parseRecord(line: string): JournalRecord | null {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.t === "queue" && typeof value.id === "string" && value.id && Number.isSafeInteger(value.next) && (value.next as number) >= 1)
        return { t: "queue", id: value.id, next: value.next as number };
      if (value.t === "ack" && Number.isSafeInteger(value.seq)) return { t: "ack", seq: value.seq as number };
      if (value.t === "seen" && typeof value.id === "string" && value.id) return { t: "seen", id: value.id };
      if (value.t === "append" && Number.isSafeInteger(value.seq) && typeof value.id === "string" && typeof value.at === "string") {
        const checked = validateExternalMessage(value.message);
        if (checked.ok) return { t: "append", seq: value.seq as number, id: value.id, message: checked.message, at: value.at };
      }
    } catch {
      // Falls through: an unreadable record ends the valid prefix.
    }
    return null;
  }

  private apply(record: JournalRecord, live: Map<number, SpoolItem>): void {
    if (record.t === "queue") {
      this.queueId = record.id;
      this.nextSeq = record.next;
    } else if (record.t === "append") {
      live.set(record.seq, { seq: record.seq, providerMessageId: record.id, message: record.message, enqueuedAt: record.at });
      this.nextSeq = Math.max(this.nextSeq, record.seq + 1);
    } else if (record.t === "ack") {
      for (const [seq, item] of live)
        if (seq <= record.seq) {
          live.delete(seq);
          this.remember(item.providerMessageId);
        }
    } else this.remember(record.id);
  }

  private remember(id: string): void {
    if (this.seen.has(id) && this.acked.includes(id)) return;
    this.seen.add(id);
    this.acked.push(id);
    this.evict();
  }

  private evict(): void {
    while (this.acked.length > SEEN_LIMIT) {
      const index = this.acked.findIndex((id) => !this.pinned.has(id));
      if (index === -1) break;
      this.seen.delete(this.acked[index]!);
      this.acked.splice(index, 1);
    }
  }

  /** Rewrites the journal from memory, atomically, dropping acknowledged records. */
  private async rebuild(items: SpoolItem[], options: { newQueue?: boolean } = {}): Promise<void> {
    if (options.newQueue || !this.queueId) this.queueId = this.random();
    const lines: JournalRecord[] = [{ t: "queue", id: this.queueId, next: this.nextSeq }];
    for (const id of this.acked) lines.push({ t: "seen", id });
    for (const item of items) lines.push({ t: "append", seq: item.seq, id: item.providerMessageId, message: item.message, at: item.enqueuedAt });
    const temporary = `${this.journalPath}.${randomBytes(4).toString("hex")}.tmp`;
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await file.writeFile(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await this.handle?.close().catch(() => {});
    await rename(temporary, this.journalPath);
    this.handle = await open(this.journalPath, constants.O_WRONLY | constants.O_APPEND, 0o600);
    this.records = lines.length;
    this.items = items;
  }

  private async write(record: JournalRecord): Promise<void> {
    if (!this.handle) throw new Error("Spool is closed");
    await this.handle.write(`${JSON.stringify(record)}\n`);
    await this.handle.sync();
    this.records += 1;
  }

  /** The cursor naming `seq` in this queue. */
  cursorFor(seq: number): string {
    return `${this.queueId}:${seq}`;
  }

  has(providerMessageId: string): boolean {
    return this.seen.has(providerMessageId);
  }

  /** Protects ids from eviction while the batch that carried them is still being committed. */
  pin(ids: Iterable<string>): void {
    for (const id of ids) this.pinned.add(id);
  }

  unpin(): void {
    this.pinned.clear();
    this.evict();
  }

  /**
   * Queues a message and returns its cursor, or null when the provider id was already queued.
   * Durable before it returns.
   */
  append(message: ExternalMessage, at: Date): Promise<{ seq: number; ackCursor: string } | null> {
    return this.serialize(async () => {
      if (this.seen.has(message.providerMessageId)) return null;
      const item: SpoolItem = { seq: this.nextSeq, providerMessageId: message.providerMessageId, message, enqueuedAt: at.toISOString() };
      await this.write({ t: "append", seq: item.seq, id: item.providerMessageId, message, at: item.enqueuedAt });
      this.nextSeq += 1;
      this.items.push(item);
      this.seen.add(item.providerMessageId);
      for (const wake of this.waiters) wake();
      return { seq: item.seq, ackCursor: this.cursorFor(item.seq) };
    });
  }

  /** Up to `limit` messages after `afterSeq`, oldest first. */
  read(afterSeq: number, limit: number): Array<{ ackCursor: string; message: ExternalMessage }> {
    return this.items.filter((item) => item.seq > afterSeq).slice(0, limit).map((item) => ({ ackCursor: this.cursorFor(item.seq), message: item.message }));
  }

  /** Parses `<queueId>:<seq>`. Null when it is not a cursor of this queue. */
  parseCursor(cursor: string): number | null {
    const split = cursor.lastIndexOf(":");
    const digits = cursor.slice(split + 1);
    // Digits only: Number("") is 0, which would read "q1:" as a valid cursor.
    if (split <= 0 || cursor.slice(0, split) !== this.queueId || !/^\d{1,15}$/.test(digits)) return null;
    const seq = Number(digits);
    return seq < this.nextSeq ? seq : null;
  }

  /** Acknowledges everything up to the cursor and deletes those messages' files. */
  ack(cursor: string): Promise<AckResult> {
    return this.serialize(async () => {
      const seq = this.parseCursor(cursor);
      if (seq === null) return { reset: true as const };
      const removed = this.items.filter((item) => item.seq <= seq);
      if (!removed.length) return { reset: false as const, removed: 0 };
      await this.write({ t: "ack", seq });
      this.items = this.items.filter((item) => item.seq > seq);
      for (const item of removed) this.remember(item.providerMessageId);
      await this.deleteFiles(removed.flatMap((item) => mediaNames(item.message)));
      if (this.records > COMPACT_AFTER_RECORDS) await this.rebuild(this.items);
      return { reset: false as const, removed: removed.length };
    });
  }

  /** Waits until something is appended, `ms` pass, or `signal` aborts. Resolves true when woken by an append. */
  waitForAppend(ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (ms <= 0 || signal?.aborted) return resolve(false);
      const finish = (woken: boolean) => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        signal?.removeEventListener("abort", abort);
        resolve(woken);
      };
      const wake = () => finish(true);
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), ms);
      this.waiters.add(wake);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  /** Wakes every waiting poll without a message, so a newer poll can take over. */
  wakeWaiters(): void {
    for (const wake of this.waiters) wake();
  }

  stats(): SpoolStats {
    const exchangeBytes = this.items.reduce((sum, item) => sum + (item.message.media ?? []).reduce((inner, media) => inner + media.byteSize, 0), 0);
    return {
      length: this.items.length,
      exchangeBytes,
      backlogged: this.items.length >= MAX_QUEUE_ITEMS || exchangeBytes >= MAX_EXCHANGE_BYTES,
    };
  }

  /** True once the queue has dropped below 80% of both limits. */
  hasRoom(): boolean {
    const { length, exchangeBytes } = this.stats();
    return length < MAX_QUEUE_ITEMS * 0.8 && exchangeBytes < MAX_EXCHANGE_BYTES * 0.8;
  }

  /** Starts a new queue: a new id, nothing queued, exchange files deleted. Old cursors become unknown. */
  reset(): Promise<void> {
    return this.serialize(async () => {
      this.items = [];
      this.seen.clear();
      this.acked = [];
      this.pinned.clear();
      this.nextSeq = 1;
      await this.rebuild([], { newQueue: true });
      await this.sweepOrphans(new Set());
    });
  }

  /** Deletes exchange files that no queued message refers to, except those in `keep`. */
  async sweepOrphans(keep: ReadonlySet<string>): Promise<void> {
    const referenced = new Set(this.items.flatMap((item) => mediaNames(item.message)));
    for (const name of await readdir(this.store.path("exchange", "inbound")).catch(() => [] as string[]))
      if (!referenced.has(name) && !keep.has(name)) await rm(this.store.path("exchange", "inbound", name), { recursive: true, force: true });
  }

  private async deleteFiles(names: string[]): Promise<void> {
    for (const name of names)
      if (EXTERNAL_EXCHANGE_NAME_PATTERN.test(name)) await rm(this.store.path("exchange", "inbound", name), { force: true });
  }

  async close(): Promise<void> {
    await this.tail.catch(() => {});
    await this.handle?.close().catch(() => {});
    this.handle = null;
    for (const wake of this.waiters) wake();
  }
}
