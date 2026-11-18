import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createOutcomeDecisionTool } from "../src/services/outcome-decision-tool";
import { DecisionService } from "../src/services/decision-service";
import { OutcomeService } from "../src/services/outcome-service";
import { InternalToolService } from "../src/services/internal-tool-service";
import { enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
const input = { completedSummary: "Compared options", problemSummary: "No unresolved issue", nextStepSummary: "Choose next step", reasonCode: "missing_input", options: [{ label: "Continue", consequence: "Continue within approved contract", recommended: true, reason: "Enough context" }] };
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("Outcome decision tool transactions", () => {
  const setup = async () => {
    const h = await outcomeThreadFixture(); const item = await h.item();
    const wake = await h.db.$transaction(tx => enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `outcome-run:${h.outcome.id}:1:${item.id}` }));
    if (wake.status !== "enqueued") throw new Error("Expected an enqueued run");
    await h.db.run.update({ where: { id: wake.runId }, data: { status: "running", startedAt: new Date() } });
    await h.db.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", actor: "system:test", reason: "claimed" }));
    const decisions = new DecisionService(h.db, { messaging: h.messaging, createRevision: new OutcomeService(h.db).createRevisionInTransaction });
    const tool = createOutcomeDecisionTool(h.db, decisions);
    const source = await h.db.run.findUniqueOrThrow({ where: { id: wake.runId } });
    const request = { runId: source.id, botId: h.bot.id, conversationId: source.conversationId, channelId: source.channelId!, deliveryId: source.deliveryId, tool: "RequestOutcomeDecision", callId: "fixture", arguments: input };
    const context = { runId: source.id, workItemId: item.id, botId: h.bot.id };
    return { h, item, source, decisions, tool, request, context };
  };
  test("trusted dispatcher creates one Decision and pauses only its work item", async () => {
    const f = await setup();
    try {
      const service = new InternalToolService(f.h.db, f.h.messaging, {} as never, async () => {}, {} as never, {} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, undefined, { RequestOutcomeDecision: f.tool });
      const result = await Effect.runPromise(service.execute(f.request)) as { decisionId: string };
      const replay = await Effect.runPromise(service.execute(f.request));
      expect(replay).toEqual(result);
      expect(await f.h.db.outcomeDecision.count({ where: { outcomeId: f.h.outcome.id } })).toBe(1);
      expect((await f.h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.item.id } })).status).toBe("waiting_decision");
      expect(await f.h.db.event.count({ where: { entityId: f.h.outcome.id, topic: "outcome.decision.required" } })).toBe(1);
      expect((await f.h.db.outcomeDecision.findUniqueOrThrow({ where: { id: result.decisionId } })).options).toMatchObject([{ id: "option-1", source: "runtime", resolutionEffect: "plan_only" }]);
    } finally { await f.h.cleanup(); }
  });
  test("a pause failure rolls back the new Decision and required event", async () => {
    const f = await setup();
    try {
      const original = f.decisions.createInTransaction;
      f.decisions.createInTransaction = async (...args) => { await original(...args); throw new Error("injected atomic failure"); };
      await expect(f.tool(f.request, f.context)).rejects.toThrow("injected atomic failure");
      expect(await f.h.db.outcomeDecision.count({ where: { outcomeId: f.h.outcome.id } })).toBe(0);
      expect((await f.h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.item.id } })).status).toBe("running");
      expect(await f.h.db.event.count({ where: { entityId: f.h.outcome.id, topic: "outcome.decision.required" } })).toBe(0);
    } finally { await f.h.cleanup(); }
  });
  test("supplement selection creates one dependent branch with a durable enqueue intent", async () => {
    const f = await setup();
    try {
      const result = await f.tool({ ...f.request, arguments: { ...input, options: [{ ...input.options[0], supplement: { title: "Extra comparison", instructions: "Compare the additional public source" } }] } }, f.context) as { decisionId: string };
      await f.h.db.run.update({ where: { id: f.source.id }, data: { status: "completed", completedAt: new Date() } });
      const resolve = { optionId: "option-1", expectedContractRevision: 1, clientRequestId: crypto.randomUUID() };
      const response = await Effect.runPromise(f.decisions.resolve(result.decisionId, resolve, "owner:local"));
      expect(await Effect.runPromise(f.decisions.resolve(result.decisionId, resolve, "owner:local"))).toEqual(response);
      const supplements = await f.h.db.outcomeWorkItem.findMany({ where: { sourceDecisionId: result.decisionId, kind: "supplement" } });
      expect(supplements).toHaveLength(1); expect(supplements[0]?.dependsOn).toEqual([f.item.id]); expect(supplements[0]?.status).toBe("queued");
      expect(await f.h.db.run.count({ where: { outcomeWorkItemId: supplements[0]!.id } })).toBe(0);
      expect(await f.h.db.idempotencyRecord.count({ where: { scope: `outcome-turn:${supplements[0]!.id}`, status: "processing" } })).toBe(1);
      expect(response.resume.workItemIds).toContain(f.item.id);
    } finally { await f.h.cleanup(); }
  });
  test("a pending successor preserves only the approved started execution, then approval closes old controls", async () => {
    const f = await setup();
    try {
      const { isOutcomeDecisionRevisionActive } = await import("@outcomego/messaging");
      const outcomes = new OutcomeService(f.h.db);
      await Effect.runPromise(outcomes.createRevision(f.h.outcome.id, { baseRevision: 1, contract: {
        goal: ["New goal"], acceptance: [{ statement: "New criterion", required: true }], boundaries: { included: ["research"], excluded: [] }, budget: null,
      }, clientRequestId: crypto.randomUUID() }, "owner:local"));
      expect(await f.h.db.$transaction(tx => isOutcomeDecisionRevisionActive(tx, f.h.outcome.id, f.h.revision.id, f.item.id))).toBe(true);
      const unstarted = await f.h.item(2);
      expect(await f.h.db.$transaction(tx => isOutcomeDecisionRevisionActive(tx, f.h.outcome.id, f.h.revision.id, unstarted.id))).toBe(false);
      const result = await f.tool(f.request, f.context) as { decisionId: string };
      const { OutcomeInboxService } = await import("../src/services/outcome-inbox-service");
      const { parseOutcomeInboxQuery } = await import("@outcomego/contracts/outcome-inbox");
      expect((await Effect.runPromise(new OutcomeInboxService(f.h.db).list(parseOutcomeInboxQuery(new URLSearchParams()), f.h.outcome.id))).items.map(item => item.decisionId)).toContain(result.decisionId);
      const successor = await f.h.db.outcomeContractRevision.findUniqueOrThrow({ where: { outcomeId_revision: { outcomeId: f.h.outcome.id, revision: 2 } } });
      await f.h.db.outcomeContractRevision.update({ where: { id: successor.id }, data: { status: "approved", approvedAt: new Date() } });
      await f.h.db.outcomeContractRevision.update({ where: { id: f.h.revision.id }, data: { status: "superseded" } });
      const resolution = await Effect.runPromise(Effect.either(f.decisions.resolve(result.decisionId, { optionId: "option-1", expectedContractRevision: 1, clientRequestId: crypto.randomUUID() }, "owner:local")));
      expect(resolution._tag).toBe("Left");
      if (resolution._tag === "Left") expect(resolution.left).toMatchObject({ code: "decision_revision_conflict" });
      expect(await f.h.db.$transaction(tx => isOutcomeDecisionRevisionActive(tx, f.h.outcome.id, f.h.revision.id, f.item.id))).toBe(false);
    } finally { await f.h.cleanup(); }
  });

});
