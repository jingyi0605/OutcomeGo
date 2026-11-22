import { expect, test } from "bun:test";
import { emitReviewRequiredIfNeeded, enqueueOutcomeTurn, settleOutcomeThreadTurn, settleOutcomeWorkItem } from "../src/outcome-threads";
import { recomputeOutcomeStatus } from "../src/outcome-state";

type Row = Record<string, any>;

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_REV = "22222222-2222-4222-8222-222222222222";
const OUTCOME_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REV_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

test("enqueueOutcomeTurn gates downstream tasks on pending review_task and unfinished or failed rework", async () => {
  const makeTx = (opts: { pendingTaskReviews?: number; unfinishedReworks?: number }) => ({
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ active: true }],
    idempotencyRecord: { findUnique: async () => null, create: async () => ({}) },
    outcomeWorkItem: {
      findUnique: async () => ({ outcomeId: OUTCOME_ID }),
      findUniqueOrThrow: async () => ({
        id: "w-child",
        outcomeId: OUTCOME_ID,
        contractRevisionId: REV_ID,
        botId: BOT_A,
        executorType: "agent",
        status: "queued",
        dependsOn: ["w-parent"],
        outcome: { cancelledAt: null, acceptedAt: null },
        contractRevision: { status: "approved", approvedAt: new Date() },
      }),
      count: async ({ where }: Row) => {
        if (where.id?.in) return 1; // parent is completed
        if (where.reworkOfWorkItemId) return opts.unfinishedReworks ?? 0;
        return 0;
      },
    },
    outcomeThreadTurn: {
      count: async () => opts.pendingTaskReviews ?? 0,
    },
  });
  const fakeEnv = process.env.OUTCOMEGO_DISPATCH_DISABLED;
  delete process.env.OUTCOMEGO_DISPATCH_DISABLED;
  try {
    expect(
      await enqueueOutcomeTurn(makeTx({ pendingTaskReviews: 1 }) as never, {} as never, {
        workItemId: "w-child",
        content: "Go",
        reason: "start",
        clientId: "k1",
      })
    ).toEqual({ status: "queued_for_capacity" });

    expect(
      await enqueueOutcomeTurn(makeTx({ unfinishedReworks: 1 }) as never, {} as never, {
        workItemId: "w-child",
        content: "Go",
        reason: "start",
        clientId: "k2",
      })
    ).toEqual({ status: "queued_for_capacity" });
  } finally {
    if (fakeEnv !== undefined) process.env.OUTCOMEGO_DISPATCH_DISABLED = fakeEnv;
  }
});

test("recomputeOutcomeStatus stays running while deliverable review_task turn is pending", async () => {
  const tx: Row = {
    $executeRaw: async () => 0,
    outcome: {
      findUniqueOrThrow: async () => ({
        id: OUTCOME_ID,
        status: "running",
        resumeStatus: null,
        trackingMode: "standard",
        cancelledAt: null,
        acceptedAt: null,
        currentRevision: { id: REV_ID, status: "approved", revision: 1 },
        workItems: [{ id: "w1", executorType: "agent", status: "completed", contractRevisionId: REV_ID, ordinal: 1, dependsOn: [] }],
      }),
      update: async () => ({}),
    },
    outcomeThreadTurn: {
      count: async ({ where }: Row) => (where.purpose === "review_task" ? 1 : 0),
    },
    outcomeDecision: { count: async () => 0 },
    event: { create: async () => ({}) },
  };
  expect(await recomputeOutcomeStatus(tx as never, OUTCOME_ID, "system:test")).toBe("running");
});

