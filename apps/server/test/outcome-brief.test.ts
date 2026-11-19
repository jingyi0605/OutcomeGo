import { expect, test } from "bun:test";
import { outcomeBriefSource, type OutcomeDetail } from "@outcomego/contracts/outcomes";
import { OutcomeBriefService, parseOutcomeBrief } from "../src/services/outcome-brief-service";
import { OutcomeResultSummaryWorker } from "../src/services/outcome-result-summary-worker";
import { outcomeResultInput, parseOutcomeResultSummary } from "../src/services/outcome-result-summary";
import { Effect } from "effect";

const outcome: OutcomeDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Clean storage",
  status: "pending_approval",
  botId: "bot",
  description:
    "Storage is almost full. Confirm the backup first. Measure usage. Deletion could lose data.",
  currentRevision: 1,
  currentRevisionView: {
    id: "revision-1",
    revision: 1,
    status: "pending_approval",
    goal: ["Recover unused space without deleting active files"],
    boundaries: { included: [], excluded: ["Do not delete active disks"] },
    budget: null,
    executionBotId: "bot",
    changeSummary: null,
    sourceDecisionId: null,
    createdBy: "owner",
    approvedBy: null,
    approvedAt: null,
    conflicts: [],
    criteria: [],
    createdAt: "2026-11-18T00:00:00Z",
  },
  resumeStatus: null,
  createdAt: "2026-11-18T00:00:00Z",
  updatedAt: "2026-11-18T00:00:00Z",
  acceptedAt: null,
  revisions: [],
  workItems: [],
  outputs: [],
  evidence: [],
  reviews: [],
};
const generated = {
  background: {
    title: "Make room on the storage server.",
    explanation: "Storage is nearly full; recover unused space.",
    quote: "Storage is almost full.",
  },
  intent: {
    title: "Measure storage, then review cleanup candidates.",
    explanation: "The plan limits cleanup to approved candidates.",
    quote: "Recover unused space without deleting active files",
  },
  prerequisites: [
    {
      title: "Backup available",
      explanation: "A backup check is needed before cleanup.",
      quote: "Confirm the backup first.",
      status: "met",
    },
  ],
  risks: [],
  proposedTasks: [
    {
      title: "Measure usage",
      explanation: "Record usage before choosing what to clean.",
      quote: "Measure usage.",
    },
  ],
};
test("brief stays grounded and strips model status/approval authority; exclusions do not force risks", () => {
  const brief = parseOutcomeBrief(JSON.stringify(generated), outcome);
  expect(brief.background.title).toBe(generated.background.title);
  expect(brief.risks).toEqual([]);
  expect(brief.prerequisites[0]).not.toHaveProperty("status");
  expect(brief.sourceKey).toBe(outcomeBriefSource(outcome));
  expect(brief.revisionId).toBe("revision-1");
  expect(brief.proposedTasks).toHaveLength(1);
});
test("brief rejects fabricated citations, oversized summaries and missing risk lists", () => {
  for (const invalid of [
    {
      ...generated,
      risks: [{ title: "Danger", explanation: "Invented", quote: "Not saved anywhere" }],
    },
    { ...generated, background: { ...generated.background, title: "x".repeat(91) } },
    { ...generated, proposedTasks: [{ ...generated.proposedTasks[0], title: "x".repeat(46) }] },
    { ...generated, risks: null },
  ])
    expect(() => parseOutcomeBrief(JSON.stringify(invalid), outcome)).toThrow();
});
test("brief accepts an explicitly saved risk and retains its inspectable source", () => {
  const risk = {
    title: "Data loss",
    explanation: "Deleting the wrong data may be irreversible.",
    quote: "Deletion could lose data.",
  };
  expect(parseOutcomeBrief(JSON.stringify({ ...generated, risks: [risk] }), outcome).risks).toEqual(
    [risk]
  );
});
test("concurrent reads share inference while new content and revisions get a new summary", async () => {
  const prompts: string[] = [];
  const service = new OutcomeBriefService(async (input) => {
    prompts.push(input.prompt);
    return { text: JSON.stringify(generated) };
  });
  const [a, b] = await Promise.all([service.get(outcome), service.get(outcome)]);
  expect(a).toBe(b);
  expect(prompts).toHaveLength(1);
  const next = {
    ...outcome,
    currentRevisionView: { ...outcome.currentRevisionView!, id: "revision-2", revision: 2 },
  };
  expect((await service.get(next)).revisionId).toBe("revision-2");
  await service.get({ ...outcome, description: `${outcome.description} Preserve all files.` });
  await service.get({
    ...outcome,
    currentRevisionView: {
      ...outcome.currentRevisionView!,
      budget: { timeLimitMinutes: 60, costLimit: null },
    },
  });
  expect(prompts).toHaveLength(4);
  expect(prompts[0]).toContain(outcome.description);
});
test("a failed summary is retryable and does not poison the cache or change business data", async () => {
  const saved = JSON.stringify(outcome);
  let calls = 0;
  const service = new OutcomeBriefService(async () => {
    if (++calls === 1) throw new Error("Controlled model outage");
    return { text: JSON.stringify(generated) };
  });
  await expect(service.get(outcome)).rejects.toThrow("short overview is unavailable");
  expect((await service.get(outcome)).outcomeId).toBe(outcome.id);
  expect(JSON.stringify(outcome)).toBe(saved);
});

