import { MAX_REPLY_PREVIEW_CHARS } from "@outcomego/contracts";

export const RICH_REPLY_TOOL = "SendRichMessageToUser";

const UPDATE_INTERVAL_MS = 150;

export class ReplyPreviewPublisher {
  private pending?: { callId: string; content: string };
  private last?: { callId: string; content: string };
  private timer?: ReturnType<typeof setTimeout>;
  private sending?: Promise<void>;
  private nextUpdate = 0;

  constructor(private readonly send: (callId: string, content: string | null) => Promise<void>) {}

  observe(callId: string, content: unknown): void {
    if (typeof content !== "string" || !content.trim()) return;
    const text = content.slice(0, MAX_REPLY_PREVIEW_CHARS).replace(/[\uD800-\uDBFF]$/, "");
    if (!text || this.last?.callId === callId && this.last.content === text) return;
    this.pending = { callId, content: text };
    this.schedule();
  }

  finish(callId: string, discard: boolean): void {
    if (this.pending?.callId === callId) this.pending = undefined;
    if (this.last?.callId !== callId) return;
    if (discard) {
      this.last = undefined;
      const settled = this.sending ?? Promise.resolve();
      void settled.then(() => this.send(callId, null)).catch(() => undefined);
    }
  }

  stop(discard = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    if (discard && this.last) this.finish(this.last.callId, true);
  }

  private schedule(): void {
    if (this.sending || this.timer || !this.pending) return;
    const delay = this.nextUpdate - Date.now();
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.schedule();
      }, delay);
      return;
    }
    const update = this.pending;
    this.pending = undefined;
    this.last = update;
    this.nextUpdate = Date.now() + UPDATE_INTERVAL_MS;
    this.sending = this.send(update.callId, update.content).catch(() => undefined).finally(() => {
      this.sending = undefined;
      this.schedule();
    });
  }
}
