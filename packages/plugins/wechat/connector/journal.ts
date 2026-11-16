import type { WechatInboundMessage } from "./protocol";
import { STATE_VERSION, type StateStore } from "./state";

/**
 * The batch being worked on, written before any media is touched (design §2.3.2). It holds exactly what
 * is needed to finish the batch after a crash: the provider's messages with their reply and media
 * credentials, the cursor to move to, and when the batch was received.
 *
 * It exists only in the connector's private state directory. It never goes into a tool result, a log,
 * or the Server's database.
 */
export interface ReceiveJournal {
  version: typeof STATE_VERSION;
  /** The account the batch belongs to; a journal from another account is discarded. */
  ilinkBotId: string;
  /** The queue the batch is entering; a rebuilt queue means the journal no longer applies. */
  queueId: string;
  /** Stable receive time: the fallback send time, and what a replayed reply-window is measured from. */
  receivedAt: string;
  /** The cursor to save once the batch is fully queued; null when the response carried none. */
  nextBuffer: string | null;
  messages: WechatInboundMessage[];
}

const JOURNAL = "receive-journal.json";

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseJournal = (value: unknown): ReceiveJournal | null => {
  const source = object(value);
  if (!source || source.version !== STATE_VERSION) return null;
  if (typeof source.ilinkBotId !== "string" || typeof source.queueId !== "string" || !source.ilinkBotId || !source.queueId) return null;
  if (typeof source.receivedAt !== "string" || Number.isNaN(Date.parse(source.receivedAt))) return null;
  if (source.nextBuffer !== null && typeof source.nextBuffer !== "string") return null;
  if (!Array.isArray(source.messages)) return null;
  const messages: WechatInboundMessage[] = [];
  for (const entry of source.messages) {
    const message = object(entry);
    if (!message || typeof message.messageId !== "string" || typeof message.fromUserId !== "string" || !Array.isArray(message.items)) return null;
    // Stored by this connector, so the shape is trusted once the identifying fields check out.
    messages.push(message as unknown as WechatInboundMessage);
  }
  return { version: STATE_VERSION, ilinkBotId: source.ilinkBotId, queueId: source.queueId, receivedAt: source.receivedAt, nextBuffer: source.nextBuffer as string | null, messages };
};

/** Reads and writes the journal through the store's atomic, fsynced, owner-only write. */
export class JournalStore {
  constructor(private readonly store: StateStore) {}

  /** Durable before it returns: from here the batch survives a crash. */
  async write(journal: Omit<ReceiveJournal, "version">): Promise<void> {
    await this.store.writeJson(JOURNAL, { version: STATE_VERSION, ...journal });
  }

  /** The pending batch, or null when there is none or it is unusable (which is set aside, not dropped). */
  async read(): Promise<ReceiveJournal | null> {
    const raw = await Bun.file(this.store.path(JOURNAL)).text().catch(() => null);
    if (raw === null) return null;
    try {
      const parsed = parseJournal(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      // Falls through to quarantine.
    }
    await Bun.write(this.store.path(`${JOURNAL}.corrupt`), raw);
    await this.store.remove(JOURNAL);
    return null;
  }

  /** Removed only after the cursor is saved and the batch is queued. */
  async clear(): Promise<void> {
    await this.store.remove(JOURNAL);
  }
}
