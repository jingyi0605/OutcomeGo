import type { ChannelMessageView } from "@outcomego/contracts";
import { externalDraftReviewFields, externalDraftReviewState, mergeExternalDraftReviewFields } from "@outcomego/client-core/external-draft";
import type { ExternalDraft } from "@outcomego/contracts/external-draft";

export interface DraftReviewRecord {
  version: 1;
  message: ChannelMessageView;
  fields: Record<string, string>;
  pending: boolean;
  action?: "send" | "cancel";
}

export interface DraftReviewStorage {
  read(): Promise<unknown>;
  write(record: DraftReviewRecord): Promise<void>;
}

const metadata = (message: ChannelMessageView) =>
  (message.metadata ?? {}) as Record<string, unknown>;
export const draftReviewState = (message: ChannelMessageView) =>
  String(metadata(message).cardState ?? "pending");

/** A per-card journal; unresolved actions are reconciled, never replayed. */
export class DraftReviewJournal {
  record: DraftReviewRecord;
  running = false;
  attempt = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  constructor(
    private readonly storage: DraftReviewStorage,
    message: ChannelMessageView,
    fields: Record<string, string> = {}
  ) {
    this.record = { version: 1, message, fields, pending: false };
  }

  async restore() {
    const value = await this.storage.read() as DraftReviewRecord | null;
    if (value?.version !== 1 || value.message?.id !== this.record.message.id ||
      value.message.channelId !== this.record.message.channelId ||
      typeof value.pending !== "boolean" || !value.fields || typeof value.fields !== "object" ||
      Array.isArray(value.fields) ||
      Object.values(value.fields).some((field) => typeof field !== "string")) return;
    const incoming = this.record.message;
    this.record = value;
    this.observe(incoming);
    // A cached bootstrap is not evidence that the user's persisted edits changed.
    if (draftReviewState(incoming) !== "sent") this.record = { ...this.record, fields: value.fields };
    this.changed();
  }

  private persist() {
    const record = this.record;
    const write = this.tail.catch(() => undefined).then(() => this.storage.write(record));
    this.tail = write;
    return write;
  }

  edit(fields: Record<string, string>) {
    this.record = { ...this.record, fields };
    this.changed();
    return this.persist();
  }

  /** Persist intent before dispatch; a crash here is resolved by a read on restart. */
  async begin(action: "send" | "cancel") {
    if (this.record.pending || draftReviewState(this.record.message) !== "pending") return false;
    this.running = true;
    this.attempt++;
    this.record = { ...this.record, pending: true, action };
    this.changed();
    try {
      await this.persist();
    } catch (error) {
      this.running = false;
      throw error;
    }
    return true;
  }

  observe(message: ChannelMessageView) {
    if (message.id !== this.record.message.id || message.channelId !== this.record.message.channelId) return;
    const current = draftReviewState(this.record.message);
    const incoming = draftReviewState(message);
    if (externalDraftReviewState(current, incoming) !== incoming) return;
    const previousDraft = metadata(this.record.message).draft as ExternalDraft | undefined;
    const incomingDraft = metadata(message).draft as ExternalDraft | undefined;
    const fields = incomingDraft && incoming === "sent"
      ? { ...externalDraftReviewFields(incomingDraft) }
      : previousDraft && incomingDraft ? { ...mergeExternalDraftReviewFields(
        externalDraftReviewFields(previousDraft),
        { ...externalDraftReviewFields(previousDraft), ...this.record.fields },
        externalDraftReviewFields(incomingDraft)
      ) }
      : this.record.fields;
    this.record = { ...this.record, message, fields };
    this.changed();
  }

  /** Only a server read or mutation response resolves a pending action. */
  async acknowledge(message: ChannelMessageView) {
    if (message.id !== this.record.message.id || message.channelId !== this.record.message.channelId)
      throw new Error("Draft response belongs to another message");
    this.observe(message);
    this.record = { ...this.record, pending: draftReviewState(this.record.message) === "sending" };
    this.changed();
    await this.persist();
  }
}
