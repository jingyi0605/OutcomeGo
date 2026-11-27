import { expect, test } from "bun:test";
import { createOutcomeApi, createScheduleApi } from "../src/renderer/client/outcome-api";
import { listTodos } from "../src/renderer/components/outcomego/outcomes/dashboard/todo-state";

type Call = { path: string; method: string; body?: unknown };
function recorder(respond: (path: string) => unknown = () => ({})) {
  const calls: Call[] = [];
  const request = async <Result>(path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? "GET", ...(init?.body && { body: JSON.parse(String(init.body)) }) });
    return respond(path) as Result;
  };
  return { calls, request };
}

test("to-do reads and writes go through the unified Outcome API", async () => {
  const { calls, request } = recorder();
  const client = createOutcomeApi(request);
  const input = { kind: "todo" as const, title: "Item zeta", clientRequestId: "request-zeta" };
  await client.create(input);
  const action = { action: "complete" as const, expectedRevision: 2, clientRequestId: "request-complete" };
  await client.act("opaque/item", action);
  const update = { followUpAt: null, expectedRevision: 3, clientRequestId: "request-update" };
  await client.update("opaque/item", update);
  const convert = { targetKind: "standard" as const, expectedRevision: 4, clientRequestId: "request-convert" };
  await client.convert("opaque/item", convert);
  const plan = { mode: "advice" as const, clientRequestId: "request-advice" };
  await client.plan!("opaque/item", plan);
  expect(calls).toEqual([
    { path: "/api/outcomes", method: "POST", body: input },
    { path: "/api/outcomes/opaque%2Fitem/actions", method: "POST", body: action },
    { path: "/api/outcomes/opaque%2Fitem", method: "PATCH", body: update },
    { path: "/api/outcomes/opaque%2Fitem/convert", method: "POST", body: convert },
    { path: "/api/outcomes/opaque%2Fitem/plan", method: "POST", body: plan },
  ]);
});

test("each to-do view asks for its own items and reads every row's detail", async () => {
  const summary = { id: "item", kind: "todo" };
  const { calls, request } = recorder((path) => path.startsWith("/api/outcomes?")
    ? { items: [summary], nextCursor: "opaque+next" }
    : { ...summary, description: "Note" });
  const client = createOutcomeApi(request);
  expect(await listTodos(client, "all")).toEqual({ items: [{ ...summary, description: "Note" }] as never, nextCursor: "opaque+next" });
  await listTodos(client, "suggestions");
  await listTodos(client, "history", "opaque+cursor");
  expect(calls.map((call) => call.path)).toEqual([
    "/api/outcomes?kinds=todo&statuses=open%2Cwaiting", "/api/outcomes/item",
    "/api/outcomes?kinds=todo&view=suggestions", "/api/outcomes/item",
    "/api/outcomes?kinds=todo&view=history&cursor=opaque%2Bcursor", "/api/outcomes/item",
  ]);
});

test("a calendar move reads the current revision before changing the time", async () => {
  const { calls, request } = recorder(() => ({ revision: 7 }));
  await createScheduleApi(request).rescheduleOutcome("opaque/item", "dueAt", "2026-12-02T09:00:00.000Z");
  expect(calls).toEqual([
    { path: "/api/outcomes/opaque%2Fitem", method: "GET" },
    { path: "/api/outcomes/opaque%2Fitem", method: "PATCH", body: { expectedRevision: 7, dueAt: "2026-12-02T09:00:00.000Z", clientRequestId: expect.any(String) } },
  ]);
});

test("the rule manager sends create, update and delete to the owner-only API", async () => {
  const { calls, request } = recorder();
  const client = createOutcomeApi(request).autoAcceptRules!;
  const draft = { name: "Rule alpha", routineId: "00000000-0000-4000-8000-000000000001" };
  await client.list();
  await client.create(draft);
  await client.update("rule/id", { enabled: false });
  await client.remove("rule/id");
  expect(calls).toEqual([
    { path: "/api/outcomes/auto-accept-rules", method: "GET" },
    { path: "/api/outcomes/auto-accept-rules", method: "POST", body: draft },
    { path: "/api/outcomes/auto-accept-rules/rule%2Fid", method: "PATCH", body: { enabled: false } },
    { path: "/api/outcomes/auto-accept-rules/rule%2Fid", method: "DELETE" },
  ]);
});
