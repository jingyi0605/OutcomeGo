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

// Specs/004.10 task 2.7: a human task may carry a booked time and a deadline. Shape only here; the server decides
// whether they are real timestamps and whether the deadline precedes the start.
test("a human action may carry a booked time and a deadline, and both are optional", () => {
  const card = { title: "Inspect", purpose: "Collect real evidence", steps: ["Human checks the fixture"], evidenceRequirements: [{ criterionOrdinal: 1, label: "Log", kind: "text" }] };
  expect(humanActionInputSchema.parse(card)).not.toHaveProperty("scheduledAt");
  const dated = humanActionInputSchema.parse({ ...card, scheduledAt: "2026-12-01T09:00:00+08:00", dueAt: "2026-12-05T09:00:00Z" });
  expect(dated).toMatchObject({ scheduledAt: "2026-12-01T09:00:00+08:00", dueAt: "2026-12-05T09:00:00Z" });
  expect(humanActionInputSchema.safeParse({ ...card, scheduledAt: 5 }).success).toBe(false);
  expect(humanActionInputSchema.safeParse({ ...card, dueAt: "x".repeat(65) }).success).toBe(false);
  // Still strict: an unknown field is refused, so dates do not open the door to other client-supplied fields.
  expect(humanActionInputSchema.safeParse({ ...card, status: "accepted" }).success).toBe(false);
});

test("the tool schema the agent sees lists the two dates as optional", () => {
  const properties = REQUEST_HUMAN_ACTION_TOOL.inputSchema as unknown as { properties: Record<string, unknown>; required: string[] };
  expect(Object.keys(properties.properties)).toEqual(expect.arrayContaining(["scheduledAt", "dueAt"]));
  expect(properties.required).not.toContain("scheduledAt");
  expect(properties.required).not.toContain("dueAt");
});
