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
    const active = { runtimeProfile: "agent", subagentType: null, pluginNamespaces: [], requestSource, outcomesEnabled: true };
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
      expect(outcome.direct).toContain("ReportOutcomeProgress");
    }
  });
}

test("goal management stays off unless the owner enabled it", () => {
  const runtime = tools();
  const names = (outcomesEnabled?: boolean) => runtime.dynamicCatalog({
    runtimeProfile: "agent", subagentType: null, pluginNamespaces: [], requestSource: "turn", outcomesEnabled,
  }).flatMap(namespace => namespace.tools.map(tool => tool.name))
    .filter(name => (OUTCOME_CHAT_TOOL_NAMES as readonly string[]).includes(name));
  expect(names()).toEqual([]);
  expect(names(false)).toEqual([]);
  expect(names(true)).toEqual(OUTCOME_CHAT_TOOL_NAMES);
});

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
    { runtimeProfile: "agent", accessMode: "readonly_strict" },
    { runtimeProfile: "agent", requestSource: "automation", outcomeThread: { workItemId: "fixture" } },
  ]) {
    const names = runtime.dynamicCatalog({
      subagentType: null, pluginNamespaces: [], requestSource: "turn", outcomesEnabled: true,
      ...overrides,
    }).flatMap(namespace => namespace.tools.map(tool => tool.name));
    expect(names.filter(name => (OUTCOME_CHAT_TOOL_NAMES as readonly string[]).includes(name))).toEqual([]);
  }
});

test("research turns expose and execute only research tools and mode-specific Plan tools", async () => {
  const runtime = tools() as any;
  const calls: string[] = [];
  const record = (name: string) => async () => {
    calls.push(name);
    return { content: [], details: {} };
  };
  Object.assign(runtime.nativeToolExecutor, {
    externalRead: record("Read"), externalShell: record("Shell"),
    externalAwaitShell: record("AwaitShell"), listMachines: record("ListMachines"),
  });
  runtime.callControlPlaneTool = record("PluginCall");
  const active = {
    accessMode: "research_readonly", runtimeProfile: "agent", requestSource: "automation", subagentType: null,
    runId: "research", contextSessionId: "research-session",
    goalThread: { threadId: "thread", outcomeId: "outcome", purpose: "plan", planMode: "triage" },
    pluginNamespaces: [{ name: "source", description: "Fixture", namespaceStatus: "ready", tools: [
      { connectionId: "account", name: "lookup", description: "Read", inputSchema: { type: "object" }, source: "custom/custom", readOnly: true },
      { connectionId: "account", name: "modify", description: "Write", inputSchema: { type: "object" }, source: "custom/custom" },
    ] }],
  };
  const names = [
    ...runtime.customTools(active).map((tool: { name: string }) => tool.name),
    ...runtime.dynamicCatalog(active).flatMap((namespace: { tools: Array<{ name: string }> }) => namespace.tools.map((tool) => tool.name)),
  ];
  expect(names).toEqual(expect.arrayContaining(["Read", "Shell", "AwaitShell", "ListMachines", "ClassifyOutcome", "lookup"]));
  for (const name of ["SendToUser", "WakeParent", "UpdateRoutine", "CopyToBox", "CopyFromBox", "SaveOutcomeContract", "modify"]) {
    expect(names).not.toContain(name);
    await expect(runtime.executeOutcomeGoTool(active, name, name, {})).rejects.toThrow("read-only");
  }
  await runtime.executeOutcomeGoTool(active, "read", "Read", { path: "/tmp/example", machineId: "fixture" });
  await runtime.executeOutcomeGoTool(active, "shell", "Shell", { command: "ls", machineId: "fixture" });
  for (const [toolName, args, namespace] of [
    ["AwaitShell", { machineId: "fixture" }, "cursor"], ["ListMachines", {}, "cursor"], ["lookup", {}, "source"],
  ] as const) await runtime.callDynamicTool(active, toolName, { namespace, toolName, arguments: args });
  await expect(runtime.callDynamicTool(active, "write", { namespace: "source", toolName: "modify", arguments: {} })).rejects.toThrow("read-only");
  expect(calls).toEqual(["Read", "Shell", "AwaitShell", "ListMachines", "PluginCall"]);
});

test("turn contract accepts the optional marker and keeps ordinary requests without it", () => {
  const request = {
    runId: "run", botId: "bot", contextSessionId: "session", conversationId: "conversation",
    sessionPath: null, content: "fixture", clientMessageId: "message", cwd: "/workspace",
    instructions: "fixture", channelId: "channel", deliveryId: null, model: "fixture", reasoning: "high", accessMode: "full",
  };
  const decode = Schema.decodeUnknownSync(ComputerTurnRequest);
  expect(decode(request)).not.toHaveProperty("outcomeThread");
  expect(decode({ ...request, outcomeThread: { workItemId: "work" } }).outcomeThread).toEqual({ workItemId: "work" });
});

