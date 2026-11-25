import { expect, test } from "bun:test";
import { createOpenTeamClient } from "../src";

test("routine creation preserves a supplied retry nonce and defaults other callers to fresh IDs", async () => {
  const calls: unknown[] = [];
  let nonce = 0;
  const client = createOpenTeamClient({
    baseUrl: "http://fixture",
    createId: () => `generated-${++nonce}`,
    fetch: (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }) as typeof fetch,
  });
  const input = { name: "Audit", prompt: "Inspect", schedule: "@every 1h", enabled: true };
  await client.createRoutine("bot", "bot", input, "stable-create");
  await client.createRoutine("bot", "bot", input, "stable-create");
  await client.createRoutine("bot", "bot", input);
  expect(calls).toEqual([
    { ...input, clientId: "stable-create" },
    { ...input, clientId: "stable-create" },
    { ...input, clientId: "generated-1" },
  ]);
});

test("run advice posts the saved revision and retry nonce to the preparation endpoint", async () => {
  const calls: unknown[] = [];
  const client = createOpenTeamClient({
    baseUrl: "http://fixture",
    fetch: (async (url, init) => {
      calls.push({ path: new URL(String(url)).pathname, method: init?.method, body: JSON.parse(String(init?.body)) });
      return Response.json({ kind: "preparation" });
    }) as typeof fetch,
  });
  expect(await client.prepareRoutine("routine", 3, "stable-advice")).toMatchObject({ kind: "preparation" });
  expect(calls).toEqual([{
    path: "/api/v0/routines/routine/prepare", method: "POST", body: { expectedRevision: 3, clientId: "stable-advice" },
  }]);
});
