import type { ExternalInboundMedia, ExternalMediaFailure, ExternalMessage, ExternalPollInput, ExternalPollResult } from "@outcomego/plugin-sdk/messaging";
import type { AccountCollaborators, WechatAccount } from "./account";
import { WechatApi, WechatApiError } from "./api";
import { JournalStore, type ReceiveJournal } from "./journal";
import { MediaError, sniffMedia, WechatMedia } from "./media";
import { normalizeInbound } from "./normalize";
import type { PeerBook } from "./peers";
import type { WechatInboundMessage } from "./protocol";
import type { Spool } from "./spool";
import type { StateStore } from "./state";

export interface ReceiveTiming {
  /** Wait after one of the first three failures. */
  retryMs: number;
  /** Wait after that, until a poll succeeds. */
  slowRetryMs: number;
  /** How often a full queue is checked for room. */
  backlogPollMs: number;
  /** Default long-poll length before the server suggests one. */
  pollTimeoutMs: number;
  /** Extra time allowed on top of the server's suggested long-poll length. */
  pollSlackMs: number;
  /** How soon a cool-down probe is tried again after a failure that is not a session expiry. */
  probeRetryMs: number;
}

export const DEFAULT_TIMING: ReceiveTiming = {
  retryMs: 2_000,
  slowRetryMs: 30_000,
  backlogPollMs: 5_000,
  pollTimeoutMs: 35_000,
  pollSlackMs: 5_000,
  probeRetryMs: 60_000,
};

export interface ReceiveDependencies {
  api: WechatApi;
  store: StateStore;
  spool: Spool;
  journal: JournalStore;
  media: WechatMedia;
  peers: PeerBook;
  timing?: Partial<ReceiveTiming>;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

const safeStem = (value: string | undefined, fallback: string): string => {
  const stem = (value ?? "").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return stem || fallback;
};

/**
 * Everything on the receiving side: the long-poll loop that fills the queue, and the poll tool that
 * drains it. Implements what the account needs from it (start, stop, reset), so the account can
 * restart it with new credentials without knowing how it works.
 */
export class ReceiveService implements AccountCollaborators {
  private readonly timing: ReceiveTiming;
  private readonly now: () => Date;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private account!: Pick<WechatAccount, "reportPollOk" | "reportPollFailure" | "reportBacklog" | "reportSessionExpired" | "resumeAfterCooldown" | "discardCredentials" | "ownerId" | "botId" | "probeDueIn" | "status">;
  private loop: { abort: AbortController; done: Promise<void> } | null = null;
  private probe: ReturnType<typeof setTimeout> | null = null;
  private pollWait: AbortController | null = null;
  private closed = false;
  private readonly counters = { group: 0, self: 0, empty: 0, duplicate: 0 };
  private recoveredBatches = 0;

  constructor(private readonly deps: ReceiveDependencies) {
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? sleepFor;
  }

  /** The account is built with this service as its collaborator, so it is attached after both exist. */
  attach(account: ReceiveService["account"]): void {
    this.account = account;
  }

  // --- What the account needs --------------------------------------------------------------

  startReceiving(): void {
    if (this.closed || this.loop) return;
    const abort = new AbortController();
    const done = this.run(abort.signal).catch(() => {}).finally(() => {
      if (this.loop?.abort === abort) this.loop = null;
    });
    this.loop = { abort, done };
  }

  /** Stops fetching and lets a batch already being worked on finish queuing. */
  async stopReceiving(): Promise<void> {
    this.cancelProbe();
    const loop = this.loop;
    if (!loop) return;
    loop.abort.abort();
    await loop.done;
  }

  async resetQueue(): Promise<void> {
    await this.deps.spool.reset();
    await this.deps.journal.clear();
    Object.assign(this.counters, { group: 0, self: 0, empty: 0, duplicate: 0 });
  }

  queueLength(): number {
    return this.deps.spool.stats().length;
  }

  dropped() {
    return { ...this.counters };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pollWait?.abort();
    await this.stopReceiving();
  }

  /** Whether the fetch loop is alive. It ends on a session expiry, a stop, or an unexpected failure. */
  get isRunning(): boolean {
    return this.loop !== null;
  }

  /** Test visibility: how many interrupted batches were finished from the journal. */
  get recovered(): number {
    return this.recoveredBatches;
  }

  // --- The loop ----------------------------------------------------------------------------

