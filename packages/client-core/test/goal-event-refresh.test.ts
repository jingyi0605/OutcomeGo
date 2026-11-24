import { describe, expect, test } from "bun:test";
import type { ProductEvent } from "@outcomego/contracts";
import { shouldRefreshForEvent } from "../src/sync";

// Specs/004.10 task 3.2: goal-level signals tell an open goal to reload itself. They must not also make every client
// reload its whole snapshot, which is what an unknown topic does.
const event = (topic: string): ProductEvent => ({ sequence: "1", topic, entityId: "g", payload: {}, createdAt: "2026-11-25T00:00:00Z" });

describe("which events trigger a full refresh", () => {
  test("goal-level signals do not, a schedule change included", () => {
    for (const topic of ["goal.status.changed", "goal.progress.updated", "goal.thread.updated", "goal.schedule.changed"])
      expect(shouldRefreshForEvent(event(topic))).toBe(false);
  });

  test("an unknown topic still does, so a new kind of change is never silently missed", () => {
    expect(shouldRefreshForEvent(event("something.new.happened"))).toBe(true);
  });
});
