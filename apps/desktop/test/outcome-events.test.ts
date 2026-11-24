import { afterEach, expect, test } from "bun:test";
import type { ProductEvent } from "@outcomego/contracts";
import {
  OUTCOME_REFRESH_DEBOUNCE_MS,
  refreshOutcomeViews,
  subscribeOutcomeListRefresh,
  subscribeOutcomeRefresh,
} from "../src/renderer/lib/outcome-events";

const event = (topic: string, entityId: string | null): ProductEvent => ({
  sequence: "1", topic, entityId, payload: {}, createdAt: "2026-11-18T00:00:00Z",
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const watch = (id: string) => {
  let count = 0;
  cleanups.push(subscribeOutcomeRefresh(id, () => count++));
  return () => count;
};

test("progress reports refresh the matching goal immediately", () => {
  const a = watch("a");
  const b = watch("b");
  refreshOutcomeViews(event("goal.progress.updated", "a"));
  expect([a(), b()]).toEqual([1, 0]);
});

// Specs/004.10 task 3.2: the client stream carries no `outcome.*` topics, so a schedule change (the owner's, or a bot
// deferring its own task) reaches an open goal through this dedicated goal signal.
test("a schedule change refreshes the matching open goal once per burst, and not another goal or the list", async () => {
  const a = watch("a");
  const b = watch("b");
  let listReloads = 0;
  cleanups.push(subscribeOutcomeListRefresh(() => listReloads++));
  for (let i = 0; i < 3; i++) refreshOutcomeViews(event("goal.schedule.changed", "a"));
  expect(a()).toBe(0);
  await wait(OUTCOME_REFRESH_DEBOUNCE_MS + 80);
  expect([a(), b(), listReloads]).toEqual([1, 0, 0]);
});

test("thread completion, work item, status and decision events refresh the open goal once per burst", async () => {
  const a = watch("a");
  const b = watch("b");
  for (const topic of ["goal.thread.updated", "outcome.work_item.updated", "outcome.status_changed", "outcome.decision.resolved"])
    refreshOutcomeViews(event(topic, "a"));
  expect(a()).toBe(0);
  await wait(OUTCOME_REFRESH_DEBOUNCE_MS + 80);
  expect([a(), b()]).toEqual([1, 0]);
});

test("the duplicate outcome.progress.updated event and unrelated topics do not refresh", async () => {
  const a = watch("a");
  refreshOutcomeViews(event("outcome.progress.updated", "a"));
  refreshOutcomeViews(event("message.created", "a"));
  refreshOutcomeViews(event("outcome.status_changed", "unwatched"));
  await wait(OUTCOME_REFRESH_DEBOUNCE_MS + 80);
  expect(a()).toBe(0);
});

test("a snapshot reset refreshes every open goal", () => {
  const a = watch("a");
  const b = watch("b");
  refreshOutcomeViews(event("snapshot.required", null));
  expect([a(), b()]).toEqual([1, 1]);
});

test("goal status changes and reconnects refresh aggregate views, other topics do not", async () => {
  let count = 0;
  cleanups.push(subscribeOutcomeListRefresh(() => count++));
  refreshOutcomeViews(event("goal.status.changed", "a"));
  refreshOutcomeViews(event("goal.status.changed", "b"));
  expect(count).toBe(0);
  await wait(OUTCOME_REFRESH_DEBOUNCE_MS + 80);
  expect(count).toBe(1);
  refreshOutcomeViews(event("outcome.work_item.updated", "a"));
  await wait(OUTCOME_REFRESH_DEBOUNCE_MS + 80);
  expect(count).toBe(1);
  refreshOutcomeViews();
  expect(count).toBe(2);
});
