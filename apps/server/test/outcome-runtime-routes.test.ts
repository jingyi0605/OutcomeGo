import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { errorResponse } from "../src/http";
import { outcomeRoutes } from "../src/routes/outcome";
import { exploreRoutes } from "../src/routes/explore";
import type { RouteContext } from "../src/routes/context";
import type { ExploreService } from "../src/services/explore-service";

const id = "00000000-0000-0000-0000-000000000001";
const originalFlag = process.env.OUTCOMEGO_OUTCOMES_ENABLED;
afterEach(() => {
  if (originalFlag === undefined) delete process.env.OUTCOMEGO_OUTCOMES_ENABLED;
  else process.env.OUTCOMEGO_OUTCOMES_ENABLED = originalFlag;
});
const calls: unknown[][] = [];
const method = (name: string) => (...args: unknown[]) => {
  calls.push([name, ...args]);
  return Effect.succeed({ method: name });
};
const app = {
  outcomes: { get: method("detail"), cancel: method("cancel"), startRun: method("start") },
  outcomePlanning: { create: method("plan") },
  outcomeReviews: { submit: method("review") },
  outcomeRecovery: {
    get: method("recovery"), reconcile: method("reconcile"),
    metrics: method("metrics"), recordAttention: method("attention"),
  },
};
async function call(path: string, input?: unknown) {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url, input === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
  const context = { app, path, request, url, authMode: "disabled", authenticatedSessionId: null } as unknown as RouteContext;
  try {
    return (await outcomeRoutes(context) ?? await exploreRoutes(context, {
      propose: method("propose"), get: method("idea"),
    } as unknown as ExploreService))!;
  } catch (error) { return errorResponse(error); }
}

test("runtime queries and mutations dispatch parsed inputs with the authenticated actor", async () => {
  calls.length = 0;
  expect((await call(`/api/outcomes/${id}/recovery`)).status).toBe(200);
  expect((await call(`/api/outcomes/${id}/metrics`)).status).toBe(200);
  expect((await call(`/api/outcomes/${id}/reconcile`, { clientRequestId: "reconcile-test", actorRef: "bot:forged" })).status).toBe(200);
  expect((await call(`/api/outcomes/${id}/attention`, {
    clientRequestId: "attention-test", surface: "decision", seconds: 12, actorRef: "bot:forged",
  })).status).toBe(200);
  expect(calls).toEqual([
    ["recovery", id], ["metrics", id],
    ["reconcile", id, { clientRequestId: "reconcile-test" }, "owner:local"],
    ["attention", id, { clientRequestId: "attention-test", surface: "decision", seconds: 12 }, "owner:local"],
  ]);
  calls.length = 0;
  expect((await call(`/api/outcomes/${id}/attention`, {
    clientRequestId: "invalid-test", surface: "decision", seconds: 301,
  })).status).toBe(400);
  expect(calls).toEqual([]);
});

test("the rollback switch blocks only new planning, Explore proposal and run dispatch", async () => {
  process.env.OUTCOMEGO_OUTCOMES_ENABLED = "FALSE";
  calls.length = 0;
  for (const path of ["/api/outcomes/plans", `/api/outcomes/${id}/runs`, `/api/explore/${id}/propose`]) {
    const response = await call(path, {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "outcome_dispatch_disabled", details: { retryable: true } } });
  }
  expect(calls).toEqual([]);
  expect((await call(`/api/outcomes/${id}`)).status).toBe(200);
  expect((await call(`/api/outcomes/${id}/recovery`)).status).toBe(200);
  expect((await call(`/api/outcomes/${id}/metrics`)).status).toBe(200);
  expect((await call(`/api/explore/${id}`)).status).toBe(200);
  expect((await call(`/api/outcomes/${id}/cancel`, { clientRequestId: "cancel-test" })).status).toBe(200);
  expect((await call(`/api/outcomes/${id}/reconcile`, { clientRequestId: "reconcile-test" })).status).toBe(200);
  expect((await call(`/api/outcomes/${id}/reviews`, {
    expectedRevision: 1,
    results: [{ criterionId: id, result: "UNVERIFIED", evidenceIds: [], comment: "Awaiting evidence" }],
    clientRequestId: "review-test",
  })).status).toBe(200);
  expect(calls.map(call => call[0])).toEqual(["detail", "recovery", "metrics", "idea", "cancel", "reconcile", "review"]);
});
