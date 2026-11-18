import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { ExploreIdeaView } from "@outcomego/contracts/explore";
import { exploreRoutes } from "../src/routes/explore";
import type { RouteContext } from "../src/routes/context";
import type { ExploreService } from "../src/services/explore-service";

const id = "00000000-0000-4000-8000-000000000001";
const idea: ExploreIdeaView = {
  id, title: "Investigate", note: "", botId: null, status: "draft", sourceOutcomeId: null, sourceReferences: [],
  budget: null, planningDraftId: null, proposedOutcomeId: null,
  createdAt: "2026-11-17T00:00:00.000Z", updatedAt: "2026-11-17T00:00:00.000Z", discardedAt: null,
};
const context = (path: string, method = "GET", body?: unknown, session?: { userId: string } | null): RouteContext => ({
  path: path.split("?")[0], url: new URL(`http://localhost${path}`),
  request: new Request(`http://localhost${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }),
  authenticatedSessionId: session === undefined ? undefined : "session-id",
  app: { prisma: { session: { findUnique: async () => session ? { ...session, expiresAt: new Date(Date.now() + 60_000) } : null } } },
} as unknown as RouteContext);

test("create decodes only intent and derives the actor from the existing authentication context", async () => {
  let seen: unknown;
  const service = { create: (input: unknown, actor: string) => { seen = { input, actor }; return Effect.succeed(idea); } } as unknown as ExploreService;
  const response = await exploreRoutes(context("/api/explore", "POST", {
    title: "Investigate", clientRequestId: "explore:route", actorRef: "user:forged", proposedOutcomeId: id,
  }, { userId: "owner-id" }), service);
  expect(response?.status).toBe(201);
  expect(seen).toEqual({ input: { title: "Investigate", clientRequestId: "explore:route" }, actor: "user:owner-id" });
});

test("list and single-detail responses retain the exact public shape", async () => {
  let query: unknown;
  const service = {
    list: (value: unknown) => { query = value; return Effect.succeed({ items: [idea], nextCursor: null }); },
    get: () => Effect.succeed(idea),
  } as unknown as ExploreService;
  expect(await (await exploreRoutes(context("/api/explore?status=draft&limit=1000"), service))?.json()).toEqual({ items: [idea], nextCursor: null });
  expect(query).toEqual({ statuses: ["draft"], cursor: null, limit: 100 });
  expect(await (await exploreRoutes(context(`/api/explore/${id}`), service))?.json()).toEqual(idea);
});

test("invalid list state and stale authenticated sessions fail before invoking business handlers", async () => {
  const service = {} as ExploreService;
  await expect(exploreRoutes(context("/api/explore?status=proposed"), service)).rejects.toMatchObject({ code: "invalid_request" });
  await expect(exploreRoutes(context("/api/explore", "GET", undefined, null), service)).rejects.toMatchObject({ code: "unauthorized" });
});
