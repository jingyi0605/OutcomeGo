import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  AssetStore, consumeOutcomeInboxEvent, createOutcomeDecision, recoverOutcomeWorkItem, settleOutcomeWorkItem, transitionWorkItem,
} from "@outcomego/messaging";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { DecisionService } from "../../../src/services/decision-service";
import { HumanWorkService } from "../../../src/services/human-work-service";
import { HumanReceiptService } from "../../../src/services/human-receipt-service";
import { OutcomeReviewService } from "../../../src/services/outcome-review-service";
import { recoveryFixture, type RecoveryFixture } from "./fixture";
import type { RecoveryReport, RecoveryScenario } from "../../../../../scripts/outcome-recovery/report";

const actor = "owner:local" as const;
const run = Effect.runPromise;
const recovery = (f: RecoveryFixture, confirmedStoppedRunIds?: ReadonlySet<string>) =>
  f.locked(tx => recoverOutcomeWorkItem(tx, f.item.id, { ...f.runtime, confirmedStoppedRunIds }));

async function finish(f: RecoveryFixture, runId: string, status: "completed" | "interrupted" = "completed") {
  await f.db.run.update({ where: { id: runId }, data: { status, completedAt: new Date() } });
  await f.db.inboxEvent.updateMany({ where: { runId }, data: { status: "completed", completedAt: new Date() } });
}

async function restartRunningRun(f: RecoveryFixture) {
  const runId = await f.enqueue();
  const processHandle = Bun.spawn([process.execPath, join(import.meta.dir, "restart-process.ts"), runId, f.item.id], {
    cwd: join(import.meta.dir, "../../.."), env: process.env, stdout: "pipe", stderr: "ignore",
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const reader = processHandle.stdout.getReader();
    let text = "";
    await Promise.race([
      (async () => {
        while (!text.includes("\n")) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("fixture_executor_exited_before_commit");
          text += new TextDecoder().decode(chunk.value);
        }
      })(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("fixture_executor_start_timeout")), 20_000); }),
    ]);
    if (timeout) clearTimeout(timeout);
    reader.releaseLock();
    const initial = await f.snapshot();
    const before = await recovery(f);
    f.check("expired_lease_without_stop_confirmation_does_not_replace_executor", before === null &&
      (await f.db.run.findUniqueOrThrow({ where: { id: runId } })).status === "running");
    processHandle.kill("SIGKILL");
    await processHandle.exited;
    const restarted = Bun.spawn([process.execPath, join(import.meta.dir, "recovery-process.ts"), f.item.id, runId, f.root], {
      cwd: join(import.meta.dir, "../../.."), env: process.env, stdout: "pipe", stderr: "ignore",
    });
    const raw = await new Response(restarted.stdout).text();
    if (await restarted.exited !== 0) throw new Error("fixture_recovery_process_failed");
    const { action } = JSON.parse(raw) as { action: string };
    const count = await f.db.run.count({ where: { outcomeWorkItemId: f.item.id } });
    await recovery(f, new Set([runId]));
    const old = await f.db.run.findUniqueOrThrow({ where: { id: runId } });
    const continuation = await f.db.run.findFirst({ where: { outcomeWorkItemId: f.item.id, status: "queued" } });
    f.check("terminated_local_executor_resumes_exactly_once", action === "resume_queued" && old.status === "interrupted" && count === 2 &&
      await f.db.run.count({ where: { outcomeWorkItemId: f.item.id } }) === count && continuation?.origin === "outcome");
    f.check("expired_outcome_lease_released", await f.db.botRunLease.count({ where: { runId } }) === 0);
    return f.report("restart-running-run", initial, `executor-exit:${runId}`, 2, {
      executor: "disposable-local-process", exitObserved: processHandle.exitCode !== null,
      remoteComputerStop: "PENDING", recoveryAction: action,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    if (processHandle.exitCode === null) { processHandle.kill("SIGKILL"); await processHandle.exited; }
  }
}

