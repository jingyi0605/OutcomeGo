import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import { OUTCOME_CHAT_TOOL_NAMES } from "@outcomego/contracts/outcome-chat";
import type {
  OutcomeDetail,
  OutcomeListPage,
  PlanningDraftView,
} from "@outcomego/contracts/outcomes";
import type {
  ExploreIdeaPage,
  ExploreIdeaView,
} from "@outcomego/contracts/explore";
import type { OutcomeInboxPage } from "@outcomego/contracts/outcome-inbox";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeChatTools } from "../src/services/outcome-chat-tools";
import { InternalToolService } from "../src/services/internal-tool-service";
import { OutcomeService } from "../src/services/outcome-service";
import { OutcomePlanningService } from "../src/services/outcome-planning-service";
import { OutcomeInboxService } from "../src/services/outcome-inbox-service";
import { ExploreService } from "../src/services/explore-service";
import { RunService } from "../src/services/run-service";
import { DecisionService } from "../src/services/decision-service";
import { OutcomeChatCards } from "../src/services/outcome-chat-cards";
import type { OutcomeInference } from "../src/services/outcome-inference";
import { AgentMessaging } from "@outcomego/messaging";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const key = () => `chat-test:${crypto.randomUUID()}`;
type DetailResult = { outcome: OutcomeDetail; url: string; approvalRequired: boolean };
const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

async function fixture(infer?: OutcomeInference) {
  const h = await outcomeThreadFixture();
  cleanups.push(() => h.cleanup());
  const planning = new OutcomePlanningService(
    h.db,
    infer ??
      (async () => ({
        text: JSON.stringify({
          goal: [
            {
              text: "Reclaim Unraid disk space",
              recommended: true,
              reason: "Matches the requested goal",
            },
          ],
          acceptance: [
            { text: "Document reclaimed bytes and verify services still run", required: true },
          ],
          boundaries: [
            { text: "Do not delete personal files without confirmation", kind: "excluded" },
          ],
        }),
      }))
  );
  const outcomes = new OutcomeService(
    h.db,
    h.messaging,
    new RunService(h.db, async () => new Response("{}"))
  );
  const explore = new ExploreService(h.db, planning);
  const cardMessaging = new AgentMessaging(
    h.db,
    {
      send: async () => "job",
      sendDebounced: async () => "projection-job",
    } as never,
    h.store
  );
  const tools = new OutcomeChatTools(
    outcomes,
    new OutcomeInboxService(h.db),
    explore,
    new OutcomeChatCards(h.db, cardMessaging)
  );
  const setOutcomesEnabled = (outcomesEnabled: boolean) =>
    h.db.featureSettings.upsert({
      where: { id: "global" },
      create: { id: "global", outcomesEnabled },
      update: { outcomesEnabled },
    });
  // Goal management is opt-in; these tests exercise it, so switch it on.
  await setOutcomesEnabled(true);
  const main = await h.db.$transaction((tx) =>
    h.messaging.enqueueWake(tx, {
      botId: h.bot.id,
      channelId: h.channel.id,
      origin: "user",
      type: "user.message",
      content: "Create a native goal to clean Unraid space",
      clientId: key(),
      priority: 300,
    })
  );
  await h.db.run.update({ where: { id: main.run.id }, data: { status: "running" } });
  const internal = new InternalToolService(
    h.db,
    h.messaging,
    {} as never,
    async () => {},
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    tools
  );
  const request = (tool: string, args: unknown): DynamicToolCallRequest => ({
    runId: main.run.id,
    botId: h.bot.id,
    conversationId: main.run.conversationId,
    channelId: main.run.channelId!,
    deliveryId: main.run.deliveryId,
    callId: key(),
    tool,
    arguments: args,
  });
  const call = <T>(tool: string, args: unknown = {}) =>
    Effect.runPromise(internal.execute(request(tool, args))) as Promise<T>;
  const failure = async (tool: string, args: unknown) => {
    const result = await Effect.runPromise(Effect.either(internal.execute(request(tool, args))));
    expect(result._tag).toBe("Left");
    if (result._tag === "Right") throw new Error("Expected tool failure");
    expect(result.left).toBeInstanceOf(ApiError);
    return (result.left as ApiError).code;
  };
  const create = async (title = `Unraid ${crypto.randomUUID()}`) => {
    const planInput = {
      sourceText: "Clean Unraid partition space and propose the steps",
      clientRequestId: key(),
    };
    const plan = await call<PlanningDraftView>("PlanOutcome", planInput);
    const input = {
      planId: plan.planId,
      title,
      clientRequestId: key(),
      goal: { selectedOptionIds: [plan.goal.options[0]!.id], customEntries: [] },
      acceptance: { selectedOptionIds: [plan.acceptance.options[0]!.id], customEntries: [] },
      boundaries: { selectedOptionIds: [plan.boundaries.options[0]!.id], customEntries: [] },
      budget: { timeLimitMinutes: 60, costLimit: null },
    };
    const result = await call<DetailResult>("CreateOutcome", input);
    return { plan, planInput, input, result };
  };
  const f = { h, planning, outcomes, main, request, call, failure, create, setOutcomesEnabled };
  return f;
}

