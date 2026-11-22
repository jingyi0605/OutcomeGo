import { expect, test } from "bun:test";
import { OUTCOME_THREAD_PRIORITY, OUTCOME_THREAD_SYSTEM_PRIORITY } from "@outcomego/messaging";
import {
  canClaimThreadTurn,
  countThreadLeasesByRole,
  PLANNER_TURN_CONCURRENCY,
  REVIEWER_TURN_CONCURRENCY,
} from "../src/thread-concurrency";

test("planner and reviewer thread turns each cap at 5 independently of work-item concurrency", () => {
  const map = new Map([
    ["r1", "plan" as const],
    ["r2", "owner_message" as const],
    ["r3", "replan" as const],
    ["r4", "plan" as const],
    ["r5", "replan" as const],
    ["r6", "review" as const],
    ["r7", "review_task" as const],
  ]);
  const counts = countThreadLeasesByRole(["r1", "r2", "r3", "r4", "r5", "r6", "r7"], map);
  expect(counts).toEqual({ planner: 5, reviewer: 2 });
  expect(PLANNER_TURN_CONCURRENCY).toBe(5);
  expect(REVIEWER_TURN_CONCURRENCY).toBe(5);

  // 6th planner turn must wait, while reviewer turns remain claimable up to 5.
  expect(canClaimThreadTurn("plan", counts)).toBe(false);
  expect(canClaimThreadTurn("owner_message", counts)).toBe(false);
  expect(canClaimThreadTurn("replan", counts)).toBe(false);
  expect(canClaimThreadTurn("review", counts)).toBe(true);
  expect(canClaimThreadTurn("review_task", counts)).toBe(true);

  const reviewerFull = countThreadLeasesByRole(
    ["v1", "v2", "v3", "v4", "v5"],
    new Map([
      ["v1", "review" as const],
      ["v2", "review_task" as const],
      ["v3", "review" as const],
      ["v4", "review_task" as const],
      ["v5", "review" as const],
    ])
  );
  expect(canClaimThreadTurn("review_task", reviewerFull)).toBe(false);
  expect(canClaimThreadTurn("owner_message", reviewerFull)).toBe(true);
});

test("owner messages take priority over system-triggered replan/review turns", () => {
  expect(OUTCOME_THREAD_PRIORITY).toBeGreaterThan(OUTCOME_THREAD_SYSTEM_PRIORITY);
  expect(OUTCOME_THREAD_SYSTEM_PRIORITY).toBeGreaterThan(280);
});