test("a goal's own thread filters tools by purpose and excludes chat, WakeParent, Decision, and Bitwarden tools", () => {
  const runtime = tools();
  const names = (turn: Record<string, unknown>) => {
    const active = { runtimeProfile: "agent", subagentType: null, pluginNamespaces: [], outcomesEnabled: true, ...turn };
    // A run calls its own thread's tools directly; everything else is looked up in the catalog.
    return [
      ...runtime.customTools(active).map((tool) => tool.name),
      ...runtime.dynamicCatalog(active).flatMap((namespace) => namespace.tools.map((tool) => tool.name)),
    ];
  };
  for (const purpose of ["plan", "owner_message", "replan"] as const) {
    const inThread = names({ requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose } });
    for (const name of ["Read", "Shell", "AwaitShell", "SaveOutcomeContract", "SavePlan", "GetOutcome", "ListOutcomes", "CancelOutcome"])
      expect(inThread).toContain(name);
    for (const forbidden of [
      "SubmitPrereview", "ReviewTaskResult",
      "CreateOutcome", "TrackOutcome", "CloseOutcome", "StartOutcome", "ReviseOutcome", "WakeParent",
      "RequestOutcomeDecision", "RequestHumanAction", "ReportOutcomeProgress",
      "RequestBitwardenReadApproval", "SearchBitwardenItems", "ReadBitwardenCredential",
    ]) expect(inThread).not.toContain(forbidden);
  }

  const reviewThread = names({ requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose: "review" } });
  for (const name of ["Read", "Shell", "AwaitShell", "GetOutcome", "SubmitPrereview"])
    expect(reviewThread).toContain(name);
  for (const forbidden of [
    "SaveOutcomeContract", "SavePlan", "CancelOutcome", "ListOutcomes", "ReviewTaskResult",
    "RequestOutcomeDecision", "RequestHumanAction", "RequestBitwardenReadApproval",
  ]) expect(reviewThread).not.toContain(forbidden);

  const reviewTaskThread = names({ requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose: "review_task" } });
  for (const name of ["Read", "Shell", "AwaitShell", "GetOutcome", "ReviewTaskResult"])
    expect(reviewTaskThread).toContain(name);
  for (const forbidden of [
    "SaveOutcomeContract", "SavePlan", "CancelOutcome", "ListOutcomes", "SubmitPrereview",
    "RequestOutcomeDecision", "RequestHumanAction", "RequestBitwardenReadApproval",
  ]) expect(reviewTaskThread).not.toContain(forbidden);

  const ordinary = names({ requestSource: "turn" });
  expect(ordinary).not.toContain("SaveOutcomeContract");
  expect(ordinary).not.toContain("SavePlan");
  expect(ordinary).toContain("CreateOutcome");
  expect(names({ requestSource: "automation" })).not.toContain("SaveOutcomeContract");
});

// Specs/004.10 task 2.5: DeferWorkItem exists only inside a task's own Outcome turn. The lists above name tools
// by hand, so they cannot catch a new tool being offered somewhere it should not be; this one names the one place.
test("DeferWorkItem is offered in an Outcome work item's own turn and nowhere else", () => {
  const runtime = tools();
  const names = (turn: Record<string, unknown>) => {
    const active = { runtimeProfile: "agent", subagentType: null, pluginNamespaces: [], outcomesEnabled: true, ...turn };
    return [
      ...runtime.customTools(active).map((tool) => tool.name),
      ...runtime.dynamicCatalog(active).flatMap((namespace) => namespace.tools.map((tool) => tool.name)),
    ];
  };
  expect(names({ requestSource: "automation", outcomeThread: { workItemId: "work" } })).toContain("DeferWorkItem");
  const elsewhere: Array<[string, Record<string, unknown>]> = [
    ["an ordinary user turn", { requestSource: "turn" }],
    ["a routine or event turn", { requestSource: "automation" }],
    ["a sub-agent", { requestSource: "turn", runtimeProfile: "subagent", subagentType: "executor" }],
    ["a goal's planning thread", { requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose: "plan" } }],
    ["a goal's replanning thread", { requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose: "replan" } }],
    ["a goal's owner-message thread", { requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose: "owner_message" } }],
    ["a goal's review thread", { requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose: "review" } }],
    ["a goal's task-review thread", { requestSource: "automation", goalThread: { threadId: "t", outcomeId: "o", purpose: "review_task" } }],
  ];
  for (const [label, turn] of elsewhere) expect([label, names(turn).includes("DeferWorkItem")]).toEqual([label, false]);
});