test("settleOutcomeWorkItem queues review_task only for deliverable plan tasks, not action/rework/unplanned", async () => {
  const runSettle = async (kind: string, planKey: string | null, nature?: "deliverable" | "action") => {
    const wakes: Row[] = [];
    const turns: Row[] = [];
    const item = {
      id: "w1",
      outcomeId: OUTCOME_ID,
      contractRevisionId: REV_ID,
      botId: BOT_A,
      executorType: "agent",
      kind,
      title: "Work",
      status: "running",
      planKey,
      reworkOfWorkItemId: kind === "rework" ? "w0" : null,
      ordinal: 1,
      dependsOn: [],
      outcome: { id: OUTCOME_ID, botId: BOT_A, cancelledAt: null, acceptedAt: null },
      contractRevision: {
        id: REV_ID,
        revision: 1,
        status: "approved",
        approvedAt: new Date(),
        plan: planKey
          ? {
              tasks: [
                { key: planKey, title: "Work", instructions: "Do work", botId: BOT_A, covers: ["c1"], nature: nature ?? "deliverable" },
              ],
            }
          : null,
      },
    };
    const tx: Row = {
      $executeRaw: async () => 0,
      $queryRaw: async () => [],
      idempotencyRecord: { findUnique: async () => null, create: async () => ({}) },
      run: {
        findUnique: async () => ({ outcomeWorkItemId: "w1" }),
        findMany: async () => [{ id: "r1", status: "completed" }],
      },
      outcomeWorkItem: {
        findUnique: async () => ({ outcomeId: OUTCOME_ID }),
        findUniqueOrThrow: async () => item,
        update: async ({ data }: Row) => Object.assign(item, data),
      },
      outcome: {
        findUnique: async () => ({ id: OUTCOME_ID, botId: BOT_A, title: "G", cancelledAt: null, acceptedAt: null }),
        findUniqueOrThrow: async () => ({
          id: OUTCOME_ID,
          status: "running",
          resumeStatus: null,
          trackingMode: "standard",
          cancelledAt: null,
          acceptedAt: null,
          currentRevision: { id: REV_ID, status: "approved", revision: 1 },
          workItems: [item],
        }),
        update: async () => ({}),
      },
      featureSettings: { findUnique: async () => ({ outcomesEnabled: true, reviewerBotId: BOT_REV }) },
      bot: { findUnique: async () => ({ id: BOT_REV, status: "active", subagentIdentity: null, conversation: { id: "c" } }) },
      channel: { findFirst: async () => ({ id: "dm-rev" }) },
      outcomeThread: { upsert: async ({ create }: Row) => ({ id: "th-rev", ...create }) },
      outcomeThreadTurn: {
        findFirst: async () => null,
        create: async ({ data }: Row) => {
          const row = { id: `turn-${turns.length + 1}`, status: "queued", ...data };
          turns.push(row);
          return row;
        },
        update: async ({ where, data }: Row) => Object.assign(turns.find((t) => t.id === where.id)!, data),
        count: async () => turns.length,
      },
      outcomeOutput: { findUnique: async () => null, findFirst: async () => ({ id: "out-1" }), create: async ({ data }: Row) => ({ id: "out-1", ...data }) },
      outcomeAcceptanceCriterion: { findMany: async () => [{ id: "c1" }] },
      outcomeDecision: { count: async () => 0 },
      subagent: { count: async () => 0 },
      task: { count: async () => 0 },
      runItem: { findMany: async () => [] },
      event: { findFirst: async () => ({ id: "e1" }), findMany: async () => [], create: async () => ({}) },
    };
    const runtime = {
      messaging: {
        enqueueWake: async (_t: Row, input: Row) => {
          wakes.push(input);
          return { run: { id: "wake-1" } };
        },
        agentData: { workspaceRoot: "/nonexistent" },
      },
      workspaceRoot: "/nonexistent",
    };
    await settleOutcomeWorkItem(tx as never, "r1", runtime as never);
    return { wakes, turns };
  };

  expect((await runSettle("initial", "deliver-key", "deliverable")).turns.map((t) => t.purpose)).toEqual(["review_task"]);
  expect((await runSettle("initial", "action-key", "action")).turns.filter((t) => t.purpose === "review_task")).toHaveLength(0);
  expect((await runSettle("initial", null)).turns.filter((t) => t.purpose === "review_task")).toHaveLength(0);
  expect((await runSettle("rework", null)).turns.filter((t) => t.purpose === "review_task")).toHaveLength(0);
});

test("settleOutcomeThreadTurn passes failed review_task as unreviewed and triggers review + emitReviewRequiredIfNeeded", async () => {
  const events: Row[] = [];
  const wakes: Row[] = [];
  const turns: Row[] = [
    {
      id: "turn-rt-1",
      threadId: "th-rev",
      purpose: "review_task",
      status: "running",
      workItemId: "w1",
      result: null,
      runId: "run-rt-1",
      thread: { outcomeId: OUTCOME_ID, botId: BOT_REV },
      run: { status: "failed", error: { code: "timeout", message: "Timed out" } },
    },
  ];
  const tx: Row = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    outcomeThreadTurn: {
      findUnique: async () => turns[0],
      findFirst: async () => null,
      create: async ({ data }: Row) => {
        const t = { id: `turn-${turns.length + 1}`, status: "queued", ...data };
        turns.push(t);
        return t;
      },
      update: async ({ where, data }: Row) => Object.assign(turns.find((t) => t.id === where.id)!, data),
      count: async () => 0,
    },
    outcomeWorkItem: {
      findMany: async () => [{ id: "w1" }],
      findUnique: async () => ({
        id: "w1",
        contractRevisionId: REV_ID,
        outcome: { cancelledAt: null, acceptedAt: null, currentRevisionId: REV_ID },
        contractRevision: { revision: 1, status: "approved" },
      }),
    },
    outcome: {
      findUnique: async () => ({ id: OUTCOME_ID, botId: BOT_A, title: "G", status: "review_pending", trackingMode: "standard", currentRevisionId: REV_ID, cancelledAt: null, acceptedAt: null, currentRevision: { id: REV_ID, revision: 1, status: "approved" } }),
      findUniqueOrThrow: async () => ({
        id: OUTCOME_ID,
        status: "running",
        resumeStatus: null,
        trackingMode: "standard",
        cancelledAt: null,
        acceptedAt: null,
        currentRevision: { id: REV_ID, status: "approved", revision: 1 },
        workItems: [{ id: "w1", executorType: "agent", status: "completed", contractRevisionId: REV_ID, ordinal: 1, dependsOn: [] }],
      }),
      update: async () => ({}),
    },
    featureSettings: { findUnique: async () => ({ outcomesEnabled: true, reviewerBotId: BOT_REV }) },
    bot: { findUnique: async () => ({ id: BOT_REV, status: "active", subagentIdentity: null, conversation: { id: "c" } }) },
    channel: { findFirst: async () => ({ id: "dm-rev" }) },
    outcomeThread: { upsert: async ({ create }: Row) => ({ id: "th-rev", ...create }) },
    outcomeDecision: { count: async () => 0, findMany: async () => [] },
    outcomeEvidence: { findMany: async () => [] },
    outcomeOutput: { findFirst: async () => ({ id: "out-1" }), findMany: async () => [{ id: "out-1" }] },
    outcomeAcceptanceCriterion: { findMany: async () => [{ id: "c1" }] },
    event: { findFirst: async () => null, create: async ({ data }: Row) => void events.push(data) },
  };
  const messaging = {
    enqueueWake: async (_t: Row, input: Row) => {
      wakes.push(input);
      return { run: { id: `run-${wakes.length}` } };
    },
  };
  await settleOutcomeThreadTurn(tx as never, "run-rt-1", messaging as never);
  expect(turns[0]!.result).toMatchObject({ verdict: "unreviewed" });
  expect(events.some((e) => e.topic === "outcome.task_review.decided" && e.payload.payload.verdict === "unreviewed")).toBe(true);
  // Goal hit review_pending -> emitted outcome.review.required and queued holistic review turn
  expect(events.some((e) => e.topic === "outcome.review.required")).toBe(true);
  expect(turns[1]?.purpose).toBe("review");
  expect(wakes).toHaveLength(1);
});

