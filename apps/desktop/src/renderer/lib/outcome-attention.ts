export type AttentionSurface = "planning" | "decision" | "review";
export interface AttentionSample { clientRequestId: string; surface: AttentionSurface; seconds: number }

/** Counts only visible, focused interaction and preserves delta identity until acknowledged. */
export class OutcomeAttentionTracker {
  private outcomeId?: string;
  private activeSince: number | null = null;
  private seconds = 0;
  private pending: Array<{ outcomeId: string; sample: AttentionSample }> = [];
  private draining = false;
  constructor(
    private surface: AttentionSurface,
    private send: (outcomeId: string, sample: AttentionSample) => Promise<unknown>,
    private now: () => number = () => performance.now(),
    private createId: () => string = () => crypto.randomUUID(),
  ) {}
  setActive(active: boolean) {
    this.collect();
    this.activeSince = active ? this.now() : null;
    if (!active) void this.flush();
  }
  attach(outcomeId: string) { this.outcomeId = outcomeId; void this.flush(); }
  private collect() {
    if (this.activeSince === null) return;
    const now = this.now();
    this.seconds += Math.max(0, now - this.activeSince) / 1000;
    this.activeSince = now;
  }
  async flush() {
    this.collect();
    if (this.outcomeId && this.seconds > 0) {
      while (this.seconds > 0) {
        const seconds = Math.min(this.seconds, 300);
        this.pending.push({ outcomeId: this.outcomeId, sample: { clientRequestId: `attention:${this.createId()}`, surface: this.surface, seconds } });
        this.seconds -= seconds;
      }
    }
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length) {
        const next = this.pending[0]!;
        try { await this.send(next.outcomeId, next.sample); } catch { break; }
        this.pending.shift();
      }
    } finally { this.draining = false; }
  }
}
