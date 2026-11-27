import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { Effect } from "effect";
import { PgBoss } from "pg-boss";
import { Client } from "pg";
import { ApiError } from "@outcomego/contracts";
import { createPrismaClient } from "@outcomego/db";
import {
  AgentDataStore, AgentMessaging, AssetStore, settleOutcomeThreadTurn, settleOutcomeWorkItem,
} from "@outcomego/messaging";
import { WakeWorker } from "../../../../worker/src/worker";
import { Projection } from "../../../../worker/src/projection";
import { OutcomeClassificationService } from "../../../src/services/outcome-classification";
import { OutcomeService } from "../../../src/services/outcome-service";
import { OutcomeThreadService } from "../../../src/services/outcome-thread-service";
import { OutcomeThreadTools } from "../../../src/services/outcome-thread-tools";
import { OutcomeReviewService } from "../../../src/services/outcome-review-service";
import { OutcomeEvidenceConsumer } from "../../../src/services/outcome-evidence-consumer";
import { EventWakeup } from "../../../src/event-wakeup";
import { createHumanWorkServices } from "../../../src/services/human-work-factory";
import { knowledgeDigest } from "../../../src/services/knowledge-provider";
import type { OutcomeInference } from "../../../src/services/outcome-inference";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { ClassifyOutcomeInput, SaveOutcomeContractInput } from "@outcomego/contracts/outcome-thread";
import type { HumanActionResult, ToolContext } from "@outcomego/messaging";
import { disposableDatabaseUrl } from "../../../../../scripts/outcome-recovery/report";

export type ProductReplayScenario = "research" | "human";
interface ReplayStep {
  operation: string;
  input: unknown;
  result: unknown;
}
interface Claim {
  runId: string;
  conversationId: string;
  contextSessionId: string;
  outcomeWorkItemId: string | null;
}
interface ResearchFixture {
  fixtureId: string;
  planningRequest: { sourceText: string };
  fakeInferenceResponse: {
    goal: Array<{ text: string }>;
    acceptance: Array<{ text: string; required: boolean }>;
    boundaries: Array<{ text: string; kind: string }>;
  };
  selections: {
    title: string;
    goal: { selectedOptionIds: string[] };
  };
}
interface HumanFixture {
  outcome: { title: string; criteria: Array<{ statement: string }> };
  references: Array<{ text: string }>;
  requestHumanAction: {
    title: string; purpose: string; steps: string[];
    evidenceRequirements: Array<{ criterionOrdinal: number; label: string; kind: "text" }>;
  };
  pause: { currentStepId: string; draftSummary: string; reason: string };
  receipts: {
    rejected: { comment: string; review: { comment: string } };
    resubmitted: { comment: string };
  };
}

const execute = Effect.runPromise;
const actor = "owner:local" as const;
const specs = join(import.meta.dir, "../../../../../specs");

/**
 * Real service/claim/projection replay with controlled inference and Computer events.
 * No model, network provider, native UI or full worker loop is started.
 */
