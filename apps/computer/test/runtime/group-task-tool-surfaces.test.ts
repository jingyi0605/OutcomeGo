import { expect, test } from "bun:test";
import { ComputerTurnRequest } from "@outcomego/contracts";
import { GROUP_TASK_TOOL_NAMES } from "@outcomego/contracts/group-tasks";
import { Schema } from "effect";
import { ComputerRuntime } from "../../src/runtime";

const tools = () => (new ComputerRuntime() as unknown as {
  tools: { dynamicCatalog(active: unknown): Array<{ name: string; tools: Array<{ name: string }> }> };
}).tools;

const groupTools = (turn: Record<string, unknown>) =>
  tools()
    .dynamicCatalog({ runtimeProfile: "agent", subagentType: null, pluginNamespaces: [], requestSource: "turn", ...turn })
    .flatMap((namespace) => namespace.tools.map((tool) => tool.name))
    .filter((name) => (GROUP_TASK_TOOL_NAMES as readonly string[]).includes(name));

test("a member's group turn gets the four board tools", () => {
  expect(groupTools({ groupTasksEnabled: true })).toEqual(GROUP_TASK_TOOL_NAMES);
});

test("direct chats and turns without the marker never get the board tools", () => {
  expect(groupTools({})).toEqual([]);
  expect(groupTools({ groupTasksEnabled: false })).toEqual([]);
});

test("workers, routines, goal threads and read-only runs never get the board tools", () => {
  for (const overrides of [
    { runtimeProfile: "subagent", subagentType: "executor" },
    { requestSource: "automation" },
    { requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose: "plan" } },
    { readOnly: true },
  ]) {
    expect(groupTools({ groupTasksEnabled: true, ...overrides })).toEqual([]);
  }
});

test("the board tools do not depend on the optional goal management module", () => {
  expect(groupTools({ groupTasksEnabled: true, outcomesEnabled: false })).toEqual(GROUP_TASK_TOOL_NAMES);
});

test("the turn contract carries the optional group marker", () => {
  const request = {
    runId: "run", botId: "bot", contextSessionId: "session", conversationId: "conversation",
    sessionPath: null, content: "fixture", clientMessageId: "message", cwd: "/workspace",
    instructions: "fixture", channelId: "channel", deliveryId: null, model: "fixture", reasoning: "high",
  };
  const decode = Schema.decodeUnknownSync(ComputerTurnRequest);
  expect(decode(request)).not.toHaveProperty("groupTasksEnabled");
  expect(decode({ ...request, groupTasksEnabled: true }).groupTasksEnabled).toBe(true);
});
