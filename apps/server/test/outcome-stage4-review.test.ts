import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outcomeReviewBatchKey } from "@outcomego/messaging";
import { Effect } from "effect";
import { OutcomeService } from "../src/services/outcome-service";
import { OutcomeEvidenceConsumer } from "../src/services/outcome-evidence-consumer";
import { OutcomeReviewService } from "../src/services/outcome-review-service";
import { OutcomeTaskReviewService } from "../src/services/outcome-task-review-service";

type Row = Record<string, any>;

const BOT_EXEC = "11111111-1111-4111-8111-111111111111";
const BOT_REVIEWER = "22222222-2222-4222-8222-222222222222";
const CRIT_REQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CRIT_OPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUTCOME_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REV_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const WORK_ITEM_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TURN_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function makeReviewHarness(options: {
  critReqCovered?: boolean;
  workItemKind?: "initial" | "rework";
  reworkOfWorkItemId?: string | null;
  nature?: "deliverable" | "action";
  existingRework?: boolean;
  revStatus?: string;
} = {}) {
  const idempotency = new Map<string, Row>();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "prereview-"));
  const evidence: Array<Row & { id: string; credibility: string; sourceType: string }> = [];
  const outputs = [{ id: "out-1", workItemId: WORK_ITEM_ID, createdAt: new Date() }];
  const decisions: Array<{ id: string; contractRevisionId: string; status: "open" | "presented" | "resolved" }> = [];
  const reviews: Row[] = [];
  const events: Row[] = [];
  const wakes: Row[] = [];
  const workItems: Row[] = [
    {
      id: WORK_ITEM_ID,
      outcomeId: OUTCOME_ID,
      contractRevisionId: REV_ID,
      botId: BOT_EXEC,
      executorType: "agent",
      kind: options.workItemKind ?? "initial",
      title: "Produce final report",
      instructions: "Write markdown report with verified tables.",
      planKey: options.workItemKind === "rework" ? null : "write-report",
      dependsOn: [],
      status: "completed",
      ordinal: 1,
      reworkOfWorkItemId: options.reworkOfWorkItemId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  if (options.existingRework) {
    workItems.push({
      id: "99999999-9999-4999-8999-999999999999",
      outcomeId: OUTCOME_ID,
      contractRevisionId: REV_ID,
      botId: BOT_EXEC,
      executorType: "agent",
      kind: "rework",
      title: "Rework",
      instructions: "Prev rework",
      status: "completed",
      ordinal: 2,
      reworkOfWorkItemId: WORK_ITEM_ID,
    });
  }
  const turns: Row[] = [
    {
      id: TURN_ID,
      threadId: "th-rev",
      purpose: "review",
      status: "running",
      result: null as unknown,
      clientRequestId: outcomeReviewBatchKey(REV_ID, outputs, [], decisions),
      createdAt: new Date(),
      thread: { outcomeId: OUTCOME_ID, role: "reviewer", botId: BOT_REVIEWER },
    },
  ];
  const revision: Row = {
    id: REV_ID,
    outcomeId: OUTCOME_ID,
    revision: 1,
    status: options.revStatus ?? "approved",
    boundaries: { included: ["Q3 metrics"], excluded: ["External SaaS sync"] },
    plan: {
      tasks: [
        {
          key: "write-report",
          title: "Produce final report",
          instructions: "Write markdown report with verified tables.",
          botId: BOT_EXEC,
          covers: options.critReqCovered === false ? [CRIT_OPT] : [CRIT_REQ],
          nature: options.nature ?? "deliverable",
        },
      ],
    },
    criteria: [
      { id: CRIT_REQ, ordinal: 1, statement: "Report contains Q3 table", required: true, verificationMethod: "human_review", evidenceRequired: false },
      { id: CRIT_OPT, ordinal: 2, statement: "Include chart thumbnail", required: false, verificationMethod: "human_review", evidenceRequired: false },
    ],
    approvedAt: new Date(),
    createdAt: new Date(),
  };
  const outcome: Row = {
    id: OUTCOME_ID,
    botId: BOT_EXEC,
    status: "review_pending",
    acceptedAt: null as Date | null,
    cancelledAt: null as Date | null,
    currentRevisionId: REV_ID,
    kind: "standard",
  };
  const tx: Row = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ active: true }],
    idempotencyRecord: {
      findUnique: async ({ where }: Row) => idempotency.get(`${where.scope_key.scope}:${where.scope_key.key}`) ?? null,
      create: async ({ data }: Row) => void idempotency.set(`${data.scope}:${data.key}`, { ...data }),
      update: async ({ where, data }: Row) => Object.assign(idempotency.get(`${where.scope_key.scope}:${where.scope_key.key}`)!, data),
    },
    outcome: {
      findUnique: async () => outcome,
      findUniqueOrThrow: async () => ({
        ...outcome,
        title: "Goal",
        description: "Desc",
        resumeStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentRevision: revision,
        revisions: [revision],
        workItems: workItems.map((w) => ({ ...w, contractRevision: revision, runs: [], createdAt: w.createdAt ?? new Date(), updatedAt: w.updatedAt ?? new Date() })),
        outputs,
        decisions,
        evidence: evidence.map((e) => ({ ...e, contractRevision: revision, contractRevisionId: REV_ID })),
        reviews: reviews.map((r) => ({ ...r, contractRevision: revision })),
        threads: [{ turns }],
      }),
      update: async ({ data }: Row) => Object.assign(outcome, data),
    },
    outcomeContractRevision: {
      findUnique: async () => revision,
    },
    outcomeAcceptanceCriterion: {
      findMany: async () => revision.criteria,
    },
    outcomeWorkItem: {
      count: async () => 0,
      findUnique: async ({ where }: Row) => {
        const w = workItems.find((row) => row.id === where.id);
        return w ? { ...w, outcome, contractRevision: revision } : null;
      },
      findUniqueOrThrow: async ({ where }: Row) => {
        const w = workItems.find((row) => row.id === where.id)!;
        return { ...w, outcome, contractRevision: revision };
      },
      findFirst: async ({ where }: Row) => {
        if (where.reworkOfWorkItemId) return workItems.find((row) => row.reworkOfWorkItemId === where.reworkOfWorkItemId) ?? null;
        return null;
      },
      findMany: async ({ where }: Row) =>
        workItems.filter((w) => (!where?.status || w.status === where.status) && (!where?.contractRevisionId || w.contractRevisionId === where.contractRevisionId)),
      aggregate: async () => ({ _max: { ordinal: workItems.reduce((m, w) => Math.max(m, w.ordinal), 0) } }),
      create: async ({ data }: Row) => {
        const row = { id: `00000000-0000-4000-8000-0000000000${workItems.length + 10}`, rootRunId: null, ...data };
        workItems.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => Object.assign(workItems.find((w) => w.id === where.id)!, data),
    },
    outcomeOutput: {
      findFirst: async () => outputs[0],
      findMany: async () => outputs,
      count: async () => outputs.length,
    },
    outcomeEvidence: {
      count: async () => 0,
      create: async ({ data }: Row) => {
        const ev = { id: `ev-${evidence.length + 1}`, capturedAt: new Date(), ...data } as typeof evidence[number];
        evidence.push(ev);
        return ev;
      },
      findMany: async ({ where }: Row) => {
        if (where?.id?.in) return evidence.filter((e) => where.id.in.includes(e.id) && e.credibility !== where.credibility?.not);
        return evidence;
      },
    },
    outcomeReview: {
      findFirst: async ({ where }: Row) => reviews.filter((r) => r.criterionId === where.criterionId).at(-1) ?? null,
      findMany: async () => reviews,
      create: async ({ data }: Row) => {
        const rev = { id: `revw-${reviews.length + 1}`, reviewedAt: new Date(), ...data };
        reviews.push(rev);
        return rev;
      },
    },
    outcomeThreadTurn: {
      findUnique: async ({ where }: Row) => turns.find((t) => t.id === where.id) ?? null,
      findFirst: async () => null,
      update: async ({ where, data }: Row) => {
        let t = turns.find((row) => row.id === where.id);
        if (!t) {
          t = { id: where.id };
          turns.push(t);
        }
        return Object.assign(t, data);
      },
      count: async () => 0,
    },
    outcomeDecision: { count: async () => 0, findMany: async () => decisions },
    outcomeHumanActionCard: { count: async () => 0 },
    featureSettings: { findUnique: async () => ({ outcomesEnabled: true }) },
    bot: { findUnique: async () => ({ id: BOT_EXEC, status: "active", conversation: { id: "c1" } }) },
    channel: { findFirst: async () => ({ id: "dm-exec" }) },
    event: { create: async ({ data }: Row) => void events.push(data) },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: Row) => unknown) => fn(tx) };
  const messaging = {
    enqueueWake: async (_t: Row, input: Row) => {
      wakes.push(input);
      return { run: { id: `run-${wakes.length}` } };
    },
    assets: { metadata: async () => ({}) },
    agentData: { workspaceRoot },
  };
  const outcomes = {
    getInTransaction: async () => ({ id: outcome.id, status: outcome.status }),
  };
  const taskReviews = new OutcomeTaskReviewService(prisma as never, outcomes as never, messaging as never);
  const reviewService = new OutcomeReviewService(prisma as never, messaging as never, async () => ({ text: "{}" }));
  return { workspaceRoot, taskReviews, reviewService, prisma, evidence, outputs, decisions, reviews, events, wakes, workItems, outcome, turns };
}

