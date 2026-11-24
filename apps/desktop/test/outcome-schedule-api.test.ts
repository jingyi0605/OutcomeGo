import { expect, test } from "bun:test";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";
import { outcomeFixture } from "./outcome-fixture";

// Specs/004.10 task 3.2: the owner's date changes go to the two PUT endpoints, with the request ID in the body.
const recorder = () => {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const request = async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return outcomeFixture as T;
  };
  return { calls, client: createOutcomeApi(request) };
};

test("a task's schedule change is a PUT to that task, carrying only the fields given and the request ID", async () => {
  const { calls, client } = recorder();
  await client.setWorkItemSchedule!("outcome/one", "task/two", { scheduledAt: "2026-12-01T09:00:00.000Z", estimateMinutes: null, clientRequestId: "request-1234" });
  expect(calls).toEqual([
    {
      path: "/api/outcomes/outcome%2Fone/work-items/task%2Ftwo/schedule",
      method: "PUT",
      body: { scheduledAt: "2026-12-01T09:00:00.000Z", estimateMinutes: null, clientRequestId: "request-1234" },
    },
  ]);
});

test("the goal's due date is a PUT to the goal, and null clears it", async () => {
  const { calls, client } = recorder();
  await client.setDue!("outcome/one", { dueAt: null, clientRequestId: "request-5678" });
  expect(calls).toEqual([{ path: "/api/outcomes/outcome%2Fone/due", method: "PUT", body: { dueAt: null, clientRequestId: "request-5678" } }]);
});
