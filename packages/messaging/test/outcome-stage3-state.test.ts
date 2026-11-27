import { expect, test } from "bun:test";
import { recomputeOutcomeStatus, transitionWorkItem } from "../src/outcome-state";
import { outcomeRunContext } from "../src/outcome-threads";

type Row = Record<string, any>;

test("recomputeOutcomeStatus follows §4.2 rules on failure, replan, blocked dependents, and superseding tasks", async () => {
  const derive = async (opts: {
    workItems: Row[];
    replanTurns?: number;
    stored?: string;
  }) => {
    const updates: Row[] = [];
    const tx: Row = {
      $executeRaw: async () => 0,
      outcome: {
        findUniqueOrThrow: async () => ({
          id: "o1",
          status: opts.stored ?? "running",
          resumeStatus: null,
          kind: "standard",
          cancelledAt: null,
          acceptedAt: null,
          currentRevision: { id: "r1", status: "approved", revision: 1 },
          workItems: opts.workItems,
        }),
        update: async ({ data }: Row) => void updates.push(data),
      },
      outcomeThreadTurn: {
        count: async ({ where }: Row) => {
          if (where.purpose === "replan") return opts.replanTurns ?? 0;
          return 0;
        },
      },
      outcomeDecision: { count: async () => 0 },
      event: { create: async () => ({}) },
    };
    return recomputeOutcomeStatus(tx as never, "o1", "system:test");
  };

  // 1 failed + 1 completed, no replan, no superseding -> failed (not review_pending)
  expect(
    await derive({
      workItems: [
        { id: "w1", contractRevisionId: "r1", executorType: "agent", status: "completed", ordinal: 1, dependsOn: [], reworkOfWorkItemId: null, rootRunId: "run1" },
        { id: "w2", contractRevisionId: "r1", executorType: "agent", status: "failed", ordinal: 2, dependsOn: [], reworkOfWorkItemId: null, rootRunId: "run2" },
      ],
    })
  ).toBe("failed");

  // Manually ending the only executor is not a pending start or a successful execution.
  expect(await derive({ workItems: [{
    id: "stopped", contractRevisionId: "r1", executorType: "agent", status: "cancelled",
    statusReason: "outcome_stopped", ordinal: 1, dependsOn: [], rootRunId: "run1",
  }] })).toBe("failed");

  // Failed + active replan turn -> keeps running
  expect(
    await derive({
      workItems: [
        { id: "w1", contractRevisionId: "r1", executorType: "agent", status: "completed", ordinal: 1, dependsOn: [], reworkOfWorkItemId: null, rootRunId: "run1" },
        { id: "w2", contractRevisionId: "r1", executorType: "agent", status: "failed", ordinal: 2, dependsOn: [], reworkOfWorkItemId: null, rootRunId: "run2" },
      ],
      replanTurns: 1,
    })
  ).toBe("running");

  // Queued downstream task blocked by failed dependency does not count as active or superseding -> failed
  expect(
    await derive({
      workItems: [
        { id: "w1", contractRevisionId: "r1", executorType: "agent", status: "failed", ordinal: 1, dependsOn: [], reworkOfWorkItemId: null, rootRunId: "run1" },
        { id: "w2", contractRevisionId: "r1", executorType: "agent", status: "queued", ordinal: 2, dependsOn: ["w1"], reworkOfWorkItemId: null, rootRunId: null },
      ],
    })
  ).toBe("failed");

  // Replacement task (higher ordinal, not blocked) completed -> review_pending
  expect(
    await derive({
      workItems: [
        { id: "w1", contractRevisionId: "r1", executorType: "agent", status: "failed", ordinal: 1, dependsOn: [], reworkOfWorkItemId: null, rootRunId: "run1" },
        { id: "w3", contractRevisionId: "r1", executorType: "agent", status: "completed", ordinal: 3, dependsOn: [], reworkOfWorkItemId: null, rootRunId: "run3" },
      ],
    })
  ).toBe("review_pending");
});

