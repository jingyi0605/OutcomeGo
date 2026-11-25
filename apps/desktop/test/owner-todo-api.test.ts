import { expect, test } from "bun:test";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";

test("the dashboard client sends typed owner to-do requests to the standalone API", async () => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const request = async <Result>(path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? "GET", ...(init?.body && { body: JSON.parse(String(init.body)) }) });
    return {} as Result;
  };
  const client = createOutcomeApi(request).todos!;
  const input = { title: "Item zeta", clientRequestId: "request-zeta" };
  await client.list({ view: "history", cursor: "opaque+cursor" });
  await client.create(input);
  await client.act("opaque/item", "complete", { revision: 2 });
  const bulk = { action: "dismissBot" as const, botId: "00000000-0000-4000-8000-000000000001" };
  await client.bulk(bulk);
  await client.update("opaque/item", { revision: 3, status: "open" });
  expect(calls).toEqual([
    { path: "/api/todos?view=history&cursor=opaque%2Bcursor", method: "GET" },
    { path: "/api/todos", method: "POST", body: input },
    { path: "/api/todos/opaque%2Fitem/complete", method: "POST", body: { revision: 2 } },
    { path: "/api/todos/bulk", method: "POST", body: bulk },
    { path: "/api/todos/opaque%2Fitem", method: "PATCH", body: { revision: 3, status: "open" } },
  ]);
});

test("the rule manager sends create, update and delete to the owner-only API", async () => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const request = async <Result>(path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? "GET", ...(init?.body && { body: JSON.parse(String(init.body)) }) });
    return {} as Result;
  };
  const client = createOutcomeApi(request).todos!.autoAcceptRules!;
  const draft = { name: "Rule alpha", routineId: "00000000-0000-4000-8000-000000000001" };
  await client.list();
  await client.create(draft);
  await client.update("rule/id", { enabled: false });
  await client.remove("rule/id");
  expect(calls).toEqual([
    { path: "/api/todos/auto-accept-rules", method: "GET" },
    { path: "/api/todos/auto-accept-rules", method: "POST", body: draft },
    { path: "/api/todos/auto-accept-rules/rule%2Fid", method: "PATCH", body: { enabled: false } },
    { path: "/api/todos/auto-accept-rules/rule%2Fid", method: "DELETE" },
  ]);
});
