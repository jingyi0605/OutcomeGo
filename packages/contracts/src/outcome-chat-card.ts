export const OUTCOME_CARD_STAGES = [
  "analyzing",
  "generating",
  "plan_ready",
  "draft",
  "ready",
  "running",
  "attention",
  "review",
  "accepted",
  "cancelled",
  "failed",
] as const;
export type OutcomeCardStage = (typeof OUTCOME_CARD_STAGES)[number];

export function outcomeCardStage(status: string): OutcomeCardStage {
  if (status === "accepted" || status === "cancelled" || status === "failed") return status;
  if (status === "review_pending") return "review";
  if (status === "approved") return "ready";
  if (status === "planning") return "generating";
  if (["decision_pending", "human_action_pending", "blocked", "paused"].includes(status))
    return "attention";
  if (["draft", "pending_approval"].includes(status)) return "draft";
  return status === "running" ? "running" : "attention";
}

export interface OutcomeChatCard {
  stage: OutcomeCardStage;
  title: string;
  summary?: string;
  outcomeId?: string;
  planId?: string;
  revision?: number;
  updatedAt: string;
  suggestions?: { goals: string[]; acceptance: string[]; boundaries: string[] };
}

export const OUTCOME_UPDATE_CARD_SOURCE = "outcome-update";

export function isOutcomeUpdateCardMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.type === "outcome-card" && record.source === OUTCOME_UPDATE_CARD_SOURCE;
}

export function parseOutcomeChatCard(value: unknown): OutcomeChatCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const card = value as OutcomeChatCard;
  if (
    !(OUTCOME_CARD_STAGES as readonly unknown[]).includes(card.stage) ||
    typeof card.title !== "string" ||
    typeof card.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(card.updatedAt))
  )
    return null;
  if (card.outcomeId !== undefined && typeof card.outcomeId !== "string") return null;
  if (card.planId !== undefined && typeof card.planId !== "string") return null;
  if (card.summary !== undefined && typeof card.summary !== "string") return null;
  if (
    card.suggestions !== undefined &&
    !["goals", "acceptance", "boundaries"].every(
      (key) =>
        Array.isArray(
          card.suggestions?.[key as keyof NonNullable<OutcomeChatCard["suggestions"]>]
        ) &&
        card.suggestions![key as keyof NonNullable<OutcomeChatCard["suggestions"]>].every(
          (text) => typeof text === "string"
        )
    )
  )
    return null;
  return card;
}
