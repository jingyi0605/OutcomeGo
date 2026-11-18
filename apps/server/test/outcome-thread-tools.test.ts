import { expect, test } from "bun:test";
import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import { Effect } from "effect";
import { InternalToolService, type OutcomeThreadToolHandlers } from "../src/services/internal-tool-service";

const request = (tool: string): DynamicToolCallRequest => ({
  runId: "run", botId: "bot", conversationId: "conversation", channelId: "channel",
  deliveryId: null, callId: "call", tool, arguments: { fixture: true },
});

const service = (origin: string, workItemId: string | null, handlers: OutcomeThreadToolHandlers = {}) =>
  new InternalToolService(
    { run: { findUnique: async () => ({
      id: "run", botId: "bot", conversationId: "conversation", channelId: "channel",
      deliveryId: null, status: "running", origin, outcomeWorkItemId: workItemId, inboxEvents: [],
    }) } } as never,
    {} as never, {} as never, async () => {}, {} as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, handlers
  );

const errorOf = async (effect: ReturnType<InternalToolService["execute"]>) => {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Right") throw new Error("Expected a tool error");
  expect(result.left).toBeInstanceOf(ApiError);
  return result.left as ApiError;
};

for (const tool of ["RequestOutcomeDecision", "RequestHumanAction"] as const) {
  test(`${tool} reports an unregistered handler`, async () => {
    expect((await errorOf(service("outcome", "work").execute(request(tool)))).code).toBe("outcome_thread_tool_unavailable");
  });
  test(`${tool} requires a persisted Outcome thread identity`, async () => {
    for (const [origin, workItemId] of [["user", null], ["routine", null], ["outcome", null]] as const)
      expect((await errorOf(service(origin, workItemId).execute(request(tool)))).code).toBe("outcome_thread_required");
  });
  test(`${tool} dispatches its own handler with server-derived work item context`, async () => {
    const calls: unknown[] = [];
    const input = request(tool);
    const handler = async (...args: unknown[]) => { calls.push(args); return { status: "fixture" }; };
    expect(await Effect.runPromise(service("outcome", "work", { [tool]: handler }).execute(input))).toEqual({ status: "fixture" });
    expect(calls).toEqual([[input, { runId: "run", workItemId: "work", botId: "bot" }]]);
  });
}