test("brief HTTP reads use the authenticated Outcome path and cannot approve or change it", async () => {
  const { Effect } = await import("effect");
  const { outcomeRoutes } = await import("../src/routes/outcome");
  let reads = 0,
    generations = 0;
  const app = {
    outcomes: {
      get: () => {
        reads++;
        return Effect.succeed(outcome);
      },
    },
    outcomeBriefs: new OutcomeBriefService(async () => {
      generations++;
      return { text: JSON.stringify(generated) };
    }),
    prisma: { session: { findUnique: async () => null } },
  };
  const path = `/api/outcomes/${outcome.id}/brief`;
  const call = (method: string, session: string | null = null) =>
    outcomeRoutes({
      app,
      path,
      url: new URL(`http://localhost${path}`),
      request: new Request(`http://localhost${path}`, { method }),
      authMode: "disabled",
      authenticatedSessionId: session,
    } as unknown as import("../src/routes/context").RouteContext);
  const response = await call("GET");
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({
    outcomeId: outcome.id,
    revisionId: "revision-1",
    risks: [],
  });
  await expect(call("GET", "expired-session")).rejects.toThrow("Sign in");
  expect(await call("POST")).toBeUndefined();
  expect(reads).toBe(1);
  expect(generations).toBe(1);
});

const memoryStore = () => {
  const rows = new Map<string, unknown>();
  return {
    rows,
    find: async (outcomeId: string, hash: string) => rows.get(`${outcomeId}:${hash}`) ?? null,
    save: async (outcomeId: string, hash: string, brief: unknown) => {
      rows.set(`${outcomeId}:${hash}`, JSON.parse(JSON.stringify(brief)));
    },
  };
};

test("warm generates and persists the overview so a fresh service reads it without inference", async () => {
  const store = memoryStore();
  let calls = 0;
  const writer = new OutcomeBriefService(async () => {
    calls++;
    return { text: JSON.stringify(generated) };
  }, store);
  writer.warm(outcome);
  await writer.get(outcome);
  expect(calls).toBe(1);
  expect(store.rows.size).toBe(1);

  // A restarted server has an empty memory cache; opening the goal must not call the model again.
  const reader = new OutcomeBriefService(async () => {
    throw new Error("must not infer");
  }, store);
  expect((await reader.get(outcome)).background.title).toBe(generated.background.title);
});

test("a saved overview is ignored when it belongs to other content and failed saves do not fail reads", async () => {
  const store = memoryStore();
  let calls = 0;
  const infer = async () => {
    calls++;
    return { text: JSON.stringify(generated) };
  };
  await new OutcomeBriefService(infer, store).get(outcome);
  const [key] = [...store.rows.keys()];
  store.rows.set(key!, { ...(store.rows.get(key!) as object), sourceKey: "stale" });
  expect((await new OutcomeBriefService(infer, store).get(outcome)).sourceKey).toBe(outcomeBriefSource(outcome));
  expect(calls).toBe(2);

  const broken = { find: async () => { throw new Error("db down"); }, save: async () => { throw new Error("db down"); } };
  expect((await new OutcomeBriefService(infer, broken).get(outcome)).outcomeId).toBe(outcome.id);
});

test("warm never throws when inference is unavailable and the first read retries", async () => {
  let calls = 0;
  const service = new OutcomeBriefService(async () => {
    if (++calls === 1) throw new Error("computer offline");
    return { text: JSON.stringify(generated) };
  }, memoryStore());
  expect(() => service.warm(outcome)).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await service.get(outcome)).outcomeId).toBe(outcome.id);
  expect(calls).toBe(2);
});