  private async run(signal: AbortSignal): Promise<void> {
    // A batch the last run left half done is finished first, before anything new is fetched.
    await this.recoverJournal().catch(() => {});
    let failures = 0;
    let longPollMs: number | null = null;
    while (!signal.aborted) {
      if (this.deps.spool.stats().backlogged) {
        this.account.reportBacklog(true);
        while (!signal.aborted && !this.deps.spool.hasRoom()) await this.sleep(this.timing.backlogPollMs, signal);
        this.account.reportBacklog(false);
        continue;
      }
      const cursor = await this.readCursor();
      const timeout = (longPollMs ?? this.timing.pollTimeoutMs) + this.timing.pollSlackMs;
      let result;
      try {
        result = await this.deps.api.getUpdates(cursor, timeout, signal);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof WechatApiError && error.kind === "session_expired") {
          // This loop is about to end by itself. Detach it first: reporting the expiry stops receiving,
          // and stopping would otherwise wait for this very loop to finish.
          this.loop = null;
          await this.account.reportSessionExpired();
          this.scheduleProbe();
          return;
        }
        this.account.reportPollFailure();
        failures += 1;
        await this.sleep(failures > 3 ? this.timing.slowRetryMs : this.timing.retryMs, signal);
        continue;
      }
      failures = 0;
      this.account.reportPollOk();
      longPollMs = result.longPollingTimeoutMs ?? longPollMs;
      if (!(await this.ingest(result, cursor))) return;
    }
  }

  /**
   * Takes one provider answer into the queue. Any answer with messages is journaled first, whether it
   * came from the loop or from the post-expiry probe: nothing the provider hands over is dropped.
   * Returns false when there is no account left to receive for.
   */
  private async ingest(result: { messages: WechatInboundMessage[]; nextBuffer: string | null }, previous: string): Promise<boolean> {
    if (result.messages.length === 0) {
      // Nothing to lose: an empty answer only moves the position.
      if (result.nextBuffer !== null && result.nextBuffer !== previous) await this.deps.store.writeCursor(result.nextBuffer);
      return true;
    }
    const botId = this.account.botId;
    if (!botId) return false;
    const journal = { ilinkBotId: botId, queueId: this.deps.spool.currentQueueId, receivedAt: this.now().toISOString(), nextBuffer: result.nextBuffer, messages: result.messages };
    // Durable before anything else happens to this batch. From here a crash loses nothing.
    await this.deps.journal.write(journal);
    await this.processBatch({ version: 1, ...journal });
    return true;
  }

  private async readCursor(): Promise<string> {
    const outcome = await this.deps.store.readCursor();
    return outcome.status === "ok" ? outcome.value.getUpdatesBuf : "";
  }

  /** Finishes a batch left in the journal by an earlier run. */
  private async recoverJournal(): Promise<void> {
    const journal = await this.deps.journal.read();
    if (!journal) return;
    // A batch from another login belongs to nobody now.
    if (journal.ilinkBotId !== this.account.botId) {
      await this.deps.journal.clear();
      return;
    }
    this.recoveredBatches += 1;
    await this.processBatch(journal);
  }

  /**
   * Queues a journaled batch and commits it: the messages are in the queue and on disk, then the
   * provider cursor is saved, then the journal goes. A crash between any two steps is repaired by
   * running the batch again, because queuing the same message twice does nothing.
   */
  private async processBatch(journal: ReceiveJournal): Promise<void> {
    const { spool } = this.deps;
    const receivedAt = new Date(journal.receivedAt);
    const owner = this.account.ownerId;
    const botId = this.account.botId;
    if (!owner || !botId) return;
    // Remembered ids must outlive this batch's own acknowledgement until it is committed.
    spool.pin(journal.messages.map((message) => message.messageId));
    try {
      for (const raw of journal.messages) await this.processMessage(raw, { ilinkBotId: botId, ilinkUserId: owner }, receivedAt);
      if (journal.nextBuffer !== null) await this.deps.store.writeCursor(journal.nextBuffer);
      await this.deps.journal.clear();
    } finally {
      spool.unpin();
    }
  }

