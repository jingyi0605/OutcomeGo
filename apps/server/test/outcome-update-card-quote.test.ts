import { describe, expect, test } from "bun:test";
import { isOutcomeUpdateCardMetadata, OUTCOME_UPDATE_CARD_SOURCE } from "@outcomego/contracts/outcome-chat";
import { formatUserPrompt } from "../src/services/channel/formatting";

const card = {
  id: "11111111-1111-4111-8111-111111111111",
  sequence: 7n,
  sender: "system" as const,
  content: "Goal · Clean storage · attention",
  metadata: {
    type: "outcome-card",
    source: OUTCOME_UPDATE_CARD_SOURCE,
    outcomeCard: { stage: "attention", title: "Clean storage", outcomeId: "22222222-2222-4222-8222-222222222222", updatedAt: "2026-11-18T00:00:00.000Z" },
  },
};

describe("goal update card", () => {
  test("is recognised only when the platform posted it", () => {
    expect(isOutcomeUpdateCardMetadata(card.metadata)).toBe(true);
    expect(isOutcomeUpdateCardMetadata({ type: "outcome-card", outcomeCard: {} })).toBe(false);
    expect(isOutcomeUpdateCardMetadata(null)).toBe(false);
    expect(isOutcomeUpdateCardMetadata([])).toBe(false);
  });

  test("a quote gives the Bot the goal title and Outcome id", () => {
    const prompt = formatUserPrompt("A1", "what is blocking this?", card);
    expect(prompt).toContain('[In reply to 11111111-1111-4111-8111-111111111111: "Goal · Clean storage · attention"; goal notice for Outcome 22222222-2222-4222-8222-222222222222]');
    expect(prompt).toContain("what is blocking this?");
  });

  test("ordinary quotes are unchanged", () => {
    const prompt = formatUserPrompt("A1", "ok", { ...card, sender: "agent", metadata: { type: "text" } });
    expect(prompt).toContain('"Goal · Clean storage · attention"]');
    expect(prompt).not.toContain("goal notice");
  });
});
