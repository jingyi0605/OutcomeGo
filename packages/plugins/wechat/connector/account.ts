import { randomUUID } from "node:crypto";
import { qrDataUrl } from "../../_shared/qr-png";
import { baseUrlFromHost, isAllowedWechatUrl, WechatApi, WechatApiError } from "./api";
import { PeerBook } from "./peers";
import type { AccountFile, StateStore } from "./state";

/**
 * How long a QR code is shown before it is refreshed. P1 (unverified): the real lifetime is
 * unknown. If it is shorter, the provider reports `expired` and the code is refreshed early; if
 * longer, nothing is lost. A code is never shown past this.
 */
export const QR_VALIDITY_MS = 2 * 60_000;
/** A session may refresh its code this many times, then ends as `wechat_qr_expired`. */
export const MAX_QR_REFRESHES = 3;
/** The whole approval, however many codes it takes. */
export const LINK_SESSION_MS = (MAX_QR_REFRESHES + 1) * QR_VALIDITY_MS;
/** No business request is made this long after the provider reports an expired session. */
export const SESSION_COOLDOWN_MS = 60 * 60_000;

export type WechatState = "needs_pairing" | "bootstrapping" | "ready" | "recovering" | "backlogged";
export type NeedsPairingReason = "not_linked" | "session_expired" | "removed";

/** What the account needs from the receive side. The real implementations arrive with tasks 3.1/3.2. */
export interface AccountCollaborators {
  /** Starts the background receive loop for the current credentials. */
  startReceiving(): void;
  /** Stops it and lets the persisted provider batch finish its local hand-off. */
  stopReceiving(): Promise<void>;
  /** Replaces the local queue (new account), discarding queued messages and exchange files. */
  resetQueue(): Promise<void>;
  queueLength(): number;
  dropped(): { group: number; self: number; empty: number; duplicate: number };
}

/** The host-only `wechat_link_status` result. Field names and units follow the device-link contract. */
export interface LinkStatus {
  /** Present whenever an approval session exists; the host fences stale sessions with it. */
  sessionId?: string;
  linked: boolean;
  linking: boolean;
  /** Machine-readable reason the approval ended without credentials. */
  authorizationError?: string;
  /** The current code while linking. Times are epoch milliseconds. */
  challenge?: { generation: number; qrCodeDataUrl: string | null; expiresAt: number };
}

export const noReceiving: AccountCollaborators = {
  startReceiving() {},
  async stopReceiving() {},
  async resetQueue() {},
  queueLength: () => 0,
  dropped: () => ({ group: 0, self: 0, empty: 0, duplicate: 0 }),
};

export interface AccountOptions {
  api: WechatApi;
  store: StateStore;
  peers: PeerBook;
  collaborators?: AccountCollaborators;
  now?: () => Date;
  sessionId?: () => string;
  /** Pause between QR status polls. The server already holds each request open, so this only bounds a fast reply loop. */
  statusPollDelayMs?: number;
}

interface LinkSession {
  sessionId: string;
  qrcode: string;
  expiresAt: number;
  sessionExpiresAt: number;
  generation: number;
  refreshes: number;
  qrCodeDataUrl: string;
  abort: AbortController;
  /** Set when the session ended without credentials. */
  failure?: string;
  completed: boolean;
  running?: Promise<void>;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * The single owner of the WeChat account: QR approval, credentials, and the lifecycle of the
 * receive loop. Tool handlers call into it; nothing else changes account state.
 */
export class WechatAccount {
  readonly api: WechatApi;
  readonly store: StateStore;
  readonly peers: PeerBook;
  private readonly collaborators: AccountCollaborators;
  private readonly now: () => Date;
  private readonly newSessionId: () => string;
  private readonly pollDelay: number;

  private credentials: AccountFile | null = null;
  private baseState: WechatState = "needs_pairing";
  private reason: NeedsPairingReason | null = "not_linked";
  private session: LinkSession | null = null;
  private startingLink: Promise<unknown> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  private lastPollOkAt: string | null = null;
  private consecutiveFailures = 0;

  constructor(options: AccountOptions) {
    this.api = options.api;
    this.store = options.store;
    this.peers = options.peers;
    this.collaborators = options.collaborators ?? noReceiving;
    this.now = options.now ?? (() => new Date());
    this.newSessionId = options.sessionId ?? (() => randomUUID());
    this.pollDelay = options.statusPollDelayMs ?? 1000;
  }

