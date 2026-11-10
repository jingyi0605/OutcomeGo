import { expect, test } from "bun:test";
import { resolveSidebarSync, sidebarPreferencesFromRootSettings } from "../src/index";

test("imports the reserved Unassigned section without a duplicate heading or assignment", () => {
  const result = sidebarPreferencesFromRootSettings(
    {
      valid: true,
      settings: {
        sidebarSections: [
          { id: "work", name: "Work", agentIds: ["a"], isCollapsed: true },
          { id: "__agents__", name: "Unassigned", agentIds: ["b"], isCollapsed: false },
        ],
      },
    },
    {
      version: 2,
      pinnedIds: [],
      unreadIds: ["b"],
      sections: [],
      sectionByChannel: {},
      channelOrderByGroup: {},
      unassignedCollapsed: true,
    }
  );
  expect(result?.sections).toEqual([{ id: "work", name: "Work", collapsed: true }]);
  expect(result?.sectionByChannel).toEqual({ a: "work" });
  expect(result?.unassignedCollapsed).toBe(false);
  expect(result?.unreadIds).toEqual(["b"]);
});

const emptyLocal = {
  version: 2 as const,
  pinnedIds: [],
  unreadIds: [],
  sections: [],
  sectionByChannel: {},
  channelOrderByGroup: {},
  unassignedCollapsed: false,
};

test("a fresh client with empty local state adopts the server layout instead of overwriting it", () => {
  const decision = resolveSidebarSync(
    {
      valid: true,
      settings: {
        pinnedAgentIds: ["a"],
        sidebarSections: [{ id: "work", name: "Work", agentIds: ["b"], isCollapsed: false }],
      },
    },
    emptyLocal
  );
  expect(decision.action).toBe("adopt");
  if (decision.action !== "adopt") throw new Error("expected adopt");
  expect(decision.preferences.pinnedIds).toEqual(["a"]);
  expect(decision.preferences.sectionByChannel).toEqual({ b: "work" });
});

test("a server that stored empty pinned/sections still wins over stale local data", () => {
  const decision = resolveSidebarSync(
    { valid: true, settings: { pinnedAgentIds: [], sidebarSections: [] } },
    { ...emptyLocal, pinnedIds: ["stale"] }
  );
  expect(decision.action).toBe("adopt");
  if (decision.action !== "adopt") throw new Error("expected adopt");
  expect(decision.preferences.pinnedIds).toEqual([]);
});

test("local layout is pushed only when the server has none, and nothing is pushed when both are empty", () => {
  const server = { valid: true, settings: {} };
  expect(resolveSidebarSync(server, { ...emptyLocal, pinnedIds: ["a"] }).action).toBe("push");
  expect(resolveSidebarSync(server, emptyLocal).action).toBe("none");
  expect(resolveSidebarSync({ valid: false, settings: {} }, { ...emptyLocal, pinnedIds: ["a"] }).action).toBe("none");
});
