export type { OutcomeClient } from "../../../../client/outcome-api";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { OUTCOME_LIMITS, type ContractRevisionView } from "@outcomego/contracts/outcomes";

/** Generate choices for a revision; never approve an instruction or mutate the saved plan. */
export function planOutcomeChanges(
  client: OutcomeClient,
  revision: ContractRevisionView,
  request: string
) {
  const sourceText = JSON.stringify({
    task: "Suggest a revised goal, acceptance criteria and scope from the owner's requested changes. Keep unaffected requirements. Do not execute or approve anything.",
    requestedChanges: request,
    savedPlan: {
      goal: revision.goal,
      acceptance: revision.criteria.map((item) => ({
        statement: item.statement,
        required: item.required,
      })),
      boundaries: revision.boundaries,
      budget: revision.budget,
    },
  });
  if (sourceText.length > OUTCOME_LIMITS.sourceTextChars)
    throw new Error(
      "The saved plan is too long for this planning step. Edit it in supporting records instead."
    );
  return client.plan({
    sourceText,
    context: { botId: revision.executionBotId },
    clientRequestId: `plan-change:${crypto.randomUUID()}`,
  });
}

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
  complete(action: string): void {
    this.requests.delete(action);
  }
}
export const outcomeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed. Try again.";
