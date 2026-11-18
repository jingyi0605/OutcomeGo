import { afterEach, expect, test } from "bun:test";
import type { ProductEvent } from "@outcomego/contracts";
import {
  OUTCOME_REFRESH_DEBOUNCE_MS,
  refreshOutcomeViews,
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

test("work item, status and decision events refresh the open goal once per burst", async () => {
  const a = watch("a");
  const b = watch("b");
  for (const topic of ["outcome.work_item.updated", "outcome.status_changed", "outcome.decision.resolved"])
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
