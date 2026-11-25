import { describe, expect, test } from "bun:test";
import { compareNeedsMe, needsMeZone, type NeedsMeItem } from "../src/task-overview";

// Specs/004.10 task 4.4: which request states reach the owner's queue, and in what order.
const item = (key: string, zone: NeedsMeItem["zone"], since: string) => ({ key, zone, since });

describe("which states need the owner", () => {
  test("only the three states a bot cannot resolve itself", () => {
    expect(needsMeZone("needs_owner")).toBe("blocked");
    expect(needsMeZone("no_follow_up")).toBe("exception");
    expect(needsMeZone("check_not_fired")).toBe("exception");
    for (const state of ["in_progress", "verifying", "waiting", "blocked", "completed", "running", "failed", "queued"] as const)
      expect(needsMeZone(state)).toBeNull();
  });
});

describe("the order of the queue", () => {
  test("exceptions come before blocked work, whatever the waiting time", () => {
    const sorted = [item("b", "blocked", "2020-01-01T00:00:00Z"), item("e", "exception", "2030-01-01T00:00:00Z")].sort(compareNeedsMe);
    expect(sorted.map((entry) => entry.key)).toEqual(["e", "b"]);
  });

  test("inside a zone the longest wait is first, and equal waits keep a stable order", () => {
    const sorted = [item("z", "blocked", "2024-02-01T00:00:00Z"), item("y", "blocked", "2024-01-01T00:00:00Z"), item("a", "blocked", "2024-02-01T00:00:00Z")].sort(compareNeedsMe);
    expect(sorted.map((entry) => entry.key)).toEqual(["y", "a", "z"]);
  });
});
