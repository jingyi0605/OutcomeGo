import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { outcomeRoutes } from "../src/routes/outcome";
import { errorResponse } from "../src/http";
import { OutcomeReviewService } from "../src/services/outcome-review-service";
import { OutcomeThreadService } from "../src/services/outcome-thread-service";
import type { AgentMessaging } from "@outcomego/messaging";
import type { RouteContext } from "../src/routes/context";
import { outcomeFixture, testDatabaseUrl, requestId } from "./fixtures/outcome-fixture";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeService } from "../src/services/outcome-service";

// The production authentication gate must run before every feature route.
test("main registers Outcome behind the existing authentication middleware", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  expect(main.indexOf('const session = await auth.api.getSession')).toBeLessThan(main.indexOf('const context: RouteContext'));
  expect(main).toContain("        outcomeRoutes,");
  expect(main).toContain('if (authMode === "required" && !publicCallback && !voiceStreamPath)');
  expect(main).toMatch(/if \(!session\) \{[\s\S]*?code: "unauthorized"[\s\S]*?401/);
});

describe.skipIf(!testDatabaseUrl)("Outcome HTTP routes", () => {
  const f = outcomeFixture();
  const reviews = new OutcomeReviewService(f.prisma, {} as AgentMessaging, async () => { throw new Error("offline"); });
  const app = { prisma: f.prisma, outcomes: f.outcomes, outcomeThreads: {} as OutcomeThreadService, outcomeReviews: reviews };
  afterAll(() => f.close());
  async function call(path: string, method = "GET", body?: unknown, authMode: "required" | "disabled" = "disabled", sessionId: string | null = null) {
    const url = new URL(`http://localhost/api/v0${path}`);
    const request = new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
    try { return (await outcomeRoutes({ app, request, url, path: url.pathname.replace("/api/v0", "/api"), authMode, authenticatedSessionId: sessionId } as unknown as RouteContext))!; }
    catch (error) { return errorResponse(error); }
  }
  test("goal thread creation, contract approval, and reads preserve the owner and response shapes", async () => {
    const fixture = await outcomeThreadFixture();
    const original = app.outcomeThreads;
    const previous = await fixture.db.featureSettings.findUnique({ where: { id: "global" } });
    const input = { text: "  Compare backups\nCompare costs  ", botId: fixture.bot.id, clientRequestId: requestId() };
    app.outcomeThreads = new OutcomeThreadService(fixture.db, fixture.messaging, f.outcomes);
    try {
      await fixture.db.featureSettings.upsert({
        where: { id: "global" },
        create: { id: "global", outcomesEnabled: true },
        update: { outcomesEnabled: true },
      });
      const created = await call("/outcomes/threads", "POST", input);
      expect(created.status).toBe(202);
      const { outcome, turn } = await created.json() as { outcome: { id: string }; turn: { id: string } };
      expect(turn).toMatchObject({ trigger: input.text, purpose: "plan", status: "queued" });
      expect(await (await call(`/outcomes/${outcome.id}/thread`)).json()).toMatchObject({ turns: [turn] });
      expect(await (await call("/outcomes/threads", "POST", input)).json()).toMatchObject({ outcome: { id: outcome.id }, turn });
      const revision = await Effect.runPromise(f.outcomes.saveAgentContract(outcome.id, {
        title: "Comparison",
        goal: ["Compare backups"],
        acceptance: [{ statement: "Compare costs", required: true }],
        boundaries: { included: [], excluded: [] },
        clientRequestId: requestId(),
      }, `bot:${fixture.bot.id}`));
      expect(revision.currentRevisionView).toMatchObject({ revision: 1, status: "pending_approval" });
      // Approval waits for the planner turn to end, so settle it before the owner approves.
      await fixture.db.outcomeThreadTurn.updateMany({ where: { thread: { outcomeId: outcome.id }, status: { in: ["queued", "running"] } }, data: { status: "completed" } });
      await fixture.db.$transaction((tx) => f.outcomes.recomputeStatus(tx, outcome.id, "system:test"));
      const approve ={ expectedRevision: 1, confirmationText: "I confirm", actorRef: "bot:forged", approvedBy: "forged", clientRequestId: requestId() };
      const approved = await call(`/outcomes/${outcome.id}/revisions/1/approve`, "POST", approve);
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({ currentRevisionView: { approvedBy: "owner:local" } });
      const list = await (await call("/outcomes?limit=1")).json();
      expect(list).toHaveProperty("items");
      expect(list).toHaveProperty("nextCursor");
      const detail = await (await call(`/outcomes/${outcome.id}`)).json();
      expect(detail).toHaveProperty("evidence");
      expect(detail).toHaveProperty("reviews");
    } finally {
      app.outcomeThreads = original;
      if (previous) await fixture.db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: previous.outcomesEnabled } });
      else await fixture.db.featureSettings.deleteMany({ where: { id: "global" } });
      await fixture.db.idempotencyRecord.deleteMany({ where: { scope: "outcome-thread-create", key: input.clientRequestId } });
      await fixture.cleanup();
    }
  });
  test("unauthenticated requests are rejected, missing resources and query errors use ApiError envelope", async () => {
    expect((await call("/outcomes", "GET", undefined, "required", "missing-session")).status).toBe(401);
    const missing = await call(`/outcomes/${crypto.randomUUID()}`); expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "outcome_not_found", details: { retryable: false } } });
    const invalid = await call("/outcomes?status=fabricated"); expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_outcome_query" } });
    expect((await call("/outcomes/threads", "POST", { text: "" })).status).toBe(400);
  });
  test("session actors come from persisted authentication, ignoring forged reviewer fields", async () => {
    const userId = `user-${crypto.randomUUID()}`, sessionId = `session-${crypto.randomUUID()}`;
    await f.prisma.user.create({ data: { id: userId, name: "Test owner", email: `${userId}@example.test`, sessions: { create: { id: sessionId, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) } } } });
    try {
      const x = await f.completed();
      const response = await call(`/outcomes/${x.outcome.id}/reviews`, "POST", { expectedRevision: 1, results: [{ criterionId: x.required.id, result: "PASS", evidenceIds: [], comment: "Checked", userConfirmed: true, reviewedBy: "bot:forged" }], actorRef: "owner:forged", clientRequestId: requestId() }, "required", sessionId);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ reviews: [{ reviewedBy: `user:${userId}` }] });
    } finally { await f.prisma.user.delete({ where: { id: userId } }); }
  });
  test("review is wired to the single service entry, deduplicates client IDs, and cancellation preserves facts", async () => {
    const x = await f.completed();
    const input = { expectedRevision: 1, results: [{ criterionId: x.required.id, result: "FAIL", evidenceIds: [], comment: "Missing comparison" }], clientRequestId: requestId() };
    const result = await call(`/outcomes/${x.outcome.id}/reviews`, "POST", input); expect(result.status).toBe(200);
    const first = await result.json();
    expect(await (await call(`/outcomes/${x.outcome.id}/reviews`, "POST", input)).json()).toEqual(first);
    const cancelled = await call(`/outcomes/${x.outcome.id}/cancel`, "POST", { clientRequestId: requestId() });
    expect(await cancelled.json()).toMatchObject({ status: "cancelled", outputs: [{ id: x.output.id }] });
  });
  test("run and transcript routes dispatch the real runtime and reject absent messaging", async () => {
    const h = await outcomeThreadFixture();
    const original = app.outcomes;
    app.outcomes = new OutcomeService(h.db, h.messaging);
    try {
      const response = await call(`/outcomes/${h.outcome.id}/runs`, "POST", { expectedRevision: 1, clientRequestId: requestId() });
      expect(response.status).toBe(202);
      const detail = await response.json() as { workItems: { id: string; rootRunId: string }[] };
      const item = detail.workItems[0]!;
      expect(await h.db.run.count({ where: { id: item.rootRunId, origin: "outcome" } })).toBe(1);
      const transcript = await call(`/outcomes/${h.outcome.id}/work-items/${item.id}/transcript?limit=10`);
      expect(await transcript.json()).toMatchObject({ total: 1, next_before: null, rows: [{ role: "user", status: "completed" }] });
      app.outcomes = new OutcomeService(h.db);
      const unavailable = await call(`/outcomes/${h.outcome.id}/runs`, "POST", { expectedRevision: 1, clientRequestId: requestId() });
      expect(unavailable.status).toBe(409);
      expect(await unavailable.json()).toMatchObject({ error: { code: "bot_not_runnable", details: { retryable: true } } });
    } finally { app.outcomes = original; await h.cleanup(); }
  });
});
