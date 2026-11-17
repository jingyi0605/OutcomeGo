export type { OutcomeClient } from "../../../../client/outcome-api";

/** Retain the request ID after ambiguous failures; edits form a new request intent. */
export class OutcomeRequestIds {
  private requests = new Map<string, { content: string; id: string }>();
  for(action: string, input: unknown): string {
    const content = JSON.stringify(input);
    const prior = this.requests.get(action);
    if (prior?.content === content) return prior.id;
    const id = `${action}:${crypto.randomUUID()}`;
    this.requests.set(action, { content, id });
    return id;
  }
  complete(action: string): void { this.requests.delete(action); }
}
export const outcomeErrorMessage = (error: unknown) => error instanceof Error ? error.message : "The request failed. Try again.";
