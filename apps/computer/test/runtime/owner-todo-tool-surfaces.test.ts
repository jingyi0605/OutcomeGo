import { expect, test } from "bun:test";
import { TODO_TOOL_NAMES } from "@outcomego/contracts/todo";
import { ComputerRuntime } from "../../src/runtime";

const runtime = new ComputerRuntime() as unknown as {
  tools: { dynamicCatalog(active: unknown): Array<{ tools: Array<{ name: string }> }> };
};
const names = (overrides: Record<string, unknown>) => runtime.tools
  .dynamicCatalog({ outcomesEnabled: true, todoTurnMode: "owner", runtimeProfile: "agent", pluginNamespaces: [], ...overrides })
  .flatMap(({ tools }) => tools.map(({ name }) => name))
  .filter((name) => (TODO_TOOL_NAMES as readonly string[]).includes(name));

test("owner todo tools follow the turn permission matrix", () => {
  expect(names({})).toEqual([...TODO_TOOL_NAMES]);
  expect(names({ todoTurnMode: "wake" })).toEqual(["CreateTodo", "SuggestTodo", "ListTodos"]);
  expect(names({ todoTurnMode: "automation" })).toEqual(["SuggestTodo"]);
  for (const overrides of [
    { todoTurnMode: undefined }, { outcomesEnabled: false }, { runtimeProfile: "subagent" },
    { outcomeThread: {} }, { goalThread: {} }, { readOnly: true },
  ]) expect(names(overrides)).toEqual([]);
});
