import type { ExternalListPeersResult, ExternalPeerSummary } from "@outcomego/plugin-sdk/messaging";
import type { PeerRecord, StateStore } from "./state";

/**
 * A reply token is believed good for 24 hours (P6, unverified). The window is kept one hour
 * shorter so a reply is refused locally rather than risked at the edge.
 */
export const REPLY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const FALLBACK_DISPLAY_NAME = "WeChat user";

export interface PeerObservation {
  peerId: string;
  isAccountOwner: boolean;
  displayName?: string;
  /** When the message was first received. Recovery passes the original time so replays cannot extend a window. */
  at: Date;
  /** The reply token carried by this message, if any. */
  contextToken?: string | null;
}

/**
 * Direct peers this account has seen, and the reply token for each. Persisted in
 * `contexts.json`. Tokens are reply capabilities: they are read here for sending and never
 * leave the connector in a tool result.
 */
export class PeerBook {
  private peers = new Map<string, PeerRecord>();
  /** Writes are applied in order, so the file always ends at the newest snapshot. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: StateStore) {}

  async load(): Promise<void> {
    const outcome = await this.store.readContexts();
    this.peers = outcome.status === "ok" ? new Map(outcome.value.peers) : new Map();
  }

  /** Records a message from a peer. A message without a token never erases a valid one. */
  async observe(observation: PeerObservation): Promise<void> {
    const previous = this.peers.get(observation.peerId);
    const at = observation.at.toISOString();
    const next: PeerRecord = {
      isAccountOwner: observation.isAccountOwner,
      lastObservedAt: previous && previous.lastObservedAt > at ? previous.lastObservedAt : at,
      ...(observation.displayName ? { displayName: observation.displayName } : previous?.displayName ? { displayName: previous.displayName } : {}),
    };
    const keepsPrevious = previous?.contextToken && previous.receivedAt;
    if (observation.contextToken && (!keepsPrevious || previous!.receivedAt! <= at)) {
      next.contextToken = observation.contextToken;
      next.receivedAt = at;
    } else if (keepsPrevious) {
      next.contextToken = previous!.contextToken;
      next.receivedAt = previous!.receivedAt;
    }
    this.peers.set(observation.peerId, next);
    await this.persist();
  }

  /** Forgets every reply token but keeps who has been seen (same account, new login). */
  async clearTokens(): Promise<void> {
    for (const [id, record] of this.peers) {
      const { contextToken: _token, receivedAt: _received, ...rest } = record;
      this.peers.set(id, rest);
    }
    await this.persist();
  }

  /** Forgets one peer's token, e.g. after the provider refused it. */
  async invalidateToken(peerId: string): Promise<void> {
    const record = this.peers.get(peerId);
    if (!record?.contextToken) return;
    const { contextToken: _token, receivedAt: _received, ...rest } = record;
    this.peers.set(peerId, rest);
    await this.persist();
  }

  async clearAll(): Promise<void> {
    this.peers = new Map();
    await this.persist();
  }

  /** The token to reply with, only while its window is open. */
  replyToken(peerId: string, now = new Date()): { token: string; receivedAt: string } | null {
    const record = this.peers.get(peerId);
    if (!record?.contextToken || !record.receivedAt) return null;
    return now.getTime() - Date.parse(record.receivedAt) < REPLY_WINDOW_MS ? { token: record.contextToken, receivedAt: record.receivedAt } : null;
  }

  /** Why no token is usable, for the right failure code. */
  tokenState(peerId: string, now = new Date()): "usable" | "missing" | "expired" {
    const record = this.peers.get(peerId);
    if (!record?.contextToken || !record.receivedAt) return "missing";
    return this.replyToken(peerId, now) ? "usable" : "expired";
  }

  /** The account owner's window, for `connection_status`. */
  ownerWindow(now = new Date()): { open: boolean; expiresAt: string | null } {
    let best: string | null = null;
    for (const record of this.peers.values())
      if (record.isAccountOwner && record.contextToken && record.receivedAt && (!best || record.receivedAt > best)) best = record.receivedAt;
    if (!best) return { open: false, expiresAt: null };
    const expires = Date.parse(best) + REPLY_WINDOW_MS;
    return { open: expires > now.getTime(), expiresAt: new Date(expires).toISOString() };
  }

  isOwner(peerId: string): boolean {
    return this.peers.get(peerId)?.isAccountOwner === true;
  }

  get size(): number {
    return this.peers.size;
  }

  /**
   * One page of observed direct peers in stable id order. `accountCanSend` is the account's
   * sending state; it never creates a Mapping or opens a conversation.
   */
  list(input: { limit: number; afterPeerId: string | null }, accountCanSend: boolean, now = new Date()): ExternalListPeersResult {
    const ids = [...this.peers.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).filter((id) => input.afterPeerId === null || id > input.afterPeerId);
    const page = ids.slice(0, input.limit);
    const peers = page.map((peerId): ExternalPeerSummary => {
      const record = this.peers.get(peerId)!;
      return {
        peerId,
        displayName: record.displayName ?? FALLBACK_DISPLAY_NAME,
        lastObservedAt: record.lastObservedAt,
        isAccountOwner: record.isAccountOwner,
        canReply: accountCanSend && record.isAccountOwner && this.tokenState(peerId, now) === "usable",
      };
    });
    return { peers, nextAfterPeerId: ids.length > page.length ? page[page.length - 1]! : null };
  }

  private persist(): Promise<void> {
    const snapshot = new Map(this.peers);
    const write = this.tail.then(() => this.store.writeContexts(snapshot));
    this.tail = write.catch(() => {});
    return write;
  }
}
