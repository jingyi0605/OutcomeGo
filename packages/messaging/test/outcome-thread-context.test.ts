import { expect, test } from "bun:test";
import { outcomeRunContext, outcomeThreadContext } from "../src/outcome-threads";

type Row = Record<string, any>;

function makeContextDb(purpose: string, options: { withPlanNotes?: boolean } = {}) {
  const revision = {
    id: "rev-1",
    revision: 1,
    status: "pending_approval",
    approvedAt: new Date(),
    goal: ["Publish curated docs"],
    boundaries: { included: ["markdown"], excluded: [] },
    budget: null,
    plan: options.withPlanNotes
      ? {
          notes: "Split by chapter; merge terminology before final review.",
          tasks: [
            {
              key: "draft",
              title: "Draft docs",
              instructions: "Write sections",
              botId: "bot-exec",
              covers: ["c1"],
              nature: "deliverable",
            },
          ],
        }
      : null,
    criteria: [{ id: "c1", statement: "All chapters complete", required: true }],
  };
  const db: Row = {
    outcomeThread: {
      findFirst: async () => ({
        id: "thread-1",
        botId: "bot-role",
        outcome: {
          id: "outcome-1",
          botId: "bot-submitter",
          title: "Docs Goal",
          description: "Create docs",
          status: "planning",
          currentRevision: revision,
        },
      }),
    },
    outcomeThreadTurn: {
      findFirst: async () => ({ purpose, workItemId: purpose === "review_task" ? "wi-1" : null }),
    },
    featureSettings: {
      findUnique: async () => ({
        outcomesEnabled: true,
        environmentNote: "Company wiki lives on Notion; NAS path is /mnt/archive.",
      }),
    },
    bot: {
      findMany: async () => [
        {
          id: "bot-exec",
          name: "Writer",
          description: "Handles documentation writing",
          inferenceProvider: "anthropic",
          inferenceModel: "claude-sonnet-4-5",
          inferenceReasoning: "high",
        },
        {
          id: "bot-ops",
          name: "Operator",
          description: "",
          inferenceProvider: null,
          inferenceModel: null,
          inferenceReasoning: null,
        },
      ],
      findUnique: async ({ where }: Row) =>
        where.id === "bot-submitter" ? { id: "bot-submitter", name: "Main Assistant" } : null,
    },
    outcomeWorkItem: {
      findFirst: async () => ({
        id: "wi-1",
        outcomeId: "outcome-1",
        botId: "bot-exec",
        executorType: "agent",
        progress: null,
        contractRevision: revision,
      }),
    },
  };
  return db;
}

test("planner turns include environmentNote, assignableBots, and submitterBot hint on plan turn", async () => {
  const ctx = await outcomeThreadContext(makeContextDb("plan") as never, "bot-role", "thread-1", {
    globalInference: { providerId: "openai-codex", modelId: "gpt-5.4", reasoning: "medium" },
  });
  expect(ctx).toContain("Company wiki lives on Notion; NAS path is /mnt/archive.");
  expect(ctx).toContain("bot-submitter");
  expect(ctx).toContain("ReadTranscript");
  expect(ctx).toContain("bot-exec");
  expect(ctx).toContain("claude-sonnet-4-5");
  expect(ctx).toContain("gpt-5.4");
});

test("planner turns prefer one task over a chain of same-bot steps", async () => {
  const ctx = await outcomeThreadContext(makeContextDb("plan") as never, "bot-role", "thread-1");
  expect(ctx).toContain("Prefer one task over several");
  expect(ctx).toContain("different Bot, different permissions, or can run in parallel");
});

test("reviewer turns include environmentNote and planNotes without assignableBots", async () => {
  const reviewCtx = await outcomeThreadContext(
    makeContextDb("review", { withPlanNotes: true }) as never,
    "bot-role",
    "thread-1"
  );
  expect(reviewCtx).toContain("Company wiki lives on Notion");
  expect(reviewCtx).toContain("Split by chapter; merge terminology before final review.");
  expect(reviewCtx).toContain("SubmitPrereview");
  expect(reviewCtx).not.toContain("assignableBots");
  expect(reviewCtx).not.toContain("SaveOutcomeContract");

  const taskReviewCtx = await outcomeThreadContext(
    makeContextDb("review_task", { withPlanNotes: true }) as never,
    "bot-role",
    "thread-1"
  );
  expect(taskReviewCtx).toContain("ReviewTaskResult");
  expect(taskReviewCtx).toContain("wi-1");
});

