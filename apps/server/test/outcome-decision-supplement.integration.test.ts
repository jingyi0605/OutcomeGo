import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  enqueueOutcomeTurn, isOutcomeDecisionRevisionActive, settleOutcomeWorkItem, withdrawSupersededOutcomeDecisions,
} from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { WakeWorker } from "../../worker/src/worker";
import { createOutcomeDecisionTool } from "../src/services/outcome-decision-tool";
import { DecisionService } from "../src/services/decision-service";
import { OutcomeService } from "../src/services/outcome-service";

test.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("a trusted Decision supplement waits for its old approved requester during a pending successor and executes before approval", async () => {
  const h = await outcomeThreadFixture();
  const worker = Object.assign(Object.create(WakeWorker.prototype), { prisma: h.db, messaging: h.messaging, agentData: h.store, workspaceRoot: h.root });
  const outcomes = new OutcomeService(h.db, h.messaging, undefined, withdrawSupersededOutcomeDecisions);
  const decisions = new DecisionService(h.db, { messaging: h.messaging, createRevision: outcomes.createRevisionInTransaction });
  const tool = createOutcomeDecisionTool(h.db, decisions);
  const finish = async (runId: string) => {
    await h.db.run.update({ where: { id: runId }, data: { status: "completed", completedAt: new Date() } });
    await h.db.inboxEvent.updateMany({ where: { runId }, data: { status: "completed", completedAt: new Date() } });
    await h.db.botRunLease.deleteMany({ where: { runId } });
    await h.db.$transaction(tx => settleOutcomeWorkItem(tx, runId, h.runtime));
  };
  const invoke = async (runId: string, supplement = false) => {
    const run = await h.db.run.findUniqueOrThrow({ where: { id: runId } });
    return tool({ runId, botId: h.bot.id, conversationId: run.conversationId, channelId: run.channelId!, deliveryId: run.deliveryId,
      callId: crypto.randomUUID(), tool: "RequestOutcomeDecision", arguments: {
        completedSummary: "Compared the approaches", problemSummary: "Choose one detail", nextStepSummary: "Confirm the additional comparison",
        reasonCode: "missing_input", options: [{ label: "Continue", consequence: "Keep the approved scope",
          ...(supplement ? { supplement: { title: "Compare one additional source", instructions: "Compare within the approved boundaries" } } : {}) }],
      } }, { runId, botId: h.bot.id, workItemId: run.outcomeWorkItemId! }) as Promise<{ decisionId: string }>;
  };
  try {
    const requester = await h.item();
    await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: requester.id, content: "Research", reason: "start", clientId: crypto.randomUUID() }));
    const initial = await worker.claim(h.bot.id);
    if (!initial) throw new Error("Expected the original Outcome run");
    const requested = await invoke(initial.runId, true);
    await finish(initial.runId);
    await Effect.runPromise(outcomes.createRevision(h.outcome.id, { baseRevision: 1, contract: {
      goal: ["A proposed new goal"], acceptance: [{ statement: "A proposed criterion", required: true }],
      boundaries: { included: ["Public research"], excluded: [] }, budget: null,
    }, clientRequestId: crypto.randomUUID() }, "owner:local"));
    const input = { optionId: "option-1", expectedContractRevision: 1, clientRequestId: crypto.randomUUID() };
    const resolved = await Effect.runPromise(decisions.resolve(requested.decisionId, input, "owner:local"));
    expect(await Effect.runPromise(decisions.resolve(requested.decisionId, input, "owner:local"))).toEqual(resolved);
    const supplement = await h.db.outcomeWorkItem.findFirstOrThrow({ where: { sourceDecisionId: requested.decisionId } });
    expect(supplement).toMatchObject({ kind: "supplement", status: "queued", startedAt: null, dependsOn: [requester.id] });
    expect(await h.db.run.count({ where: { outcomeWorkItemId: supplement.id } })).toBe(0);
    expect(await h.db.idempotencyRecord.count({ where: { scope: `outcome-turn:${supplement.id}`, status: "processing" } })).toBe(1);
    expect(await h.db.$transaction(tx => isOutcomeDecisionRevisionActive(tx, h.outcome.id, h.revision.id, supplement.id))).toBe(true);
    const impostor = await h.db.outcomeWorkItem.create({ data: { outcomeId: h.outcome.id, contractRevisionId: h.revision.id, botId: h.bot.id,
      executorType: "agent", kind: "supplement", status: "queued", title: supplement.title, instructions: supplement.instructions, ordinal: 3,
      sourceDecisionId: requested.decisionId, dependsOn: [] } });
    expect(await h.db.$transaction(tx => isOutcomeDecisionRevisionActive(tx, h.outcome.id, h.revision.id, impostor.id))).toBe(false);
    const continuation = await worker.claim(h.bot.id);
    expect(continuation?.outcomeWorkItemId).toBe(requester.id);
    expect(continuation?.contextSessionId).toBe(initial.contextSessionId);
    expect(await worker.claim(h.bot.id)).toBeNull();
    await finish(continuation!.runId);
    const additional = await worker.claim(h.bot.id);
    expect(additional?.outcomeWorkItemId).toBe(supplement.id);
    expect(additional?.contextSessionId).not.toBe(initial.contextSessionId);
    expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: supplement.id } })).status).toBe("running");
    const oldControl = await invoke(additional!.runId);
    await Effect.runPromise(outcomes.approve(h.outcome.id, 2, { expectedRevision: 2, confirmationText: "Approve the successor", clientRequestId: crypto.randomUUID() }, "owner:local"));
    expect(await h.db.$transaction(tx => isOutcomeDecisionRevisionActive(tx, h.outcome.id, h.revision.id, supplement.id))).toBe(false);
    const rejected = await Effect.runPromise(Effect.either(decisions.resolve(oldControl.decisionId, {
      optionId: "option-1", expectedContractRevision: 1, clientRequestId: crypto.randomUUID(),
    }, "owner:local")));
    expect(rejected._tag).toBe("Left");
    if (rejected._tag === "Left") expect(rejected.left).toMatchObject({ code: "decision_revision_conflict", status: 409 });
    await expect(invoke(additional!.runId)).rejects.toMatchObject({ code: "decision_revision_conflict", status: 409 });
    expect(await h.db.outcomeWorkItem.count({ where: { sourceDecisionId: requested.decisionId, dependsOn: { equals: [requester.id] } } })).toBe(1);
  } finally { await h.cleanup(); }
});