test("SubmitPrereview saves ai_prereview evidence without OutcomeReview, and rejects invalid/incomplete inputs", async () => {
  const f = makeReviewHarness();
  await expect(
    f.taskReviews.submitPrereview(
      OUTCOME_ID,
      TURN_ID,
      {
        expectedRevision: 1,
        results: [{ criterionId: CRIT_REQ, suggestion: "likely_pass", reason: "Present" }],
        conclusion: ["Missing second criterion"],
        attention: [],
        clientRequestId: "pre-inc-1",
      },
      `bot:${BOT_REVIEWER}`
    )
  ).rejects.toMatchObject({ code: "prereview_incomplete" });

  await expect(
    f.taskReviews.submitPrereview(
      OUTCOME_ID,
      TURN_ID,
      {
        expectedRevision: 1,
        results: [
          { criterionId: CRIT_REQ, suggestion: "likely_pass", reason: "Looks good" },
          { criterionId: CRIT_OPT, suggestion: "likely_fail", reason: "Optional missing" },
        ],
        conclusion: ["Cannot fail optional criterion"],
        attention: [],
        clientRequestId: "pre-opt-fail",
      },
      `bot:${BOT_REVIEWER}`
    )
  ).rejects.toMatchObject({ code: "invalid_request", details: { field: "results", criterionId: CRIT_OPT } });

  await expect(
    f.taskReviews.submitPrereview(
      OUTCOME_ID,
      TURN_ID,
      {
        expectedRevision: 1,
        results: [
          { criterionId: CRIT_REQ, suggestion: "likely_pass", reason: "Looks good" },
          { criterionId: CRIT_OPT, suggestion: "likely_pass", reason: "Optional ok" },
        ],
        conclusion: ["Summary"],
        attention: [{ criterionId: CRIT_REQ, question: "Could improve font?" }],
        clientRequestId: "pre-att-pass",
      },
      `bot:${BOT_REVIEWER}`
    )
  ).rejects.toMatchObject({ code: "invalid_request", details: { field: "attention" } });

  await f.taskReviews.submitPrereview(
    OUTCOME_ID,
    TURN_ID,
    {
      expectedRevision: 1,
      results: [
        { criterionId: CRIT_REQ, suggestion: "likely_pass", reason: "Table verified against output" },
        { criterionId: CRIT_OPT, suggestion: "unclear", reason: "Thumbnail omitted" },
      ],
      conclusion: ["表格已满足，缩略图待核实。"],
      attention: [],
      clientRequestId: "pre-valid-1",
    },
    `bot:${BOT_REVIEWER}`
  );
  expect(f.evidence).toHaveLength(2);
  expect(f.evidence.every((e) => e.credibility === "ai_prereview")).toBe(true);
  expect(f.reviews).toHaveLength(0);
  expect(f.outcome.status).toBe("review_pending");
  expect(f.events.some((e) => e.topic === "outcome.prereview.submitted")).toBe(true);
});

