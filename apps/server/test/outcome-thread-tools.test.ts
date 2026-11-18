import { expect, test } from "bun:test";
import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import { Effect } from "effect";
import { InternalToolService, type OutcomeThreadToolHandlers } from "../src/services/internal-tool-service";
import { createOutcomeProgressTool } from "../src/services/outcome-progress-tool";

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

for (const tool of ["RequestOutcomeDecision", "RequestHumanAction", "ReportOutcomeProgress"] as const) {
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

test("ReportOutcomeProgress rejects invalid arguments and updates work item progress", async () => {
  const updates: unknown[] = [];
  const events: unknown[] = [];
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: async () => 1,
        outcomeWorkItem: {
          findUnique: async () => ({ outcomeId: "outcome-1" }),
          findUniqueOrThrow: async () => ({
            id: "work-1",
            outcomeId: "outcome-1",
            contractRevisionId: "rev-1",
            botId: "bot",
            executorType: "agent",
            status: "running",
            contractRevision: { revision: 2 },
            outcome: { cancelledAt: null, acceptedAt: null },
          }),
          update: async (args: unknown) => {
            updates.push(args);
            return {};
          },
        },
        run: {
          findUnique: async () => ({
            id: "run",
            botId: "bot",
            status: "running",
            origin: "outcome",
            outcomeWorkItemId: "work-1",
          }),
        },
        event: {
          create: async (args: unknown) => {
            events.push(args);
            return {};
          },
        },
      }),
  } as never;

  const tool = createOutcomeProgressTool(prisma);
  await expect(
    tool(
      { ...request("ReportOutcomeProgress"), arguments: { phase: "", tasks: [] } },
      { runId: "run", workItemId: "work-1", botId: "bot" }
    )
  ).rejects.toThrow();

  const result = (await tool(
    {
      ...request("ReportOutcomeProgress"),
      arguments: {
        phase: "盘点存储占用",
        summary: "正在扫描 /mnt/user 目录",
        tasks: [
          { id: "scan", title: "扫描目录占用", status: "in_progress" },
          { id: "plan", title: "输出分级清理方案", status: "pending" },
        ],
      },
    },
    { runId: "run", workItemId: "work-1", botId: "bot" }
  )) as { updated: boolean; progress: { phase: string; tasks: Array<{ id: string; status: string }> } };

  expect(result.updated).toBe(true);
  expect(result.progress.phase).toBe("盘点存储占用");
  expect(result.progress.tasks).toHaveLength(2);
  expect(updates).toHaveLength(1);
  expect(events).toHaveLength(2);
});
