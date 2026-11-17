import { expect, test } from "bun:test";
import { ComputerTurnRequest, OUTCOME_THREAD_TOOL_NAMES } from "@outcomego/contracts";
import { Schema } from "effect";
import { ComputerRuntime } from "../../src/runtime";
import { outcomeThreadToolDefinitions } from "../../src/runtime/tools";
import before from "../fixtures/outcome-tool-surfaces.json";

const tools = () => (new ComputerRuntime() as unknown as {
  tools: {
    customTools(active: unknown): Array<{ name: string }>;
    dynamicCatalog(active: unknown): Array<{ name: string; tools: Array<{ name: string }> }>;
  };
}).tools;

for (const requestSource of ["turn", "automation", "event"] as const) {
  test(`${requestSource} retains its exact pre-wave-0 tool lists`, () => {
    const runtime = tools();
    const active = { runtimeProfile: "agent", subagentType: null, pluginNamespaces: [], requestSource };
    const snapshot = (turn: unknown) => ({
      direct: runtime.customTools(turn).map((tool) => tool.name),
      dynamic: runtime.dynamicCatalog(turn).map((namespace) => ({
        name: namespace.name, tools: namespace.tools.map((tool) => tool.name),
      })),
    });
    expect(snapshot(active)).toEqual(before[requestSource]);
    if (requestSource === "automation")
      expect(snapshot({ ...active, outcomeThread: { workItemId: "fixture" } })).toEqual(before.automation);
  });
}

test("Outcome tools are selected only when implemented and the thread marker is present", () => {
  const definition = (name: string) => ({
    name, description: "Fixture", inputSchema: { type: "object" }, source: "first-party",
    decodeArguments: (input: unknown) => input,
  });
  const implemented = Object.fromEntries(OUTCOME_THREAD_TOOL_NAMES.map((name) => [name, definition(name)]));
  expect(outcomeThreadToolDefinitions({}, implemented)).toEqual([]);
  expect(outcomeThreadToolDefinitions({ outcomeThread: { workItemId: "fixture" } })).toEqual([]);
  expect(outcomeThreadToolDefinitions({ outcomeThread: { workItemId: "fixture" } }, implemented).map((tool) => tool.name))
    .toEqual([...OUTCOME_THREAD_TOOL_NAMES]);
});

test("turn contract accepts the optional marker and keeps ordinary requests without it", () => {
  const request = {
    runId: "run", botId: "bot", contextSessionId: "session", conversationId: "conversation",
    sessionPath: null, content: "fixture", clientMessageId: "message", cwd: "/workspace",
    instructions: "fixture", channelId: "channel", deliveryId: null, model: "fixture", reasoning: "high",
  };
  const decode = Schema.decodeUnknownSync(ComputerTurnRequest);
  expect(decode(request)).not.toHaveProperty("outcomeThread");
  expect(decode({ ...request, outcomeThread: { workItemId: "work" } }).outcomeThread).toEqual({ workItemId: "work" });
});
