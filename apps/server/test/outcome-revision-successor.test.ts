import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { PrismaClient } from "@outcomego/db";
import { transitionWorkItem } from "@outcomego/messaging";
import { DecisionService } from "../src/services/decision-service";
import { OutcomeService } from "../src/services/outcome-service";
import { failureCode, outcomeFixture, requestId, testDatabaseUrl } from "./fixtures/outcome-fixture";

const actor = "owner:local" as const;
const change = (baseRevision: number) => ({
  baseRevision,
  contract: {
    goal: ["Compare backup scope and recovery time"],
    acceptance: [{ statement: "Compare costs", required: true }],
    boundaries: { included: ["Public sources"], excluded: ["Production changes"] },
    budget: null,
  },
  changeSummary: "Update scope, acceptance and boundaries",
  clientRequestId: requestId(),
});
const approval = (expectedRevision: number) => ({ expectedRevision, confirmationText: "I confirm", clientRequestId: requestId() });

describe.skipIf(!testDatabaseUrl)("approved contract successors", () => {
  const f = outcomeFixture();
  afterAll(() => f.close());

  test("approval cancels only older work that never started, preserves audit facts and replays without duplicate transitions", async () => {
    const x = await f.completed();
    const evidence = await f.prisma.outcomeEvidence.create({ data: {
      outcomeId: x.outcome.id, contractRevisionId: x.revision.id, criterionId: x.required.id, workItemId: x.item.id,
      sourceType: "output", sourceRef: `output:${x.output.id}`, contentSummary: "Historical result", capturedBy: actor, credibility: "agent_report",
    } });
    const review = await f.prisma.outcomeReview.create({ data: {
      outcomeId: x.outcome.id, contractRevisionId: x.revision.id, criterionId: x.required.id, sequence: 1,
      result: "FAIL", evidenceIds: [evidence.id], comment: "Expand the comparison", reviewedBy: actor,
    } });
    const cases = [
      { executorType: "agent", status: "queued", startedAt: null, cancel: true },
      { executorType: "agent", status: "retry_pending", startedAt: null, cancel: true },
      { executorType: "human", status: "pending", startedAt: null, cancel: true },
      { executorType: "human", status: "ready", startedAt: null, cancel: true },
      { executorType: "agent", status: "running", startedAt: new Date(), cancel: false },
      { executorType: "agent", status: "queued", startedAt: new Date(), cancel: false },
      { executorType: "agent", status: "waiting_decision", startedAt: new Date(), cancel: false },
      { executorType: "human", status: "in_progress", startedAt: new Date(), cancel: false },
      { executorType: "human", status: "submitted", startedAt: new Date(), cancel: false },
    ] as const;
    const items = await Promise.all(cases.map((entry, index) => f.prisma.outcomeWorkItem.create({ data: {
      outcomeId: x.outcome.id, contractRevisionId: x.revision.id, botId: x.bot.id, title: `Old work ${index}`,
      executorType: entry.executorType, status: entry.status, startedAt: entry.startedAt, ordinal: index + 2,
    } })));
    const successor = await Effect.runPromise(f.outcomes.createRevision(x.outcome.id, change(1), actor));
    expect((await f.prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: items[0]!.id } })).status).toBe("queued");
    const input = approval(2);
    const approved = await Effect.runPromise(f.outcomes.approve(x.outcome.id, 2, input, actor));
    expect(await Effect.runPromise(f.outcomes.approve(x.outcome.id, 2, input, actor))).toEqual(approved);
    for (const [index, original] of items.entries()) {
      const item = await f.prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: original.id } });
      if (cases[index]!.cancel) {
        expect(item.status).toBe("cancelled");
        expect(item.statusReason).toBe("contract_revision_superseded");
        expect(item.startedAt).toBeNull();
        expect(item.completedAt).not.toBeNull();
      } else expect(item).toEqual(original);
    }
    expect(await f.prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: x.item.id } })).toMatchObject({ status: "completed", contractRevisionId: x.revision.id });
    expect(await f.prisma.outcomeOutput.findUniqueOrThrow({ where: { id: x.output.id } })).toEqual(x.output);
    expect(await f.prisma.outcomeEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).toEqual(evidence);
    expect(await f.prisma.outcomeReview.findUniqueOrThrow({ where: { id: review.id } })).toEqual(review);
    expect(await f.prisma.event.count({ where: { entityId: x.outcome.id, topic: "outcome.work_item.updated" } })).toBe(4);
    expect(approved.currentRevisionView).toMatchObject({ id: successor.currentRevisionView!.id, baseRevisionId: x.revision.id, createdBy: actor });
    expect(approved.revisions[1]).toMatchObject({ baseRevisionId: x.revision.id, sourceDecisionId: null, createdBy: actor });
  });

  test("approval rollback includes replaced work and every transition event", async () => {
    const x = await f.create();
    const old = await f.prisma.outcomeWorkItem.create({ data: {
      outcomeId: x.outcome.id, contractRevisionId: x.outcome.currentRevisionView!.id, botId: x.bot.id,
      title: "Not started", executorType: "agent", status: "queued", ordinal: 1,
    } });
    await Effect.runPromise(f.outcomes.createRevision(x.outcome.id, change(1), actor));
    const service = new OutcomeService({
      idempotencyRecord: f.prisma.idempotencyRecord,
      $transaction: (write: (tx: unknown) => Promise<unknown>) => f.prisma.$transaction(async tx => {
        await write(tx);
        throw new Error("approval rollback");
      }),
    } as unknown as PrismaClient);
    const result = await Effect.runPromise(Effect.either(service.approve(x.outcome.id, 2, approval(2), actor)));
    expect(result._tag).toBe("Left");
    expect((await f.prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("queued");
    expect((await f.prisma.outcomeContractRevision.findUniqueOrThrow({ where: { outcomeId_revision: { outcomeId: x.outcome.id, revision: 1 } } })).status).toBe("approved");
    expect(await f.prisma.event.count({ where: { entityId: x.outcome.id, topic: "outcome.work_item.updated" } })).toBe(0);
  });

  test("work started while its successor is pending retains its original approved snapshot", async () => {
    const x = await f.create();
    const item = await f.prisma.outcomeWorkItem.create({ data: {
      outcomeId: x.outcome.id, contractRevisionId: x.outcome.currentRevisionView!.id, botId: x.bot.id,
      title: "Started before approval", executorType: "agent", status: "queued", ordinal: 1,
    } });
    await Effect.runPromise(f.outcomes.createRevision(x.outcome.id, change(1), actor));
    await f.prisma.$transaction(tx => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "lease_acquired", actor }));
    const started = await f.prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } });
    await Effect.runPromise(f.outcomes.approve(x.outcome.id, 2, approval(2), actor));
    expect(await f.prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).toEqual(started);
  });

  test("Decision provenance must be real and relevant; pending edits preserve the same Decision ancestry", async () => {
    const x = await f.create();
    const other = await f.create();
    const decisions = new DecisionService(f.prisma);
    const source = async (outcome: typeof x.outcome) => Effect.runPromise(decisions.create({
      outcomeId: outcome.id, contractRevisionId: outcome.currentRevisionView!.id, reasonCode: "scope_change_required",
      completedSummary: "", problemSummary: "Expand comparison", nextStepSummary: "Revise scope",
      options: [{ id: "revise", label: "Revise", consequence: "Update scope", source: "runtime", resolutionEffect: "plan_only" }],
    }, actor));
    const foreign = await source(other.outcome);
    expect(await failureCode(f.outcomes.createRevision(x.outcome.id, { ...change(1), sourceDecisionId: foreign.id }, actor))).toBe("contract_revision_conflict");
    expect(await failureCode(f.outcomes.createRevision(x.outcome.id, { ...change(1), sourceDecisionId: crypto.randomUUID() }, actor))).toBe("contract_revision_conflict");
    const decision = await source(x.outcome);
    const next = await Effect.runPromise(f.outcomes.createRevision(x.outcome.id, { ...change(1), sourceDecisionId: decision.id }, actor));
    expect(next.currentRevisionView).toMatchObject({ baseRevisionId: x.outcome.currentRevisionView!.id, sourceDecisionId: decision.id, createdBy: actor });
    const edited = await Effect.runPromise(f.outcomes.createRevision(x.outcome.id, { ...change(2), sourceDecisionId: decision.id }, actor));
    expect(edited.currentRevisionView).toMatchObject({ baseRevisionId: next.currentRevisionView!.id, sourceDecisionId: decision.id });
  });
});
