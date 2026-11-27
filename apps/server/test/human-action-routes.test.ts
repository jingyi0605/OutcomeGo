import { expect, test } from "bun:test";
import { humanWorkRoutes } from "../src/routes/human-work";
import { errorResponse } from "../src/http";
import type { RouteContext } from "../src/routes/context";
import type { HumanWorkService } from "../src/services/human-work-service";
import type { HumanReceiptService } from "../src/services/human-receipt-service";
import type { HumanKnowledgeService } from "../src/services/human-knowledge-service";

const outcomeId = crypto.randomUUID();
const workItemId = crypto.randomUUID();
const requests: unknown[] = [];
const dependencies = {
  humanReceipts: { submit: async (...args: unknown[]) => { requests.push(args); return { id: "receipt", status: "submitted" }; } } as unknown as HumanReceiptService,
  knowledge: {
    search: async (...args: unknown[]) => { requests.push(args); return []; },
    read: async (...args: unknown[]) => { requests.push(args); return { text: "Actual source", digest: "digest" }; },
  } as unknown as HumanKnowledgeService,
};
const ownerId = "persisted-owner";
const prisma = {
  session: { findUnique: async () => ({ userId: ownerId, expiresAt: new Date(Date.now() + 60_000) }) },
  outcome: { findFirst: async ({ where }: { where: { id: string; ownerId: string } }) =>
    where.id === outcomeId && where.ownerId === ownerId ? { id: outcomeId } : null },
  outcomeWorkItem: { findFirst: async ({ where }: { where: { id: string; outcome: { ownerId: string } } }) =>
    where.id === workItemId && where.outcome.ownerId === ownerId ? { id: workItemId } : null },
};
const route = async (path: string, input: unknown) => {
  const request = new Request(`http://fixture${path}`, { method: "POST", body: JSON.stringify(input) });
  try {
    return await humanWorkRoutes({
      request, path, url: new URL(request.url), authMode: "required", authenticatedSessionId: "session",
      app: { prisma },
    } as unknown as RouteContext, {} as HumanWorkService, dependencies);
  } catch (error) { return errorResponse(error); }
};

test("receipt HTTP dispatcher uses strict input and persisted session actor", async () => {
  const input = { clientRequestId: "receipt-http", expectedContractRevision: 1, text: "Observed" };
  const response = await route(`/api/work-items/${workItemId}/receipts`, input);
  expect(response?.status).toBe(201);
  expect(requests.at(-1)).toEqual([workItemId, {
    ...input, comment: "", assetRefs: [], sourceRefs: [], observations: [],
  }, "user:persisted-owner"]);
  expect((await route(`/api/work-items/${workItemId}/receipts`, { ...input, actor: "user:forged" }))?.status).toBe(400);
  expect((await route(`/api/work-items/${workItemId}/receipts`, { ...input, status: "accepted" }))?.status).toBe(400);
  const dispatched = requests.length;
  expect((await route(`/api/work-items/${crypto.randomUUID()}/receipts`, input))?.status).toBe(404);
  expect((await route(`/api/outcomes/${crypto.randomUUID()}/knowledge/search`, { text: "checklist" }))?.status).toBe(404);
  expect(requests).toHaveLength(dispatched);
});

test("knowledge HTTP dispatcher binds Outcome and passes search/read to production ports", async () => {
  expect((await route(`/api/outcomes/${outcomeId}/knowledge/search`, { text: "checklist" }))?.status).toBe(200);
  expect(requests.at(-1)).toEqual([outcomeId, { text: "checklist", limit: 20 }]);
  expect((await route(`/api/outcomes/${outcomeId}/knowledge/search`, { text: "checklist", root: "/private" }))?.status).toBe(400);
  const reference = { id: "message:linked" };
  const response = await route(`/api/outcomes/${outcomeId}/knowledge/read`, { reference });
  expect(await response?.json()).toEqual({ text: "Actual source", digest: "digest" });
  expect(requests.at(-1)).toEqual([outcomeId, reference]);
});