test("transitionWorkItem queues replan on failed or needs_review when planner role is active, and skips when unset", async () => {
  const makeTx = (plannerBotId: string | null) => {
    const item: Row = {
      id: "wi-fail",
      outcomeId: "o1",
      contractRevisionId: "r1",
      botId: "bot-exec",
      executorType: "agent",
      status: "running",
      title: "Build chart",
      planKey: "chart",
      startedAt: new Date(),
      completedAt: null,
      ordinal: 1,
    };
    const wakes: Row[] = [];
    const turns: Row[] = [];
    const events: Row[] = [];
    const tx: Row = {
      $executeRaw: async () => 0,
      idempotencyRecord: { findUnique: async () => null, create: async () => ({}) },
      featureSettings: {
        findUnique: async () => ({
          outcomesEnabled: true,
          plannerBotId,
        }),
      },
      bot: {
        findUnique: async () => ({ id: "bot-planner", status: "active", subagentIdentity: null, conversation: { id: "c1" } }),
      },
      channel: { findFirst: async () => ({ id: "dm-planner" }) },
      outcomeWorkItem: {
        findUnique: async () => item,
        findUniqueOrThrow: async () => item,
        update: async ({ data }: Row) => Object.assign(item, data),
      },
      outcome: {
        findUnique: async () => ({ id: "o1", botId: "bot-main", title: "Goal", cancelledAt: null, acceptedAt: null }),
        findUniqueOrThrow: async () => ({
          id: "o1",
          status: "running",
          resumeStatus: null,
          kind: "standard",
          cancelledAt: null,
          acceptedAt: null,
          currentRevision: { id: "r1", status: "approved", revision: 1 },
          workItems: [{ ...item }],
        }),
        update: async () => ({}),
      },
      outcomeThread: {
        upsert: async ({ create }: Row) => ({ id: "th-planner", ...create }),
      },
      outcomeThreadTurn: {
        findFirst: async () => null,
        create: async ({ data }: Row) => {
          const t = { id: `turn-${turns.length + 1}`, status: "queued", ...data };
          turns.push(t);
          return t;
        },
        update: async ({ where, data }: Row) => Object.assign(turns.find((t) => t.id === where.id)!, data),
        count: async () => turns.length,
      },
      outcomeDecision: { count: async () => 0 },
      event: { create: async ({ data }: Row) => void events.push(data) },
    };
    const messaging = {
      enqueueWake: async (_t: Row, input: Row) => {
        wakes.push(input);
        return { run: { id: `run-${wakes.length}` } };
      },
    };
    return { tx, messaging, wakes, turns, events };
  };

  // Active planner role -> transitions to needs_review & queues replan
  const active = makeTx("bot-planner");
  await transitionWorkItem(active.tx as never, {
    workItemId: "wi-fail",
    to: "needs_review",
    reason: "worker_disconnected",
    actor: "system:outcome-recovery",
    messaging: active.messaging as never,
  });
  expect(active.wakes).toHaveLength(1);
  expect(active.wakes[0]!.botId).toBe("bot-planner");
  expect(active.turns[0]!.purpose).toBe("replan");
  expect(active.turns[0]!.triggerBy).toBe("system:task_failed");
  expect(active.events.some((e) => e.topic === "outcome.replan.requested")).toBe(true);

  // Unset planner role -> stays 004.8 behavior (no replan queued)
  const unset = makeTx(null);
  await transitionWorkItem(unset.tx as never, {
    workItemId: "wi-fail",
    to: "failed",
    reason: "run_failed",
    actor: "system:outcome-runtime",
    messaging: unset.messaging as never,
  });
  expect(unset.wakes).toHaveLength(0);
  expect(unset.turns).toHaveLength(0);
});

test("outcomeRunContext includes covered criteria, task instructions, and upstream output summaries", async () => {
  const revision = {
    id: "r1",
    revision: 2,
    status: "approved",
    approvedAt: new Date(),
    goal: ["Create release summary"],
    boundaries: { included: ["Q3 metrics"], excluded: ["Pricing changes"] },
    plan: {
      notes: "Internal planner note",
      tasks: [
        {
          key: "collect",
          title: "Collect",
          instructions: "Collect numbers",
          botId: "bot-a",
          covers: ["c1"],
          nature: "action",
        },
        {
          key: "write",
          title: "Write",
          instructions: "Write final markdown using collected data",
          botId: "bot-b",
          dependsOn: ["collect"],
          covers: ["c2"],
          nature: "deliverable",
        },
      ],
    },
    criteria: [
      { id: "c1", statement: "Data collected", required: false },
      { id: "c2", statement: "Markdown published", required: true },
    ],
  };
  const db: Row = {
    outcomeWorkItem: {
      findFirst: async () => ({
        id: "w-write",
        outcomeId: "o1",
        botId: "bot-b",
        executorType: "agent",
        title: "Write",
        instructions: "Write final markdown using collected data",
        planKey: "write",
        dependsOn: ["w-collect"],
        reworkOfWorkItemId: null,
        progress: null,
        contractRevision: revision,
      }),
      findMany: async () => [
        {
          id: "w-collect",
          planKey: "collect",
          title: "Collect",
          outputs: [{ kind: "final_result", title: "Collect", content: "Revenue grew 18%", contentRef: null }],
        },
      ],
    },
  };
  const ctx = await outcomeRunContext(db as never, "bot-b", "w-write");
  expect(ctx).toContain("Write final markdown using collected data");
  expect(ctx).toContain("Markdown published");
  expect(ctx).toContain("Revenue grew 18%");
  expect(ctx).not.toContain("Internal planner note");
});