describe.skipIf(!databaseUrl)(
  "ordinary conversation native Outcome tools with real services",
  () => {
    // Retired planning tools (specs/004.8 task 3.2): migrate this to the contract-writing CreateOutcome.
    test.skip("one persisted card changes from generation to real suggestions across an inference barrier", async () => {
      let release!: () => void;
      let entered!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const f = await fixture(async () => {
        entered();
        await barrier;
        return {
          text: JSON.stringify({
            goal: [{ text: "Measure before cleaning" }],
            acceptance: [{ text: "Record reclaimed bytes" }],
            boundaries: [],
          }),
        };
      });
      const args = { sourceText: "Clean storage safely", clientRequestId: key() };
      const pending = f.call<PlanningDraftView>("PlanOutcome", args);
      try {
        await started;
        const during = await f.h.db.channelMessage.findMany({
          where: { channelId: f.h.channel.id, sender: "agent" },
        });
        expect(during).toHaveLength(1);
        expect(during[0]!.metadata).toMatchObject({
          type: "outcome-card",
          outcomeCard: { stage: "generating", title: "Clean storage safely" },
        });
        release();
        const plan = await pending;
        const after = await f.h.db.channelMessage.findUniqueOrThrow({
          where: { id: during[0]!.id },
        });
        expect(after.metadata).toMatchObject({
          outcomeCard: {
            stage: "plan_ready",
            planId: plan.planId,
            suggestions: {
              goals: ["Measure before cleaning"],
              acceptance: ["Record reclaimed bytes"],
            },
          },
        });
        expect(after.content).not.toContain("Record reclaimed bytes");
        await f.call("PlanOutcome", args);
        expect(
          (await f.h.db.channelMessage.findUniqueOrThrow({ where: { id: after.id } })).metadata
        ).toMatchObject({ outcomeCard: { stage: "plan_ready" } });
        expect(
          await f.h.db.channelMessage.count({
            where: { channelId: f.h.channel.id, sender: "agent" },
          })
        ).toBe(1);
        expect(
          await f.h.db.event.count({
            where: { topic: "channel.message.updated", entityId: after.id },
          })
        ).toBeGreaterThan(0);
      } finally {
        release();
        await pending.catch(() => {});
      }
    });
    // Retired planning tools (specs/004.8 task 3.2): migrate this to the contract-writing CreateOutcome.
    test.skip("draft cards carry actual IDs, never approve; identical write retries reuse the card", async () => {
      const f = await fixture();
      const { input, result } = await f.create();
      const cards = () =>
        f.h.db.channelMessage.findMany({ where: { channelId: f.h.channel.id, sender: "agent" } });
      expect(await cards()).toHaveLength(2);
      expect((await cards()).map((row) => row.metadata)).toContainEqual(
        expect.objectContaining({
          type: "outcome-card",
          outcomeCard: expect.objectContaining({
            outcomeId: result.outcome.id,
            stage: "draft",
            revision: 1,
          }),
        })
      );
      await f.call("CreateOutcome", input);
      expect(await cards()).toHaveLength(2);
      expect(result.outcome.currentRevisionView!.approvedAt).toBeNull();
      expect(
        await f.failure("StartOutcome", {
          outcomeId: result.outcome.id,
          expectedRevision: 1,
          clientRequestId: key(),
        })
      ).toBe("contract_revision_not_approved");
      expect((await cards()).map((row) => row.metadata)).toContainEqual(
        expect.objectContaining({
          outcomeCard: expect.objectContaining({ stage: "failed" }),
        })
      );
      const count = (await cards()).length;
      expect(await f.failure("CreateOutcome", {})).toBe("invalid_request");
      expect(await cards()).toHaveLength(count);
    });
    test("goal tools are refused while the owner has goal management turned off", async () => {
      const f = await fixture();
      await f.setOutcomesEnabled(false);
      try {
        for (const tool of ["CreateOutcome", "TrackOutcome", "ListOutcomes", "CreateExploreIdea"])
          expect(await f.failure(tool, { clientRequestId: key() })).toBe("outcomes_disabled");
        expect(await f.h.db.outcomePlanningDraft.count({ where: { botId: f.h.bot.id } })).toBe(0);
      } finally {
        await f.setOutcomesEnabled(true);
      }
    });

    // Retired planning tools (specs/004.8 task 3.2): migrate this to the contract-writing CreateOutcome.
    test.skip("planning failure leaves a failed card and no fabricated ready plan or Outcome", async () => {
      const f = await fixture(async () => {
        throw new Error("Controlled inference failure");
      });
      expect(
        await f.failure("PlanOutcome", { sourceText: "Test failure", clientRequestId: key() })
      ).toBe("planning_generation_failed");
      const messages = await f.h.db.channelMessage.findMany({
        where: { channelId: f.h.channel.id, sender: "agent" },
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]!.metadata).toMatchObject({ outcomeCard: { stage: "failed" } });
      expect(
        await f.h.db.outcome.count({ where: { planningDraftId: { not: null }, botId: f.h.bot.id } })
      ).toBe(0);
    });
    // Retired planning tools (specs/004.8 task 3.2): migrate this to the contract-writing CreateOutcome.
    test.skip("conversation -> persisted plan -> unapproved Outcome; owner approval then one isolated start", async () => {
      const f = await fixture();
      const { plan, input, result } = await f.create();
      expect(await f.call<PlanningDraftView>("GetOutcomePlan", { planId: plan.planId })).toEqual({
        ...plan,
        status: "consumed",
      });
      expect(result).toMatchObject({
        approvalRequired: true,
        url: `outcomego://app/v1/outcomes?id=${result.outcome.id}`,
        outcome: {
          botId: f.h.bot.id,
          status: "pending_approval",
          workItems: [],
          currentRevisionView: { createdBy: `bot:${f.h.bot.id}`, approvedAt: null },
        },
      });
      expect(await f.call<DetailResult>("CreateOutcome", input)).toEqual(result);
      expect(await f.h.db.outcome.count({ where: { planningDraftId: plan.planId } })).toBe(1);
      const start = { outcomeId: result.outcome.id, expectedRevision: 1, clientRequestId: key() };
      expect(await f.failure("StartOutcome", start)).toBe("contract_revision_not_approved");
      expect(await f.h.db.run.count({ where: { botId: f.h.bot.id, origin: "outcome" } })).toBe(0);
      await Effect.runPromise(
        f.outcomes.approve(
          result.outcome.id,
          1,
          {
            expectedRevision: 1,
            confirmationText: "I confirm the displayed contract",
            clientRequestId: key(),
          },
          "owner:local"
        )
      );
      const started = await f.call<DetailResult>("StartOutcome", start);
      expect(await f.call<DetailResult>("StartOutcome", start)).toEqual(started);
      expect(started.outcome.workItems).toHaveLength(1);
      expect(started.outcome.currentRevisionView?.approvedBy).toBe("owner:local");
      expect(await f.h.db.run.count({ where: { botId: f.h.bot.id, origin: "outcome" } })).toBe(1);
      expect(await f.h.db.run.findUnique({ where: { id: f.main.run.id } })).toMatchObject({
        status: "running",
        origin: "user",
        outcomeWorkItemId: null,
      });
      const read = await f.call<DetailResult & { transcript: { total: number } }>("GetOutcome", {
        outcomeId: result.outcome.id,
        workItemId: started.outcome.workItems[0]!.id,
        limit: 5,
      });
      expect(read.transcript.total).toBeGreaterThan(0);
      expect(read.outcome.outputs).toEqual([]);
      expect(read.outcome.reviews).toEqual([]);
      const cancel = { outcomeId: result.outcome.id, clientRequestId: key() };
      expect(await f.call("CancelOutcome", cancel)).toMatchObject({
        outcome: { status: "cancelled" },
      });
      expect(await f.call("CancelOutcome", cancel)).toMatchObject({
        outcome: { status: "cancelled" },
      });
      expect(
        await f.h.db.run.findUnique({ where: { id: started.outcome.workItems[0]!.rootRunId! } })
      ).toMatchObject({ status: "cancelled" });
      expect(await f.h.db.run.findUnique({ where: { id: f.main.run.id } })).toMatchObject({
        status: "running",
      });
    });

    // Retired planning tools (specs/004.8 task 3.2): migrate this to the contract-writing CreateOutcome.
    test.skip("search/status pagination, historical revisions and stale edit detection use saved facts", async () => {
      const f = await fixture();
      const search = `chat-search-${crypto.randomUUID()}`;
      const first = await f.create(`${search} first`);
      await f.create(`${search} second`);
      const page = await f.call<OutcomeListPage>("ListOutcomes", {
        query: search.toUpperCase(),
        statuses: ["pending_approval"],
        limit: 1,
      });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeString();
      const next = await f.call<OutcomeListPage>("ListOutcomes", {
        query: search,
        statuses: ["pending_approval"],
        cursor: page.nextCursor,
        limit: 1,
      });
      expect(next.items).toHaveLength(1);
      expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
      expect(next.nextCursor).toBeNull();
      const revision = {
        outcomeId: first.result.outcome.id,
        baseRevision: 1,
        changeSummary: "Also preserve VM images",
        contract: {
          goal: ["Reclaim disk space"],
          acceptance: [{ statement: "List reclaimed bytes", required: true }],
          boundaries: { included: ["Cache audit"], excluded: ["Delete VM images"] },
          budget: null,
        },
        clientRequestId: key(),
      };
      const updated = await f.call<DetailResult>("ReviseOutcome", revision);
      expect(updated.outcome.currentRevision).toBe(2);
      expect(updated.approvalRequired).toBe(true);
      expect(await f.call<DetailResult>("ReviseOutcome", revision)).toEqual(updated);
      expect(await f.failure("ReviseOutcome", { ...revision, clientRequestId: key() })).toBe(
        "contract_revision_conflict"
      );
      const historical = await f.call<{ revision: { revision: number; status: string } }>(
        "GetOutcome",
        {
          outcomeId: first.result.outcome.id,
          revision: 1,
        }
      );
      expect(historical.revision).toMatchObject({ revision: 1, status: "superseded" });
      expect(await f.failure("GetOutcome", { outcomeId: crypto.randomUUID() })).toBe(
        "outcome_not_found"
      );
      expect(await f.failure("ListOutcomes", { cursor: "broken" })).toBe("invalid_outcome_query");
      expect(await f.call<PlanningDraftView>("PlanOutcome", first.planInput)).toEqual(first.plan);
      expect(
        await f.failure("PlanOutcome", {
          sourceText: "Different request",
          clientRequestId: first.planInput.clientRequestId,
        })
      ).toBe("idempotency_conflict");
    });

    // Retired planning tools (specs/004.8 task 3.2): migrate this to the contract-writing CreateOutcome.
    test.skip("Explore ideas persist, replay, propose real planning, convert and preserve terminal rules", async () => {
      const f = await fixture();
      const input = {
        title: "Explore a safer cache layout",
        note: "Keep disk cleanup separate",
        clientRequestId: key(),
      };
      const idea = await f.call<ExploreIdeaView>("CreateExploreIdea", input);
      expect(idea.botId).toBe(f.h.bot.id);
      expect(await f.call<ExploreIdeaView>("CreateExploreIdea", input)).toEqual(idea);
      expect(await f.call<ExploreIdeaView>("GetExploreIdea", { ideaId: idea.id })).toEqual(idea);
      expect(
        (await f.call<ExploreIdeaPage>("ListExploreIdeas", { statuses: ["draft"] })).items.map(
          (i) => i.id
        )
      ).toContain(idea.id);
      const proposed = await f.call<{ idea: { id: string; status: string }; plan: { planId: string } }>("ProposeExploreIdea", {
        ideaId: idea.id,
        clientRequestId: key(),
      });
      expect(proposed.idea.status).toBe("proposed_for_delivery");
      const plan = proposed.plan;
      const created = await f.call<DetailResult>("CreateOutcome", {
        planId: plan.planId,
        title: idea.title,
        clientRequestId: key(),
        goal: { selectedOptionIds: ["goal-1"], customEntries: [] },
        acceptance: { selectedOptionIds: ["acceptance-1"], customEntries: [] },
        boundaries: { selectedOptionIds: ["boundaries-1"], customEntries: [] },
      });
      expect(created.outcome.sourceExploreId).toBe(idea.id);
      expect(
        await f.failure("DiscardExploreIdea", { ideaId: idea.id, clientRequestId: key() })
      ).toBe("explore_read_only");
      const other = await f.call<ExploreIdeaView>("CreateExploreIdea", {
        ...input,
        clientRequestId: key(),
      });
      const discard = { ideaId: other.id, clientRequestId: key() };
      expect(await f.call("DiscardExploreIdea", discard)).toMatchObject({ status: "discarded" });
      expect(await f.call("DiscardExploreIdea", discard)).toMatchObject({ status: "discarded" });
    });

    // Retired planning tools (specs/004.8 task 3.2): migrate this to the contract-writing CreateOutcome.
    test.skip("attention queries and cancellation use business facts without accepting or deleting history", async () => {
      const f = await fixture();
      const { result } = await f.create();
      expect(
        await f.call<OutcomeInboxPage>("ListOutcomeInbox", { outcomeId: result.outcome.id })
      ).toMatchObject({ items: [], nextCursor: null });
      const decision = await Effect.runPromise(
        new DecisionService(f.h.db).create(
          {
            outcomeId: f.h.outcome.id,
            contractRevisionId: f.h.revision.id,
            completedSummary: "Cache inspection finished",
            problemSummary: "Choose which cache policy to use",
            nextStepSummary: "Review the two choices",
            reasonCode: "missing_input",
            options: [
              {
                id: "keep",
                label: "Keep files",
                consequence: "No files are removed",
                source: "runtime",
                resolutionEffect: "plan_only",
              },
            ],
          },
          `bot:${f.h.bot.id}`
        )
      );
      const attention = await f.call<OutcomeInboxPage>("ListOutcomeInbox", {
        outcomeId: f.h.outcome.id,
        category: "decision_pending",
      });
      expect(attention.items).toHaveLength(1);
      expect(attention.items[0]).toMatchObject({
        decisionId: decision.id,
        requiresAction: true,
        problem: "Choose which cache policy to use",
      });
      expect(await f.h.db.outcomeDecision.findUnique({ where: { id: decision.id } })).toMatchObject(
        { status: "open", resolvedAt: null, resolvedBy: null }
      );
      const output = await f.h.db.outcomeOutput.count({ where: { outcomeId: result.outcome.id } });
      const input = { outcomeId: result.outcome.id, clientRequestId: key() };
      expect(await f.call("CancelOutcome", input)).toMatchObject({
        outcome: { status: "cancelled" },
      });
      expect(await f.call("CancelOutcome", input)).toMatchObject({
        outcome: { status: "cancelled" },
      });
      expect(await f.h.db.outcomeOutput.count({ where: { outcomeId: result.outcome.id } })).toBe(
        output
      );
      expect(
        await f.failure("PlanOutcome", {
          sourceText: "x",
          actor: "owner:local",
          clientRequestId: key(),
        })
      ).toBe("invalid_request");
    });

    // Retired planning tools (specs/004.8 task 3.2): migrate this to the contract-writing CreateOutcome.
    test.skip("all management calls reject background/stopped/forged Run context before side effects", async () => {
      const f = await fixture();
      for (const origin of ["routine", "outcome"] as const) {
        await f.h.db.run.update({ where: { id: f.main.run.id }, data: { origin } });
        for (const tool of OUTCOME_CHAT_TOOL_NAMES)
          expect(await f.failure(tool, {})).toBe("outcome_chat_required");
      }
      await f.h.db.run.update({
        where: { id: f.main.run.id },
        data: { status: "cancelled", origin: "user" },
      });
      expect(
        await f.failure("PlanOutcome", {
          sourceText: "Should never be saved",
          clientRequestId: key(),
        })
      ).toBe("tool_context_invalid");
      expect(await f.h.db.outcomePlanningDraft.count({ where: { botId: f.h.bot.id } })).toBe(0);
      await f.h.db.run.update({ where: { id: f.main.run.id }, data: { status: "running" } });
      const forged = {
        ...f.request("PlanOutcome", { sourceText: "Never", clientRequestId: key() }),
        botId: crypto.randomUUID(),
      };
      const denied = await Effect.runPromise(
        Effect.either(
          new InternalToolService(
            f.h.db,
            f.h.messaging,
            {} as never,
            async () => {},
            {} as never,
            {} as never,
            {} as never,
            {} as never
          ).execute(forged)
        )
      );
      expect(denied._tag === "Left" && (denied.left as ApiError).code).toBe("tool_context_invalid");
      const parent = await fixture();
      await f.h.db.subagent.create({
        data: {
          parentBotId: parent.h.bot.id,
          parentRunId: parent.main.run.id,
          parentChannelId: parent.h.channel.id,
          childBotId: f.h.bot.id,
          launchCallId: key(),
          description: "Delegated fixture",
          prompt: "Delegated work",
          subagentType: "executor",
          outputPath: "/tmp/fixture",
        },
      });
      expect(await f.failure("PlanOutcome", { sourceText: "Never", clientRequestId: key() })).toBe(
        "outcome_chat_required"
      );
    });
  }
);
