import { expect, test } from "bun:test";
import { createJsonTransport } from "@outcomego/client-core/http";
import type { ExploreProposal } from "@outcomego/contracts/explore";
import { createExploreApi } from "../src/renderer/components/outcomego/outcomes/explore/explore-api";
import { proposeExploreIdea } from "../src/renderer/components/outcomego/outcomes/explore/explore-state";
import { OutcomeRequestIds } from "../src/renderer/components/outcomego/outcomes/planning/outcome-client";
import { exploreFixture } from "./outcome-client-fixtures";
import { planFixture } from "./outcome-fixture";

const proposal: ExploreProposal = { idea: { ...exploreFixture, status: "proposed_for_delivery", planningDraftId: planFixture.planId }, plan: planFixture };
const failure = () => Response.json({ error: { code: "planning_generation_failed", message: "Retry with a new request ID" } }, { status: 502 });

test("confirmed terminal generation failure permits fresh inference for the same idea and Bot", async () => {
  const bodies: Array<{ botId: string; clientRequestId: string }> = [];
  const receipts = new Map<string, boolean>();
  let inferences = 0;
  const client = createExploreApi(createJsonTransport({
    baseUrl: "https://server.test", getAuthToken: () => "current-account",
    fetch: async (url, init) => {
      expect(url).toBe(`https://server.test/api/explore/${exploreFixture.id}/propose`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer current-account");
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      if (!receipts.has(body.clientRequestId)) receipts.set(body.clientRequestId, ++inferences > 1);
      return receipts.get(body.clientRequestId) ? Response.json(proposal) : failure();
    },
  }).request);
  const ids = new OutcomeRequestIds();
  const input = { botId: planFixture.botId };
  await expect(proposeExploreIdea(client, ids, exploreFixture.id, input)).rejects.toMatchObject({ status: 502, code: "planning_generation_failed" });
  expect(inferences).toBe(1);
  expect(bodies).toHaveLength(1);
  const result = await proposeExploreIdea(client, ids, exploreFixture.id, input);
  expect(result).toEqual(proposal);
  expect(bodies[1]!.clientRequestId).not.toBe(bodies[0]!.clientRequestId);
  expect(bodies.map(body => body.botId)).toEqual([input.botId, input.botId]);
  expect(inferences).toBe(2);
});

test("lost successful proposal response reuses the exact body and key without duplicate inference", async () => {
  const bodies: string[] = [];
  const receipts = new Set<string>();
  let inferences = 0;
  const client = createExploreApi(createJsonTransport({
    baseUrl: "https://server.test",
    fetch: async (_url, init) => {
      bodies.push(String(init?.body));
      const { clientRequestId } = JSON.parse(String(init?.body));
      if (!receipts.has(clientRequestId)) {
        receipts.add(clientRequestId); inferences++;
        throw new Error("Response lost after commit");
      }
      return Response.json(proposal);
    },
  }).request);
  const ids = new OutcomeRequestIds();
  const input = { botId: planFixture.botId };
  await expect(proposeExploreIdea(client, ids, exploreFixture.id, input)).rejects.toMatchObject({ code: "offline" });
  expect(await proposeExploreIdea(client, ids, exploreFixture.id, input)).toEqual(proposal);
  expect(bodies[1]).toBe(bodies[0]);
  expect(inferences).toBe(1);
});

test("generic gateway errors, unknown codes and malformed responses preserve ambiguous request intent", async () => {
  for (const response of [
    Response.json({ error: { code: "planning_generation_failed" } }, { status: 500 }),
    Response.json({ error: { code: "unknown_gateway_failure" } }, { status: 502 }),
    new Response("Bad Gateway", { status: 502 }),
    new Response("not a JSON success", { status: 200 }),
  ]) {
    const bodies: string[] = [];
    const client = createExploreApi(createJsonTransport({
      baseUrl: "https://server.test", fetch: async (_url, init) => {
        bodies.push(String(init?.body));
        return bodies.length === 1 ? response : Response.json(proposal);
      },
    }).request);
    const ids = new OutcomeRequestIds();
    await expect(proposeExploreIdea(client, ids, exploreFixture.id, {})).rejects.toThrow();
    expect(await proposeExploreIdea(client, ids, exploreFixture.id, {})).toEqual(proposal);
    expect(bodies[1]).toBe(bodies[0]);
  }
});
