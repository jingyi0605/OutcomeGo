import { expect, test } from "bun:test";
import { AUTOMATION_ATTEMPT_LIMIT, automationRetryDelay } from "../src/automation-retry";

test("automation outages get exactly three delayed retries, without changing foreground or external delivery policy", () => {
  expect(AUTOMATION_ATTEMPT_LIMIT).toBe(4);
  for (const type of ["routine.scheduled", "routine.manual", "routine.event", "automation.wake_parent", "request.check"]) {
    expect([1, 2, 3, 4, 5].map((attempt) => automationRetryDelay(type, attempt)))
      .toEqual([30_000, 120_000, 300_000, null, null]);
    for (const attempt of [0, -1, 1.5, NaN, Infinity]) expect(automationRetryDelay(type, attempt)).toBeNull();
  }
  for (const type of ["user.message", "connector.message", "bot.bootstrap", "ack.redrive", "runtime.reconcile", "subagent.completed"]) {
    expect(automationRetryDelay(type, 1)).toBeNull();
  }
});