export async function runProductReplay(
  scenario: ProductReplayScenario,
  publish?: (report: ProductReplayReport) => Promise<void>,
): Promise<ProductReplayReport> {
  const canonicalUrl = disposableDatabaseUrl(process.env);
  const root = await mkdtemp(join(tmpdir(), "outcomego-product-replay-"));
  const databaseName = `outcomego_product_replay_${crypto.randomUUID().replaceAll("-", "")}`;
  const target = new URL(canonicalUrl);
  target.pathname = `/${databaseName}`;
  const admin = new Client({ connectionString: canonicalUrl });
  let created = false;
  let result: Omit<ProductReplayReport, "databaseIsolation">;
  try {
    await admin.connect();
    // Never clone a populated canonical database: the production consumer is global.
    await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
    created = true;
    const repository = join(import.meta.dir, "../../../../..");
    const config = join(root, "prisma.config.ts");
    await writeFile(config, [
      `import { defineConfig } from ${JSON.stringify(join(repository, "packages/db/node_modules/prisma/config"))};`,
      `export default defineConfig({ schema: ${JSON.stringify(join(repository, "packages/db/prisma/schema.prisma"))},`,
      "datasource: { url: process.env.OUTCOMEGO_TEST_DATABASE_URL! } });",
    ].join("\n"), { flag: "wx" });
    const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]
      .flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
    const deploy = Bun.spawn([
      process.execPath, "--no-env-file", join(repository, "packages/db/node_modules/prisma/build/index.js"),
      "db", "push", "--config", config,
    ], { cwd: repository, env: { ...environment, OUTCOMEGO_TEST_DATABASE_URL: target.toString() }, stdout: "pipe", stderr: "pipe" });
    const [status] = await Promise.all([
      deploy.exited, new Response(deploy.stdout).text(), new Response(deploy.stderr).text(),
    ]);
    if (status !== 0) throw new Error("private_replay_schema_deploy_failed");
    const schema = new Client({ connectionString: target.toString() });
    try {
      await schema.connect();
      await schema.query("BEGIN");
      await schema.query(await readFile(join(repository, "packages/db/prisma/sql/raw-schema.sql"), "utf8"));
      await schema.query("COMMIT");
    } finally { await schema.end(); }
    result = await replayInDatabase(scenario, target.toString(), root);
  } finally {
    try {
      if (created) {
        await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
        const remaining = await admin.query("SELECT datname FROM pg_database WHERE datname=$1", [databaseName]);
        if (remaining.rows.length) throw new Error("private_replay_database_cleanup_failed");
      }
    } finally {
      await admin.end();
      await rm(root, { recursive: true, force: true });
    }
  }
  const report: ProductReplayReport = {
    ...result, databaseIsolation: { databaseName, inheritedData: false, removed: true },
  };
  if (publish) await publish(report);
  return report;
}

