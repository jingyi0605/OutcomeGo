import { OutcomeError } from "@outcomego/contracts/outcomes";
import type { Prisma } from "@outcomego/db";
export type { DecisionEffect } from "@outcomego/contracts/outcomes";

/** The shared input to the line 4 action-card builder (004.4 design §32). */
export interface HumanActionInput {
  title: string;
  purpose: string;
  steps: readonly string[];
  evidenceRequirements: ReadonlyArray<{
    criterionOrdinal: number;
    label: string;
    kind: "text" | "asset" | "sourceReference" | "observation";
  }>;
  referenceIds?: readonly string[];
}

export interface HumanActionResult {
  workItemId: string;
  cardId: string;
}

/** Both entry points write their facts/events in the caller's transaction; implemented by line 4. */
export interface HumanActionPort {
  createFromDecision(tx: Prisma.TransactionClient, input: {
    outcomeId: string;
    decisionId: string;
    requestedByWorkItemId: string;
    card: HumanActionInput;
  }): Promise<HumanActionResult>;
  createFromAgentRequest(tx: Prisma.TransactionClient, input: {
    runId: string;
    workItemId: string;
    input: HumanActionInput;
  }): Promise<HumanActionResult>;
}

const unavailable = async (): Promise<never> => {
  throw new OutcomeError("manual_action_unavailable", "Human action support has not been registered");
};

/** An absent provider must fail explicitly, never report an uncreated human action as successful. */
export const unavailableHumanActionPort: HumanActionPort = {
  createFromDecision: unavailable,
  createFromAgentRequest: unavailable,
};
