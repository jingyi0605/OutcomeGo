import { expect, test } from "bun:test";
import { ComputerTurnRequest } from "@outcomego/contracts";
import { CHECK_GROUP_TASK_WORK, GROUP_TASK_TOOL_NAMES } from "@outcomego/contracts/group-tasks";
import { Schema } from "effect";
import { ComputerRuntime } from "../../src/runtime";
import { RuntimeTools } from "../../src/runtime/tools";
import type { ActiveTurn } from "../../src/runtime/types";

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
    { accessMode: "readonly_strict" },
  ]) {
    expect(groupTools({ groupTasksEnabled: true, ...overrides })).toEqual([]);
  }
});

test("the board tools do not depend on the optional goal management module", () => {
  expect(groupTools({ groupTasksEnabled: true, outcomesEnabled: false })).toEqual(GROUP_TASK_TOOL_NAMES);
});

test("a group turn checks its live claim before local work, even after a prior success", async () => {
  const actions: string[] = [];
  let allowed = false;
  const runtime = Object.assign(Object.create(RuntimeTools.prototype), {
    privateControl: async (_active: ActiveTurn, _callId: string, tool: string) => {
      actions.push(tool);
      return { allowed };
    },
    processSecrets: async () => ({}),
    nativeToolExecutor: {
      shell: async () => {
        actions.push("Shell");
        return { content: [], details: {} };
      },
    },
    callControlPlaneTool: async (_active: ActiveTurn, _callId: string, tool: string) => {
      actions.push(tool);
      return { content: [], details: {} };
    },
  }) as { executeScopedTool: (active: ActiveTurn, callId: string, tool: string, args: unknown) => Promise<unknown> };
  const active = { runtimeProfile: "agent", groupTasksEnabled: true, groupTurn: true, channelId: "room" } as ActiveTurn;
  const execute = (tool: string, args: unknown) => runtime.executeScopedTool(active, "call", tool, args);
  await execute("SendToUser", { type: "text", content: "Could you clarify the scope?" });
  await expect(execute("Shell", { command: "pwd" })).rejects.toThrow("verify the active group task claim");
  allowed = true;
  await execute("Shell", { command: "pwd" });
  allowed = false;
  await expect(execute("Shell", { command: "pwd" })).rejects.toThrow("verify the active group task claim");
  await expect(execute("SendToUser", { type: "text", content: "Handoff", to: "dm" })).rejects.toThrow("verify the active group task claim");
  expect(actions).toEqual(["SendToUser", CHECK_GROUP_TASK_WORK, CHECK_GROUP_TASK_WORK, "Shell", CHECK_GROUP_TASK_WORK, CHECK_GROUP_TASK_WORK]);
});

test("the turn contract carries the optional group marker", () => {
  const request = {
    runId: "run", botId: "bot", contextSessionId: "session", conversationId: "conversation",
    sessionPath: null, content: "fixture", clientMessageId: "message", cwd: "/workspace",
    instructions: "fixture", channelId: "channel", deliveryId: null, model: "fixture", reasoning: "high", accessMode: "full",
  };
  const decode = Schema.decodeUnknownSync(ComputerTurnRequest);
  expect(decode(request)).not.toHaveProperty("groupTasksEnabled");
  expect(decode({ ...request, groupTasksEnabled: true }).groupTasksEnabled).toBe(true);
  expect(decode(request)).not.toHaveProperty("groupTurn");
  expect(decode({ ...request, groupTurn: true }).groupTurn).toBe(true);
});
