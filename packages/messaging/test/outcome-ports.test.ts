import { expect, test } from "bun:test";
import type { Prisma } from "@outcomego/db";
import type { AgentMessaging } from "../src";
import { unavailableHumanActionPort } from "../src/outcome-actions";
import { enqueueOutcomeTurn, settleOutcomeWorkItem } from "../src/outcome-threads";

test("implemented thread interfaces reject missing work and ignore ordinary runs", async () => {
  const tx = { outcomeWorkItem: { findUnique: async () => null }, run: { findUnique: async () => null } } as unknown as Prisma.TransactionClient;
  await expect(enqueueOutcomeTurn(tx, {} as AgentMessaging, {
    workItemId: "fixture", content: "Continue", reason: "recovery", clientId: "fixture",
  })).rejects.toMatchObject({ code: "work_item_not_found" });
  await expect(settleOutcomeWorkItem(tx, "fixture")).resolves.toBeUndefined();
});

test("both missing human-action entry points fail explicitly", async () => {
  const tx = {} as Prisma.TransactionClient;
  const card = { title: "Fixture", purpose: "Fixture", steps: ["Inspect"], evidenceRequirements: [] };
  await expect(unavailableHumanActionPort.createFromDecision(tx, {
    outcomeId: "fixture", decisionId: "fixture", requestedByWorkItemId: "fixture", card,
  })).rejects.toMatchObject({ code: "manual_action_unavailable", status: 503 });
  await expect(unavailableHumanActionPort.createFromAgentRequest(tx, {
    runId: "fixture", workItemId: "fixture", input: card,
  })).rejects.toMatchObject({ code: "manual_action_unavailable", status: 503 });
});
