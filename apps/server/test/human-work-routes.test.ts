import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import type { AppService } from "../src/app-service";
import { errorResponse } from "../src/http";
import { humanWorkRoutes } from "../src/routes/human-work";
import { HumanWorkService } from "../src/services/human-work-service";
import { humanWorkScenario } from "./human-work-fixtures";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("human action card routes", () => {
  const prisma = createPrismaClient(url!);
  const service = new HumanWorkService(prisma);
  const bots: string[] = [];
  const users: string[] = [];
  const scenario = async () => {
    const result = await humanWorkScenario(prisma, service);
    bots.push(result.bot.id);
    return result;
  };
  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  const request = async (method: string, path: string, input?: unknown, sessionId: string | null = null) => {
    const req = new Request(`http://fixture${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    try {
      return await humanWorkRoutes({
        app: { prisma } as AppService, request: req, url: new URL(req.url),
        path: new URL(req.url).pathname.replace(/^\/api\/v0(?=\/|$)/, "/api"),
        authMode: sessionId ? "required" : "disabled", authenticatedSessionId: sessionId,
      }, service);
    } catch (error) { return errorResponse(error); }
  };
  const start = () => ({ clientRequestId: crypto.randomUUID(), expectedContractRevision: 1 });
  const pause = () => ({ ...start(), currentStepId: "step-1", draftSummary: "Checked DHCP", readReferenceIds: [], reason: "Site access interrupted" });

  test("list/detail/start/pause and reopen return persisted cards; list filters include Agent work", async () => {
    const { outcome, card } = await scenario();
    const listed = await request("GET", `/api/v0/outcomes/${outcome.id}/work-items`);
    expect(listed?.status).toBe(200);
    expect(await listed?.json()).toHaveLength(2);
    const filtered = await request("GET", `/api/v0/outcomes/${outcome.id}/work-items?executorType=human&status=ready`);
    expect(await filtered?.json()).toHaveLength(1);
    const read = await request("GET", `/api/v0/work-items/${card.workItemId}`);
    expect(await read?.json()).toMatchObject({ status: "ready", evidenceCount: 0, nextAction: "start" });
    const started = await request("POST", `/api/v0/work-items/${card.workItemId}/start`, start());
    expect(await started?.json()).toMatchObject({ status: "in_progress", card: { startedBy: "owner:local" } });
    const paused = await request("POST", `/api/v0/work-items/${card.workItemId}/pause`, pause());
    expect(await paused?.json()).toMatchObject({ status: "paused", card: { draft: { draftSummary: "Checked DHCP" } } });
    const reopened = await request("GET", `/api/v0/work-items/${card.workItemId}`);
    expect(await reopened?.json()).toMatchObject({ status: "paused", card: { draft: { currentStepId: "step-1" } } });
  });
  test("revision conflicts, invalid requests/statuses and forged actor/final state are rejected", async () => {
    const { outcome, card } = await scenario();
    const path = `/api/v0/work-items/${card.workItemId}/start`;
    expect((await request("POST", path, { ...start(), expectedContractRevision: 9 }))?.status).toBe(409);
    expect((await request("POST", path, { ...start(), actorRef: "user:forged" }))?.status).toBe(400);
    expect((await request("POST", path, { ...start(), status: "accepted" }))?.status).toBe(400);
    expect((await request("POST", path, {}))?.status).toBe(400);
    expect((await request("GET", `/api/v0/outcomes/${outcome.id}/work-items?status=Succeeded`))?.status).toBe(400);
    expect((await request("GET", `/api/v0/work-items/${crypto.randomUUID()}`))?.status).toBe(404);
    expect((await request("GET", "/api/v0/work-items/not-a-uuid"))?.status).toBe(400);
    expect((await request("POST", `/api/v0/work-items/${card.workItemId}/receipts`, {}))?.status).toBe(503);
    expect(await request("POST", `/api/v0/work-items/${card.workItemId}/accept`, {})).toBeUndefined();
    expect((await service.detail(card.workItemId)).status).toBe("ready");
  });
  test("same request key concurrency produces one start with original startedAt; pause conflicts return 409", async () => {
    const { card } = await scenario();
    const input = start();
    const path = `/api/v0/work-items/${card.workItemId}`;
    const replies = await Promise.all([request("POST", `${path}/start`, input), request("POST", `${path}/start`, input)]);
    expect(replies.map((response) => response?.status)).toEqual([200, 200]);
    const [first, second] = await Promise.all(replies.map((response) => response!.json()));
    expect(first.startedAt).toBe(second.startedAt);
    const draft = pause();
    expect((await request("POST", `${path}/pause`, draft))?.status).toBe(200);
    const conflict = await request("POST", `${path}/pause`, { ...draft, reason: "Changed" });
    expect(conflict?.status).toBe(409);
    expect(await conflict?.json()).toMatchObject({ error: { code: "receipt_idempotency_conflict" } });
  });
  test("authenticated actors come from persisted session and absent sessions cannot mutate", async () => {
    const { outcome, card } = await scenario();
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), name: "Synthetic owner", email: `${crypto.randomUUID()}@example.invalid` } });
    users.push(user.id);
    const session = await prisma.session.create({ data: {
      id: crypto.randomUUID(), userId: user.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    } });
    const path = `/api/v0/work-items/${card.workItemId}/start`;
    expect((await request("POST", path, start(), "missing-session"))?.status).toBe(401);
    expect((await request("POST", path, start(), session.id))?.status).toBe(404);
    expect((await service.detail(card.workItemId)).status).toBe("ready");
    await prisma.outcome.update({ where: { id: outcome.id }, data: { ownerId: user.id } });
    const response = await request("POST", path, start(), session.id);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ card: { startedBy: `user:${user.id}` } });
  });
  test("pause excludes arbitrary payloads and non-card steps from saved drafts", async () => {
    const { card } = await scenario();
    const path = `/api/v0/work-items/${card.workItemId}`;
    await request("POST", `${path}/start`, start());
    expect((await request("POST", `${path}/pause`, { ...pause(), formPayload: { secret: "synthetic-not-saved" } }))?.status).toBe(400);
    expect((await request("POST", `${path}/pause`, { ...pause(), currentStepId: "foreign-step" }))?.status).toBe(400);
    expect((await service.detail(card.workItemId)).card?.draft).toBeNull();
  });
});