async function replayInDatabase(
  scenario: ProductReplayScenario, databaseUrl: string, root: string,
): Promise<Omit<ProductReplayReport, "databaseIsolation">> {
  const db = createPrismaClient(databaseUrl);
  const runKey = `product-replay:${crypto.randomUUID()}`;
  const key = (operation: string) => `${runKey}:${operation}`;
  const requests: ReplayStep[] = [];
  const checks: Array<{ name: string; passed: boolean }> = [];
  const check = (name: string, passed: boolean) => {
    checks.push({ name, passed });
    if (!passed) throw new Error(`product_replay_assertion:${name}`);
  };
  const record = (operation: string, input: unknown, result: unknown) => requests.push({ operation, input, result });
  const research = JSON.parse(await readFile(join(specs, "004.2-Outcome规划执行与成果验收闭环/docs/research-pilot.json"), "utf8")) as ResearchFixture;
  const human = JSON.parse(await readFile(join(specs, "004.4-现实任务与知识资料闭环/docs/human-task-fixture.json"), "utf8")) as HumanFixture;
  const store = new AgentDataStore(db, { root: join(root, "agent-data"), workspaceRoot: root });
  const assets = new AssetStore({ root: join(root, "assets"), allowedFileRoots: [root] });
  // Persist real bot-wake jobs without starting queue workers or an application server.
  const boss = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });
  const messaging = new AgentMessaging(db, boss, store, assets);
  const humanServices = createHumanWorkServices(db, messaging, store, assets);
  const threads = new OutcomeThreadService(db, messaging);
  const enqueuePlan = threads.plan.bind(threads);
  const outcomes = new OutcomeService(db, messaging, undefined, undefined, undefined, { enqueuePlan });
  const classification = new OutcomeClassificationService(db, outcomes, enqueuePlan);
  const tools = new OutcomeThreadTools(db, outcomes, undefined, undefined, undefined, classification);
  const infer: OutcomeInference = async input => {
    record("controlled-inference", { kind: input.kind }, { adapter: "fixture", network: false });
    const { criteria } = JSON.parse(input.prompt) as { criteria: Array<{ id: string }> };
    return { text: JSON.stringify({ results: criteria.map(criterion => ({
      criterionId: criterion.id, suggestion: "unclear", reason: "Controlled local prereview; owner verification is required",
    })) }) };
  };
  const reviews = new OutcomeReviewService(db, messaging, infer, undefined, humanServices.humanReceipts);
  const consumer = new OutcomeEvidenceConsumer(db, reviews, new EventWakeup(databaseUrl));
  // Use the existing worker's production claim, as in outcome-thread.integration.test.ts.
  const worker = Object.assign(Object.create(WakeWorker.prototype), {
    prisma: db, messaging, agentData: store, workspaceRoot: root,
  }) as { claim(botId: string): Promise<Claim | null> };
  const projection = new Projection(db, store);
  let botId: string | undefined;
  let channelId: string | undefined;
  let outcomeId: string | undefined;
  let sourceReference: { id: string; digest?: string; version: string } | undefined;
  const contexts: Claim[] = [];
  const completeRun = async (claim: Claim, text: string) => {
    const turnId = key(`computer:${claim.runId}`);
    await projection.apply(claim.runId, claim.conversationId, botId!, {
      type: "item.completed", turnId,
      item: { id: key(`result:${claim.runId}`), type: "agentMessage", text },
    });
    await projection.apply(claim.runId, claim.conversationId, botId!, {
      type: "turn.completed", turnId, status: "completed",
    });
    // These are the worker's transport receipt/lease cleanup, not business state.
    await db.inboxEvent.updateMany({ where: { runId: claim.runId }, data: { status: "completed", completedAt: new Date() } });
    await db.botRunLease.deleteMany({ where: { runId: claim.runId } });
  };
  const finish = async (claim: Claim, text: string) => {
    await completeRun(claim, text);
    await db.$transaction(tx => settleOutcomeWorkItem(tx, claim.runId, { messaging, workspaceRoot: root }));
    record("controlled-computer-completion", { runId: claim.runId, adapter: "Projection.apply" }, {
      run: await db.run.findUniqueOrThrow({ where: { id: claim.runId }, select: { id: true, status: true } }),
      workItems: await humanServices.humanWork.list(outcomeId!),
    });
  };
  try {
    await boss.start();
    await boss.createQueue("bot-wake");
    await db.featureSettings.create({ data: { id: "global", outcomesEnabled: true } });
    const bot = await db.bot.create({ data: {
      name: "Fictional local product replay", defaultDirectory: root, status: "active", conversation: { create: {} },
    } });
    botId = bot.id;
    const channel = await db.channel.create({ data: {
      name: "Fictional local product replay", kind: "bot_dm", directKey: `bot:${bot.id}`,
      members: { create: { botId: bot.id, ordinal: 0 } },
    } });
    channelId = channel.id;
    const intakeInput = { text: scenario === "research" ? research.planningRequest.sourceText : human.outcome.title,
      botId: bot.id, clientRequestId: key("intake") };
    const intake = await execute(outcomes.createIntake(intakeInput, actor));
    outcomeId = intake.outcome.id;
    record("outcomes.createIntake", intakeInput, intake);
    check("intake_persists_note_before_triage", intake.outcome.kind === "note" && Boolean(intake.turn?.runId));
    const invoke = (claim: Claim, tool: string, args: unknown) => {
      const context: ToolContext = { runId: claim.runId, botId: bot.id, conversationId: claim.conversationId,
        channelId: channel.id, origin: "outcome_thread", deliveryId: null, callId: key(tool), replyToMessageId: null, isFork: false };
      return tools.execute({ ...context, tool, arguments: args }, context);
    };
    const title = scenario === "research" ? research.selections.title : human.outcome.title;
    const classify: ClassifyOutcomeInput = { strategy: "single_convert", outcome: { kind: "standard", title },
      summary: "Route this fictional request to contract planning", clientRequestId: key("classify") };
    const triage = await worker.claim(bot.id);
    if (!triage || triage.runId !== intake.turn?.runId) throw new Error("product_replay_triage_claim_missing");
    const classified = await invoke(triage, "ClassifyOutcome", classify);
    record("ClassifyOutcome", classify, classified);
    await completeRun(triage, classify.summary);
    await db.$transaction(tx => settleOutcomeThreadTurn(tx, triage.runId, messaging));
    const standard = await execute(outcomes.get(outcomeId));
    check("triage_converts_in_place", standard.id === outcomeId && standard.kind === "standard" && standard.title === title);
    check("intake_same_key_returns_original_receipt", isDeepStrictEqual(await execute(outcomes.createIntake(intakeInput, actor)), intake));
    check("triage_replays_without_a_second_outcome", isDeepStrictEqual(await invoke(triage, "ClassifyOutcome", classify), classified) && await db.outcome.count() === 1);
    const queuedPlan = (await threads.list(outcomeId)).turns.find(turn => turn.planMode === "contract_plan");
    const planRequest = { mode: "contract_plan" as const, expectedRevision: standard.revision, clientRequestId: key("plan") };
    const plan = await threads.plan(outcomeId, planRequest, actor);
    record("outcomeThreads.plan", planRequest, plan);
    check("contract_plan_reuses_the_turn_enqueued_by_triage", queuedPlan?.id === plan.id);
    const planner = await worker.claim(bot.id);
    if (!planner || planner.runId !== plan.runId) throw new Error("product_replay_contract_plan_claim_missing");
    const researchContract = research.fakeInferenceResponse;
    const contract: SaveOutcomeContractInput = {
      title, clientRequestId: key("save-contract"),
      goal: scenario === "research" ? researchContract.goal.filter((_, index) => research.selections.goal.selectedOptionIds.includes(`goal-${index + 1}`)).map(goal => goal.text) : [title],
      acceptance: scenario === "research" ? researchContract.acceptance.map(({ text, required }) => ({ statement: text, required }))
        : human.outcome.criteria.map(({ statement }) => ({ statement, required: true })),
      boundaries: scenario === "research" ? {
        included: researchContract.boundaries.filter(boundary => boundary.kind === "included").map(boundary => boundary.text),
        excluded: researchContract.boundaries.filter(boundary => boundary.kind === "excluded").map(boundary => boundary.text),
      } : { included: [], excluded: ["Production systems and real customer data"] },
    };
    const saved = await invoke(planner, "SaveOutcomeContract", contract);
    record("SaveOutcomeContract", contract, saved);
    await completeRun(planner, "Contract is ready for the owner's approval.");
    await db.$transaction(tx => settleOutcomeThreadTurn(tx, planner.runId, messaging));
    check("plan_and_contract_replay_preserve_single_turn_and_revision",
      (await threads.plan(outcomeId, planRequest, actor)).id === plan.id &&
      isDeepStrictEqual(await invoke(planner, "SaveOutcomeContract", contract), saved) &&
      await db.outcomeContractRevision.count({ where: { outcomeId } }) === 1 &&
      (await threads.list(outcomeId)).turns.filter(turn => turn.planMode === "contract_plan").length === 1);
    const approve = { expectedRevision: 1, confirmationText: "Owner confirms this fictional local Contract", clientRequestId: key("approve") };
    const approved = await execute(outcomes.approve(outcomeId, 1, approve, actor));
    record("outcomes.approve", approve, approved);
    check("approval_replay_preserves_approved_snapshot", isDeepStrictEqual(await execute(outcomes.approve(outcomeId, 1, approve, actor)), approved));
    const start = { expectedRevision: 1, clientRequestId: key("start") };
    const started = await execute(outcomes.startRun(outcomeId, start, actor));
    const item = started.workItems[0]!;
    record("outcomes.startRun", start, started);
    check("run_replay_has_same_work_item_and_root", isDeepStrictEqual(await execute(outcomes.startRun(outcomeId, start, actor)), started));
    check("run_replay_does_not_create_second_run", await db.run.count({ where: { outcomeWorkItemId: item.id } }) === 1);
    const claimed = await worker.claim(bot.id);
    if (!claimed) throw new Error("product_replay_claim_missing");
    contexts.push(claimed);
    check("actual_worker_claims_enqueued_outcome_root", claimed.runId === item.rootRunId && claimed.outcomeWorkItemId === item.id);
    check("actual_context_is_scoped_to_work_item", await db.contextSession.count({
      where: { id: claimed.contextSessionId, scope: "outcome", scopeId: item.id },
    }) === 1);
    record("worker.claim", { botId: bot.id }, claimed);

    const mainRequest = { botId: bot.id, channelId: channel.id, content: "今天天气怎么样？", clientId: key("main-chat") };
    const main = await db.$transaction(tx => messaging.acceptDirectUserMessage(tx, mainRequest));
    const mainClaim = await worker.claim(bot.id);
    check("main_message_claims_independently", mainClaim?.runId === main.run.id && mainClaim.contextSessionId !== claimed.contextSessionId);
    check("main_message_does_not_interrupt_outcome", (await db.run.findUniqueOrThrow({ where: { id: claimed.runId } })).status === "running");
    const mainBefore = await db.run.findUniqueOrThrow({ where: { id: main.run.id } });
    const mainLeaseBefore = await db.botRunLease.findFirstOrThrow({ where: { runId: main.run.id } });
    record("messaging.acceptDirectUserMessage", mainRequest, { runId: main.run.id, interruptRunId: main.interruptRunId, claim: mainClaim });

    let humanWorkItemId: string | undefined;
    if (scenario === "human") {
      const directory = store.botDirectory(bot.id);
      await mkdir(directory, { recursive: true });
      const file = join(directory, "network-checklist.txt");
      const text = human.references[0]!.text;
      await writeFile(file, text, { flag: "wx" });
      await db.agentFileState.create({ data: { path: file, botId: bot.id, kind: "document", digest: knowledgeDigest(text) } });
      const found = await humanServices.knowledge.search(outcomeId, { text: "network-checklist", limit: 10 });
      const reference = found.find(candidate => candidate.id === `agent-file:${file}`);
      if (!reference) throw new Error("product_replay_source_missing");
      const document = await humanServices.knowledge.read(outcomeId, reference);
      check("knowledge_reads_actual_mounted_bytes", document.digest === knowledgeDigest(text) && document.text === text);
      sourceReference = reference;
      record("knowledge.search/read", { outcomeId, text: "network-checklist", referenceId: reference.id }, { reference, document });
      const action = { ...human.requestHumanAction, referenceIds: [reference.id] };
      const request = {
        runId: claimed.runId, botId: bot.id, conversationId: claimed.conversationId, channelId: channel.id,
        deliveryId: null, callId: key("request-human"), tool: "RequestHumanAction", arguments: action,
      };
      const context = { runId: claimed.runId, botId: bot.id, workItemId: item.id };
      const card = await humanServices.humanActionTool(request, context) as HumanActionResult & { end_turn: boolean };
      humanWorkItemId = card.workItemId;
      check("human_tool_replay_returns_same_card", isDeepStrictEqual(await humanServices.humanActionTool(request, context), card));
      check("human_tool_ends_turn", card.end_turn === true);
      record("RequestHumanAction", request, { ...card, detail: await humanServices.humanWork.detail(card.workItemId) });
      await finish(claimed, "Fictional instructions prepared; waiting for the owner's observed material.");
      check("settlement_preserves_waiting_human", (await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).status === "waiting_human");
      const mutation = (operation: string) => ({ expectedContractRevision: 1, clientRequestId: key(operation) });
      const begin = mutation("human-start");
      const initial = await humanServices.humanWork.start(card.workItemId, begin, actor);
      record("human.start", begin, initial);
      const pause = { ...mutation("human-pause"), ...human.pause, readReferenceIds: [reference.id] };
      record("human.pause", pause, await humanServices.humanWork.pause(card.workItemId, pause, actor));
      check("paused_draft_survives_reopen", (await humanServices.humanWork.detail(card.workItemId)).card?.draft?.draftSummary === pause.draftSummary);
      const resume = mutation("human-resume");
      record("human.start", resume, await humanServices.humanWork.start(card.workItemId, resume, actor));
      const missingRequest = mutation("receipt-missing");
      const missing = await humanServices.humanReceipts.submit(card.workItemId, missingRequest, actor);
      record("receipts.submit.missing", missingRequest, missing);
      check("missing_material_is_explicit_not_success", missing.missingRequirements.length === 1 && missing.evidenceIds.length === 0);
      const criterionId = approved.currentRevisionView!.criteria[0]!.id;
      const unverified = {
        expectedRevision: 1, clientRequestId: key("review-unverified"),
        results: [{ criterionId, result: "UNVERIFIED" as const, evidenceIds: [], comment: "No observed material yet" }],
      };
      record("reviews.submit.UNVERIFIED", unverified, await execute(reviews.submit(outcomeId, unverified, actor)));
      const unsupportedPass = {
        ...unverified, clientRequestId: key("review-missing-pass"),
        results: [{ criterionId, result: "PASS" as const, evidenceIds: [], userConfirmed: true, comment: "Missing materials cannot be waived by confirmation" }],
      };
      const rejectedPass = await execute(Effect.either(reviews.submit(outcomeId, unsupportedPass, actor)));
      const errorCode = rejectedPass._tag === "Left" && rejectedPass.left instanceof ApiError ? rejectedPass.left.code : null;
      check("missing_human_material_rejects_pass", errorCode === "human_evidence_missing");
      record("reviews.submit.missing-PASS", unsupportedPass, { errorCode });
      const reject = {
        expectedRevision: 1, clientRequestId: key("review-reject"),
        results: [{ criterionId, result: "FAIL" as const, evidenceIds: [], comment: human.receipts.rejected.review.comment }],
      };
      record("reviews.submit.FAIL", reject, await execute(reviews.submit(outcomeId, reject, actor)));
      check("rejection_preserves_receipt", (await db.outcomeHumanReceipt.findUniqueOrThrow({ where: { id: missing.id } })).status === "rejected");
      const restart = mutation("human-resubmit-start");
      record("human.start", restart, await humanServices.humanWork.start(card.workItemId, restart, actor));
      const resubmit = { ...mutation("receipt-resubmit"), text: human.receipts.resubmitted.comment };
      const receipt = await humanServices.humanReceipts.submit(card.workItemId, resubmit, actor);
      check("receipt_retry_is_exact", isDeepStrictEqual(await humanServices.humanReceipts.submit(card.workItemId, resubmit, actor), receipt));
      record("receipts.submit.resubmitted", resubmit, receipt);
      const acceptHuman = {
        expectedRevision: 1, clientRequestId: key("review-human"),
        results: [{ criterionId, result: "PASS" as const, evidenceIds: receipt.evidenceIds, comment: "Owner verified the fictional observed network log" }],
      };
      const reviewed = await execute(reviews.submit(outcomeId, acceptHuman, actor));
      check("human_review_retry_is_exact", isDeepStrictEqual(await execute(reviews.submit(outcomeId, acceptHuman, actor)), reviewed));
      record("reviews.submit.human-PASS", acceptHuman, reviewed);
      check("review_accepts_human_only_before_agent_finishes", reviewed.acceptedAt === null &&
        (await humanServices.humanWork.detail(card.workItemId)).status === "accepted");
      check("human_review_enqueues_once", await db.run.count({ where: { outcomeWorkItemId: item.id } }) === 2);
      const continuation = await worker.claim(bot.id);
      if (!continuation) throw new Error("product_replay_continuation_missing");
      contexts.push(continuation);
      check("continuation_uses_actual_same_context_and_root", continuation.contextSessionId === claimed.contextSessionId &&
        continuation.outcomeWorkItemId === item.id && continuation.runId !== claimed.runId &&
        (await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).rootRunId === claimed.runId);
      record("worker.claim.continuation", { botId: bot.id }, continuation);
      await finish(continuation, "Fictional human observations incorporated into the network report.");
    } else {
      await finish(claimed, "Fictional backup comparison: plan A has lower cost; plan B has faster recovery. Sources and limits are stated.");
    }

    const consumerCount = await consumer.drain();
    check("output_evidence_consumer_is_idempotent", await consumer.drain() === 0);
    record("evidenceConsumer.drain", { boundedDurableEvents: true }, { processed: consumerCount });
    let detail = await execute(outcomes.get(outcomeId));
    check("settlement_records_real_output_and_review_pending", detail.outputs.length > 0 && detail.status === "review_pending");
    check("output_created_agent_report_candidates", detail.evidence.some(evidence => evidence.credibility === "agent_report"));
    const finalReview = {
      expectedRevision: 1, clientRequestId: key("review-final"),
      results: detail.currentRevisionView!.criteria.map(criterion => ({
        criterionId: criterion.id, result: "PASS" as const, evidenceIds: [],
        comment: "Owner verified the controlled local report against this criterion",
      })),
      newEvidence: detail.currentRevisionView!.criteria.map(criterion => ({
        criterionId: criterion.id, sourceType: "check" as const,
        sourceRef: `local-replay:${outcomeId}:${criterion.id}`,
        contentSummary: "Fictional owner observation recorded through the actual review service",
      })),
    };
    detail = await execute(reviews.submit(outcomeId, finalReview, actor));
    check("final_review_retry_returns_exact_response", isDeepStrictEqual(await execute(reviews.submit(outcomeId, finalReview, actor)), detail));
    record("reviews.submit.final", finalReview, detail);
    check("same_outcome_has_output_evidence_review_and_acceptance", detail.status === "accepted" && !!detail.acceptedAt &&
      detail.outputs.length > 0 && detail.evidence.some(evidence => evidence.credibility === "human_confirmed") && detail.reviews.length > 0);
    check("outcome_does_not_mutate_main_run_or_lease", isDeepStrictEqual(await db.run.findUniqueOrThrow({ where: { id: main.run.id } }), mainBefore) &&
      isDeepStrictEqual(await db.botRunLease.findFirstOrThrow({ where: { runId: main.run.id } }), mainLeaseBefore));
    check("outcome_never_publishes_main_visible_messages", await db.channelMessage.count({ where: { channelId: channel.id, senderBotId: bot.id } }) === 0);
    check("run_lineage_never_changes_revision_or_work_item", await db.run.count({
      where: { botId: bot.id, origin: "outcome", outcomeWorkItemId: { not: item.id } },
    }) === 0);
    const runs = await db.run.findMany({
      where: { outcomeWorkItemId: item.id }, orderBy: { createdAt: "asc" },
      select: { id: true, origin: true, status: true, outcomeWorkItemId: true, startedAt: true, completedAt: true },
    });
    const receipts = humanWorkItemId ? await humanServices.humanWork.detail(humanWorkItemId) : null;
    const lineage = {
      outputs: await db.outcomeOutput.findMany({ where: { outcomeId }, orderBy: { createdAt: "asc" } }),
      evidence: await db.outcomeEvidence.findMany({ where: { outcomeId }, orderBy: { capturedAt: "asc" } }),
      reviews: await db.outcomeReview.findMany({ where: { outcomeId }, orderBy: [{ criterionId: "asc" }, { sequence: "asc" }] }),
    };
    check("all_output_ids_bind_real_outcome_item_and_run", lineage.outputs.every(output =>
      output.outcomeId === outcomeId && output.workItemId === item.id && runs.some(run => run.id === output.runId)));
    check("all_evidence_and_reviews_bind_actual_approved_criteria", [...lineage.evidence, ...lineage.reviews].every(row =>
      row.contractRevisionId === detail.currentRevisionView!.id &&
      detail.currentRevisionView!.criteria.some(criterion => criterion.id === row.criterionId)));
    const idempotency = await db.idempotencyRecord.findMany({ where: { OR: [
      { key: { startsWith: runKey } }, { scope: { contains: outcomeId } },
      { scope: `outcome-turn:${item.id}` }, ...(humanWorkItemId ? [{ scope: `human-work:${humanWorkItemId}` }, { scope: `human-receipt:${humanWorkItemId}` }] : []),
    ] }, select: { scope: true, key: true, status: true, requestHash: true, response: true }, orderBy: [{ scope: "asc" }, { key: "asc" }] });
    const events = await db.event.findMany({ where: { entityId: outcomeId }, orderBy: { sequence: "asc" } });
    const inbox = await db.inboxEvent.findMany({ where: { runId: { in: runs.map(run => run.id) } },
      select: { id: true, runId: true, idempotencyKey: true, status: true, payload: true } });
    const report: Omit<ProductReplayReport, "databaseIsolation"> = {
      scenario, status: "PASS", execution: "local-real-services-controlled-inference-and-computer-events",
      realBotReplay: "PENDING", nativeUIReplay: "PENDING",
      fixture: scenario === "research" ? research.fixtureId : "human-task-fixture",
      runKey, checks, requests,
      ids: { botId: bot.id, channelId: channel.id, triageTurnId: intake.turn!.id, planTurnId: plan.id, outcomeId,
        revisionId: detail.currentRevisionView!.id, workItemId: item.id, rootRunId: claimed.runId,
        contextSessionId: claimed.contextSessionId, mainRunId: main.run.id,
        ...(humanWorkItemId ? { humanWorkItemId } : {}) },
      contexts, sourceReference, runs, inbox, lineage, idempotency, events: events.map(event => ({
        sequence: event.sequence.toString(), topic: event.topic, payload: event.payload,
      })), finalDetail: detail, humanDetail: receipts,
    };
    return report;
  } finally {
    try { await boss.stop(); }
    finally { await db.$disconnect(); }
  }
}

export interface ProductReplayReport {
  scenario: ProductReplayScenario;
  status: "PASS";
  execution: "local-real-services-controlled-inference-and-computer-events";
  realBotReplay: "PENDING";
  nativeUIReplay: "PENDING";
  fixture: string;
  runKey: string;
  checks: Array<{ name: string; passed: boolean }>;
  requests: ReplayStep[];
  ids: Record<string, string>;
  contexts: Claim[];
  sourceReference?: { id: string; digest?: string; version: string };
  runs: unknown[];
  inbox: unknown[];
  lineage: { outputs: unknown[]; evidence: unknown[]; reviews: unknown[] };
  idempotency: unknown[];
  databaseIsolation: { databaseName: string; inheritedData: false; removed: true };
  events: unknown[];
  finalDetail: OutcomeDetail;
  humanDetail: unknown;
}
