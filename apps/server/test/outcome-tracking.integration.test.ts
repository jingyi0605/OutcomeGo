import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import { parseOutcomeInboxQuery, type OutcomeInboxPage } from "@outcomego/contracts/outcome-inbox";
import type { ToolContext } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeChatTools } from "../src/services/outcome-chat-tools";
import { OutcomeService } from "../src/services/outcome-service";
import { OutcomePlanningService } from "../src/services/outcome-planning-service";
import { OutcomeInboxService } from "../src/services/outcome-inbox-service";
import { ExploreService } from "../src/services/explore-service";
import { RunService } from "../src/services/run-service";
import { DecisionService } from "../src/services/decision-service";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const key = () => `track-test:${crypto.randomUUID()}`;
type Result = { outcome: OutcomeDetail; decisionId?: string | null; approvalRequired: boolean; nextStep: string };
const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

async function fixture() {
  const h = await outcomeThreadFixture();
  const created: string[] = [];
  cleanups.push(async () => {
    await h.db.event.deleteMany({ where: { entityId: { in: created } } });
    await h.cleanup();
  });
  const infer = async () => ({ text: "{}" });
  const planning = new OutcomePlanningService(h.db, infer);
  const outcomes = new OutcomeService(h.db, h.messaging, new RunService(h.db, async () => new Response("{}")));
  const decisions = new DecisionService(h.db, { messaging: h.messaging });
  const inbox = new OutcomeInboxService(h.db);
  const tools = new OutcomeChatTools(outcomes, inbox, new ExploreService(h.db, planning), undefined, decisions);
  const context = {
    runId: crypto.randomUUID(),
    botId: h.bot.id,
    conversationId: crypto.randomUUID(),
    channelId: h.channel.id,
    deliveryId: null,
    origin: "user",
    callId: key(),
    replyToMessageId: null,
    isFork: false,
  } as ToolContext;
  const call = async <T>(tool: string, args: unknown): Promise<T> => {
    const request = { ...context, tool, arguments: args } as unknown as DynamicToolCallRequest;
    const result = (await tools.execute(request, context)) as T;
    const outcome = (result as { outcome?: OutcomeDetail }).outcome;
    if (outcome) created.push(outcome.id);
    return result;
  };
  const failure = async (tool: string, args: unknown) => {
    try {
      await tools.execute({ ...context, tool, arguments: args } as unknown as DynamicToolCallRequest, context);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      return (error as ApiError).code;
    }
    throw new Error("Expected tool failure");
  };
  const pendingInbox = (): Promise<OutcomeInboxPage> =>
    Effect.runPromise(inbox.list(parseOutcomeInboxQuery(new URLSearchParams("status=pending"))));
  return { h, decisions, call, failure, pendingInbox };
}