test("results summary draws on both the final report and the measurement for the selected revision", async () => {
  const { Effect } = await import("effect");
  const { outcomeRoutes } = await import("../src/routes/outcome");
  const revision = outcome.currentRevisionView!;
  const finalReport = "Dify migration verified. Cache utilization fell from 84% to 63%.";
  const measurement = "Cache used: before 480 GB, after 360 GB.";
  const completed = {
    ...outcome,
    currentRevision: 2,
    currentRevisionView: { ...revision, id: "revision-2", revision: 2 },
    workItems: [{ id: "original", contractRevision: 1 }, { id: "successor", contractRevision: 2 }],
    outputs: [
      { id: "measurement", workItemId: "original", title: "Cache measurements", content: measurement },
      { id: "report", workItemId: "original", title: "Cleanup report", content: finalReport },
      { id: "new-report", workItemId: "successor", title: "Successor report", content: "Different revision" },
    ],
  } as OutcomeDetail;
  const generatedReport = {
    summary: "Cache went from 480 GB used (84%) to 360 GB used (63%), a drop of 120 GB.",
    details: "Dify was migrated and verified.",
    citations: [{ id: "measurement", quote: measurement }, { id: "report", quote: finalReport }],
  };
  const prompts: string[] = [];
  const store = memoryStore();
  const outcomeBriefs = new OutcomeBriefService(async ({ prompt }) => {
    prompts.push(prompt);
    return { text: JSON.stringify(generatedReport) };
  }, store);
  const path = `/api/outcomes/${outcome.id}/revisions/1/results-summary`;
  const call = () => outcomeRoutes({
    app: {
      outcomes: { get: () => Effect.succeed(completed), getRevision: () => Effect.succeed(revision) },
      outcomeBriefs,
    },
    path,
    url: new URL(`http://localhost${path}`),
    request: new Request(`http://localhost${path}`),
    authMode: "disabled",
    authenticatedSessionId: null,
  } as unknown as import("../src/routes/context").RouteContext);
  const responses = await Promise.all([call(), call()]);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain(revision.goal[0]!);
  expect(prompts[0]).toContain(measurement);
  expect(prompts[0]).toContain(finalReport);
  expect(prompts[0]).not.toContain("Different revision");
  const expected = {
    outcomeId: outcome.id,
    revisionId: revision.id,
    summary: generatedReport.summary,
    details: generatedReport.details,
    sources: [
      { title: "Cache measurements", quote: measurement },
      { title: "Cleanup report", quote: finalReport },
    ],
    charts: [],
  };
  for (const response of responses) expect(await response?.json()).toEqual(expected);
  const reader = new OutcomeBriefService(async () => {
    throw new Error("must use the saved report");
  }, store);
  expect(await reader.getResult(completed, revision)).toEqual(expected);
  expect(await reader.getResult(outcome, revision)).toBeNull();

  const invalidated = { ...completed, outputs: [
    ...completed.outputs,
    { ...completed.outputs[0]!, id: "updated-measurement", content: "Cache was measured again." },
  ] };
  await outcomeBriefs.getResult(invalidated, revision);
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Cache was measured again.");
});

test("results summary retries after an unsupported source quote", async () => {
  const revision = outcome.currentRevisionView!;
  const content = "Cache usage fell from 84% to 63%.";
  const completed = {
    ...outcome,
    workItems: [{ id: "item", contractRevision: 1 }],
    outputs: [{ id: "report", workItemId: "item", title: "Cleanup report", content }],
  } as OutcomeDetail;
  let attempts = 0;
  const service = new OutcomeBriefService(async () => ({
    text: JSON.stringify({
      summary: `${content} The amount of space freed was not measured.`,
      details: "",
      citations: [{ id: "report", quote: ++attempts === 1 ? "120 GB was freed." : content }],
    }),
  }));
  await expect(service.getResult(completed, revision)).rejects.toThrow("results summary is unavailable");
  expect((await service.getResult(completed, revision))?.sources[0]?.quote).toBe(content);
});

