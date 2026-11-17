import type { DecisionResolution, DecisionView } from "@outcomego/contracts/outcome-inbox";
import type { InboxClient } from "./inbox-api";
import { OutcomeRequestIds } from "../planning/outcome-client";

export type DecisionPhase = "loading" | "ready" | "resolving" | "resolved" | "conflict" | "expired" | "error";
export interface DecisionState {
  phase: DecisionPhase;
  decision: DecisionView | null;
  optionId: string;
  customText: string;
  error: string | null;
  result: DecisionResolution | null;
}
export const responseStatus = (error: unknown): number | undefined =>
  error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
export const responseCode = (error: unknown): string | undefined =>
  error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
export const canResolveDecision = (decision: DecisionView | null) => Boolean(decision &&
  ["open", "presented"].includes(decision.status) &&
  (!decision.expiresAt || Date.parse(decision.expiresAt) > Date.now()));

/** Owns one card's request intent; transport retries retain the exact request ID. */
export class DecisionController {
  private state: DecisionState = { phase: "loading", decision: null, optionId: "", customText: "", error: null, result: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private ids = new OutcomeRequestIds();
  constructor(private client: Pick<InboxClient, "decision" | "resolve">, readonly id: string) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<DecisionState>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  edit(change: Partial<Pick<DecisionState, "optionId" | "customText">>) {
    if (this.state.phase !== "resolving") this.update(change);
  }
  dispose() { this.generation++; }
  async load(conflict = false) {
    const generation = ++this.generation;
    this.update({ phase: "loading", error: null });
    try {
      const decision = await this.client.decision(this.id);
      if (generation !== this.generation) return;
      const phase = decision.status === "resolved" ? "resolved" : !canResolveDecision(decision) ? "expired" : conflict ? "conflict" : "ready";
      this.update({ decision, phase });
    } catch (error) {
      if (generation === this.generation) this.update({ phase: "error", error: responseStatus(error) === 404 ? "This Decision is unavailable." : "Could not load the Decision. Try again." });
    }
  }
  async resolve() {
    const { decision, optionId, customText, phase } = this.state;
    if (phase === "resolving" || !canResolveDecision(decision)) return;
    const custom = optionId === "custom";
    if (custom ? !decision!.customEntryAllowed || !customText.trim() : !decision!.options.some(option => option.id === optionId)) return;
    const input = { expectedContractRevision: decision!.contractRevision, optionId: custom ? null : optionId, customText: custom ? customText : null };
    const generation = ++this.generation;
    this.update({ phase: "resolving", error: null });
    try {
      const result = await this.client.resolve(this.id, { ...input, clientRequestId: this.ids.for("decision", input) });
      if (generation !== this.generation) return;
      this.ids.complete("decision");
      this.update({ result, phase: "resolved", decision: this.state.decision ? { ...this.state.decision, status: result.status } : null });
    } catch (error) {
      if (generation !== this.generation) return;
      if ([409, 410].includes(responseStatus(error) ?? 0)) {
        await this.load(true);
        if (this.state.phase !== "error") this.update({ error: "This Decision changed. Review the refreshed card before submitting again." });
      } else this.update({ phase: "error", error: "The choice could not be confirmed. Retry to check the same request." });
    }
  }
}