describe.skipIf(!databaseUrl)("Bot task board: TrackOutcome / CloseOutcome with real services", () => {
  test("a silent task is registered without planning, never runs, and closes without owner acceptance", async () => {
    const f = await fixture();
    const input = { title: "Renew domain", goal: "Renew the domain before it expires", clientRequestId: key() };
    const result = await f.call<Result>("TrackOutcome", input);
    expect(result.outcome).toMatchObject({ trackingMode: "tracked", status: "approved", botId: f.h.bot.id });
    expect(result.outcome.currentRevisionView).toMatchObject({ status: "approved" });
    expect(result.outcome.workItems).toHaveLength(0);
    expect(result.approvalRequired).toBe(false);
    expect(result.nextStep).toContain("CloseOutcome");
    // Same request ID returns the same goal.
    const replay = await f.call<Result>("TrackOutcome", input);
    expect(replay.outcome.id).toBe(result.outcome.id);
    expect(await f.h.db.outcome.count({ where: { title: "Renew domain", botId: f.h.bot.id } })).toBe(1);
    // The system, not the owner, approved the trivial contract; the proof says so.
    const revision = await f.h.db.outcomeContractRevision.findFirstOrThrow({ where: { outcomeId: result.outcome.id } });
    expect(revision.approvedBy).toBe("system:auto-track");
    expect(await f.h.db.run.count({ where: { outcomeWorkItem: { outcomeId: result.outcome.id } } })).toBe(0);
    // It is not waiting on the owner.
    expect((await f.pendingInbox()).items.some((item) => item.outcomeId === result.outcome.id)).toBe(false);

    const closed = await f.call<Result>("CloseOutcome", {
      outcomeId: result.outcome.id,
      resultSummary: "Renewed for one year",
      clientRequestId: key(),
    });
    expect(closed.outcome).toMatchObject({ status: "accepted", closeSummary: "Renewed for one year" });
    expect(closed.outcome.autoClosedAt).toBeTruthy();
    expect(closed.nextStep).toContain("auto-closed");
    const events = await f.h.db.event.findMany({ where: { entityId: result.outcome.id, topic: "outcome.accepted" } });
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { payload: { autoClosed?: boolean } }).payload.autoClosed).toBe(true);
    expect((await f.pendingInbox()).items.some((item) => item.outcomeId === result.outcome.id)).toBe(false);
    // Closed is final.
    expect(await f.failure("CloseOutcome", { outcomeId: result.outcome.id, resultSummary: "again", clientRequestId: key() }))
      .toBe("invalid_outcome_transition");
  });

  test("a task the owner must approve stays a standard goal that the Bot can neither approve nor close", async () => {
    const f = await fixture();
    const result = await f.call<Result>("TrackOutcome", {
      title: "Migrate mailbox",
      goal: "Move the mailbox to the new provider",
      ownerNeed: "approval",
      clientRequestId: key(),
    });
    expect(result.outcome).toMatchObject({ trackingMode: "standard", status: "pending_approval" });
    expect(result.approvalRequired).toBe(true);
    expect(result.outcome.autoClosedAt ?? null).toBeNull();
    expect(await f.h.db.outcomeWorkItem.count({ where: { outcomeId: result.outcome.id } })).toBe(0);
    expect(await f.failure("CloseOutcome", { outcomeId: result.outcome.id, resultSummary: "Done", clientRequestId: key() }))
      .toBe("tracked_close_not_allowed");
    expect(await f.h.db.outcome.findUniqueOrThrow({ where: { id: result.outcome.id } })).toMatchObject({
      status: "pending_approval",
      acceptedAt: null,
    });
  });

  test("an owner decision reaches the inbox, blocks auto-close, and resolves back to a closable task", async () => {
    const f = await fixture();
    const result = await f.call<Result>("TrackOutcome", {
      title: "Choose hosting plan",
      goal: "Pick the hosting plan and migrate",
      ownerNeed: "decision",
      decision: {
        problemSummary: "Which plan should we buy?",
        options: [
          { label: "Basic", consequence: "Cheaper, less storage", recommended: true, reason: "Fits current usage" },
          { label: "Pro", consequence: "More storage" },
        ],
      },
      clientRequestId: key(),
    });
    expect(result.outcome).toMatchObject({ trackingMode: "tracked", status: "decision_pending" });
    expect(result.decisionId).toBeTruthy();
    const pending = await f.pendingInbox();
    expect(pending.items.some((item) => item.outcomeId === result.outcome.id)).toBe(true);

    expect(await f.failure("CloseOutcome", { outcomeId: result.outcome.id, resultSummary: "Done", clientRequestId: key() }))
      .toBe("tracked_close_not_allowed");

    const resolved = await Effect.runPromise(
      f.decisions.resolve(result.decisionId!, {
        optionId: "option-1",
        expectedContractRevision: 1,
        clientRequestId: key(),
      }, "owner:local")
    );
    expect(resolved.resume).toEqual({ status: "recorded", workItemIds: [] });
    const after = await f.call<{ outcome: OutcomeDetail }>("GetOutcome", { outcomeId: result.outcome.id });
    expect(after.outcome.status).toBe("approved");
    expect((await f.pendingInbox()).items.some((item) => item.outcomeId === result.outcome.id)).toBe(false);

    const closed = await f.call<Result>("CloseOutcome", {
      outcomeId: result.outcome.id,
      resultSummary: "Bought Basic and migrated",
      clientRequestId: key(),
    });
    expect(closed.outcome.status).toBe("accepted");
  });

  test("invalid registrations leave no goal behind", async () => {
    const f = await fixture();
    const before = await f.h.db.outcome.count({ where: { botId: f.h.bot.id } });
    expect(await f.failure("TrackOutcome", { title: "x", goal: "y", ownerNeed: "decision", clientRequestId: key() }))
      .toBe("invalid_request");
    expect(await f.failure("TrackOutcome", { title: "", goal: "y", clientRequestId: key() })).toBe("invalid_request");
    expect(await f.h.db.outcome.count({ where: { botId: f.h.bot.id } })).toBe(before);
  });
});