test("adoptPrereview rejects bots and stale revisions, and submits likely_pass items as user", async () => {
  const f = makeReviewHarness();
  await f.taskReviews.submitPrereview(
    OUTCOME_ID,
    TURN_ID,
    {
      expectedRevision: 1,
      results: [
        { criterionId: CRIT_REQ, suggestion: "likely_pass", reason: "Verified table" },
        { criterionId: CRIT_OPT, suggestion: "unclear", reason: "Optional skipped" },
      ],
      conclusion: ["All required criteria passed."],
      attention: [],
      clientRequestId: "pre-for-adopt",
    },
    `bot:${BOT_REVIEWER}`
  );

  f.turns[0]!.status = "completed";
  // Bot cannot adopt
  const botExit = await Effect.runPromise(
    Effect.either(f.reviewService.adoptPrereview(OUTCOME_ID, { expectedRevision: 1, turnId: TURN_ID, clientRequestId: "adopt-bot" }, `bot:${BOT_REVIEWER}`))
  );
  expect(botExit._tag === "Left" && (botExit.left as any).code).toBe("forbidden");

  // Wrong revision -> prereview_stale
  const staleExit = await Effect.runPromise(
    Effect.either(f.reviewService.adoptPrereview(OUTCOME_ID, { expectedRevision: 2, turnId: TURN_ID, clientRequestId: "adopt-stale" }, "owner:local"))
  );
  expect(staleExit._tag === "Left" && (staleExit.left as any).code).toBe("prereview_stale");

  // User adopts likely_pass (only CRIT_REQ); since CRIT_OPT is optional, required criteria satisfied -> accepted!
  await Effect.runPromise(
    f.reviewService.adoptPrereview(OUTCOME_ID, { expectedRevision: 1, turnId: TURN_ID, clientRequestId: "adopt-user-1" }, "owner:local")
  );
  expect(f.reviews).toHaveLength(1);
  expect(f.reviews[0]!.criterionId).toBe(CRIT_REQ);
  expect(f.reviews[0]!.result).toBe("PASS");
  expect(f.reviews[0]!.userConfirmed).toBe(true);
  expect(f.reviews[0]!.reviewedBy).toBe("owner:local");
  expect(f.outcome.acceptedAt).not.toBeNull();
});

