import { expect, test } from "bun:test";
import { humanActionInputSchema, humanReceiptSchema, humanKnowledgeSearchSchema, REQUEST_HUMAN_ACTION_TOOL } from "../src/human-work";

test("human action arguments accept the frozen card and reject client-supplied status or actor", () => {
  const card = { title: "Inspect", purpose: "Collect real evidence", steps: ["Human checks the fixture"], evidenceRequirements: [{ criterionOrdinal: 1, label: "Log", kind: "text" }] };
  expect(humanActionInputSchema.safeParse(card).success).toBe(true);
  expect(humanActionInputSchema.safeParse({ ...card, actorRef: "owner:forged" }).success).toBe(false);
  expect(REQUEST_HUMAN_ACTION_TOOL.inputSchema.required).toContain("evidenceRequirements");
});
test("receipt material input is bounded, strict and defaults optional materials", () => {
  const request = { clientRequestId: "receipt:fixture:1", expectedContractRevision: 1 };
  expect(humanReceiptSchema.parse(request)).toMatchObject({ text: "", comment: "", assetRefs: [], observations: [], sourceRefs: [] });
  expect(humanReceiptSchema.safeParse({ ...request, assetRefs: ["file:///private/example"] }).success).toBe(false);
  expect(humanReceiptSchema.safeParse({ ...request, submittedBy: "user:forged", status: "accepted" }).success).toBe(false);
  expect(humanKnowledgeSearchSchema.parse({ text: "network" }).limit).toBe(20);
});
