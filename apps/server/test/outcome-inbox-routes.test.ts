import { describe, expect, test } from "bun:test";
import { createOutcomeInboxRoutes } from "../src/routes/outcome-inbox";
import type { RouteContext } from "../src/routes/context";
import type { DecisionService } from "../src/services/decision-service";
import type { OutcomeInboxService } from "../src/services/outcome-inbox-service";
import { Effect } from "effect";
const id = "11111111-1111-4111-8111-111111111111";
const context = (path: string, init?: RequestInit, required = false) => ({ request: new Request(`http://localhost${path}`, init), url: new URL(`http://localhost${path}`), path: path.split("?")[0], authMode: required ? "required" : "disabled", authenticatedSessionId: null }) as RouteContext;
describe("Outcome inbox routes", () => {
  test("rejects unauthenticated requests before private service queries", async () => {
    const route = createOutcomeInboxRoutes({} as DecisionService, {} as OutcomeInboxService);
    await expect(route(context("/api/outcome-inbox", undefined, true))).rejects.toMatchObject({ status: 401 });
  });
  test("rejects invalid cursor, invalid IDs and non-integer revision number", async () => {
    const route = createOutcomeInboxRoutes({} as DecisionService, {} as OutcomeInboxService);
    await expect(route(context("/api/outcome-inbox?cursor=bad"))).rejects.toMatchObject({ status: 400 });
    await expect(route(context("/api/decisions/bad"))).rejects.toMatchObject({ status: 400 });
    await expect(route(context(`/api/decisions/${id}/resolve`, { method: "POST", body: JSON.stringify({ expectedContractRevision: id, clientRequestId: "request-1" }) }))).rejects.toMatchObject({ status: 400 });
  });
  test("public resolve trusts server actor and strips client effect, actor and status", async () => {
    let got: unknown;
    const decisions = { resolve: (_id: string, input: unknown, actor: unknown) => { got = { id: _id, input, actor }; return Effect.succeed({ status: "resolved" }); } } as unknown as DecisionService;
    const route = createOutcomeInboxRoutes(decisions, {} as OutcomeInboxService);
    const response = await route(context(`/api/decisions/${id}/resolve`, { method: "POST", body: JSON.stringify({ optionId: "continue", expectedContractRevision: 2, clientRequestId: "request-1", actorRef: "bot:evil", status: "resolved", resolutionEffect: "scope_change" }) }));
    expect(response?.status).toBe(200);
    expect(got).toEqual({ id, input: { optionId: "continue", expectedContractRevision: 2, clientRequestId: "request-1" }, actor: "owner:local" });
  });
});
