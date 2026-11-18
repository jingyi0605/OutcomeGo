import { expect, test } from "bun:test";
import { outcomeBriefSource, type OutcomeDetail } from "@outcomego/contracts/outcomes";
import { OutcomeBriefService, parseOutcomeBrief } from "../src/services/outcome-brief-service";

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
