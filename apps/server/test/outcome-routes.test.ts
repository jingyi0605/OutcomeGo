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
import { OutcomeScheduleService } from "../src/services/outcome-schedule-service";

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
  const app = { prisma: f.prisma, outcomes: f.outcomes, outcomeThreads: {} as OutcomeThreadService, outcomeReviews: reviews, outcomeSchedule: undefined as unknown as OutcomeScheduleService };
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
  // Specs/004.10 task 2.6: the owner's schedule and deadline endpoints.
  test("schedule and deadline routes change dates for the owner and report refusals with their codes", async () => {
    const h = await outcomeThreadFixture();
    const original = app.outcomeSchedule;
    app.outcomeSchedule = new OutcomeScheduleService(h.db, new OutcomeService(h.db, h.messaging), h.messaging);
    try {
      const item = await h.item(1);
      const when = new Date(Date.now() + 3_600_000).toISOString();
      const put = (path: string, body: unknown) => call(path, "PUT", body);

      const moved = await put(`/outcomes/${h.outcome.id}/work-items/${item.id}/schedule`, { scheduledAt: when, estimateMinutes: 30, clientRequestId: requestId() });
      expect(moved.status).toBe(200);
      expect(await moved.json()).toMatchObject({ workItems: [{ id: item.id, scheduledAt: when, estimateMinutes: 30 }] });

      const bad = await put(`/outcomes/${h.outcome.id}/work-items/${item.id}/schedule`, { scheduledAt: "soon", clientRequestId: requestId() });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ error: { code: "invalid_schedule" } });

      const malformed = await put(`/outcomes/${h.outcome.id}/work-items/${item.id}/schedule`, { scheduledAt: 7, clientRequestId: requestId() });
      expect(malformed.status).toBe(400);

      const due = new Date(Date.now() + 86_400_000).toISOString();
      const deadline = await put(`/outcomes/${h.outcome.id}/due`, { dueAt: due, clientRequestId: requestId() });
      expect(deadline.status).toBe(200);
      expect(await deadline.json()).toMatchObject({ dueAt: due });
      const cleared = await put(`/outcomes/${h.outcome.id}/due`, { dueAt: null, clientRequestId: requestId() });
      expect(await cleared.json()).toMatchObject({ dueAt: null });

      await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { status: "running" } });
      const started = await put(`/outcomes/${h.outcome.id}/work-items/${item.id}/schedule`, { scheduledAt: when, clientRequestId: requestId() });
      expect(started.status).toBe(409);
      expect(await started.json()).toMatchObject({ error: { code: "schedule_not_editable" } });

      // Only PUT is handled. Any other method falls through to the other routes and finds nothing, so nothing changes.
      expect(await call(`/outcomes/${h.outcome.id}/due`, "POST", { dueAt: due, clientRequestId: requestId() })).toBeUndefined();
      expect(await call(`/outcomes/${h.outcome.id}/work-items/${item.id}/schedule`, "GET")).toBeUndefined();
    } finally { app.outcomeSchedule = original; await h.cleanup(); }
  });

});
