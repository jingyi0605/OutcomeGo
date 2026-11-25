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
  expect(calls).toEqual([
    { path: "/api/todos?view=history&cursor=opaque%2Bcursor", method: "GET" },
    { path: "/api/todos", method: "POST", body: input },
    { path: "/api/todos/opaque%2Fitem/complete", method: "POST", body: { revision: 2 } },
  ]);
});