  private async processMessage(raw: WechatInboundMessage, account: { ilinkBotId: string; ilinkUserId: string }, receivedAt: Date): Promise<void> {
    const normalized = normalizeInbound(raw, account, receivedAt);
    if (normalized.kind === "drop") {
      this.counters[normalized.reason] += 1;
      // A message that is not for the Bot still tells us this person can be answered.
      if (normalized.reason === "empty") await this.observe(raw, account, receivedAt);
      return;
    }
    await this.observe(raw, account, receivedAt);
    if (this.deps.spool.has(raw.messageId)) {
      this.counters.duplicate += 1;
      return;
    }
    const files: ExternalInboundMedia[] = [];
    const failures: ExternalMediaFailure[] = [...(normalized.message.mediaFailures ?? [])];
    for (const entry of normalized.media) {
      // Named by what is about to be queued, so a retried batch lands on the same file.
      const exchangeName = `${this.deps.spool.upcomingSeq}-${entry.index}`;
      try {
        const fetched = await this.deps.media.fetchInbound(entry.item.media ?? {}, entry.item.length, exchangeName);
        const kind = sniffMedia(fetched.head);
        const original = entry.item.fileName?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase();
        const extension = kind?.extension ?? original ?? "bin";
        files.push({
          exchangeName,
          fileName: `${safeStem(entry.item.fileName, `media-${entry.index + 1}`)}.${extension}`,
          ...(kind ? { mimeType: kind.mimeType } : {}),
          byteSize: fetched.byteSize,
          sha256: fetched.sha256,
        });
      } catch (error) {
        if (!(error instanceof MediaError)) throw error;
        failures.push({ ...(entry.item.fileName ? { fileName: entry.item.fileName.slice(0, 200) } : {}), code: error.code });
      }
    }
    const { mediaFailures: _carried, ...base } = normalized.message;
    const message: ExternalMessage = {
      ...base,
      ...(files.length ? { media: files } : {}),
      ...(failures.length ? { mediaFailures: failures } : {}),
    };
    const queued = await this.deps.spool.append(message, this.now());
    if (!queued) this.counters.duplicate += 1;
  }

  private async observe(raw: WechatInboundMessage, account: { ilinkUserId: string }, receivedAt: Date): Promise<void> {
    if (raw.groupId || !raw.fromUserId) return;
    await this.deps.peers.observe({
      peerId: raw.fromUserId,
      isAccountOwner: raw.fromUserId === account.ilinkUserId,
      at: receivedAt,
      contextToken: raw.contextToken,
    });
  }

  // --- Poll tool ---------------------------------------------------------------------------

  /**
   * The Server's poll: acknowledges what it has handled, then returns what follows. Waits for news
   * when there is none. Only one poll waits at a time: a newer one releases the older one empty.
   */
  async poll(input: ExternalPollInput): Promise<ExternalPollResult> {
    const { spool } = this.deps;
    this.pollWait?.abort();
    const wait = new AbortController();
    this.pollWait = wait;
    let after = 0;
    let reset = false;
    if (input.cursor) {
      const acknowledged = await spool.ack(input.cursor);
      if (acknowledged.reset) reset = true;
      else after = spool.parseCursor(input.cursor) ?? 0;
    }
    let items = spool.read(after, input.limit);
    if (items.length === 0) {
      if (this.account.status().state === "needs_pairing" && spool.stats().length === 0)
        throw new Error("wechat_needs_pairing: scan the QR code again");
      await spool.waitForAppend(input.waitMs, wait.signal);
      if (wait.signal.aborted) return { messages: [], ...(reset ? { resetCursor: true } : {}) };
      items = spool.read(after, input.limit);
    }
    if (this.pollWait === wait) this.pollWait = null;
    return { messages: items, ...(reset ? { resetCursor: true } : {}) };
  }

  // --- After a session expiry --------------------------------------------------------------

  /** Schedules the one request that decides whether a paused account lives: its first after the cool-down. */
  scheduleProbe(): void {
    if (this.closed) return;
    this.cancelProbe();
    const due = this.account.probeDueIn();
    if (due === null) return;
    const timer = setTimeout(() => void this.runProbe().catch(() => {}), due);
    (timer as { unref?: () => void }).unref?.();
    this.probe = timer;
  }

  private cancelProbe(): void {
    if (this.probe) clearTimeout(this.probe);
    this.probe = null;
  }

  /** A probe that fetches nothing it keeps: the provider cursor is untouched, so nothing is lost or skipped. */
  async runProbe(): Promise<"resumed" | "discarded" | "later"> {
    this.probe = null;
    const cursor = await this.readCursor();
    let answer;
    try {
      answer = await this.deps.api.getUpdates(cursor, 8_000);
    } catch (error) {
      if (error instanceof WechatApiError && error.kind === "session_expired") {
        await this.account.discardCredentials();
        return "discarded";
      }
      // The network, not the account: ask again later.
      const timer = setTimeout(() => void this.runProbe().catch(() => {}), this.timing.probeRetryMs);
      (timer as { unref?: () => void }).unref?.();
      this.probe = timer;
      return "later";
    }
    // The probe may have been handed messages; they are queued like any others before receiving resumes.
    await this.ingest(answer, cursor);
    await this.account.resumeAfterCooldown();
    return "resumed";
  }
}