test("one review persists an evidence-grounded report and rejects adoption after same-revision results change", async () => {
  const f = makeReviewHarness();
  const quote = "Main cache 63%\nSecondary cache 57%";
  f.evidence.push({ id: "measurement", contentSummary: quote, credibility: "external_record", sourceType: "check", capturedAt: new Date() });
  f.evidence.push({ id: "claim", contentSummary: quote, credibility: "agent_report", sourceType: "file", capturedAt: new Date() });
  const turn = f.turns[0]!;
  const charts = {
    type: "bar" as const, title: "Cache use", unit: "%", points: [
      { label: "Main cache", value: 63, evidenceId: "measurement", quote: "Main cache 63%" },
      { label: "Secondary cache", value: 57, evidenceId: "measurement", quote: "Secondary cache 57%" },
    ],
  };
  const folder = join(f.workspaceRoot, "outcomes", OUTCOME_ID, WORK_ITEM_ID);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "report.md"), "Array 34%\nCache 63%\n");
  const fileChart = {
    type: "bar" as const, title: "Use by pool", unit: "%", points: [
      { label: "Array", value: 34, file: `outcomes/${OUTCOME_ID}/${WORK_ITEM_ID}/report.md`, quote: "Array 34%" },
      { label: "Cache", value: 63, file: `outcomes/${OUTCOME_ID}/${WORK_ITEM_ID}/report.md`, quote: "Cache 63%" },
    ],
  };
  const input = {
    expectedRevision: 1,
    results: [
      { criterionId: CRIT_REQ, suggestion: "likely_pass" as const, reason: "Verified table", evidenceIds: ["measurement"] },
      { criterionId: CRIT_OPT, suggestion: "unclear" as const, reason: "Optional skipped" },
    ],
    conclusion: ["主缓存使用63%，第二缓存使用57%。", "两个缓存都低于70%预警线。"], attention: [],
    charts: [charts, fileChart],
    clientRequestId: "batch-review-1",
  };
  await expect(f.taskReviews.submitPrereview(OUTCOME_ID, TURN_ID, input, `bot:${BOT_REVIEWER}`))
    .rejects.toMatchObject({ code: "prereview_stale" });
  expect(f.evidence).toHaveLength(2);
  expect(turn.result).toBeNull();
  turn.clientRequestId = outcomeReviewBatchKey(REV_ID, f.outputs, f.evidence, f.decisions);
  const fabricated = { ...charts, points: [{ ...charts.points[0]!, quote: "Main cache 99%", value: 99 }, charts.points[1]!] };
  await expect(f.taskReviews.submitPrereview(OUTCOME_ID, TURN_ID, { ...input, charts: [fabricated] }, `bot:${BOT_REVIEWER}`))
    .rejects.toMatchObject({ code: "invalid_request", details: { field: "charts" } });
  const outside = { ...fileChart, points: fileChart.points.map((point) => ({ ...point, file: "../../etc/hosts" })) };
  await expect(f.taskReviews.submitPrereview(OUTCOME_ID, TURN_ID, { ...input, charts: [outside] }, `bot:${BOT_REVIEWER}`))
    .rejects.toMatchObject({ code: "invalid_request", details: { field: "charts" } });
  expect(turn.result).toBeNull();
  await f.taskReviews.submitPrereview(OUTCOME_ID, TURN_ID, input, `bot:${BOT_REVIEWER}`);
  const get = () => new OutcomeService(f.prisma as never).getInTransaction(f.prisma as never, OUTCOME_ID);
  expect((await get()).prereviewStatus).toBe("pending");
  turn.status = "completed";
  const current = await get();
  expect(current.prereview?.report).toMatchObject({
    reviewTurnId: TURN_ID, summary: "1. 主缓存使用63%，第二缓存使用57%。\n2. 两个缓存都低于70%预警线。",
    charts: [{ type: "bar", points: [{ value: 63 }, { value: 57 }] }, { type: "bar", points: [{ value: 34 }, { value: 63 }] }],
  });
  expect(current.prereview?.report?.sources.filter((source) => source.credibility === "agent_report")).toHaveLength(2);
  const record = { id: "decision-1", contractRevisionId: REV_ID, status: "open" as const };
  f.decisions.push(record);
  expect((await get()).prereviewStatus).toBe("stale");
  f.decisions.pop();
  f.outputs.push({ id: "out-2", workItemId: WORK_ITEM_ID, createdAt: new Date() });
  expect(await get()).toMatchObject({ prereview: null, prereviewStatus: "stale", currentRevision: 1 });
  const result = await Effect.runPromise(Effect.either(f.reviewService.adoptPrereview(
    OUTCOME_ID, { expectedRevision: 1, turnId: TURN_ID, clientRequestId: "stale-adopt" }, "owner:local",
  )));
  expect(result).toMatchObject({ _tag: "Left", left: { code: "prereview_stale" } });
  expect(f.reviews).toEqual([]);
  expect(f.outcome.acceptedAt).toBeNull();
});