test("background scan persists pending acceptance results and retries a failed generation", async () => {
  const content = "Cache usage fell from 84% to 63%.";
  const pending = {
    ...outcome,
    status: "review_pending",
    workItems: [{ id: "item", contractRevision: 1 }],
    outputs: [{ id: "report", workItemId: "item", title: "Cleanup report", content }],
  } as OutcomeDetail;
  const store = memoryStore();
  let inferenceCalls = 0;
  let saves = 0;
  const service = new OutcomeBriefService(async () => {
    inferenceCalls++;
    return { text: JSON.stringify({
      summary: content, details: "", citations: [{ id: "report", quote: content }],
    }) };
  }, {
    ...store,
    save: async (...args) => {
      if (++saves === 1) throw new Error("temporary persistence failure");
      await store.save(...args);
    },
  });
  const worker = new OutcomeResultSummaryWorker(
    {
      outcome: {
        findMany: async (query: { where: { status: string } }) => {
          expect(query.where.status).toBe("review_pending");
          return [{ id: pending.id }];
        },
      },
    } as unknown as ConstructorParameters<typeof OutcomeResultSummaryWorker>[0],
    { get: () => Effect.succeed(pending) },
    service,
  );
  await worker.scan();
  expect(store.rows.size).toBe(0);
  await worker.scan();
  expect(store.rows.size).toBe(1);
  await worker.scan();
  expect(inferenceCalls).toBe(2);
  const restarted = new OutcomeBriefService(async () => {
    throw new Error("must use saved summary");
  }, store);
  expect((await restarted.getResult(pending, pending.currentRevisionView!))?.summary).toBe(content);
});

test("reports retain all five chart types with grounded values and omit unsupported charts", () => {
  const quote = "Recorded percentages by group: A 84%, B 63%, C 44%, D 39%.";
  const completed = {
    ...outcome,
    workItems: [{ id: "item", contractRevision: 1 }],
    outputs: [{ id: "report", workItemId: "item", title: "Results", content: quote }],
  } as OutcomeDetail;
  const input = outcomeResultInput(completed, completed.currentRevisionView!);
  const report = { summary: "Measured results", details: "", citations: [{ id: "report", quote }] };
  const points = [84, 63, 44, 39].map((value, i) => ({
    label: String.fromCharCode(65 + i), value, citation: 0,
  }));
  const chart = { title: "Recorded percentages", unit: "%" };
  for (const [type, data] of [
    ["metric", points.slice(0, 1)],
    ["bar", points.slice(0, 2)],
    ["line", points],
    ["pie", points.slice(0, 3)],
    ["heatmap", points.map((point, i) => ({
      ...point, label: i % 2 ? "Second" : "First", row: i < 2 ? "North" : "South",
    }))],
  ] as const) {
    expect(parseOutcomeResultSummary({
      ...report, charts: [{ ...chart, type, points: data }],
    }, input).charts).toMatchObject([{ type, points: data }]);
  }
  const damaged = parseOutcomeResultSummary({
    ...report,
    charts: [
      { ...chart, type: "bar", points: [points[0], { ...points[1], value: 630 }] },
      { ...chart, type: "bar", unit: "GB", points: points.slice(0, 2) },
    ],
  }, input);
  expect(damaged.charts).toEqual([]);
  expect(damaged.summary).toBe(report.summary);
});

test("saved Chinese summaries recover a before-and-after chart from the original result", async () => {
  const revision = outcome.currentRevisionView!;
  const content = "Dify 迁移实际已完成并验证。本轮结果不变：Cache 84% → 63%，9 个 LXC 已迁移。";
  const completed = {
    ...outcome,
    workItems: [{ id: "item", contractRevision: 1 }],
    outputs: [{ id: "report", workItemId: "item", title: "清理报告", content }],
  } as OutcomeDetail;
  const summary = "核心结果：Cache 池占用率由 84% 降至 63%（下降 21 个百分点）。";
  const generated = {
    summary,
    details: "",
    citations: [{ id: "report", quote: "Dify 迁移实际已完成并验证。" }],
    charts: [],
  };
  const store = memoryStore();
  const writer = new OutcomeBriefService(async () => ({ text: JSON.stringify(generated) }), store);
  const report = await writer.getResult(completed, revision);
  const chart = {
    type: "bar" as const,
    title: "Cache 池占用率",
    unit: "%",
    points: [
      { label: "之前", value: 84, citation: 1 },
      { label: "之后", value: 63, citation: 1 },
    ],
  };
  expect(report?.charts).toEqual([chart]);
  expect(report?.sources[1]?.quote).toBe("Cache 84% → 63%");

  const [key] = [...store.rows.keys()];
  store.rows.set(key!, { ...report, charts: [], sources: report?.sources.slice(0, 1) });
  const reader = new OutcomeBriefService(async () => {
    throw new Error("must reuse the saved summary");
  }, store);
  expect(await reader.getResult(completed, revision)).toEqual(report);

  const wrongScope = new OutcomeBriefService(async () => ({
    text: JSON.stringify({ ...generated, summary: summary.replace("Cache 池", "Secache 池") }),
  }));
  expect((await wrongScope.getResult(completed, revision))?.charts).toEqual([]);
});
