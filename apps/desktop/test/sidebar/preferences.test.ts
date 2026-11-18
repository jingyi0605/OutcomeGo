import { describe, expect, test } from "bun:test";
import {
  addSidebarUnread,
  removeSidebarUnread,
  sidebarLayoutChanged,
  toggleSidebarUnread,
} from "@outcomego/contracts/client-preferences";
import type { SidebarPreferences } from "../../src/renderer/hooks/use-sidebar-preferences";

const preferences = (unreadIds: string[]): SidebarPreferences => ({
  version: 2,
  pinnedIds: [],
  unreadIds,
  unassignedCollapsed: false,
  sections: [],
  sectionByChannel: {},
  channelOrderByGroup: {},
});

describe("batched sidebar unread preferences", () => {
  test("merges a large activity burst in one immutable update", () => {
    const current = preferences(["existing"]);
    const next = addSidebarUnread(
      current,
      Array.from({ length: 1_000 }, (_, index) => `channel-${index}`)
    );

    expect(next).not.toBe(current);
    expect(next.unreadIds).toHaveLength(1_001);
    expect(addSidebarUnread(next, ["channel-4", "existing"])).toBe(next);
  });

  test("removes a burst once and preserves identity when nothing matches", () => {
    const current = preferences(["one", "two", "three"]);
    expect(removeSidebarUnread(current, ["one", "three"]).unreadIds).toEqual(["two"]);
    expect(removeSidebarUnread(current, ["missing"])).toBe(current);
  });

  test("toggles unread state through the shared preference reducer", () => {
    const current = preferences([]);
    const unread = toggleSidebarUnread(current, "one");
    expect(unread.unreadIds).toEqual(["one"]);
    expect(toggleSidebarUnread(unread, "one").unreadIds).toEqual([]);
  });
});

describe("sidebar layout change detection", () => {
  const withSection = (): SidebarPreferences => ({
    ...preferences([]),
    pinnedIds: ["pin"],
    sections: [{ id: "s1", name: "研发管理", collapsed: false }],
    sectionByChannel: { a: "s1", b: "s1" },
  });

  test("ignores client-local fields so unread changes are never pushed", () => {
    const current = withSection();
    expect(sidebarLayoutChanged(current, { ...current, unreadIds: ["a"] })).toBe(false);
    expect(sidebarLayoutChanged(current, { ...current, unassignedCollapsed: true })).toBe(false);
    expect(sidebarLayoutChanged(current, { ...current, channelOrderByGroup: { s1: ["b", "a"] } })).toBe(false);
  });

  test("ignores assignment key order and assignments to unknown sections", () => {
    const current = withSection();
    const reordered = { ...current, sectionByChannel: { b: "s1", a: "s1", c: "gone" } };
    expect(sidebarLayoutChanged(current, reordered)).toBe(false);
  });

  test("detects pins, sections and assignments", () => {
    const current = withSection();
    expect(sidebarLayoutChanged(current, { ...current, pinnedIds: [] })).toBe(true);
    expect(sidebarLayoutChanged(current, { ...current, sections: [] })).toBe(true);
    expect(sidebarLayoutChanged(current, { ...current, sectionByChannel: { a: "s1" } })).toBe(true);
    expect(
      sidebarLayoutChanged(current, {
        ...current,
        sections: [{ id: "s1", name: "x", collapsed: false }],
      })
    ).toBe(true);
  });
});
