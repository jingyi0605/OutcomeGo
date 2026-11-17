import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DecisionService } from "../src/services/decision-service";
import { OutcomeService } from "../src/services/outcome-service";
import { withdrawSupersededDecisions } from "../src/services/decision-lifecycle";
import { OutcomeThreadFake, type AgentMessaging } from "@outcomego/messaging";
import type { DecisionOption } from "@outcomego/contracts/outcome-inbox";
import { actor, errorCode, fixture, option, run, testDb } from "./fixtures/outcome-inbox-fixture";
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;

describe.skipIf(!url)("DecisionService transactional state machine", () => {
  const db = testDb();
  const bots: string[] = [];
  let decisions: DecisionService;
  const createFixture = async () => { const f = await fixture(db); bots.push(f.bot.id); return f; };
  const request = (expectedContractRevision = 1) => ({ optionId: "cancel", expectedContractRevision, clientRequestId: crypto.randomUUID() });
  beforeAll(() => { decisions = new DecisionService(db, { createRevision: new OutcomeService(db, undefined, undefined, withdrawSupersededDecisions).createRevisionInTransaction }); });
  afterAll(async () => { await db.bot.deleteMany({ where: { id: { in: bots } } }); await db.$disconnect(); });

  test("create retains snapshots, defaults to no expiry, truncates extras and replays a Run input", async () => {
    const f = await createFixture();
    const conversation = await db.conversation.findUniqueOrThrow({ where: { botId: f.bot.id } });
    const message = await db.message.create({ data: { botId: f.bot.id, conversationId: conversation.id, role: "user", content: "fixture" } });
    const source = await db.run.create({ data: { botId: f.bot.id, conversationId: conversation.id, userMessageId: message.id, outcomeWorkItemId: f.item.id, origin: "outcome", status: "completed" } });
    const input = { ...f.input, runId: source.id, options: Array.from({ length: 6 }, (_, i) => option({ id: `choice-${i}` })) };
    const result = await run(decisions.create(input, actor));
    expect(result.expiresAt).toBeNull(); expect(result.options).toHaveLength(4); expect(result.truncatedOptionCount).toBe(2);
    expect(result.options[0]).toMatchObject({ label: input.options[0]!.label, consequence: input.options[0]!.consequence, source: "runtime", resolutionEffect: "cancel_branch" });
    expect(result.options[0]?.createdAt).toBeString();
    expect((await run(decisions.create(input, actor))).id).toBe(result.id);
    expect((await db.outcomeDecision.findUniqueOrThrow({ where: { id: result.id } })).idempotencyKey).toMatch(new RegExp(`^decision-request:${source.id}:[a-f0-9]{64}$`));
    expect(await db.event.count({ where: { topic: "outcome.decision.required", entityId: f.outcome.id } })).toBe(1);
  });
  test("reading only presents the decision; open and presented both resolve", async () => {
    for (const present of [false, true]) {
      const f = await createFixture(); const d = await run(decisions.create(f.input, actor));
      if (present) expect((await run(decisions.present(d.id, actor))).status).toBe("presented");
      const input = request(); const response = await run(decisions.resolve(d.id, input, actor));
      expect(response).toMatchObject({ status: "resolved", resolutionEffect: "cancel_branch", resume: { status: "cancelled" } });
      expect((await run(decisions.resolve(d.id, input, actor)))).toEqual(response);
      expect(await errorCode(decisions.resolve(d.id, { ...input, optionId: "different" }, actor))).toBe("idempotency_conflict");
      expect(await errorCode(decisions.resolve(d.id, request(), actor))).toBe("decision_already_resolved");
      expect((await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.item.id } })).status).toBe("cancelled");
      expect(await db.event.count({ where: { topic: "outcome.decision.resolved", entityId: f.outcome.id } })).toBe(1);
    }
  });
  test("two distinct concurrent requests have one winner and duplicate requests replay", async () => {
    const f = await createFixture(); const d = await run(decisions.create(f.input, actor));
    const results = await Promise.all([request(), request()].map(input => run(decisions.resolve(d.id, input, actor)).then(value => ({ ok: true, value }), error => ({ ok: false, error }))));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    const f2 = await createFixture(); const d2 = await run(decisions.create(f2.input, actor)); const input = request();
    const duplicate = await Promise.all([run(decisions.resolve(d2.id, input, actor)), run(decisions.resolve(d2.id, input, actor))]);
    expect(duplicate[0]).toEqual(duplicate[1]);
  });
  test("rejects revision numbers and choices outside the frozen snapshot", async () => {
    const f = await createFixture(); const d = await run(decisions.create({ ...f.input, customEntryAllowed: false }, actor));
    expect(await errorCode(decisions.resolve(d.id, request(2), actor))).toBe("decision_revision_conflict");
    expect(await errorCode(decisions.resolve(d.id, { ...request(), optionId: "unknown" }, actor))).toBe("invalid_decision_choice");
    expect(await errorCode(decisions.resolve(d.id, { ...request(), customText: "other" }, actor))).toBe("invalid_decision_choice");
    expect((await run(decisions.get(d.id))).status).toBe("open");
  });
  test("plan-only preserves revision and resumes the same work item with stored custom text", async () => {
    const f = await createFixture(); const fake = new OutcomeThreadFake();
    const service = new DecisionService(db, { messaging: {} as AgentMessaging, enqueueTurn: fake.enqueueOutcomeTurn.bind(fake) });
    const d = await run(service.create({ ...f.input, options: [option({ id: "continue", resolutionEffect: "plan_only" })] }, actor));
    const input = { ...request(), optionId: "continue", customText: "  Keep this exact custom text  " };
    await run(service.resolve(d.id, input, actor));
    expect(fake.enqueueCalls).toHaveLength(1); expect(fake.enqueueCalls[0]).toMatchObject({ workItemId: f.item.id, reason: "decision_resolved", clientId: `decision:${d.id}` });
    expect((await run(service.get(d.id))).customText).toBe(input.customText);
    expect((await db.outcome.findUniqueOrThrow({ where: { id: f.outcome.id } })).currentRevisionId).toBe(f.revision.id);
  });
  test("absent production enqueue and human ports never persist a resolved result", async () => {
    for (const effect of ["plan_only", "manual_action"] as const) {
      const f = await createFixture();
      const d = await run(decisions.create({ ...f.input, options: [option({ resolutionEffect: effect, manualAction: { title: "Check", purpose: "Observe", steps: ["Inspect"], evidenceRequirements: [] } })] }, actor));
      expect(await errorCode(decisions.resolve(d.id, request(), actor))).toBe(effect === "manual_action" ? "manual_action_unavailable" : "decision_effect_unavailable");
      expect((await run(decisions.get(d.id))).status).toBe("open");
      expect(await db.event.count({ where: { topic: "outcome.decision.resolved", entityId: f.outcome.id } })).toBe(0);
    }
  });
  const contract: NonNullable<DecisionOption["contract"]> = { goal: ["Changed goal"], acceptance: [{ statement: "New criterion", required: true }], boundaries: { included: ["research"], excluded: [] }, budget: null };
  test("scope and acceptance changes create an unapproved revision and withdraw its other decisions atomically", async () => {
    for (const resolutionEffect of ["scope_change", "acceptance_change"] as const) {
      const f = await createFixture(); const other = await run(decisions.create({ ...f.input, workItemId: undefined, reasonCode: "other" }, actor));
      const d = await run(decisions.create({ ...f.input, options: [option({ resolutionEffect, contract })] }, actor));
      await run(decisions.resolve(d.id, request(), actor));
      const outcome = await db.outcome.findUniqueOrThrow({ where: { id: f.outcome.id }, include: { currentRevision: true } });
      expect(outcome.currentRevision?.revision).toBe(2); expect(outcome.currentRevision?.status).toBe("pending_approval");
      expect(outcome.currentRevision?.sourceDecisionId).toBe(d.id);
      expect((await db.outcomeContractRevision.findUniqueOrThrow({ where: { id: f.revision.id } })).goal).toEqual(["Compare options"]);
      expect((await run(decisions.get(other.id))).status).toBe("withdrawn");
    }
  });
  test("an effect failure after revision writes rolls back revision, decision, events and response", async () => {
    const f = await createFixture(); const outcomeService = new OutcomeService(db);
    const service = new DecisionService(db, { createRevision: async (...args) => { await outcomeService.createRevisionInTransaction(...args); throw new Error("injected post-revision failure"); } });
    const d = await run(service.create({ ...f.input, options: [option({ resolutionEffect: "scope_change", contract })] }, actor));
    await expect(run(service.resolve(d.id, request(), actor))).rejects.toThrow("injected post-revision failure");
    expect((await run(service.get(d.id))).status).toBe("open");
    expect(await db.outcomeContractRevision.count({ where: { outcomeId: f.outcome.id } })).toBe(1);
    expect(await db.idempotencyRecord.count({ where: { scope: `decision-resolve:${d.id}` } })).toBe(0);
  });
  test("withdraw, explicit expiry and expiry-on-resolve close without consent; jobs replay safely", async () => {
    const f = await createFixture(); const d = await run(decisions.create(f.input, actor));
    expect((await run(decisions.withdraw(d.id, actor))).status).toBe("withdrawn");
    expect((await run(decisions.withdraw(d.id, actor))).status).toBe("withdrawn");
    expect(await errorCode(decisions.resolve(d.id, request(), actor))).toBe("decision_withdrawn");
    for (const job of [false, true]) {
      const f2 = await createFixture(); const d2 = await run(decisions.create({ ...f2.input, expiresAt: new Date(Date.now()-1000).toISOString() }, actor));
      if (job) await run(decisions.expire());
      expect(await errorCode(decisions.resolve(d2.id, request(), actor))).toBe("decision_expired");
      expect((await db.outcomeDecision.findUniqueOrThrow({ where: { id: d2.id } })).status).toBe("expired");
      expect(await db.event.count({ where: { topic: "outcome.decision.closed", entityId: f2.outcome.id } })).toBe(1);
    }
    expect((await run(decisions.expire())).expiredCount).toBe(0);
  });
  test("revision supersession and cancellation automatically withdraw when refreshed", async () => {
    const f = await createFixture(); const d = await run(decisions.create(f.input, actor));
    const outcomes = new OutcomeService(db, undefined, undefined, withdrawSupersededDecisions);
    await run(outcomes.createRevision(f.outcome.id, { baseRevision: 1, contract, clientRequestId: crypto.randomUUID() }, actor));
    expect((await db.outcomeDecision.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("withdrawn");
    expect(await errorCode(decisions.resolve(d.id, request(), actor))).toBe("decision_revision_conflict");
    const f2 = await createFixture(); const d2 = await run(decisions.create(f2.input, actor));
    await db.outcome.update({ where: { id: f2.outcome.id }, data: { cancelledAt: new Date() } });
    expect((await run(decisions.get(d2.id))).status).toBe("withdrawn");
  });
});
