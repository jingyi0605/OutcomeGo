import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ApiError } from "@outcomego/contracts";
import { createPrismaClient } from "@outcomego/db";
import { dispatchQueuedOutcomeWorkItems, settleOutcomeWorkItem, transitionWorkItem } from "@outcomego/messaging";
import { HumanWorkService } from "../src/services/human-work-service";
import { HumanReceiptService } from "../src/services/human-receipt-service";
import { HumanKnowledgeService } from "../src/services/human-knowledge-service";
import { humanActionTool } from "../src/services/human-action-tool";
import { OutcomeReviewService } from "../src/services/outcome-review-service";
import { DecisionService } from "../src/services/decision-service";
import { humanActionScenario } from "./human-work-fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { knowledgeDigest } from "../src/services/knowledge-provider";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const noKnowledge = { resolve: async () => [] };
describe.skipIf(!url)("human action sources, receipts and unified review", () => {
  const prisma = createPrismaClient(url!);
  afterAll(() => prisma.$disconnect());
  const request = () => ({ clientRequestId: crypto.randomUUID(), expectedContractRevision: 1 });
  const code = async (operation: () => Promise<unknown>) => {
    try { await operation(); throw new Error("Expected a service error"); }
    catch (error) { expect(error).toBeInstanceOf(ApiError); return (error as ApiError).code; }
  };
  const setup = async (source: "agent" | "decision" = "agent", kind: "text" | "asset" | "sourceReference" = "text", pendingSuccessor = false) => {
    const humanWork = new HumanWorkService(prisma, noKnowledge);
    const f = await humanActionScenario(prisma, humanWork);
    if (pendingSuccessor) await successor(f);
    const input = { ...f.cardInput.card, evidenceRequirements: [{ criterionOrdinal: 1, label: "Actual receipt", kind }] };
    let card;
    if (source === "agent") {
      const call = () => prisma.$transaction(tx => humanWork.createFromAgentRequest(tx, { runId: f.run.id, workItemId: f.agent.id, input }));
      const [first, second] = await Promise.all([call(), call()]);
      expect(second).toEqual(first);
      card = first;
    } else {
      await prisma.$transaction(tx => transitionWorkItem(tx, { workItemId: f.agent.id, to: "waiting_decision", reason: "Synthetic decision", actor: "owner:local" }));
      const decisions = new DecisionService(prisma, { humanActions: humanWork });
      const decision = await Effect.runPromise(decisions.create({
        outcomeId: f.outcome.id, contractRevisionId: f.revision.id, workItemId: f.agent.id, runId: f.run.id,
        reasonCode: "manual_action_required", completedSummary: "Prepared site instructions", problemSummary: "Human evidence required",
        nextStepSummary: "Perform the check", options: [{
          id: "human", label: "Perform check", consequence: "Create a human action", resolutionEffect: "manual_action", source: "runtime", manualAction: input,
        }],
      }, "owner:local"));
      const result = await Effect.runPromise(decisions.resolve(decision.id, {
        optionId: "human", expectedContractRevision: 1, clientRequestId: crypto.randomUUID(),
      }, "owner:local"));
      card = { workItemId: result.resume.workItemIds[0]!, cardId: result.resume.cardId! };
      expect((await prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.agent.id } })).status).toBe("waiting_decision");
    }
    const receipts = new HumanReceiptService(prisma, f.assets, noKnowledge, f.messaging);
    const reviews = new OutcomeReviewService(prisma, f.messaging, async () => { throw new Error("No inference"); }, undefined, receipts);
    const criterion = await prisma.outcomeAcceptanceCriterion.findFirstOrThrow({ where: { contractRevisionId: f.revision.id } });
    await prisma.run.update({ where: { id: f.run.id }, data: { status: "completed", completedAt: new Date() } });
    await prisma.$transaction(tx => settleOutcomeWorkItem(tx, f.run.id));
    expect((await prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.agent.id } })).status).toBe(source === "agent" ? "waiting_human" : "waiting_decision");
    await humanWork.start(card.workItemId, request(), "owner:local");
    return { ...f, humanWork, receipts, reviews, criterion, card };
  };
  const successor = async (f: { outcome: { id: string }; bot: { id: string } }, approved = false) => {
    const revision = await prisma.outcomeContractRevision.create({ data: {
      outcomeId: f.outcome.id, revision: 2, status: approved ? "approved" : "pending_approval",
      goal: ["Pending replacement"], boundaries: {}, executionBotId: f.bot.id,
      contentHash: "successor", createdBy: "owner:local", ...(approved ? { approvedAt: new Date(), approvedBy: "owner:local" } : {}),
      criteria: { create: { ordinal: 1, statement: "Successor criterion", required: true } },
    } });
    await prisma.outcome.update({ where: { id: f.outcome.id }, data: { currentRevisionId: revision.id } });
    return revision;
  };

  test("pending successor preserves verified started human snapshot and review never accepts the new current Contract", async () => {
    const f = await setup();
    try {
      const pending = await successor(f);
      await f.humanWork.pause(f.card.workItemId, {
        ...request(), currentStepId: "step-1", draftSummary: "Still under approved N", readReferenceIds: [], reason: "Pause",
      }, "owner:local");
      await f.humanWork.start(f.card.workItemId, request(), "owner:local");
      const receipt = await f.receipts.submit(f.card.workItemId, { ...request(), text: "Approved N observation" }, "owner:local");
      const review = {
        expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [{
          criterionId: f.criterion.id, result: "PASS" as const, evidenceIds: receipt.evidenceIds, comment: "Verified N",
        }],
      };
      const detail = await Effect.runPromise(f.reviews.submit(f.outcome.id, review, "owner:local"));
      expect((await f.humanWork.detail(f.card.workItemId)).status).toBe("accepted");
      expect(detail.acceptedAt).toBeNull();
      expect(detail.currentRevision).toBe(2);
      expect((await prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.agent.id } })).contractRevisionId).toBe(f.revision.id);
      await prisma.outcomeContractRevision.update({ where: { id: pending.id }, data: { status: "approved", approvedAt: new Date() } });
      expect(await Effect.runPromise(f.reviews.submit(f.outcome.id, review, "owner:local"))).toEqual(detail);
    } finally { await f.cleanup(); }
  });

  test("approved successor rejects old controls but replays original receipt before revision or state guards", async () => {
    const f = await setup();
    try {
      const input = { ...request(), text: "Recorded before approval" };
      const receipt = await f.receipts.submit(f.card.workItemId, input, "owner:local");
      await successor(f, true);
      expect(await f.receipts.submit(f.card.workItemId, input, "owner:local")).toEqual(receipt);
      expect(await code(() => f.receipts.submit(f.card.workItemId, { ...input, clientRequestId: crypto.randomUUID() }, "owner:local"))).toBe("review_revision_conflict");
      expect(await code(() => f.humanWork.start(f.card.workItemId, request(), "owner:local"))).toBe("review_revision_conflict");
      const review = await Effect.runPromise(Effect.either(f.reviews.submit(f.outcome.id, {
        expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [{
          criterionId: f.criterion.id, result: "PASS", evidenceIds: receipt.evidenceIds, comment: "Old snapshot",
        }],
      }, "owner:local")));
      expect(review._tag).toBe("Left");
      if (review._tag === "Left") expect((review.left as ApiError).code).toBe("review_revision_conflict");
      expect((await prisma.outcomeHumanReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe("submitted");
    } finally { await f.cleanup(); }
  });

  test("a root Run without actual started facts cannot authorize old human controls under a pending successor", async () => {
    const f = await setup();
    try {
      await successor(f);
      await prisma.run.update({ where: { id: f.run.id }, data: { startedAt: null } });
      expect(await code(() => f.receipts.submit(f.card.workItemId, { ...request(), text: "Unstarted proof" }, "owner:local"))).toBe("review_revision_conflict");
      expect(await prisma.outcomeHumanReceipt.count({ where: { workItemId: f.card.workItemId } })).toBe(0);
    } finally { await f.cleanup(); }
  });
  for (const source of ["agent", "decision"] as const) {
    test(`${source} creates an immutable approved N card while the current successor awaits approval`, async () => {
      const f = await setup(source, "text", true);
      try {
        expect((await f.humanWork.detail(f.card.workItemId)).contractRevision).toBe(1);
        expect((await prisma.outcome.findUniqueOrThrow({ where: { id: f.outcome.id } })).currentRevisionId).not.toBe(f.revision.id);
        expect(await prisma.outcomeHumanActionCard.count({ where: { requestedByWorkItemId: f.agent.id } })).toBe(1);
      } finally { await f.cleanup(); }
    });

    test(`${source} creates one human card and acceptance atomically resumes the same real Outcome thread`, async () => {
      const f = await setup(source);
      try {
        expect(f.bot.status).toBe("active");
        const input = { ...request(), text: "Human observed DHCP and DNS succeeding" };
        const [receipt, duplicate] = await Promise.all([
          f.receipts.submit(f.card.workItemId, input, "owner:local"), f.receipts.submit(f.card.workItemId, input, "owner:local"),
        ]);
        expect(duplicate).toEqual(receipt);
        expect(receipt.evidenceIds).toHaveLength(1);
        expect((await f.humanWork.detail(f.card.workItemId)).status).toBe("review_pending");
        const review = { expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [{
          criterionId: f.criterion.id, result: "PASS" as const, evidenceIds: receipt.evidenceIds, comment: "Observed log verified",
        }] };
        await Effect.runPromise(f.reviews.submit(f.outcome.id, review, "owner:local"));
        await Effect.runPromise(f.reviews.submit(f.outcome.id, review, "owner:local"));
        expect((await prisma.outcomeHumanReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe("accepted");
        expect((await f.humanWork.detail(f.card.workItemId)).status).toBe("accepted");
        const runs = await prisma.run.findMany({ where: { outcomeWorkItemId: f.agent.id }, orderBy: { createdAt: "asc" } });
        expect(runs).toHaveLength(2);
        expect(runs[1]).toMatchObject({ origin: "outcome", outcomeWorkItemId: f.agent.id, status: "queued" });
        const continuationKey = `human-action-accepted:${f.card.workItemId}:${receipt.id}`;
        expect(await prisma.idempotencyRecord.findUnique({
          where: { scope_key: { scope: `outcome-turn:${f.agent.id}`, key: continuationKey } },
        })).toMatchObject({ status: "completed", response: { status: "enqueued", runId: runs[1]!.id } });
        const inbox = await prisma.inboxEvent.findMany({ where: { botId: f.bot.id, idempotencyKey: continuationKey } });
        expect(inbox).toHaveLength(1);
        expect(inbox[0]).toMatchObject({ runId: runs[1]!.id, payload: { origin: "outcome", outcomeWorkItemId: f.agent.id } });
        expect((await prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.agent.id } })).rootRunId).toBe(f.run.id);
        expect(await prisma.channelMessage.count({ where: { channelId: f.channel.id } })).toBe(source === "decision" ? 1 : 0);
        expect((await f.humanWork.detail(f.card.workItemId)).receipts?.[0]?.status).toBe("accepted");
      } finally { await f.cleanup(); }
    });
  }

  test("an unavailable Bot retains the accepted receipt continuation and drains it once after activation", async () => {
    const f = await setup();
    try {
      await prisma.bot.update({ where: { id: f.bot.id }, data: { status: "provisioning" } });
      const receipt = await f.receipts.submit(f.card.workItemId, { ...request(), text: "Human observed the real fixture" }, "owner:local");
      const review = {
        expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [{
          criterionId: f.criterion.id, result: "PASS" as const, evidenceIds: receipt.evidenceIds, comment: "Verified",
        }],
      };
      await Effect.runPromise(f.reviews.submit(f.outcome.id, review, "owner:local"));
      const where = { scope_key: { scope: `outcome-turn:${f.agent.id}`, key: `human-action-accepted:${f.card.workItemId}:${receipt.id}` } };
      expect(await prisma.idempotencyRecord.findUnique({ where })).toMatchObject({
        status: "processing", response: { input: { workItemId: f.agent.id, reason: "human_action_accepted" } },
      });
      expect((await f.humanWork.detail(f.card.workItemId)).status).toBe("accepted");
      expect(await prisma.run.count({ where: { outcomeWorkItemId: f.agent.id } })).toBe(1);
      await prisma.bot.update({ where: { id: f.bot.id }, data: { status: "active" } });
      await prisma.$transaction(tx => dispatchQueuedOutcomeWorkItems(tx, f.messaging, f.bot.id));
      await prisma.$transaction(tx => dispatchQueuedOutcomeWorkItems(tx, f.messaging, f.bot.id));
      await Effect.runPromise(f.reviews.submit(f.outcome.id, review, "owner:local"));
      expect(await prisma.idempotencyRecord.findUnique({ where })).toMatchObject({ status: "completed" });
      expect(await prisma.run.count({ where: { outcomeWorkItemId: f.agent.id } })).toBe(2);
      expect((await prisma.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.agent.id } })).rootRunId).toBe(f.run.id);
    } finally { await f.cleanup(); }
  });

  test("missing materials stay unverified; rejection preserves history and resubmission needs fresh receipt Evidence", async () => {
    const f = await setup("agent", "asset");
    try {
      const missing = await f.receipts.submit(f.card.workItemId, request(), "owner:local");
      expect(missing.missingRequirements).toHaveLength(1);
      expect(missing.evidenceIds).toEqual([]);
      const review = (result: "PASS" | "FAIL" | "UNVERIFIED", evidenceIds: string[] = []) => ({
        expectedRevision: 1, clientRequestId: crypto.randomUUID(),
        results: [{ criterionId: f.criterion.id, result, evidenceIds, comment: "Missing observed attachment", userConfirmed: true }],
      });
      await Effect.runPromise(f.reviews.submit(f.outcome.id, review("UNVERIFIED"), "owner:local"));
      expect((await f.humanWork.detail(f.card.workItemId)).status).toBe("review_pending");
      expect(await code(async () => {
        const result = await Effect.runPromise(Effect.either(f.reviews.submit(f.outcome.id, review("PASS"), "owner:local")));
        if (result._tag === "Left") throw result.left;
      })).toBe("human_evidence_missing");
      await Effect.runPromise(f.reviews.submit(f.outcome.id, review("FAIL"), "owner:local"));
      expect((await prisma.outcomeHumanReceipt.findUniqueOrThrow({ where: { id: missing.id } })).status).toBe("rejected");
      await f.humanWork.start(f.card.workItemId, request(), "owner:local");
      const asset = await f.assets.ingestBytes({ fileName: "observed.log", mimeType: "text/plain", bytes: Buffer.from("Synthetic observed log") });
      const next = await f.receipts.submit(f.card.workItemId, { ...request(), assetRefs: [`asset:${asset.assetId}`] }, "owner:local");
      expect(next.sequence).toBe(2);
      expect(next.missingRequirements).toEqual([]);
      await Effect.runPromise(f.reviews.submit(f.outcome.id, { expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [] }, "owner:local"));
      expect((await f.humanWork.detail(f.card.workItemId)).status).toBe("review_pending");
      await Effect.runPromise(f.reviews.submit(f.outcome.id, review("PASS", next.evidenceIds), "owner:local"));
      expect((await f.humanWork.detail(f.card.workItemId)).receipts?.map(receipt => receipt.status)).toEqual(["rejected", "accepted"]);
    } finally { await f.cleanup(); }
  });

  test("receipt conflicts, foreign observations and invalid assets create no partial receipt", async () => {
    const f = await setup();
    try {
      const asset = await f.assets.ingestBytes({ fileName: "network.txt", mimeType: "text/plain", bytes: Buffer.from("Synthetic receipt asset") });
      const input = { ...request(), text: "Synthetic observed text", assetRefs: [`asset:${asset.assetId}`] };
      await f.receipts.submit(f.card.workItemId, input, "owner:local");
      expect(await code(() => f.receipts.submit(f.card.workItemId, { ...input, text: "Changed" }, "owner:local"))).toBe("receipt_idempotency_conflict");
      const second = await prisma.$transaction(tx => f.humanWork.createCard(tx, f.cardInput, "owner:local"));
      await f.humanWork.start(second.workItemId, request(), "owner:local");
      expect(await code(() => f.receipts.submit(second.workItemId, { ...request(), assetRefs: input.assetRefs }, "owner:local"))).toBe("receipt_asset_conflict");
      expect(await code(() => f.receipts.submit(second.workItemId, { ...request(), assetRefs: [`asset:${"a".repeat(64)}`] }, "owner:local"))).toBe("receipt_asset_not_found");
      expect(await code(() => f.receipts.submit(second.workItemId, { ...request(), observations: [{ criterionId: crypto.randomUUID(), result: "observed", value: "pass" }] }, "owner:local"))).toBe("invalid_request");
      expect(await prisma.outcomeHumanReceipt.count({ where: { workItemId: second.workItemId } })).toBe(0);
    } finally { await f.cleanup(); }
  });

  test("continuation failure rolls back the Review, receipt acceptance and human state together", async () => {
    const f = await setup();
    try {
      const receipt = await f.receipts.submit(f.card.workItemId, { ...request(), text: "Observed network log" }, "owner:local");
      const failing = new HumanReceiptService(prisma, f.assets, noKnowledge, f.messaging, async () => { throw new Error("Injected continuation failure"); });
      const reviews = new OutcomeReviewService(prisma, f.messaging, async () => { throw new Error("No inference"); }, undefined, failing);
      await expect(Effect.runPromise(reviews.submit(f.outcome.id, {
        expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [{
          criterionId: f.criterion.id, result: "PASS", evidenceIds: receipt.evidenceIds, comment: "Verified",
        }],
      }, "owner:local"))).rejects.toThrow("Injected continuation failure");
      expect((await f.humanWork.detail(f.card.workItemId)).status).toBe("review_pending");
      expect((await prisma.outcomeHumanReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe("submitted");
      expect(await prisma.outcomeReview.count({ where: { outcomeId: f.outcome.id } })).toBe(0);
      expect(await prisma.run.count({ where: { outcomeWorkItemId: f.agent.id } })).toBe(1);
    } finally { await f.cleanup(); }
  });

  test("real RequestHumanAction resolves mounted text into bounded versioned Agent/card context", async () => {
    const service = new HumanWorkService(prisma);
    const f = await humanActionScenario(prisma, service);
    try {
      const directory = f.store.botDirectory(f.bot.id);
      await mkdir(directory, { recursive: true });
      const path = join(directory, "network.txt");
      const text = "Actual synthetic network checklist";
      await writeFile(path, text);
      await prisma.agentFileState.create({ data: { path, botId: f.bot.id, kind: "document", digest: knowledgeDigest(text) } });
      const knowledge = new HumanKnowledgeService(prisma, f.store, f.assets);
      const humanWork = new HumanWorkService(prisma, knowledge);
      const response = await humanActionTool(prisma, humanWork)({
        arguments: { ...f.cardInput.card, referenceIds: [`agent-file:${path}`] },
      } as never, { runId: f.run.id, workItemId: f.agent.id, botId: f.bot.id }) as {
        workItemId: string; end_turn: boolean; knowledge: Array<{ excerpt: string; digest: string }>;
      };
      expect(response.end_turn).toBe(true);
      expect(response.knowledge[0]).toMatchObject({ excerpt: text, digest: knowledgeDigest(text) });
      expect((await humanWork.detail(response.workItemId)).card?.references[0]?.digest).toBe(knowledgeDigest(text));
      expect((await knowledge.read(f.outcome.id, (await humanWork.detail(response.workItemId)).card!.references[0])).text).toBe(text);
    } finally { await f.cleanup(); }
  });

  test("source bytes changing after receipt submission cannot be accepted as current evidence", async () => {
    const f = await setup("agent", "sourceReference");
    try {
      const directory = f.store.botDirectory(f.bot.id);
      await mkdir(directory, { recursive: true });
      const path = join(directory, "observed-source.txt");
      await writeFile(path, "Observed source version one");
      await prisma.agentFileState.create({ data: { path, botId: f.bot.id, kind: "document", digest: knowledgeDigest("Observed source version one") } });
      const knowledge = new HumanKnowledgeService(prisma, f.store, f.assets);
      const receipts = new HumanReceiptService(prisma, f.assets, knowledge, f.messaging);
      const receipt = await receipts.submit(f.card.workItemId, { ...request(), sourceRefs: [{ type: "knowledge", ref: `agent-file:${path}` }] }, "owner:local");
      await writeFile(path, "Changed without a metadata update");
      const reviews = new OutcomeReviewService(prisma, f.messaging, async () => { throw new Error("No inference"); }, undefined, receipts);
      const result = await Effect.runPromise(Effect.either(reviews.submit(f.outcome.id, {
        expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [{
          criterionId: f.criterion.id, result: "PASS", evidenceIds: receipt.evidenceIds, comment: "Verify current source",
        }],
      }, "owner:local")));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") expect((result.left as ApiError).code).toBe("knowledge_source_stale");
      expect((await f.humanWork.detail(f.card.workItemId)).status).toBe("review_pending");
    } finally { await f.cleanup(); }
  });

  test("source snapshots use actual provider reads and an unsupported external reference cannot satisfy source evidence", async () => {
    const f = await setup("agent", "sourceReference");
    try {
      const receipt = await f.receipts.submit(f.card.workItemId, {
        ...request(), sourceRefs: [{ type: "external", ref: "https://example.invalid/unreadable" }],
      }, "owner:local");
      expect(receipt.missingRequirements[0]?.kind).toBe("sourceReference");
      const knowledge = new HumanKnowledgeService(prisma, f.store, f.assets);
      const service = new HumanWorkService(prisma, knowledge);
      const tool = humanActionTool(prisma, service);
      expect(await code(() => tool({ arguments: f.cardInput.card } as never, {
        runId: f.run.id, botId: f.bot.id, workItemId: f.agent.id,
      }))).toBe("human_work_item_not_active");
      expect((await knowledge.search(f.outcome.id, { text: "missingfixture", limit: 20 }))).toEqual([]);
    } finally { await f.cleanup(); }
  });
});
