import type { ReplyPreview, ReplyPreviewSnapshot } from "@outcomego/contracts";
import type { PrismaClient } from "@outcomego/db";

const PREVIEW_TTL_MS = 15_000;
const IDLE_WAIT_MS = 15_000;
const ACTIVE_WAIT_MS = 1_000;

type Entry = {
  preview: ReplyPreview;
  inboxId: string;
  attempt: number;
  revision: string;
  committed: boolean;
  timer: ReturnType<typeof setTimeout>;
};

export class ReplyPreviews {
  private readonly entries = new Map<string, Entry>();
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private readonly db: Pick<PrismaClient, "run">) {}

  clear(): void {
    for (const [channelId, entry] of this.entries) this.remove(channelId, entry);
  }

  publish(channelId: string, inboxId: string, attempt: number, preview: ReplyPreview): void {
    const entry = this.entries.get(channelId);
    if (entry?.preview.runId === preview.runId && entry.preview.clientId === preview.clientId &&
        entry.inboxId === inboxId && entry.attempt === attempt &&
        (entry.committed || entry.preview.content === preview.content)) return;
    this.set(channelId, inboxId, attempt, preview, false);
  }

  commit(channelId: string, runId: string, callId: string): void {
    const entry = this.entries.get(channelId);
    if (entry?.preview.runId === runId && entry.preview.clientId === `tool:${callId}`)
      this.set(channelId, entry.inboxId, entry.attempt, entry.preview, true);
  }

  discard(channelId: string, inboxId: string, attempt: number, clientId: string): void {
    const entry = this.entries.get(channelId);
    if (entry?.inboxId === inboxId && entry.attempt === attempt && entry.preview.clientId === clientId && !entry.committed)
      this.remove(channelId, entry);
  }

  async poll(channelId: string, after: string, signal: AbortSignal): Promise<ReplyPreviewSnapshot> {
    const entry = this.entries.get(channelId);
    if ((entry?.revision ?? "") === after)
      await this.wait(channelId, signal, entry && !entry.committed ? ACTIVE_WAIT_MS : IDLE_WAIT_MS);
    const current = this.entries.get(channelId);
    if (!current || signal.aborted) return { revision: "", preview: null };
    const allowed = await this.db.run.findFirst({
      where: {
        id: current.preview.runId,
        inboxEvents: { some: { id: current.inboxId, attempts: current.attempt } },
        channelId,
        ...(current.committed ? {} : { status: "running" }),
        bot: { status: "active" },
        channel: { kind: "bot_dm", archivedAt: null, members: { some: { bot: { status: "active" } } } },
      },
      select: { id: true },
    });
    if (!allowed) {
      this.remove(channelId, current);
      return { revision: "", preview: null };
    }
    const latest = this.entries.get(channelId);
    if (!latest || latest.inboxId !== current.inboxId || latest.attempt !== current.attempt || signal.aborted)
      return { revision: "", preview: null };
    return { revision: latest.revision, preview: latest.preview };
  }

  private set(channelId: string, inboxId: string, attempt: number, preview: ReplyPreview, committed: boolean): void {
    const previous = this.entries.get(channelId);
    if (previous) clearTimeout(previous.timer);
    const entry: Entry = {
      inboxId, attempt, preview, committed,
      revision: crypto.randomUUID(),
      timer: setTimeout(() => this.remove(channelId, entry), PREVIEW_TTL_MS),
    };
    entry.timer.unref();
    this.entries.set(channelId, entry);
    this.wake(channelId);
  }

  private remove(channelId: string, entry: Entry): void {
    if (this.entries.get(channelId) !== entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(channelId);
    this.wake(channelId);
  }

  private wake(channelId: string): void {
    for (const finish of this.waiters.get(channelId) ?? []) finish();
  }

  private wait(channelId: string, signal: AbortSignal, timeoutMs: number): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const waiters = this.waiters.get(channelId) ?? new Set<() => void>();
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        waiters.delete(finish);
        if (!waiters.size) this.waiters.delete(channelId);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref();
      waiters.add(finish);
      this.waiters.set(channelId, waiters);
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}
