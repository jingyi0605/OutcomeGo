import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@outcomego/db";
import {
  EXTERNAL_POLL_BATCH_LIMIT,
  EXTERNAL_POLL_DEFAULT_WAIT_SECONDS,
  EXTERNAL_POLL_MAX_WAIT_SECONDS,
  ExternalProtocolError,
  parseExternalPollResult,
  type ExternalPollEntry,
} from "@outcomego/plugin-sdk/messaging";
import type { PollableConnection } from "../plugin/events";
import type { ExternalInboundMessageService, AcceptContext } from "./inbound";
import { DB_NOW, messagingOf, shortCode, toolResultValue, ToolResultError } from "./shared";

export const SCAN_INTERVAL_MS = 5_000;
export const LEASE_SECONDS = 60;
export const RETRY_LIMIT = 20;
export const RETRY_WINDOW_MS = 30 * 60_000;
export const RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60_000;
const BACKOFF_FIRST_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
/** A connector that answers an empty poll instantly would otherwise spin the loop. */
const EMPTY_FAST_RETURN_MS = 100;
const EMPTY_FAST_PAUSE_MS = 250;

export const backoffMs = (failures: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** Math.max(0, failures - 1));

export type CallHostTool = (connection: PollableConnection, toolName: string, args: Record<string, unknown>) => Promise<unknown>;

export interface PollerDependencies {
  prisma: PrismaClient;
  callHostTool: CallHostTool;
  inbound: Pick<ExternalInboundMessageService, "accept" | "deadLetter">;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Names this process in leases. Defaults to a random id. */
  instanceId?: string;
}

type Outcome = { next: "continue" | "stop"; delayMs: number };

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Drives inbound polling for every enabled Binding (specs/009 §2.3.1). One loop per Binding,
 * guarded by a database lease so only one Server polls a connection at a time. The cursor moves
 * only after a message reaches a terminal result, and only with a "previous value" condition, so
 * two overlapping pollers can neither skip nor repeat a message.
 */
export class ExternalInboundPoller {
  private readonly owner: string;
  private readonly now: () => Date;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly loops = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private timer?: ReturnType<typeof setInterval>;
  private lastCleanup = 0;
  private stopped = true;

  constructor(private readonly deps: PollerDependencies) {
    this.owner = `${deps.instanceId ?? "server"}:${randomUUID()}`;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? abortableSleep;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.scan().catch(() => {});
    this.timer = setInterval(() => void this.scan().catch(() => {}), SCAN_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const loop of this.loops.values()) loop.abort.abort();
    await Promise.allSettled([...this.loops.values()].map((loop) => loop.done));
  }

  /** Starts a loop for every pollable Binding that has none here. Also prunes old receipts daily. */
  async scan(): Promise<void> {
    const bindings = await this.deps.prisma.externalMessagingBinding.findMany({
      where: { enabled: true, status: "active", connection: { status: "ready", installation: { status: "installed" } } },
      include: { connection: { include: { installation: true } } },
    });
    for (const binding of bindings) {
      if (this.stopped || this.loops.has(binding.id) || !messagingOf(binding.connection)) continue;
      const abort = new AbortController();
      const done = this.run(binding.id, binding.connection.runtimeGeneration, abort.signal).finally(() => this.loops.delete(binding.id));
      this.loops.set(binding.id, { abort, done });
    }
    if (this.now().getTime() - this.lastCleanup > 24 * 60 * 60_000) {
      this.lastCleanup = this.now().getTime();
      await this.cleanupReceipts().catch(() => {});
    }
  }

  async cleanupReceipts(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - RECEIPT_RETENTION_MS);
    return (await this.deps.prisma.externalMessageReceipt.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
  }