test("ReviewTaskResult creates rework without reviewer note and enforces all rejection guards", async () => {
  const f = makeReviewHarness();

  // Optional criterion rejected
  await expect(
    f.taskReviews.reviewTaskResult(
      OUTCOME_ID,
      "t-rev-1",
      WORK_ITEM_ID,
      {
        workItemId: WORK_ITEM_ID,
        verdict: "reject",
        findings: [{ kind: "omission", basis: { criterionId: CRIT_OPT }, reason: "Optional chart skipped" }],
        clientRequestId: "rej-opt",
      },
      `bot:${BOT_REVIEWER}`
    )
  ).rejects.toMatchObject({ code: "review_not_rejectable" });

  // Nonexistent boundary index rejected
  await expect(
    f.taskReviews.reviewTaskResult(
      OUTCOME_ID,
      "t-rev-1",
      WORK_ITEM_ID,
      {
        workItemId: WORK_ITEM_ID,
        verdict: "reject",
        findings: [{ kind: "error", basis: { boundary: { side: "excluded", index: 5 } }, reason: "Bad index" }],
        clientRequestId: "rej-bad-idx",
      },
      `bot:${BOT_REVIEWER}`
    )
  ).rejects.toMatchObject({ code: "review_not_rejectable" });

  // Uncovered required criterion rejected
  const uncovered = makeReviewHarness({ critReqCovered: false });
  await expect(
    uncovered.taskReviews.reviewTaskResult(
      OUTCOME_ID,
      "t-rev-1",
      WORK_ITEM_ID,
      {
        workItemId: WORK_ITEM_ID,
        verdict: "reject",
        findings: [{ kind: "omission", basis: { criterionId: CRIT_REQ }, reason: "Not covered by this task" }],
        clientRequestId: "rej-uncovered",
      },
      `bot:${BOT_REVIEWER}`
    )
  ).rejects.toMatchObject({ code: "review_not_rejectable" });

  // Action or rework tasks cannot be rejected
  const reworkHarness = makeReviewHarness({ workItemKind: "rework", reworkOfWorkItemId: "prev-id" });
  await expect(
    reworkHarness.taskReviews.reviewTaskResult(
      OUTCOME_ID,
      "t-rev-1",
      WORK_ITEM_ID,
      {
        workItemId: WORK_ITEM_ID,
        verdict: "reject",
        findings: [{ kind: "omission", basis: { criterionId: CRIT_REQ }, reason: "Still wrong" }],
        clientRequestId: "rej-rework",
      },
      `bot:${BOT_REVIEWER}`
    )
  ).rejects.toMatchObject({ code: "review_not_rejectable" });

  // Valid rejection creates rework for same BOT_EXEC without leaking note
  await f.taskReviews.reviewTaskResult(
    OUTCOME_ID,
    "t-rev-1",
    WORK_ITEM_ID,
    {
      workItemId: WORK_ITEM_ID,
      verdict: "reject",
      findings: [
        { kind: "omission", basis: { criterionId: CRIT_REQ }, reason: "Q3 revenue rows are missing" },
        { kind: "error", basis: { boundary: { side: "excluded", index: 0 } }, reason: "Added forbidden external sync" },
      ],
      note: "SECRET_HOLISTIC_REVIEWER_NOTE",
      clientRequestId: "rej-valid-1",
    },
    `bot:${BOT_REVIEWER}`
  );
  expect(f.workItems).toHaveLength(2);
  const rework = f.workItems[1]!;
  expect(rework.kind).toBe("rework");
  expect(rework.botId).toBe(BOT_EXEC);
  expect(rework.reworkOfWorkItemId).toBe(WORK_ITEM_ID);
  expect(rework.instructions).toContain("Q3 revenue rows are missing");
  expect(rework.instructions).not.toContain("SECRET_HOLISTIC_REVIEWER_NOTE");
  expect(f.wakes).toHaveLength(1);
  expect(f.wakes[0]!.botId).toBe(BOT_EXEC);
  expect(f.wakes[0]!.content).not.toContain("SECRET_HOLISTIC_REVIEWER_NOTE");

  // Second rejection on same work item rejected with review_reject_exhausted
  await expect(
    f.taskReviews.reviewTaskResult(
      OUTCOME_ID,
      "t-rev-2",
      WORK_ITEM_ID,
      {
        workItemId: WORK_ITEM_ID,
        verdict: "reject",
        findings: [{ kind: "omission", basis: { criterionId: CRIT_REQ }, reason: "Second try" }],
        clientRequestId: "rej-second",
      },
      `bot:${BOT_REVIEWER}`
    )
  ).rejects.toMatchObject({ code: "review_reject_exhausted" });
});

