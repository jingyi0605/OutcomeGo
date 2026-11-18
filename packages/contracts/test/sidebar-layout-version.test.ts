import { describe, expect, test } from "bun:test";
import {
  INITIAL_SIDEBAR_LAYOUT_VERSION,
  emptySidebarPreferences,
  mergeSidebarLayout,
  parseSidebarLayoutConflict,
  parseSidebarLayoutVersion,
  resolveSidebarSync,
  sidebarVersionEquals,
  sidebarVersionFromRootSettings,
  sidebarVersionLeads,
  withSidebarBase,
  type RootSettingsView,
} from "../src/client-preferences";

const version = (revision: number, updatedAt: string) => ({ revision, updatedAt });

describe("sidebar layout version ordering", () => {
  const known = version(3, "2026-11-18T10:00:00.000Z");

  test("a version leads only when revision and timestamp both lead", () => {
    expect(sidebarVersionLeads(version(4, "2026-11-18T10:00:00.001Z"), known)).toBe(true);
    expect(sidebarVersionLeads(version(4, "2026-11-18T10:00:00.000Z"), known)).toBe(false);
    expect(sidebarVersionLeads(version(3, "2026-11-18T11:00:00.000Z"), known)).toBe(false);
    expect(sidebarVersionLeads(version(9, "2026-11-18T09:00:00.000Z"), known)).toBe(false);
    expect(sidebarVersionLeads(known, known)).toBe(false);
  });

  test("equality needs both fields", () => {
    expect(sidebarVersionEquals(known, { ...known })).toBe(true);
    expect(sidebarVersionEquals(known, version(3, "2026-11-18T10:00:00.001Z"))).toBe(false);
    expect(sidebarVersionEquals(known, version(4, known.updatedAt))).toBe(false);
  });

  test("rejects malformed versions", () => {
    expect(parseSidebarLayoutVersion({ revision: -1, updatedAt: known.updatedAt })).toBeNull();
    expect(parseSidebarLayoutVersion({ revision: 1.5, updatedAt: known.updatedAt })).toBeNull();
    expect(parseSidebarLayoutVersion({ revision: 1, updatedAt: "not a date" })).toBeNull();
    expect(parseSidebarLayoutVersion({ revision: "1", updatedAt: known.updatedAt })).toBeNull();
    expect(parseSidebarLayoutVersion(null)).toBeNull();
    expect(parseSidebarLayoutVersion(known)).toEqual(known);
  });
});

describe("sidebar sync decisions carry the server version", () => {
  const root = (settings: RootSettingsView["settings"]): RootSettingsView => ({
    settings,
    valid: true,
  });

  test("a server that predates versioning reports the initial version", () => {
    expect(sidebarVersionFromRootSettings(root({}))).toEqual(INITIAL_SIDEBAR_LAYOUT_VERSION);
  });

  test("adopts the server layout together with its version", () => {
    const meta = version(2, "2026-11-18T10:00:00.000Z");
    const decision = resolveSidebarSync(
      root({
        sidebarMeta: meta,
        pinnedAgentIds: [],
        sidebarSections: [{ id: "dev", name: "研发管理", agentIds: ["a"], isCollapsed: false }],
      }),
      emptySidebarPreferences()
    );
    expect(decision.action).toBe("adopt");
    if (decision.action !== "adopt") return;
    expect(decision.version).toEqual(meta);
    expect(decision.preferences.sectionByChannel).toEqual({ a: "dev" });
  });

  test("pushes a local layout to an unversioned empty server against the initial version", () => {
    const local = { ...emptySidebarPreferences(), pinnedIds: ["a"] };
    const decision = resolveSidebarSync(root({}), local);
    expect(decision).toEqual({
      action: "push",
      preferences: local,
      version: INITIAL_SIDEBAR_LAYOUT_VERSION,
    });
  });
});

describe("conflict handling helpers", () => {
  test("parses the layout and version out of a conflict body", () => {
    const preferences = {
      ...emptySidebarPreferences(),
      sections: [{ id: "dev", name: "研发管理", collapsed: false }],
      sectionByChannel: { a: "dev" },
    };
    const conflict = parseSidebarLayoutConflict({
      current: { preferences, revision: 5, updatedAt: "2026-11-18T10:00:00.000Z" },
    });
    expect(conflict?.version).toEqual(version(5, "2026-11-18T10:00:00.000Z"));
    expect(conflict?.preferences.sections).toEqual(preferences.sections);
    expect(parseSidebarLayoutConflict({ current: { revision: 5 } })).toBeNull();
    expect(parseSidebarLayoutConflict(undefined)).toBeNull();
  });

  test("merging a remote layout keeps the client-local fields", () => {
    const local = {
      ...emptySidebarPreferences(),
      unreadIds: ["u"],
      unassignedCollapsed: true,
      channelOrderByGroup: { dev: ["a"] },
      pinnedIds: ["old"],
    };
    const remote = {
      ...emptySidebarPreferences(),
      pinnedIds: ["new"],
      sections: [{ id: "dev", name: "研发管理", collapsed: false }],
      sectionByChannel: { a: "dev" },
    };
    expect(mergeSidebarLayout(local, remote)).toEqual({
      ...local,
      pinnedIds: ["new"],
      sections: remote.sections,
      sectionByChannel: remote.sectionByChannel,
    });
  });

  test("withSidebarBase names the version the edit was based on", () => {
    const base = version(7, "2026-11-18T10:00:00.000Z");
    expect(withSidebarBase(emptySidebarPreferences(), base)).toMatchObject({
      baseRevision: 7,
      baseUpdatedAt: base.updatedAt,
    });
  });
});
