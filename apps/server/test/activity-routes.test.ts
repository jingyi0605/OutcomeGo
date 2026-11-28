import { describe, expect, test } from "bun:test";
import { TASK_POLICY_FIELDS } from "@outcomego/contracts/task-policy";
import { createActivityRoutes } from "../src/routes/activity";
import type { RouteContext } from "../src/routes/context";
import type { ActivityQuery, ActivityService } from "../src/services/activity-service";

// Specs/004.10 task 4.1: the owner's activity routes. Read-only, owner only, and strict about what they accept.
const id = "11111111-1111-4111-8111-111111111111";
const context = (path: string, init?: RequestInit, required = false) =>
  ({
    request: new Request(`http://localhost${path}`, init),
    url: new URL(`http://localhost${path}`),
    path: path.split("?")[0],
    authMode: required ? "required" : "disabled",
    authenticatedSessionId: null,
  }) as RouteContext;
const recentWindow = TASK_POLICY_FIELDS.find((field) => field.key === "activity.recentCompletedHours")!;

const service = (overrides: Partial<Record<"list" | "requestDetail" | "needsMe" | "stopRequest", (...args: any[]) => unknown>> = {}) =>
  ({
    list: async () => ({ items: [], truncated: false }),
    requestDetail: async () => null,
    needsMe: async () => ({ items: [] }),
    stopRequest: async (requestRunId: string) => ({ stopped: true, requestRunId, stoppedWorkers: 0 }),
    ...overrides,
  }) as unknown as ActivityService;

describe("activity routes", () => {
  test("they are for the signed-in owner only, and a request that is not signed in is refused before anything is read", async () => {
    let read = 0;
    const route = createActivityRoutes(service({ list: async () => void read++, requestDetail: async () => void read++ }));
    await expect(route(context("/api/activity", undefined, true))).rejects.toMatchObject({ status: 401 });
    await expect(route(context(`/api/activity/requests/${id}`, undefined, true))).rejects.toMatchObject({ status: 401 });
    expect(read).toBe(0);
  });

  test("a path that is not theirs, or a method that is not GET, is left to the other routes", async () => {
    const route = createActivityRoutes(service());
    expect(await route(context("/api/outcomes"))).toBeUndefined();
    expect(await route(context("/api/activity", { method: "POST", body: "{}" }))).toBeUndefined();
    expect(await route(context(`/api/activity/requests/${id}`, { method: "DELETE" }))).toBeUndefined();
  });

  test("the list passes the query on, and is never cached", async () => {
    let got: ActivityQuery | undefined;
    const route = createActivityRoutes(service({ list: async (query: ActivityQuery) => ((got = query), { items: [], truncated: false }) }));
    const response = await route(context(`/api/activity?botId=${id}&includeAll=true&recentHours=48`));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(got).toEqual({ botId: id, includeAll: true, recentHours: 48 });
    await route(context("/api/activity"));
    expect(got).toEqual({});
  });

  test("passes the authenticated owner to activity-backed reads", async () => {
    let listQuery: ActivityQuery | undefined;
    let needsMeOwner: string | undefined;
    let detailOwner: string | undefined;
    const detail = { requestRunId: id, evidence: [], toolError: null };
    const route = createActivityRoutes(service({
      list: async (query: ActivityQuery) => ((listQuery = query), { items: [], truncated: false }),
      needsMe: async (_now: Date | undefined, ownerId?: string) => ((needsMeOwner = ownerId), { items: [] }),
      requestDetail: async (_id: string, _now: Date | undefined, ownerId?: string) => ((detailOwner = ownerId), detail),
    }), {
      ownerForSession: async (_mode, sessionId) => {
        expect(sessionId).toBe("session-a");
        return "owner-a";
      },
      attention: async () => [],
      digest: async () => null,
    });
    const ownerContext = (path: string) => ({
      ...context(path),
      authMode: "required" as const,
      authenticatedSessionId: "session-a",
    });

    await route(ownerContext(`/api/activity?botId=${id}`));
    await route(ownerContext("/api/needs-me"));
    await route(ownerContext(`/api/activity/requests/${id}`));

    expect(listQuery).toEqual({ botId: id, ownerId: "owner-a" });
    expect(needsMeOwner).toBe("owner-a");
    expect(detailOwner).toBe("owner-a");
  });

  test("a bot ID that is not an ID, or a window outside what the policy itself allows, is refused", async () => {
    const route = createActivityRoutes(service());
    for (const query of [
      "botId=not-an-id",
      "recentHours=abc",
      "recentHours=1.5",
      `recentHours=${recentWindow.min! - 1}`,
      `recentHours=${recentWindow.max! + 1}`,
      "includeAll=maybe",
    ])
      await expect(route(context(`/api/activity?${query}`))).rejects.toMatchObject({ status: 400 });
  });

  test("the detail is one request's, by ID; an unknown one is 404 and a bad ID is 400", async () => {
    const detail = { requestRunId: id, evidence: ["e"], toolError: null };
    const route = createActivityRoutes(service({ requestDetail: async (value: string) => (value === id ? detail : null) }));
    const found = await route(context(`/api/activity/requests/${id}`));
    expect(found?.status).toBe(200);
    expect(found?.headers.get("cache-control")).toBe("no-store");
    expect(await found!.json()).toEqual(detail);
    await expect(route(context("/api/activity/requests/22222222-2222-4222-8222-222222222222"))).rejects.toMatchObject({ status: 404 });
    await expect(route(context("/api/activity/requests/not-an-id"))).rejects.toMatchObject({ status: 400 });
  });

  // Specs/004.10 task 4.4: the owner's queue is read the same way as the list: owner only, GET only, never cached.
  test("the queue is for the signed-in owner only, GET only, and never cached", async () => {
    let read = 0;
    const route = createActivityRoutes(service({ needsMe: async () => (read++, { items: [] }) }));
    await expect(route(context("/api/needs-me", undefined, true))).rejects.toMatchObject({ status: 401 });
    expect(read).toBe(0);
    expect(await route(context("/api/needs-me", { method: "POST", body: "{}" }))).toBeUndefined();
    const response = (await route(context("/api/needs-me")))!;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [] });
  });

  test("stopping a tracked request is owner-only POST, validates UUID, and returns no-store result", async () => {
    let called = 0;
    const route = createActivityRoutes(
      service({
        stopRequest: async (requestRunId: string) => {
          called += 1;
          return { stopped: true, requestRunId, stoppedWorkers: 2 };
        },
      })
    );
    await expect(route(context(`/api/activity/requests/${id}/stop`, { method: "POST" }, true))).rejects.toMatchObject({ status: 401 });
    expect(called).toBe(0);
    expect(await route(context(`/api/activity/requests/${id}/stop`, { method: "GET" }))).toBeUndefined();
    await expect(route(context("/api/activity/requests/not-a-uuid/stop", { method: "POST" }))).rejects.toMatchObject({ status: 400 });
    const response = (await route(context(`/api/activity/requests/${id}/stop`, { method: "POST" })))!;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ stopped: true, requestRunId: id, stoppedWorkers: 2 });
    expect(called).toBe(1);
  });
});