async function duplicateFinish(f: RecoveryFixture) {
  const runId = await f.enqueue();
  const initial = await f.snapshot();
  await finish(f, runId);
  const event = await f.db.event.create({ data: {
    topic: "run_item.completed", entityId: runId,
    payload: { item: { type: "agentMessage", text: "Fictional complete report" } },
  } });
  for (let replay = 0; replay < 2; replay++) await f.locked(tx => settleOutcomeWorkItem(tx, runId, f.runtime));
  const outputs = await f.db.outcomeOutput.findMany({ where: { workItemId: f.item.id } });
  f.check("duplicate_completion_has_one_final_output", outputs.length === 1 && outputs[0]?.runId === runId);
  f.check("one_review_request", await f.db.event.count({ where: { entityId: f.outcome.id, topic: "outcome.review.required" } }) === 1);
  const reviewEvent = await f.db.event.findFirstOrThrow({ where: { entityId: f.outcome.id, topic: "outcome.review.required" } });
  const firstDelivery = await f.db.$transaction(tx => consumeOutcomeInboxEvent(tx, reviewEvent.sequence));
  const repeatedDelivery = await f.db.$transaction(tx => consumeOutcomeInboxEvent(tx, reviewEvent.sequence));
  const reviewEventId = (reviewEvent.payload as { eventId: string }).eventId;
  f.check("duplicate_inbox_delivery_has_one_durable_consumer_receipt",
    firstDelivery.processed && firstDelivery.projected && repeatedDelivery.processed && !repeatedDelivery.projected &&
    await f.db.idempotencyRecord.count({ where: { scope: "outcome-event:inbox", key: reviewEventId } }) === 1);
  f.check("one_acceptance_notification", await f.db.channelNotification.count({
    where: { kind: "outcome", payload: { path: ["outcomeId"], equals: f.outcome.id } },
  }) === 1);
  const reviews = new OutcomeReviewService(f.db, f.messaging, async () => { throw new Error("fixture_inference_disabled"); });
  const request = { expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [{
    criterionId: f.revision.criteria[0]!.id, result: "PASS" as const, evidenceIds: [] as string[],
    userConfirmed: true, comment: "Fictional owner independently checked",
  }] };
  const results = await Promise.all([run(reviews.submit(f.outcome.id, request, actor)), run(reviews.submit(f.outcome.id, request, actor))]);
  f.check("duplicate_review_one_acceptance", results[0].acceptedAt === results[1].acceptedAt &&
    await f.db.outcomeReview.count({ where: { outcomeId: f.outcome.id } }) === 1 &&
    await f.db.event.count({ where: { entityId: f.outcome.id, topic: "outcome.accepted" } }) === 1);
  f.check("agent_only_completion_creates_no_human_facts", await f.db.outcomeWorkItem.count({ where: { outcomeId: f.outcome.id, executorType: "human" } }) === 0 &&
    await f.db.outcomeHumanReceipt.count({ where: { outcomeId: f.outcome.id } }) === 0);
  return f.report("duplicate-finish-event", initial, event.sequence.toString(), 2);
}

async function interruptedResume(f: RecoveryFixture) {
  let runId = await f.enqueue();
  const initial = await f.snapshot();
  const actions = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await finish(f, runId, "interrupted");
    const action = await recovery(f);
    actions.push(action);
    const after = await f.snapshot();
    await recovery(f);
    f.check(`interruption_${attempt + 1}_replays_without_duplicate_run`, (await f.snapshot()).runCount === after.runCount);
    if (attempt < 2) {
      const next = await f.db.run.findFirstOrThrow({ where: { outcomeWorkItemId: f.item.id, status: "queued" } });
      f.check(`interruption_${attempt + 1}_preserves_context`, action === "resume_queued" && next.id !== runId && next.origin === "outcome");
      runId = next.id;
    }
  }
  const decision = await f.db.outcomeDecision.findFirst({ where: { workItemId: f.item.id } });
  f.check("third_interruption_requires_owner_decision", actions[2] === "needs_review" && decision?.reasonCode === "external_result_unknown" &&
    await f.db.outcomeDecision.count({ where: { workItemId: f.item.id } }) === 1);
  return f.report("interrupted-thread-resume", initial, `interruption:${runId}`, 3, { actions });
}

