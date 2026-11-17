import { expect, test } from "bun:test";
import { RuntimeTools, outcomeThreadToolDefinitions } from "../../src/runtime/tools";

test("RequestHumanAction is absent without an Outcome marker and uses the shared strict arguments", () => {
  expect(outcomeThreadToolDefinitions({})).toEqual([]);
  const tool = outcomeThreadToolDefinitions({ outcomeThread: { workItemId: "fixture" } }).find(tool => tool.name === "RequestHumanAction")!;
  expect(tool).toBeTruthy();
  expect(() => tool.decodeArguments({ title: "Missing evidence contract" })).toThrow();
});

test("successful human-action result ends only the current Outcome turn", async () => {
  const tools = new RuntimeTools({} as never, "http://unused.invalid", "fixture", "/tmp", "/tmp") as unknown as {
    callControlPlaneToolRequest(active: object, id: string, name: string, args: unknown): Promise<unknown>;
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json({ waiting_for_human: true, end_turn: true })) as unknown as typeof fetch;
    const active = { runId: "fixture", botId: "fixture", sentMessageCount: 0, queue: { push() {} }, outcomeThread: { workItemId: "work" }, endTurnRequested: false };
    await tools.callControlPlaneToolRequest(active, "call", "RequestHumanAction", {});
    expect(active.endTurnRequested).toBe(true);
    const ordinary = { ...active, outcomeThread: undefined, endTurnRequested: false };
    await tools.callControlPlaneToolRequest(ordinary, "call", "RequestHumanAction", {});
    expect(ordinary.endTurnRequested).toBe(false);
    globalThis.fetch = (async () => Response.json({ waiting_for_human: false })) as unknown as typeof fetch;
    const failed = { ...active, endTurnRequested: false };
    await tools.callControlPlaneToolRequest(failed, "call", "RequestHumanAction", {});
    expect(failed.endTurnRequested).toBe(false);
  } finally { globalThis.fetch = originalFetch; }
});
