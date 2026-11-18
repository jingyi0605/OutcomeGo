import { Effect } from "effect";
import { isDeepStrictEqual } from "node:util";
import { ApiError } from "@outcomego/contracts";
import type { DecisionResolution, DecisionView, OutcomeInboxPage } from "@outcomego/contracts/outcome-inbox";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import { enqueueOutcomeTurn, readOutcomeTranscript, settleOutcomeWorkItem } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../../packages/messaging/test/fixtures/outcome-thread";
import { Projection } from "../../../worker/src/projection";
import { WakeWorker } from "../../../worker/src/worker";
import { disposableDatabaseUrl } from "../../../../scripts/outcome-recovery/report";
import { outcomeInboxRoutes } from "../../src/routes/outcome-inbox";
import type { RouteContext } from "../../src/routes/context";
import { createOutcomeDecisionTool } from "../../src/services/outcome-decision-tool";
import { DecisionService } from "../../src/services/decision-service";
import { OutcomeService } from "../../src/services/outcome-service";

interface Claim {
  runId: string;
  conversationId: string;
  contextSessionId: string;
  outcomeWorkItemId: string | null;
}
interface RequestResult<T> {
  status: number;
  body: T | null;
  errorCode: string | null;
}

export interface DecisionReplayReport {
  scenario: string;
  status: "PASS";
  execution: string;
  computer: string;
  realBotReplay: "PENDING";
  nativeClientsReplay: "PENDING";
  networkServerStarted: false;
  bootstrap: string;
  ids: {
    botId: string; channelId: string; outcomeId: string; revisionId: string;
    workItemId: string; decisionId: string; rootRunId: string;
    continuationRunId: string; contextSessionId: string; foregroundRunId: string;
  };
  requests: Array<{ operation: string; input: unknown; result: unknown }>;
  checks: Array<{ name: string; passed: boolean }>;
  contexts: Claim[];
  detail: OutcomeDetail;
  transcript: Awaited<ReturnType<typeof readOutcomeTranscript>>;
  events: unknown[];
}

/**
 * Exercise the production tool, request handlers and worker against an approved
 * fixture. Computer events are controlled; no model, native client or server starts.
 */