async function concurrentDecision(f: RecoveryFixture) {
  const runId = await f.enqueue();
  await finish(f, runId);
  await f.locked(tx => transitionWorkItem(tx, { workItemId: f.item.id, to: "waiting_decision", reason: "fixture_owner_choice", actor }));
  const decision = await f.locked(tx => createOutcomeDecision(tx, {
    outcomeId: f.outcome.id, contractRevisionId: f.revision.id, workItemId: f.item.id, runId,
    reasonCode: "missing_input", completedSummary: "Fictional draft ready", problemSummary: "Fictional alternatives",
    nextStepSummary: "Choose one plan", options: ["first", "second"].map(id => ({
      id, label: id, consequence: "Resume the approved plan", source: "runtime" as const, resolutionEffect: "plan_only" as const,
    })),
  }, actor));
  const initial = await f.snapshot();
  const service = new DecisionService(f.db, { messaging: f.messaging });
  const inputs = ["first", "second"].map(optionId => ({
    expectedContractRevision: 1, optionId, clientRequestId: crypto.randomUUID(),
  }));
  const results = await Promise.all(inputs.map(input => run(Effect.either(service.resolve(decision.id, input, actor)))));
  const winner = results.findIndex(result => result._tag === "Right");
  f.check("two_distinct_choices_have_one_winner", results.filter(result => result._tag === "Right").length === 1);
  if (winner >= 0) await run(service.resolve(decision.id, inputs[winner]!, actor));
  f.check("one_resolution_and_one_continuation", await f.db.event.count({ where: { entityId: f.outcome.id, topic: "outcome.decision.resolved" } }) === 1 &&
    await f.db.run.count({ where: { outcomeWorkItemId: f.item.id, status: "queued" } }) === 1);
  f.check("approved_revision_unchanged", (await f.db.outcome.findUniqueOrThrow({ where: { id: f.outcome.id } })).currentRevisionId === f.revision.id);
  return f.report("concurrent-decision", initial, decision.id, 3, { winningChoiceCount: winner >= 0 ? 1 : 0 });
}

/** Inject a single failing delegate inside the actual interactive transaction. */
function failReceiptCreate(prisma: PrismaClient) {
  let injected = false;
  const proxy = new Proxy(prisma, { get(target, property) {
    if (property !== "$transaction") return Reflect.get(target, property, target);
    return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) =>
      target.$transaction(tx => callback(new Proxy(tx, { get(transaction, key) {
        if (key === "outcomeHumanReceipt") return new Proxy(transaction.outcomeHumanReceipt, { get(delegate, method) {
          if (method === "create") return async () => { injected = true; throw new Error("injected_receipt_create_failure"); };
          return Reflect.get(delegate, method, delegate);
        } });
        return Reflect.get(transaction, key, transaction);
      } })), options);
  } });
  return { prisma: proxy, wasInjected: () => injected };
}

async function receiptRetry(f: RecoveryFixture) {
  const runId = await f.enqueue();
  await f.db.run.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });
  const knowledge = { resolve: async () => [] };
  const human = new HumanWorkService(f.db, knowledge);
  const card = await f.locked(tx => human.createFromAgentRequest(tx, {
    runId, workItemId: f.item.id, input: {
      title: "Fictional inspection", purpose: "Observe fixture result", steps: ["Read fixture screenshot"],
      evidenceRequirements: [{ criterionOrdinal: 1, kind: "asset", label: "Observed screenshot" }],
    },
  }));
  await human.start(card.workItemId, { expectedContractRevision: 1, clientRequestId: crypto.randomUUID() }, actor);
  await finish(f, runId);
  const assets = new AssetStore({ root: join(f.root, "assets"), allowedFileRoots: [f.root] });
  const upload = await assets.ingestBytes({
    fileName: "fictional-observation.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Fictional observed fixture result"),
  });
  const request = {
    expectedContractRevision: 1, clientRequestId: crypto.randomUUID(), assetRefs: [`asset:${upload.assetId}`],
  };
  const initial = await f.snapshot();
  const faulty = failReceiptCreate(f.db);
  let rejected = false;
  try { await new HumanReceiptService(faulty.prisma, assets, knowledge, f.messaging).submit(card.workItemId, request, actor); }
  catch { rejected = true; }
  f.check("receipt_failure_reached_real_transaction", rejected && faulty.wasInjected());
  f.check("receipt_failure_rolls_back_evidence_status_and_events", await f.db.outcomeEvidence.count({ where: { workItemId: card.workItemId } }) === 0 &&
    await f.db.outcomeHumanReceipt.count({ where: { workItemId: card.workItemId } }) === 0 &&
    (await f.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: card.workItemId } })).status === "in_progress" &&
    await f.db.event.count({ where: { entityId: f.outcome.id, topic: "outcome.human_receipt.submitted" } }) === 0);
  const service = new HumanReceiptService(f.db, assets, knowledge, f.messaging);
  const first = await service.submit(card.workItemId, request, actor);
  const replay = await service.submit(card.workItemId, request, actor);
  f.check("same_key_receipt_retry_creates_one_receipt_and_evidence", first.id === replay.id &&
    await f.db.outcomeHumanReceipt.count({ where: { workItemId: card.workItemId } }) === 1 &&
    await f.db.outcomeEvidence.count({ where: { workItemId: card.workItemId } }) === 1);
  f.check("already_uploaded_asset_survives_rollback", (await assets.metadata(upload.assetId)).assetId === upload.assetId);
  f.check("receipt_submission_waits_for_review_before_resuming_agent",
    await f.db.run.count({ where: { outcomeWorkItemId: f.item.id, status: "queued" } }) === 0 &&
    (await f.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.item.id } })).status === "waiting_human");
  const review = new OutcomeReviewService(f.db, f.messaging, async () => { throw new Error("unused"); }, undefined, service);
  const reviewInput = {
    expectedRevision: 1, clientRequestId: crypto.randomUUID(), results: [{
      criterionId: f.revision.criteria[0]!.id, result: "PASS" as const, evidenceIds: first.evidenceIds,
      comment: "Owner inspected the fictional uploaded observation",
    }],
  };
  await run(review.submit(f.outcome.id, reviewInput, actor));
  await run(review.submit(f.outcome.id, reviewInput, actor));
  f.check("human_receipt_has_single_same_thread_resume", await f.db.run.count({ where: { outcomeWorkItemId: f.item.id, status: "queued" } }) === 1);
  f.check("receipt_accepted_by_unified_review", (await f.db.outcomeHumanReceipt.findUniqueOrThrow({ where: { id: first.id } })).status === "accepted");
  return f.report("receipt-retry", initial, `receipt-create-failure:${card.workItemId}`, 5, { humanWorkItemId: card.workItemId, receiptId: first.id, uploadedAssetId: upload.assetId });
}