test("work-item outcomeRunContext never includes environmentNote and switches instructions on rework", async () => {
  const db = makeContextDb("plan");
  db.outcomeWorkItem.findFirst = async () => ({
    id: "wi-1",
    outcomeId: "outcome-1",
    botId: "bot-exec",
    executorType: "agent",
    reworkOfWorkItemId: null,
    progress: null,
    contractRevision: { ...(await db.outcomeThread.findFirst()).outcome.currentRevision, status: "approved" },
  });
  const runCtx = await outcomeRunContext(db as never, "bot-exec", "wi-1");
  expect(runCtx).not.toContain("Company wiki lives on Notion");
  expect(runCtx).not.toContain("environmentNote");
  expect(runCtx).toContain("ReportOutcomeProgress");

  db.outcomeWorkItem.findFirst = async () => ({
    id: "wi-rework",
    outcomeId: "outcome-1",
    botId: "bot-exec",
    executorType: "agent",
    reworkOfWorkItemId: "wi-1",
    progress: null,
    contractRevision: { ...(await db.outcomeThread.findFirst()).outcome.currentRevision, status: "approved" },
  });
  const reworkCtx = await outcomeRunContext(db as never, "bot-exec", "wi-rework");
  expect(reworkCtx).toContain("ONLY the rework fixes");
});

test("owner_message turns in review_pending guide planner to accept, rework, replan, revise, cancel, or clarify", async () => {
  const db = makeContextDb("owner_message", { withPlanNotes: true });
  const baseFindFirst = db.outcomeThread.findFirst;
  db.outcomeThread.findFirst = async () => {
    const thread = await baseFindFirst();
    return {
      ...thread,
      outcome: {
        ...thread.outcome,
        status: "review_pending",
        currentRevision: { ...thread.outcome.currentRevision, status: "approved" },
      },
    };
  };
  const ctx = await outcomeThreadContext(db as never, "bot-role", "thread-1");
  expect(ctx).toContain("Acceptance conversation (outcome is review_pending)");
  expect(ctx).toContain("NEVER call AcceptOutcome yet");
  expect(ctx).toContain("AcceptOutcome");
  expect(ctx).toContain("RequestOutcomeRework");
  expect(ctx).toContain("SavePlan");
  expect(ctx).toContain("SaveOutcomeContract");
  expect(ctx).toContain("CancelOutcome");
});

// Specs/004.10 task 2.8: scheduling guidance for the planner. It lives in the planner thread's own prompt, not in the
// shared base prompt every bot carries, so it costs the base prompt (and its cache) nothing.
const SCHEDULING_MARKER = "Scheduling";
const guidanceOf = (ctx: string) => ctx.split("\n").filter((line) => line.startsWith("- ") && line.includes(SCHEDULING_MARKER)).join("\n");

test("planner turns are told when to give a start time, when to give an estimate, and to leave both out when unsure", async () => {
  for (const purpose of ["plan", "replan", "owner_message"] as const) {
    const ctx = await outcomeThreadContext(makeContextDb(purpose) as never, "bot-role", "thread-1");
    const text = guidanceOf(ctx);
    expect(text).not.toBe("");
    expect(text).toContain("startAt");
    expect(text).toContain("estimateMinutes");
    expect(text).toMatch(/cannot or should not start earlier/i);
    expect(text).toMatch(/only when you are (fairly )?sure/i);
    expect(text).toMatch(/when unsure,? leave (it|them) out/i);
  }
});

test("planner turns are told a deadline for the goal is only suggested in the plan notes, never set", async () => {
  const text = guidanceOf(await outcomeThreadContext(makeContextDb("plan") as never, "bot-role", "thread-1"));
  expect(text).toMatch(/goal.*deadline|deadline.*goal/i);
  expect(text).toContain("notes");
});

test("the guidance is told that a start time in the past just means already due, so a replan can send tasks back unchanged", async () => {
  const text = guidanceOf(await outcomeThreadContext(makeContextDb("replan") as never, "bot-role", "thread-1"));
  expect(text).toMatch(/past/i);
});

test("the scheduling guidance is short and carries no business number or scenario word", async () => {
  const text = guidanceOf(await outcomeThreadContext(makeContextDb("plan") as never, "bot-role", "thread-1"));
  // A scale limit on the prompt, not a product value: the point is that it stays a few lines.
  expect(text.length).toBeLessThan(1_200);
  expect(text.replace(/ISO 8601|UTC/g, "")).not.toMatch(/\d/);
  expect(text).not.toMatch(/mail|visit|inspect|customer|sender|invoice/i);
});

test("review turns and work-item runs carry no scheduling guidance", async () => {
  for (const purpose of ["review", "review_task"] as const) {
    const ctx = await outcomeThreadContext(makeContextDb(purpose, { withPlanNotes: true }) as never, "bot-role", "thread-1");
    expect(guidanceOf(ctx)).toBe("");
    expect(ctx).not.toContain("startAt");
  }
});
