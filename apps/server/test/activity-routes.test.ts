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

const service = (overrides: Partial<Record<"list" | "requestDetail", (...args: any[]) => unknown>> = {}) =>
  ({
    list: async () => ({ items: [], truncated: false }),
    requestDetail: async () => null,
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
});
