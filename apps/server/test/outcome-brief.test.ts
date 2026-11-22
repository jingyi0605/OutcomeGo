import { expect, test } from "bun:test";
import { outcomeBriefSource, type OutcomeDetail } from "@outcomego/contracts/outcomes";
import { OutcomeBriefService, parseOutcomeBrief } from "../src/services/outcome-brief-service";
import { OutcomeResultSummaryWorker } from "../src/services/outcome-result-summary-worker";
import { assemblePrereviewReport } from "../src/services/outcome-result-summary";
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

test("the results report is the reviewer's saved submission, shown as saved and never regenerated", async () => {
  const revision = { ...outcome.currentRevisionView!, status: "approved" as const };
  const report = { outcomeId: outcome.id, revisionId: revision.id, reviewTurnId: "review-1", summary: "Keep the current settings.", details: "", sources: [], charts: [] };
  const candidate = {
    ...outcome, status: "decision_pending", currentRevisionView: revision,
    workItems: [{ id: "item", contractRevision: 1 }],
    outputs: [{ id: "report", workItemId: "item", title: "Results", content: "Existing record" }],
  } as OutcomeDetail;
  let inferenceCalls = 0;
  const service = new OutcomeBriefService(async () => {
    inferenceCalls++;
    return { text: "{}" };
  }, memoryStore());
  expect(await service.getResult({ ...candidate, prereviewStatus: "stale" }, revision)).toBeNull();
  expect(await service.getResult({ ...candidate, prereviewStatus: "pending" }, revision)).toBeNull();
  const reviewed = {
    ...candidate, prereview: { turnId: report.reviewTurnId, revision: 1, summary: report.summary,
      attention: [], results: [], report, createdAt: outcome.createdAt },
  };
  expect(await service.getResult(reviewed, revision)).toBe(report);
  expect(await service.getResult({ ...reviewed, prereview: { ...reviewed.prereview, turnId: "other" } }, revision)).toBeNull();
  expect(await service.getResult(reviewed, { ...revision, id: "revision-2", revision: 2 })).toBeNull();
  expect(inferenceCalls).toBe(0);
});

test("the scan only queues a review for goals that have none; it summarizes nothing itself", async () => {
  const revision = { ...outcome.currentRevisionView!, status: "approved" as const };
  const candidate = { ...outcome, status: "decision_pending", currentRevisionView: revision } as OutcomeDetail;
  let current = candidate;
  const queued: string[] = [];
  const scanner = new OutcomeResultSummaryWorker(
    { outcome: { findMany: async () => [{ id: outcome.id }] } } as never,
    { get: () => Effect.succeed(current) },
    async (id) => { queued.push(id); return true; },
  );
  await scanner.scan();
  current = { ...candidate, prereviewStatus: "pending" };
  await scanner.scan();
  current = { ...candidate, prereviewStatus: "unreviewed" };
  await scanner.scan();
  current = { ...candidate, prereview: { turnId: "t", revision: 1, summary: "", attention: [], results: [], createdAt: outcome.createdAt } };
  await scanner.scan();
  expect(queued).toEqual([outcome.id]);
});

test("reports keep all five chart types with grounded values and refuse ungrounded points", () => {
  const quote = "Recorded percentages by group: A 84%, B 63%, C 44%, D 39%. North First 84%. North Second 63%. South First 44%. South Second 39%.";
  const evidence = [{ id: "e1", sourceType: "check", contentSummary: quote, credibility: "external_record" as const }];
  const chart = { title: "Recorded percentages", unit: "%" };
  const build = (charts: unknown) => assemblePrereviewReport(
    "o", "r", "t", "Measured results", [{ evidenceIds: ["e1"] }], evidence, charts as never,
  );
  const grounded = (label: string, value: number, extra: object = {}) =>
    ({ label, value, evidenceId: "e1", quote: `${label} ${value}%`, ...extra });
  const values: Array<[string, number]> = [["A", 84], ["B", 63], ["C", 44], ["D", 39]];
  const points = values.map(([label, value]) => grounded(label, value));
  for (const [type, data] of [
    ["metric", points.slice(0, 1)],
    ["bar", points.slice(0, 2)],
    ["line", points],
    ["pie", points.slice(0, 3)],
    ["heatmap", values.map(([, value], i) => {
      const row = i < 2 ? "North" : "South";
      const label = i % 2 ? "Second" : "First";
      return grounded(label, value, { row, quote: `${row} ${label} ${value}%` });
    })],
  ] as const) {
    const report = build([{ ...chart, type, points: data }] as never);
    expect(report.charts).toMatchObject([{ type, points: data.map(({ value }) => ({ value })) }]);
  }
  expect(() => build([{ ...chart, type: "bar", points: [points[0], { ...points[1], value: 630 }] }] as never)).toThrow("exactly one reading");
  expect(() => build([{ ...chart, type: "bar", points: [points[0], { ...points[1], quote: "B 99%", value: 99 }] }] as never)).toThrow("does not appear");
  expect(() => build([{ ...chart, type: "bar", unit: "GB", points: points.slice(0, 2) }] as never)).toThrow("exactly one reading");
  expect(() => build([{ ...chart, type: "bar", points: [points[0], { ...points[1], evidenceId: "missing" }] }] as never)).toThrow("not found");
});