async function unknownExternalReceipt(f: RecoveryFixture) {
  const runId = await f.enqueue();
  const journal = join(f.root, "fictional-external-send.json");
  // The fault adapter durably observes one accepted request, then loses its receipt.
  // Outcome recovery does not own provider receipts; the uncertain classification
  // is an injected input, not proof of a real provider's end-to-end reconciliation.
  const send = async () => {
    await writeFile(journal, JSON.stringify({ attempts: 1, state: "unknown", operationId: crypto.randomUUID() }), { flag: "wx" });
    throw new Error("injected_external_receipt_lost");
  };
  try { await send(); } catch { /* The external result remains unknown. */ }
  await finish(f, runId, "interrupted");
  await f.db.outcomeWorkItem.update({ where: { id: f.item.id }, data: { statusReason: "external_receipt_unknown" } });
  const initial = await f.snapshot();
  const first = await recovery(f);
  await recovery(f);
  const observed = JSON.parse(await readFile(journal, "utf8")) as { attempts: number; state: string; operationId: string };
  const decision = await f.db.outcomeDecision.findFirst({ where: { workItemId: f.item.id } });
  f.check("unknown_external_receipt_never_dispatches_a_retry", observed.attempts === 1 &&
    await f.db.run.count({ where: { outcomeWorkItemId: f.item.id } }) === 1);
  f.check("unknown_result_has_one_owner_decision", first === "needs_review" && decision?.reasonCode === "external_result_unknown" &&
    await f.db.outcomeDecision.count({ where: { workItemId: f.item.id } }) === 1);
  return f.report("unknown-external-receipt", initial, observed.operationId, 2, {
    externalAdapter: "fictional-durable-receipt-loss", actualAttemptCount: observed.attempts,
    classification: observed.state, productionProviderReplay: "PENDING",
  });
}

export async function runScenario(scenario: RecoveryScenario, publish?: (report: RecoveryReport) => Promise<void>): Promise<RecoveryReport> {
  const fixture = await recoveryFixture();
  const initialState = await fixture.snapshot();
  try {
    let report: RecoveryReport;
    try {
      switch (scenario) {
        case "restart-running-run": report = await restartRunningRun(fixture); break;
        case "duplicate-finish-event": report = await duplicateFinish(fixture); break;
        case "interrupted-thread-resume": report = await interruptedResume(fixture); break;
        case "concurrent-decision": report = await concurrentDecision(fixture); break;
        case "receipt-retry": report = await receiptRetry(fixture); break;
        case "unknown-external-receipt": report = await unknownExternalReceipt(fixture); break;
      }
    } catch {
      fixture.check("scenario_completed_without_execution_error", false);
      report = await fixture.report(scenario, initialState, `incomplete:${fixture.item.id}`, 0, {
        failureCode: "scenario_execution_failed", completedReplayCount: "unconfirmed",
      });
    }
    // Persist evidence while fixture facts still exist, then remove only owned data.
    if (publish) await publish(report);
    return report;
  } finally { await fixture.cleanup(); }
}