  /** Serializes everything that changes account state. */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => {
      if (this.closed) throw new Error("WeChat connector is shutting down.");
      return run();
    });
    this.tail = next.catch(() => {});
    return next;
  }

  /** Loads persisted state. Credentials that survived a restart resume without another scan. */
  async initialize(): Promise<void> {
    await this.store.prepare();
    await this.peers.load();
    const outcome = await this.store.readAccount();
    if (outcome.status !== "ok") {
      this.credentials = null;
      this.baseState = "needs_pairing";
      this.reason = "not_linked";
      return;
    }
    this.credentials = outcome.value;
    this.api.setToken(outcome.value.botToken);
    this.api.setBaseUrl(outcome.value.baseUrl);
    const pausedUntil = outcome.value.pausedUntil ? Date.parse(outcome.value.pausedUntil) : 0;
    if (pausedUntil > this.now().getTime()) {
      this.baseState = "needs_pairing";
      this.reason = "session_expired";
      return;
    }
    this.baseState = "bootstrapping";
    this.reason = null;
    this.collaborators.startReceiving();
  }

  get isLinked(): boolean {
    return this.credentials !== null;
  }

  /** Whether deliver may attempt a send right now. */
  get canSend(): boolean {
    return this.credentials !== null && ["bootstrapping", "ready", "recovering", "backlogged"].includes(this.baseState) && !this.inCooldown();
  }

  get ownerId(): string | null {
    return this.credentials?.ilinkUserId ?? null;
  }

  get botId(): string | null {
    return this.credentials?.ilinkBotId ?? null;
  }

  /** Removes the bot token from text bound for a tool result or log. */
  redact(value: string): string {
    const token = this.credentials?.botToken;
    return token && token.length >= 4 ? value.split(token).join("[redacted]") : value;
  }

  inCooldown(): boolean {
    const until = this.credentials?.pausedUntil;
    return until !== undefined && Date.parse(until) > this.now().getTime();
  }

  // --- Reports from the receive loop -------------------------------------------------

  reportPollOk(): void {
    this.lastPollOkAt = this.now().toISOString();
    this.consecutiveFailures = 0;
    if (this.baseState === "bootstrapping" || this.baseState === "recovering") this.baseState = "ready";
  }

  reportPollFailure(): void {
    this.consecutiveFailures += 1;
    if (this.baseState === "ready" || this.baseState === "bootstrapping") this.baseState = "recovering";
  }

  reportBacklog(backlogged: boolean): void {
    if (backlogged && this.baseState === "ready") this.baseState = "backlogged";
    else if (!backlogged && this.baseState === "backlogged") this.baseState = "ready";
  }

  /** `getupdates` returned the session-expired code: stop, cool down, ask for a new scan. */
  async reportSessionExpired(): Promise<void> {
    await this.exclusive(async () => {
      if (!this.credentials) return;
      await this.collaborators.stopReceiving();
      const pausedUntil = new Date(this.now().getTime() + SESSION_COOLDOWN_MS).toISOString();
      this.credentials = { ...this.credentials, pausedUntil };
      await this.store.writeAccount(withoutVersion(this.credentials));
      this.baseState = "needs_pairing";
      this.reason = "session_expired";
    });
  }

  /** The cool-down probe succeeded: resume. */
  async resumeAfterCooldown(): Promise<void> {
    await this.exclusive(async () => {
      if (!this.credentials) return;
      const { pausedUntil: _paused, ...rest } = this.credentials;
      this.credentials = rest as AccountFile;
      await this.store.writeAccount(withoutVersion(this.credentials));
      this.baseState = "bootstrapping";
      this.reason = null;
      this.collaborators.startReceiving();
    });
  }

  /** The cool-down probe failed too: the credentials are dead. */
  async discardCredentials(): Promise<void> {
    await this.exclusive(async () => {
      await this.collaborators.stopReceiving();
      this.credentials = null;
      this.api.setToken(undefined);
      for (const name of ["account.json", "cursor.json"]) await this.store.remove(name);
      this.baseState = "needs_pairing";
      this.reason = "session_expired";
    });
  }

  // --- Status for Bots -----------------------------------------------------------------

  /** The read-only `connection_status` result. It carries no token, cursor or full identifier. */
  status() {
    const now = this.now();
    const linking = this.session !== null && !this.session.completed && !this.session.failure && this.session.sessionExpiresAt > now.getTime();
    return {
      state: !this.credentials && linking ? ("pairing" as const) : this.baseState,
      reason: this.baseState === "needs_pairing" ? this.reason : null,
      pairing: linking,
      account: this.credentials ? `…${this.credentials.ilinkBotId.slice(-4)}` : null,
      lastPollOkAt: this.lastPollOkAt,
      consecutiveFailures: this.consecutiveFailures,
      queueLength: this.collaborators.queueLength(),
      replyWindow: (({ open, expiresAt }) => ({ open: open && this.canSend, expiresAt }))(this.peers.ownerWindow(now)),
      dropped: this.collaborators.dropped(),
    };
  }

  // --- Device link (host-only tools) ---------------------------------------------------

  /** Begins QR approval. Calls while one is starting share its result. */
  startLink() {
    if (this.startingLink) return this.startingLink as Promise<ReturnType<WechatAccount["startResult"]>>;
    const pending = this.exclusive(async () => {
      await this.endSession(this.session);
      const code = await this.api.getBotQrcode();
      const startedAt = this.now().getTime();
      this.session = {
        sessionId: this.newSessionId(),
        qrcode: code.qrcode,
        expiresAt: startedAt + QR_VALIDITY_MS,
        sessionExpiresAt: startedAt + LINK_SESSION_MS,
        generation: 0,
        refreshes: 0,
        qrCodeDataUrl: qrDataUrl(code.qrcodeContent),
        abort: new AbortController(),
        completed: false,
      };
      return this.startResult(this.session);
    });
    this.startingLink = pending;
    void pending.finally(() => (this.startingLink = null)).catch(() => {});
    return pending;
  }

  private startResult(session: LinkSession) {
    return {
      sessionId: session.sessionId,
      qrCodeDataUrl: session.qrCodeDataUrl,
      expiresAt: Math.min(session.expiresAt, session.sessionExpiresAt),
      sessionExpiresAt: session.sessionExpiresAt,
      challengeGeneration: session.generation,
    };
  }

  /** Starts waiting for the scan in the background; returns at once. */
  finishLink(sessionId: string) {
    return this.exclusive(async () => {
      const session = this.session;
      if (!session || session.sessionId !== sessionId || session.failure || session.sessionExpiresAt <= this.now().getTime())
        throw new Error("This device approval is no longer active.");
      session.running ??= this.watch(session).catch(() => {});
      return { sessionId, pending: !session.completed };
    });
  }

  linkStatus(): Promise<LinkStatus> {
    return this.exclusive(async (): Promise<LinkStatus> => {
      const session = this.session;
      const identity = session ? { sessionId: session.sessionId } : {};
      if (session && !session.completed && !session.failure && session.sessionExpiresAt <= this.now().getTime())
        session.failure = "wechat_qr_expired";
      if (session?.failure) return { ...identity, linked: false, linking: false, authorizationError: session.failure };
      if (session && !session.completed) {
        return {
          ...identity,
          linked: false,
          linking: true,
          challenge: {
            generation: session.generation,
            qrCodeDataUrl: session.expiresAt > this.now().getTime() ? session.qrCodeDataUrl : null,
            expiresAt: Math.min(session.expiresAt, session.sessionExpiresAt),
          },
        };
      }
      // No approval in flight: report the account itself.
      return { ...identity, linked: this.credentials !== null && !this.inCooldown(), linking: false };
    });
  }

  cancelLink(sessionId: string) {
    return this.exclusive(async () => {
      if (!this.session || this.session.sessionId !== sessionId) return { cancelled: false };
      await this.endSession(this.session);
      this.session = null;
      return { cancelled: true };
    });
  }

  /** Host deletion follows this. Stops everything and empties the state directory. */
  async removeAccount() {
    await this.closeInternal();
    // Peers first: clearing them rewrites contexts.json, which the directory wipe must then remove.
    await this.peers.clearAll().catch(() => {});
    await this.store.clear();
    this.credentials = null;
    this.baseState = "needs_pairing";
    this.reason = "removed";
    return { removed: true };
  }

  async close(): Promise<void> {
    await this.closeInternal();
  }

  private async closeInternal(): Promise<void> {
    await this.endSession(this.session);
    this.session = null;
    await this.collaborators.stopReceiving();
    const credentials = this.credentials;
    if (credentials) await this.api.notifyStop().catch(() => {});
    this.closed = true;
  }

  private async endSession(session: LinkSession | null): Promise<void> {
    if (!session) return;
    session.abort.abort();
    await session.running?.catch(() => {});
  }

  // --- Approval loop -------------------------------------------------------------------

  private async watch(session: LinkSession): Promise<void> {
    const signal = session.abort.signal;
    while (!signal.aborted && !session.failure && !session.completed) {
      if (session.sessionExpiresAt <= this.now().getTime()) {
        session.failure = "wechat_qr_expired";
        return;
      }
      let status;
      try {
        status = await this.api.getQrcodeStatus(session.qrcode, 35_000, signal);
      } catch (error) {
        if (signal.aborted) return;
        // A transient failure is retried until the session deadline.
        if (error instanceof WechatApiError && error.kind !== "invalid_response") {
          await sleep(Math.max(this.pollDelay, 1000), signal);
          continue;
        }
        session.failure = "wechat_link_failed";
        return;
      }
      if (signal.aborted) return;
      if (status.status === "confirmed") {
        await this.confirm(session, status);
        return;
      }
      if (status.status === "scaned_but_redirect" && status.redirectHost) {
        const next = baseUrlFromHost(status.redirectHost);
        if (!next) {
          session.failure = "wechat_base_url_rejected";
          return;
        }
        this.api.setBaseUrl(next);
      } else if (status.status === "expired") {
        if (session.refreshes >= MAX_QR_REFRESHES) {
          session.failure = "wechat_qr_expired";
          return;
        }
        try {
          const code = await this.api.getBotQrcode();
          if (signal.aborted) return;
          session.qrcode = code.qrcode;
          session.qrCodeDataUrl = qrDataUrl(code.qrcodeContent);
          session.expiresAt = this.now().getTime() + QR_VALIDITY_MS;
          session.refreshes += 1;
          session.generation += 1;
        } catch {
          if (signal.aborted) return;
          session.failure = "wechat_link_failed";
          return;
        }
      }
      await sleep(this.pollDelay, signal);
    }
  }

  /**
   * The scan was confirmed. Order matters (design §2.3.1): validate the host, stop the old loop
   * and let its persisted batch finish, only then swap credentials, drop the old cursor, and
   * start receiving with the new token.
   */
  private async confirm(session: LinkSession, status: { botToken?: string; baseUrl?: string; ilinkBotId?: string; ilinkUserId?: string }): Promise<void> {
    if (!status.botToken || !status.ilinkBotId || !status.ilinkUserId) {
      session.failure = "wechat_link_failed";
      return;
    }
    const baseUrl = status.baseUrl ?? this.api.baseUrl;
    if (!isAllowedWechatUrl(baseUrl)) {
      session.failure = "wechat_base_url_rejected";
      return;
    }
    await this.exclusive(async () => {
      if (this.session !== session || session.abort.signal.aborted) return;
      await this.collaborators.stopReceiving();
      const sameAccount = this.credentials?.ilinkBotId === status.ilinkBotId && this.credentials?.ilinkUserId === status.ilinkUserId;
      if (!sameAccount) {
        await this.collaborators.resetQueue();
        await this.peers.clearAll();
      } else {
        // A new login never reuses the old provider cursor or reply tokens.
        await this.peers.clearTokens();
      }
      const next: AccountFile = {
        version: 1,
        botToken: status.botToken!,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        ilinkBotId: status.ilinkBotId!,
        ilinkUserId: status.ilinkUserId!,
        linkedAt: this.now().toISOString(),
      };
      await this.store.writeAccount(withoutVersion(next));
      await this.store.remove("cursor.json");
      this.credentials = next;
      this.api.setToken(next.botToken);
      this.api.setBaseUrl(next.baseUrl);
      this.baseState = "bootstrapping";
      this.reason = null;
      this.lastPollOkAt = null;
      this.consecutiveFailures = 0;
      session.completed = true;
      // P10 (unverified): the notification is not known to be required, so failure is only noise.
      await this.api.notifyStart().catch(() => {});
      this.collaborators.startReceiving();
    });
  }
}

const withoutVersion = ({ version: _version, ...rest }: AccountFile): Omit<AccountFile, "version"> => rest;
