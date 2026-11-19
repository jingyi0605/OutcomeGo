import { expect, test } from "bun:test";
import {
  GET_USER_LOCATION_TOOL,
  USER_LOCATION_FEATURE_FLAG,
} from "@outcomego/contracts/user-location";
import { ComputerRuntime } from "../../src/runtime";

test("GetUserLocation has contract parity, defaults off and is parent-only, including routines", async () => {
  const previous = process.env[USER_LOCATION_FEATURE_FLAG];
  const runtime = (new ComputerRuntime() as any).tools;
  const parent = { runtimeProfile: "agent", subagentType: null, pluginNamespaces: [] };
  const tools = (turn = parent) =>
    runtime.dynamicCatalog(turn).find((ns: any) => ns.name === "cursor").tools;
  try {
    delete process.env[USER_LOCATION_FEATURE_FLAG];
    expect(tools().map((tool: any) => tool.name)).not.toContain(GET_USER_LOCATION_TOOL.name);
    process.env[USER_LOCATION_FEATURE_FLAG] = "1";
    const tool = tools().find((candidate: any) => candidate.name === GET_USER_LOCATION_TOOL.name);
    expect(tool.description).toBe(GET_USER_LOCATION_TOOL.description);
    expect(tool.inputSchema).toEqual(GET_USER_LOCATION_TOOL.inputSchema);
    expect(
      tools({ ...parent, requestSource: "automation" } as any).map((tool: any) => tool.name)
    ).toContain(GET_USER_LOCATION_TOOL.name);
    expect(
      tools({ ...parent, runtimeProfile: "subagent", subagentType: "executor" } as any).map(
        (tool: any) => tool.name
      )
    ).not.toContain(GET_USER_LOCATION_TOOL.name);
    let called: unknown[];
    runtime.callControlPlaneTool = async (...args: unknown[]) => {
      called = args;
      return { content: [], details: { available: false } };
    };
    await tool.execute(parent, "location-call", {}, undefined);
    expect(called!).toEqual([parent, "location-call", GET_USER_LOCATION_TOOL.name, {}, undefined]);
  } finally {
    if (previous === undefined) delete process.env[USER_LOCATION_FEATURE_FLAG];
    else process.env[USER_LOCATION_FEATURE_FLAG] = previous;
  }
});