test("emitReviewRequiredIfNeeded queues holistic review idempotently per results batch", async () => {
  const turns: Row[] = [];
  const wakes: Row[] = [];
  const outputs = [{ id: "out-1" }];
  const evidence: Row[] = [];
  const decisions: Array<{ id: string; status: string }> = [];
  const tx: Row = {
    outcomeOutput: { findFirst: async () => outputs[0], findMany: async () => outputs },
    outcomeEvidence: { findMany: async () => evidence },
    outcomeDecision: { findMany: async () => decisions },
    event: { findFirst: async () => null, create: async () => ({}) },
    outcomeAcceptanceCriterion: { findMany: async () => [{ id: "c1" }] },
    outcomeWorkItem: { findMany: async () => [{ id: "w1" }] },
    outcome: { findUnique: async () => ({ id: OUTCOME_ID, botId: BOT_A, title: "G", status: "review_pending", trackingMode: "standard", currentRevisionId: REV_ID, cancelledAt: null, acceptedAt: null, currentRevision: { status: "approved" } }) },
    featureSettings: { findUnique: async () => ({ outcomesEnabled: true, reviewerBotId: BOT_REV }) },
    bot: { findUnique: async () => ({ id: BOT_REV, status: "active", subagentIdentity: null, conversation: { id: "c" } }) },
    channel: { findFirst: async () => ({ id: "dm-rev" }) },
    outcomeThread: { upsert: async ({ create }: Row) => ({ id: "th-rev", ...create }) },
    outcomeThreadTurn: {
      findFirst: async ({ where }: Row) => turns.find((t) => t.clientRequestId === where.clientRequestId) ?? null,
      create: async ({ data }: Row) => {
        const t = { id: `turn-${turns.length + 1}`, ...data };
        turns.push(t);
        return t;
      },
      update: async ({ where, data }: Row) => Object.assign(turns.find((t) => t.id === where.id)!, data),
    },
  };
  const messaging = {
    enqueueWake: async (_t: Row, input: Row) => {
      wakes.push(input);
      return { run: { id: `run-${wakes.length}` } };
    },
  };
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  expect(turns).toHaveLength(1);
  expect(wakes).toHaveLength(1);
  evidence.push({ id: "derived", credibility: "agent_report", sourceType: "output" });
  evidence.push({ id: "review", credibility: "ai_prereview", sourceType: "prereview" });
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  expect(turns).toHaveLength(1);
  evidence.push({ id: "receipt", credibility: "human_confirmed", sourceType: "receipt" });
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  expect(turns).toHaveLength(2);
  outputs.push({ id: "out-2" });
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  expect(turns).toHaveLength(3);
  expect(wakes).toHaveLength(3);
  decisions.push({ id: "decision", status: "open" });
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  expect(turns).toHaveLength(4);
  decisions[0]!.status = "presented";
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  expect(turns).toHaveLength(4);
  decisions[0]!.status = "resolved";
  await emitReviewRequiredIfNeeded(tx as never, OUTCOME_ID, REV_ID, 1, messaging as never);
  expect(turns).toHaveLength(5);
});
