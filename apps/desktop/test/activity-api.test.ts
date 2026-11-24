import { expect, test } from "bun:test";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";

// Specs/004.10 task 4.3: the activity call is a plain GET with only the filters that were asked for.
const recorder = () => {
  const calls: string[] = [];
  const client = createOutcomeApi(async <T>(path: string) => (calls.push(path), { items: [], truncated: false } as T));
  return { calls, client };
};

test("with no filter it is one plain GET", async () => {
  const { calls, client } = recorder();
  await client.activity!();
  await client.activity!({});
  expect(calls).toEqual(["/api/activity", "/api/activity"]);
});

test("each filter is sent as asked, and 'show all' only when it is on", async () => {
  const { calls, client } = recorder();
  await client.activity!({ botId: "bot/one", includeAll: true, recentHours: 48 });
  await client.activity!({ includeAll: false });
  expect(calls).toEqual(["/api/activity?botId=bot%2Fone&includeAll=true&recentHours=48", "/api/activity"]);
});
