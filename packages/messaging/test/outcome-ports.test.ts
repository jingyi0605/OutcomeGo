import { expect, test } from "bun:test";
import type { Prisma } from "@outcomego/db";
import type { AgentMessaging } from "../src";
import { unavailableHumanActionPort } from "../src/outcome-actions";
import { enqueueOutcomeTurn, settleOutcomeWorkItem } from "../src/outcome-threads";

test("thread interfaces identify the owning implementation instead of claiming success", async () => {
  const tx = {} as Prisma.TransactionClient;
  await expect(enqueueOutcomeTurn(tx, {} as AgentMessaging, {
    workItemId: "fixture", content: "Continue", reason: "recovery", clientId: "fixture",
  })).rejects.toThrow("not implemented: owned by line 1 (004.2 task 3.2/3.4)");
  await expect(settleOutcomeWorkItem(tx, "fixture")).rejects.toThrow("not implemented: owned by line 1 (004.2 task 3.2/3.4)");
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