test("OutcomeEvidenceConsumer skips one-shot prereview when reviewer role is configured", async () => {
  const makeConsumer = (reviewerBotId: string | null) => {
    const calls: string[] = [];
    const prisma: Row = {
      $queryRaw: async () => [
        {
          sequence: 1n,
          topic: "outcome.output.recorded",
          payload: { eventId: "ev-1", payload: { outputId: "out-1" } },
        },
      ],
      $executeRaw: async () => 0,
      idempotencyRecord: { findUnique: async () => null, create: async () => ({}) },
      featureSettings: { findUnique: async () => ({ outcomesEnabled: true, reviewerBotId }) },
      bot: {
        findUnique: async () =>
          reviewerBotId ? { id: reviewerBotId, status: "active", subagentIdentity: null, conversation: { id: "c" } } : null,
      },
      channel: { findFirst: async () => (reviewerBotId ? { id: "dm" } : null) },
      outcomeOutput: { findUnique: async () => ({ workItemId: WORK_ITEM_ID }) },
    };
    const prismaWithTx: Row = {
      ...prisma,
      $transaction: async (fn: (t: Row) => unknown) => fn(prisma),
    };
    const reviews: Row = {
      recordOutputEvidence: async (id: string) => void calls.push(`evidence:${id}`),
      prereview: async (id: string) => void calls.push(`prereview:${id}`),
    };
    const consumer = new OutcomeEvidenceConsumer(prismaWithTx as never, reviews as never, {
      currentVersion: 0,
      wait: async () => 0,
    });
    return { consumer, calls };
  };

  const withReviewer = makeConsumer(BOT_REVIEWER);
  await withReviewer.consumer.drain();
  expect(withReviewer.calls).toEqual(["evidence:out-1"]);

  const withoutReviewer = makeConsumer(null);
  await withoutReviewer.consumer.drain();
  expect(withoutReviewer.calls).toEqual(["evidence:out-1", `prereview:${WORK_ITEM_ID}`]);
});