  private async run(bindingId: string, generation: number, signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted && !this.stopped) {
        const outcome = await this.iterate(bindingId, generation, signal);
        if (outcome.next === "stop") return;
        if (outcome.delayMs > 0) await this.sleep(outcome.delayMs, signal);
      }
    } catch {
      // A loop never takes the process down; the next scan starts a fresh one.
    } finally {
      await this.releaseLease(bindingId).catch(() => {});
    }
  }

  /** Takes or renews this process's lease, using the database clock. Zero rows means someone else holds it. */
  private async claimLease(bindingId: string): Promise<boolean> {
    const count = await this.deps.prisma.$executeRaw`
      UPDATE "outcomego_external_messaging_binding"
      SET "leaseOwner" = ${this.owner},
          "leaseExpiresAt" = ${DB_NOW} + make_interval(secs => ${LEASE_SECONDS})
      WHERE "id" = ${bindingId}::uuid
        AND "enabled" AND "status" = 'active'
        AND ("leaseOwner" = ${this.owner} OR "leaseExpiresAt" IS NULL OR "leaseExpiresAt" < ${DB_NOW})`;
    return count > 0;
  }

  private async releaseLease(bindingId: string): Promise<void> {
    await this.deps.prisma.externalMessagingBinding.updateMany({
      where: { id: bindingId, leaseOwner: this.owner },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  }

  /** One pass: claim, poll, hand each message over, move the cursor. Exposed for tests. */
  async iterate(bindingId: string, generation: number, signal?: AbortSignal): Promise<Outcome> {
    const { prisma } = this.deps;
    const binding = await prisma.externalMessagingBinding.findUnique({
      where: { id: bindingId },
      include: { connection: { include: { installation: true } } },
    });
    const messaging = binding ? messagingOf(binding.connection) : undefined;
    // Stop when disabled, paused, no longer ready, or the connector was restarted or replaced.
    if (
      !binding || !messaging || !binding.enabled || binding.status !== "active" ||
      binding.connection.status !== "ready" || binding.connection.installation.status !== "installed" ||
      binding.connection.runtimeGeneration !== generation
    )
      return { next: "stop", delayMs: 0 };
    if (!(await this.claimLease(bindingId))) return { next: "stop", delayMs: 0 };

    const waitMs = Math.min(messaging.inbound.maxWaitSeconds ?? EXTERNAL_POLL_DEFAULT_WAIT_SECONDS, EXTERNAL_POLL_MAX_WAIT_SECONDS) * 1000;
    const started = this.now().getTime();
    let parsed: ReturnType<typeof parseExternalPollResult>;
    try {
      const raw = await this.deps.callHostTool(binding.connection, messaging.inbound.pollTool, {
        cursor: binding.inboundCursor,
        limit: EXTERNAL_POLL_BATCH_LIMIT,
        waitMs,
      });
      parsed = parseExternalPollResult(toolResultValue(raw), { limit: EXTERNAL_POLL_BATCH_LIMIT });
    } catch (error) {
      const code = error instanceof ExternalProtocolError ? "external_poll_invalid" : "external_poll_failed";
      const failures = binding.consecutiveFailures + 1;
      await prisma.externalMessagingBinding.update({
        where: { id: bindingId },
        data: { consecutiveFailures: failures, lastErrorCode: code, lastErrorAt: this.now() },
      });
      // The connector's own code is useful in a log; the reason text never is.
      if (error instanceof ToolResultError) console.warn(`external poll failed: ${shortCode(error.code)}`);
      return { next: "continue", delayMs: backoffMs(failures) };
    }

    let cursor = binding.inboundCursor;
    if (parsed.resetCursor && cursor !== null) {
      const reset = await prisma.externalMessagingBinding.updateMany({ where: { id: bindingId, inboundCursor: cursor }, data: { inboundCursor: null } });
      if (reset.count === 0) return { next: "continue", delayMs: 0 };
      cursor = null;
    }
    await prisma.externalMessagingBinding.update({
      where: { id: bindingId },
      data: { lastPolledAt: this.now(), consecutiveFailures: 0 },
    });

    const context: AcceptContext = {
      binding: { id: binding.id, botId: binding.botId, connectionId: binding.connectionId },
      platform: messaging.platform,
      platformLabel: binding.connection.name,
    };
    for (const entry of parsed.messages) {
      if (signal?.aborted) return { next: "stop", delayMs: 0 };
      const result = await this.deps.inbound.accept(context, entry);
      if (result.status === "retry") {
        if (result.targetUnavailable) return { next: "stop", delayMs: 0 };
        const exhausted = await this.registerRetry(bindingId, entry.ackCursor);
        if (!exhausted) return { next: "continue", delayMs: backoffMs(2) };
        await this.deps.inbound.deadLetter(context, entry);
      }
      const advanced = await this.advance(bindingId, cursor, entry.ackCursor);
      // Another process moved the cursor first: re-read before doing anything else.
      if (!advanced) return { next: "continue", delayMs: 0 };
      cursor = entry.ackCursor;
      if (!(await this.claimLease(bindingId))) return { next: "stop", delayMs: 0 };
    }
    const quick = parsed.messages.length === 0 && this.now().getTime() - started < EMPTY_FAST_RETURN_MS;
    return { next: "continue", delayMs: quick ? EMPTY_FAST_PAUSE_MS : 0 };
  }

  /** Moves the cursor from exactly `previous`; false when it was no longer there. */
  private async advance(bindingId: string, previous: string | null, ack: string): Promise<boolean> {
    const moved = await this.deps.prisma.externalMessagingBinding.updateMany({
      where: { id: bindingId, inboundCursor: previous },
      data: { inboundCursor: ack, retryAckCursor: null, retryCount: 0, retryFirstAt: null },
    });
    return moved.count > 0;
  }

  /** Counts a failed attempt on one message. True once it has failed too often or for too long. */
  private async registerRetry(bindingId: string, ack: string): Promise<boolean> {
    const binding = await this.deps.prisma.externalMessagingBinding.findUniqueOrThrow({
      where: { id: bindingId },
      select: { retryAckCursor: true, retryCount: true, retryFirstAt: true },
    });
    const now = this.now();
    const same = binding.retryAckCursor === ack;
    const count = same ? binding.retryCount + 1 : 1;
    const first = same && binding.retryFirstAt ? binding.retryFirstAt : now;
    await this.deps.prisma.externalMessagingBinding.update({
      where: { id: bindingId },
      data: { retryAckCursor: ack, retryCount: count, retryFirstAt: first, lastErrorCode: "external_accept_failed", lastErrorAt: now },
    });
    return count >= RETRY_LIMIT || now.getTime() - first.getTime() > RETRY_WINDOW_MS;
  }
}

export type { ExternalPollEntry };
