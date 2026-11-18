import { expect, test } from "bun:test";
import { ComputerTurnRequest, OUTCOME_THREAD_TOOL_NAMES } from "@outcomego/contracts";
import { Schema } from "effect";
import { ComputerRuntime } from "../../src/runtime";
import { outcomeThreadToolDefinitions } from "../../src/runtime/tools";
import { OUTCOME_CHAT_TOOL_NAMES } from "@outcomego/contracts/outcome-chat";
import before from "../fixtures/outcome-tool-surfaces.json";

const tools = () => (new ComputerRuntime() as unknown as {
  tools: {
    customTools(active: unknown): Array<{ name: string }>;
    dynamicCatalog(active: unknown): Array<{ name: string; tools: Array<{ name: string }> }>;
  };
}).tools;

for (const requestSource of ["turn", "automation", "event"] as const) {
  test(`${requestSource} retains existing tools alongside explicit native conversation tools`, () => {
    const runtime = tools();
    const active = { runtimeProfile: "agent", subagentType: null, pluginNamespaces: [], requestSource };
    const snapshot = (turn: unknown) => ({
      direct: runtime.customTools(turn).map((tool) => tool.name),
      dynamic: runtime.dynamicCatalog(turn).map((namespace) => ({
        name: namespace.name, tools: namespace.tools.map((tool) => tool.name),
      })),
    });
    const current = snapshot(active);
    const chatTools = current.dynamic.flatMap(namespace => namespace.tools)
      .filter(name => (OUTCOME_CHAT_TOOL_NAMES as readonly string[]).includes(name));
    expect(chatTools).toEqual(requestSource === "automation" ? [] : OUTCOME_CHAT_TOOL_NAMES);
    expect({
      direct: current.direct,
      dynamic: current.dynamic.map(namespace => ({
        ...namespace,
        tools: namespace.tools.filter(name => !(OUTCOME_CHAT_TOOL_NAMES as readonly string[]).includes(name)),
      })),
    }).toEqual(before[requestSource]);
    if (requestSource === "automation") {
      const outcome = snapshot({ ...active, outcomeThread: { workItemId: "fixture" } });
      const originalTools = (names: string[]) => names.filter(name => !(OUTCOME_THREAD_TOOL_NAMES as readonly string[]).includes(name));
      expect({ direct: originalTools(outcome.direct), dynamic: outcome.dynamic.map(namespace => ({
        ...namespace, tools: originalTools(namespace.tools),
      })) }).toEqual(before.automation);
      expect(outcome.direct).toContain("RequestHumanAction");
      expect(outcome.direct).toContain("RequestOutcomeDecision");
    }
  });
}

test("Outcome tools are selected only when implemented and the thread marker is present", () => {
  const definition = (name: string) => ({
    name, description: "Fixture", inputSchema: { type: "object" }, source: "first-party",
    decodeArguments: (input: unknown) => input,
  });
  const implemented = Object.fromEntries(OUTCOME_THREAD_TOOL_NAMES.map((name) => [name, definition(name)]));
  expect(outcomeThreadToolDefinitions({}, implemented)).toEqual([]);
  expect(outcomeThreadToolDefinitions({ outcomeThread: { workItemId: "fixture" } }).map(tool => tool.name)).toEqual([...OUTCOME_THREAD_TOOL_NAMES]);
  expect(outcomeThreadToolDefinitions({ outcomeThread: { workItemId: "fixture" } }, implemented).map((tool) => tool.name))
    .toEqual([...OUTCOME_THREAD_TOOL_NAMES]);
});

test("delegated and readonly turns never receive native goal management tools", () => {
  const runtime = tools();
  for (const overrides of [
    { runtimeProfile: "subagent", subagentType: "executor" },
    { runtimeProfile: "agent", readOnly: true },
    { runtimeProfile: "agent", requestSource: "automation", outcomeThread: { workItemId: "fixture" } },
  ]) {
    const names = runtime.dynamicCatalog({
      subagentType: null, pluginNamespaces: [], requestSource: "turn",
      ...overrides,
    }).flatMap(namespace => namespace.tools.map(tool => tool.name));
    expect(names.filter(name => (OUTCOME_CHAT_TOOL_NAMES as readonly string[]).includes(name))).toEqual([]);
  }
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
