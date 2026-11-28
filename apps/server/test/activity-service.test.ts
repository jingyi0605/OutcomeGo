import { describe, expect, test } from "bun:test";
import { ACTIVE_REQUEST_WORKER_WHERE, activeRequestRunWhere } from "@outcomego/messaging";
import { ActivityService } from "../src/services/activity-service";
import { ScheduleService } from "../src/services/schedule-service";

describe("ActivityService and ScheduleService request filtering & owner stop", () => {
  test("a group task keeps its identity and creation date as its live status changes", async () => {
    const task = {
      id: "shared-task", channelId: "room", channel: { name: "Team" }, number: 3, title: "Verify the release",
      status: "in_progress", note: null, assigneeBotId: "bot",
      createdAt: new Date("2026-11-27T23:30:00Z"), updatedAt: new Date("2026-11-28T00:00:00Z"),
    };
    const prisma = {
      featureSettings: { findUnique: async () => null },
      run: { findMany: async () => [] },
      routine: { findMany: async () => [] },
      outcomeWorkItem: { findMany: async () => [] },
      outcome: { findMany: async () => [] },
      groupTask: { findMany: async () => [task] },
    } as never;
    const activity = new ActivityService(prisma);
    const schedule = new ScheduleService(prisma);
    const now = new Date("2026-11-28T01:00:00Z");
    const calendar = () => schedule.list("local", {
      from: "2026-11-27T16:00:00Z", to: "2026-11-28T16:00:00Z", kinds: ["group_task"],
    }, now, "Asia/Singapore");
    const shared = { id: "group_task:shared-task", title: "Team · #3 Verify the release", link: { type: "channel", id: "room" } };
    expect((await activity.list({}, now)).items).toEqual([expect.objectContaining({ ...shared, state: "in_progress" })]);
    expect((await calendar()).items).toEqual([expect.objectContaining({
      ...shared, state: "in_progress", start: "2026-11-28", allDay: true, editable: false,
    })]);
    task.status = "done";
    expect((await activity.list({}, now)).items).toEqual([expect.objectContaining({ ...shared, state: "completed" })]);
    expect((await calendar()).items).toEqual([expect.objectContaining({
      ...shared, state: "completed", start: "2026-11-28",
    })]);
  });

  test("needsMe and list use the aligned active-request filter and active-worker filter", async () => {
    const runQueries: unknown[] = [];
    const subagentQueries: unknown[] = [];
    const runId = "11111111-1111-4111-8111-111111111111";
    const botId = "22222222-2222-4222-8222-222222222222";
    const row = {
      id: runId,
      botId,
      conversationId: "33333333-3333-4333-8333-333333333333",
      channelId: null,
      userMessageId: "44444444-4444-4444-8444-444444444444",
      outcomeId: null,
      requestProgress: { state: "working", summary: "Working" },
      requestRevision: 1,
      requestReconciliations: 0,
      requestNextCheckAt: null,
      updatedAt: new Date("2026-11-27T12:00:00Z"),
    };
    const prisma = {
      featureSettings: { findUnique: async () => null },
      run: {
        findMany: async ({ where }: { where: unknown }) => {
          runQueries.push(where);
          return [row];
        },
      },
      message: { findMany: async () => [{ id: row.userMessageId, clientId: null, content: "Test request" }] },
      channelMessage: { findMany: async () => [] },
      subagent: {
        groupBy: async ({ where }: { where: unknown }) => {
          subagentQueries.push(where);
          return [];
        },
      },
      routine: { findMany: async () => [] },
      groupTask: { findMany: async () => [] },
      outcomeWorkItem: { findMany: async () => [] },
      outcome: { findMany: async () => [] },
    } as never;

    const activity = new ActivityService(prisma);
    await activity.needsMe(new Date("2026-11-27T12:05:00Z"));
    await activity.list({}, new Date("2026-11-27T12:05:00Z"));

    expect(runQueries).toHaveLength(2);
    for (const where of runQueries) {
      expect(where).toMatchObject({
        requestStoppedAt: null,
        bot: { status: "active" },
      });
      const clauses = (where as { AND: unknown[] }).AND;
      expect(clauses).toContainEqual({
        OR: [
          { status: { not: "cancelled" } },
          { status: "cancelled", error: { path: ["code"], equals: "priority_peer_interrupt" } },
        ],
      });
      expect(clauses).toContainEqual({
        OR: [{ channelId: null }, { channel: { archivedAt: null } }],
      });
    }
    expect(subagentQueries).toEqual([
      { requestRunId: { in: [runId] }, ...ACTIVE_REQUEST_WORKER_WHERE },
    ]);
  });

  test("ScheduleService.requestChecks uses the aligned active-request filter", async () => {
    const runQueries: unknown[] = [];
    const prisma = {
      featureSettings: { findUnique: async () => null },
      userTimeZoneSettings: { findUnique: async () => null },
      run: {
        findMany: async ({ where }: { where: unknown }) => {
          runQueries.push(where);
          return [];
        },
      },
      outcome: { findMany: async () => [] },
      outcomeWorkItem: { findMany: async () => [] },
      routine: { findMany: async () => [] },
      routineExecution: { findMany: async () => [] },
    } as never;

    const schedule = new ScheduleService(prisma);
    await schedule.list("local", {
      from: "2026-11-27T00:00:00Z",
      to: "2026-11-28T00:00:00Z",
      kinds: ["follow_up"],
    });

    expect(runQueries).toHaveLength(1);
    expect(runQueries[0]).toEqual(
      activeRequestRunWhere({
        requestNextCheckAt: { gte: new Date("2026-11-27T00:00:00Z"), lt: new Date("2026-11-28T00:00:00Z") },
        requestProgress: { path: ["state"], equals: "waiting" },
      })
    );
  });

  test("stopRequest stops the request, stops open subagents, cancels active run, and rejects missing request with 404", async () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const botId = "22222222-2222-4222-8222-222222222222";
    const stoppedRuns: string[] = [];
    const cancelledRuns: string[] = [];
    const workerCalls: Array<{ botId: string; requestRunId: string; callId: string }> = [];

    const tx = {
      $executeRaw: async () => 1,
      run: {
        findUnique: async () => ({ id: runId, origin: "user", inboxEvents: [] }),
        findMany: async () => [{ id: runId }],
        update: async ({ where }: { where: { id: string } }) => {
          stoppedRuns.push(where.id);
          return {};
        },
        updateMany: async () => ({ count: 0 }),
      },
      inboxEvent: {
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
      },
      event: { create: async () => ({}) },
    };
    const prisma = {
      run: {
        findFirst: async ({ where }: { where: { id: string } }) =>
          where.id === runId ? { id: runId, botId, status: "running" } : null,
      },
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx),
    } as never;

    const activity = new ActivityService(
      prisma,
      async (targetBotId, requestRunId, callId) => {
        workerCalls.push({ botId: targetBotId, requestRunId, callId });
        return 2;
      },
      async (targetRunId) => {
        cancelledRuns.push(targetRunId);
      }
    );

    await expect(activity.stopRequest("99999999-9999-4999-8999-999999999999")).rejects.toMatchObject({
      status: 404,
      code: "request_not_found",
    });

    const result = await activity.stopRequest(runId);
    expect(result).toEqual({ stopped: true, requestRunId: runId, stoppedWorkers: 2 });
    expect(stoppedRuns).toEqual([runId]);
    expect(workerCalls).toEqual([{ botId, requestRunId: runId, callId: `owner-stop:request:${runId}` }]);
    expect(cancelledRuns).toEqual([runId]);
  });
});