export async function runDecisionReplay(publish?: (report: DecisionReplayReport) => Promise<void>): Promise<DecisionReplayReport> {
  disposableDatabaseUrl(process.env);
  const h = await outcomeThreadFixture();
  const requests: Array<{ operation: string; input: unknown; result: unknown }> = [];
  const checks: Array<{ name: string; passed: boolean }> = [];
  const key = `decision-replay:${crypto.randomUUID()}`;
  const record = (operation: string, input: unknown, result: unknown) => requests.push({ operation, input, result });
  const check = (name: string, passed: boolean) => {
    checks.push({ name, passed });
    if (!passed) throw new Error(`decision_replay_assertion:${name}`);
  };
  const worker = Object.assign(Object.create(WakeWorker.prototype), {
    prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root,
  }) as { claim(botId: string): Promise<Claim | null> };
  const projection = new Projection(h.db, h.store);
  const decisions = new DecisionService(h.db, { messaging: h.messaging });
  const outcomes = new OutcomeService(h.db, h.messaging);
  const tool = createOutcomeDecisionTool(h.db, decisions);
  const app = { prisma: h.db, outcomeDecisions: decisions } as unknown as RouteContext["app"];
  async function request<T>(path: string, input?: unknown, required = false): Promise<RequestResult<T>> {
    const url = new URL(path, "http://localhost");
    const context: RouteContext = {
      app, path: url.pathname, url, authMode: required ? "required" : "disabled",
      authenticatedSessionId: null,
      request: new Request(url, input === undefined ? {} : {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
      }),
    };
    try {
      const response = await outcomeInboxRoutes(context);
      if (!response) throw new Error("decision_replay_route_missing");
      const result = { status: response.status, body: await response.json() as T, errorCode: null };
      record(`${context.request.method} ${path}`, input ?? null, result);
      return result;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const result = { status: error.status, body: null, errorCode: error.code };
      record(`${context.request.method} ${path}`, input ?? null, result);
      return result;
    }
  }
  async function finish(claim: Claim, text: string) {
    const turnId = `${key}:turn:${claim.runId}`;
    await projection.apply(claim.runId, claim.conversationId, h.bot.id, {
      type: "item.completed", turnId,
      item: { id: `${key}:message:${claim.runId}`, type: "agentMessage", text },
    });
    await projection.apply(claim.runId, claim.conversationId, h.bot.id, {
      type: "turn.completed", turnId, status: "completed",
    });
    // These are transport receipt/lease cleanup, not business outcome transitions.
    await h.db.inboxEvent.updateMany({ where: { runId: claim.runId }, data: { status: "completed", completedAt: new Date() } });
    await h.db.botRunLease.deleteMany({ where: { runId: claim.runId } });
    await h.db.$transaction(tx => settleOutcomeWorkItem(tx, claim.runId, h.runtime));
    record("controlled Computer completion / production settlement", { runId: claim.runId, text }, {
      run: await h.db.run.findUniqueOrThrow({ where: { id: claim.runId } }),
    });
  }
  let decisionId: string | undefined;
  try {
    const item = await h.item();
    const enqueued = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, {
      workItemId: item.id, content: "Compare fictional backup approaches", reason: "start", clientId: `${key}:start`,
    }));
    record("enqueueOutcomeTurn", { workItemId: item.id, clientId: `${key}:start` }, enqueued);
    const initial = await worker.claim(h.bot.id);
    if (!initial) throw new Error("decision_replay_initial_claim_missing");
    record("worker.claim.initial", { botId: h.bot.id }, initial);
    check("initial_context_is_persisted_for_this_work_item", await h.db.contextSession.count({
      where: { id: initial.contextSessionId, scope: "outcome", scopeId: item.id },
    }) === 1);

    const foreground = await h.db.$transaction(tx => h.messaging.acceptDirectUserMessage(tx, {
      botId: h.bot.id, channelId: h.channel.id, content: "Continue an unrelated conversation", clientId: `${key}:main`,
    }));
    const mainClaim = await worker.claim(h.bot.id);
    check("foreground_and_outcome_claim_independently", mainClaim?.runId === foreground.run.id &&
      mainClaim.contextSessionId !== initial.contextSessionId);
    const foregroundSnapshot = async () => ({
      run: await h.db.run.findUniqueOrThrow({ where: { id: foreground.run.id } }),
      lease: await h.db.botRunLease.findFirst({ where: { runId: foreground.run.id } }),
      messages: await h.db.channelMessage.findMany({ where: { channelId: h.channel.id }, orderBy: { createdAt: "asc" } }),
    });
    const foregroundBefore = await foregroundSnapshot();
    record("main user request / independent worker claim", { clientId: `${key}:main` }, {
      runId: foreground.run.id, claim: mainClaim, snapshot: foregroundBefore,
    });

    const source = await h.db.run.findUniqueOrThrow({ where: { id: initial.runId } });
    const input = {
      runId: source.id, botId: h.bot.id, conversationId: source.conversationId, channelId: h.channel.id,
      deliveryId: source.deliveryId, callId: `${key}:decision`, tool: "RequestOutcomeDecision",
      arguments: {
        completedSummary: "Two fictional approaches were compared",
        problemSummary: "The owner must select the next approach",
        nextStepSummary: "Continue the approved comparison with the selected approach",
        reasonCode: "missing_input",
        options: [
          { label: "Compare cost", consequence: "Continue within the approved contract" },
          { label: "Compare recovery time", consequence: "Continue within the approved contract" },
        ],
      },
    };
    const context = { runId: source.id, workItemId: item.id, botId: h.bot.id };
    const proposed = await tool(input, context) as { decisionId: string; status: string };
    decisionId = proposed.decisionId;
    record("RequestOutcomeDecision / trusted persisted context", input, proposed);
    check("tool_replay_returns_one_decision", JSON.stringify(await tool(input, context)) === JSON.stringify(proposed) &&
      await h.db.outcomeDecision.count({ where: { outcomeId: h.outcome.id } }) === 1);
    await finish(initial, "Comparison paused for the owner's choice.");
    check("settlement_keeps_waiting_decision", (await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status === "waiting_decision");
    check("paused_work_has_no_output", await h.db.outcomeOutput.count({ where: { outcomeId: h.outcome.id } }) === 0);

    const inboxPath = `/api/outcomes/${h.outcome.id}/inbox?status=pending&category=decision_pending`;
    const denied = await request<OutcomeInboxPage>(inboxPath, undefined, true);
    check("required_auth_rejects_unsigned_request", denied.status === 401);
    const inbox = await request<OutcomeInboxPage>(inboxPath);
    check("inbox_returns_the_tool_decision", inbox.status === 200 &&
      inbox.body?.items.some(entry => entry.decisionId === decisionId && entry.workItemId === item.id) === true);
    const card = await request<DecisionView>(`/api/decisions/${decisionId}`);
    check("public_card_uses_persisted_options", card.status === 200 && card.body?.status === "presented" &&
      card.body.options.length === 2);
    const choices = ["option-1", "option-2"].map((optionId, index) => ({
      optionId, expectedContractRevision: 1, clientRequestId: `${key}:resolve:${index}`,
    }));
    const resolutions = await Promise.all(choices.map(choice =>
      request<DecisionResolution>(`/api/decisions/${decisionId}/resolve`, choice)));
    check("independent_user_requests_have_one_winner", resolutions.filter(result => result.status === 200).length === 1 &&
      resolutions.filter(result => result.status === 409).length === 1);
    const winner = resolutions.findIndex(result => result.status === 200);
    const retry = await request<DecisionResolution>(`/api/decisions/${decisionId}/resolve`, choices[winner]);
    check("winner_retry_returns_original_response", isDeepStrictEqual(retry, resolutions[winner]));
    check("one_resolution_event_and_continuation", await h.db.event.count({
      where: { entityId: h.outcome.id, topic: "outcome.decision.resolved" },
    }) === 1 && await h.db.run.count({ where: { outcomeWorkItemId: item.id, status: "queued" } }) === 1);
    check("choice_preserves_the_approved_revision", (await h.db.outcome.findUniqueOrThrow({
      where: { id: h.outcome.id },
    })).currentRevisionId === h.revision.id);
    const resumed = await worker.claim(h.bot.id);
    if (!resumed) throw new Error("decision_replay_continuation_missing");
    record("worker.claim.continuation", { botId: h.bot.id }, resumed);
    check("continuation_preserves_work_item_and_context", resumed.runId !== initial.runId &&
      resumed.outcomeWorkItemId === item.id && resumed.contextSessionId === initial.contextSessionId);
    await finish(resumed, "The selected fictional comparison is ready for owner review.");
    const resolvedCard = await request<DecisionView>(`/api/decisions/${decisionId}`);
    const afterInbox = await request<OutcomeInboxPage>(inboxPath);
    check("resolved_decision_is_queryable_and_no_longer_pending", resolvedCard.body?.status === "resolved" &&
      afterInbox.body?.items.every(entry => entry.decisionId !== decisionId) === true);
    const detail = await Effect.runPromise(outcomes.get(h.outcome.id));
    const transcript = await Effect.runPromise(outcomes.transcript(h.outcome.id, item.id, { limit: 100 }));
    record("outcomes.detail / transcript", { outcomeId: h.outcome.id, workItemId: item.id }, { detail, transcript });
    check("final_output_is_from_the_resumed_turn", detail.outputs.length === 1 &&
      detail.outputs[0]?.runId === resumed.runId && detail.status === "review_pending");
    check("main_run_lease_and_visible_messages_unchanged", JSON.stringify(await foregroundSnapshot()) === JSON.stringify(foregroundBefore));
    const report: DecisionReplayReport = {
      scenario: "decision-tool-inbox-api-continuation", status: "PASS",
      execution: "local-disposable-database", computer: "controlled Projection.apply events",
      realBotReplay: "PENDING", nativeClientsReplay: "PENDING", networkServerStarted: false,
      bootstrap: "Existing approved Outcome fixture; planning is covered by the separate product replay",
      ids: {
        botId: h.bot.id, channelId: h.channel.id, outcomeId: h.outcome.id,
        revisionId: h.revision.id, workItemId: item.id, decisionId,
        rootRunId: initial.runId, continuationRunId: resumed.runId,
        contextSessionId: initial.contextSessionId, foregroundRunId: foreground.run.id,
      },
      requests, checks, contexts: [initial, resumed], detail, transcript,
      events: (await h.db.event.findMany({
        where: { entityId: h.outcome.id }, orderBy: { sequence: "asc" },
      })).map(event => ({ ...event, sequence: event.sequence.toString() })),
    };
    if (publish) await publish(report);
    return report;
  } finally {
    if (decisionId) await h.db.idempotencyRecord.deleteMany({ where: { scope: { contains: decisionId } } });
    await h.cleanup();
  }
}
