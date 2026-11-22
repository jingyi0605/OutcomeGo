import { ApiError } from "@outcomego/contracts";
import type { ReviewTaskResultInput, SubmitPrereviewInput } from "@outcomego/contracts/outcome-thread";
import {
  PLAN_LIMITS,
  parseOutcomePlan,
  type OutcomeDetail,
  type TaskReviewFinding,
} from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  appendOutcomeEvent,
  dispatchQueuedOutcomeWorkItems,
  emitReviewRequiredIfNeeded,
  enqueueOutcomeTurn,
  readOutcomeReviewBatch,
  recomputeOutcomeStatus,
  type ActorRef,
  type AgentMessaging,
} from "@outcomego/messaging";
import { outcomeApiError, type OutcomeService } from "./outcome-service";
import { lockOutcome, outcomeWrite } from "./outcome-write";
import { toJson } from "./service-utils";
import { assemblePrereviewReport } from "./outcome-result-summary";

type Tx = Prisma.TransactionClient;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const asBoundaries = (value: unknown) => {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    included: asStringArray(record.included),
    excluded: asStringArray(record.excluded),
  };
};

const CONCLUSION_MAX_CHARS = 50;
const CONCLUSION_ITEM_MAX_CHARS = 30;
const CONCLUSION_ITEM_PATTERN = /^([1-5])[.、)]\s*(.+)$/u;
const FACT_NUMBER_PATTERN = /\d+(?:[.,]\d+)?(?:\s*(?:[%％]|[A-Za-z]+))?/gu;

function validatePrereviewSummary(summary: string, facts: readonly string[]): void {
  const lines = summary.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const numbered = lines.length > 1 || CONCLUSION_ITEM_PATTERN.test(lines[0] ?? "");
  if (!numbered) {
    if (summary.length > CONCLUSION_MAX_CHARS) {
      throw new ApiError(400, "invalid_request", `Review summary must be <= ${CONCLUSION_MAX_CHARS} characters, or use 2-5 numbered items of <= ${CONCLUSION_ITEM_MAX_CHARS} characters each`, { field: "summary" });
    }
  } else {
    if (lines.length < 2 || lines.length > 5) {
      throw new ApiError(400, "invalid_request", "Review summary must be one sentence or 2-5 numbered conclusion items", { field: "summary" });
    }
    for (const [index, line] of lines.entries()) {
      const match = line.match(CONCLUSION_ITEM_PATTERN);
      if (!match || match[1] !== String(index + 1) || match[2]!.length > CONCLUSION_ITEM_MAX_CHARS) {
        throw new ApiError(400, "invalid_request", `Numbered conclusion items must run from 1. through ${lines.length}. and each be <= ${CONCLUSION_ITEM_MAX_CHARS} characters`, { field: "summary" });
      }
    }
  }
  const recordedNumbers = new Set(facts.flatMap((fact) => fact.match(FACT_NUMBER_PATTERN) ?? []));
  if (recordedNumbers.size && ![...recordedNumbers].some((number) => summary.includes(number.replaceAll(" ", "")))) {
    throw new ApiError(400, "invalid_request", "Review summary must include at least one recorded number or date from the reviewed facts", { field: "summary" });
  }
}

/**
 * Reviewer role thread actions (specs/004.9): holistic preliminary review (SubmitPrereview)
 * and deliverable task-level review with at-most-once rejection (ReviewTaskResult).
 */
export class OutcomeTaskReviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outcomes: Pick<OutcomeService, "getInTransaction">,
    private readonly messaging?: AgentMessaging
  ) {}

  async submitPrereview(
    outcomeId: string,
    turnId: string,
    input: SubmitPrereviewInput,
    actor: ActorRef
  ): Promise<OutcomeDetail> {
    return outcomeWrite(
      this.prisma,
      `outcome-prereview-submit:${turnId}`,
      input.clientRequestId,
      { outcomeId, turnId, input, actor },
      async (tx) => {
        const outcome = await lockOutcome(tx, outcomeId);
        if (outcome.status === "accepted" || outcome.status === "cancelled" || outcome.acceptedAt || outcome.cancelledAt) {
          throw outcomeApiError("prereview_stale", `This goal is already ${outcome.status}`);
        }
        const revision = outcome.currentRevisionId
          ? await tx.outcomeContractRevision.findUnique({
              where: { id: outcome.currentRevisionId },
              include: { criteria: { orderBy: { ordinal: "asc" } } },
            })
          : null;
        if (!revision || revision.revision !== input.expectedRevision || revision.status !== "approved") {
          throw outcomeApiError("review_revision_conflict", "The contract revision changed; reload before reviewing", {
            currentRevision: revision?.revision ?? null,
          });
        }
        const turn = await tx.outcomeThreadTurn.findUnique({
          where: { id: turnId },
          include: { thread: { select: { outcomeId: true, role: true, botId: true } } },
        });
        const batch = await readOutcomeReviewBatch(tx, outcomeId, revision.id);
        if (!["review_pending", "decision_pending"].includes(outcome.status) || !batch.hasResults || turn?.thread.outcomeId !== outcomeId || turn.thread.role !== "reviewer" ||
            actor !== `bot:${turn.thread.botId}` || turn.purpose !== "review" ||
            turn.status !== "running" || turn.result !== null || turn.clientRequestId !== batch.key) {
          throw outcomeApiError("prereview_stale", "The results changed or this review has already ended");
        }
        const summary = input.summary.trim();
        if (!summary || summary.length > PLAN_LIMITS.prereviewSummaryChars) {
          throw new ApiError(
            400,
            "invalid_request",
            `Summary must be between 1 and ${PLAN_LIMITS.prereviewSummaryChars} characters`,
            { field: "summary" }
          );
        }

        const criteriaById = new Map(revision.criteria.map((c) => [c.id, c]));
        const previousReviews = await tx.outcomeThreadTurn.findMany({
          where: { threadId: turn.threadId, purpose: "review", status: "completed", id: { not: turnId } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
          select: { result: true },
        });
        const seen = new Set<string>();
        const normalizedResults: Array<{
          criterionId: string;
          suggestion: SubmitPrereviewInput["results"][number]["suggestion"];
          reason: string;
          evidenceIds: string[];
        }> = [];
        const evidenceToCheck = new Set<string>();

        for (const item of input.results) {
          const criterion = criteriaById.get(item.criterionId);
          if (!criterion) {
            throw outcomeApiError("review_revision_conflict", `Unknown criterion ${item.criterionId}`, {
              criterionId: item.criterionId,
            });
          }
          if (seen.has(item.criterionId)) {
            throw outcomeApiError("prereview_incomplete", `Duplicate result for criterion ${item.criterionId}`, {
              criterionId: item.criterionId,
            });
          }
          seen.add(item.criterionId);
          if (!criterion.required && item.suggestion === "likely_fail") {
            throw new ApiError(
              400,
              "invalid_request",
              "likely_fail is only permitted for required acceptance criteria",
              { field: "results", criterionId: item.criterionId }
            );
          }
          const reason = item.reason.trim();
          if (!reason) {
            throw new ApiError(400, "invalid_request", "Each prereview result requires a reason", {
              field: "results",
              criterionId: item.criterionId,
            });
          }
          const evidenceIds = [...new Set(item.evidenceIds ?? [])];
          for (const eid of evidenceIds) evidenceToCheck.add(eid);
          normalizedResults.push({
            criterionId: item.criterionId,
            suggestion: item.suggestion,
            reason,
            evidenceIds,
          });
        }

        const missingIds = revision.criteria.filter((c) => !seen.has(c.id)).map((c) => c.id);
        if (missingIds.length) {
          throw outcomeApiError(
            "prereview_incomplete",
            `Prereview must cover every criterion (missing: ${missingIds.join(", ")})`,
            { missingCriterionIds: missingIds }
          );
        }

        const citedIds = [...new Set([...evidenceToCheck, ...(input.charts ?? []).flatMap(
          (chart) => chart.points.map((point) => point.evidenceId),
        )])];
        const evidence = citedIds.length ? await tx.outcomeEvidence.findMany({
          where: { id: { in: citedIds }, outcomeId, contractRevisionId: revision.id, credibility: { not: "ai_prereview" } },
          select: { id: true, criterionId: true, credibility: true, contentSummary: true, sourceType: true },
        }) : [];
        const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
        const normalizedSignature = JSON.stringify({
          summary,
          results: normalizedResults.map(({ criterionId, suggestion, reason, evidenceIds }) => ({ criterionId, suggestion, reason, evidenceIds })),
        });
        if (previousReviews.some((previous) => {
          if (!previous.result || typeof previous.result !== "object" || Array.isArray(previous.result)) return false;
          const value = previous.result as { summary?: unknown; results?: unknown };
          return JSON.stringify({ summary: value.summary, results: value.results }) === normalizedSignature;
        })) {
          throw new ApiError(409, "prereview_repeated", "Re-read the current report and submit a new conclusion based on its contents", { field: "summary" });
        }
        validatePrereviewSummary(
          summary,
          [...normalizedResults.map((entry) => entry.reason), ...evidence.map((entry) => entry.contentSummary)],
        );
        for (const entry of normalizedResults) {
          const cited = entry.evidenceIds.map((id) => evidenceById.get(id));
          if (cited.some((source) => !source || (source.criterionId && source.criterionId !== entry.criterionId))) {
            throw outcomeApiError("evidence_missing", "Referenced evidence does not belong to this criterion and revision");
          }
          if (entry.suggestion === "likely_pass" && criteriaById.get(entry.criterionId)?.verificationMethod === "deterministic_check" &&
              !cited.some((source) => source?.credibility === "deterministic_check")) {
            throw new ApiError(400, "invalid_request", "Cite evidence from a deterministic check or mark this criterion unclear", { criterionId: entry.criterionId });
          }
        }

        const resultByCriterion = new Map(normalizedResults.map((r) => [r.criterionId, r]));
        const normalizedAttention: Array<{ criterionId?: string; question: string }> = [];
        for (const item of input.attention) {
          const question = item.question.trim();
          if (!question) {
            throw new ApiError(400, "invalid_request", "Attention question must not be empty", { field: "attention" });
          }
          if (!item.criterionId) {
            throw new ApiError(
              400,
              "invalid_request",
              "Attention items must cite a likely_fail or unclear required criterion; put optional notes in summary.",
              { field: "attention" }
            );
          }
          const criterion = criteriaById.get(item.criterionId);
          const result = resultByCriterion.get(item.criterionId);
          if (
            !criterion ||
            !criterion.required ||
            !result ||
            (result.suggestion !== "likely_fail" && result.suggestion !== "unclear")
          ) {
            throw new ApiError(
              400,
              "invalid_request",
              "Attention items may only reference likely_fail or unclear required criteria",
              { field: "attention", criterionId: item.criterionId }
            );
          }
          normalizedAttention.push({ criterionId: item.criterionId, question });
        }

        for (const entry of normalizedResults) {
          await tx.outcomeEvidence.create({
            data: {
              outcomeId,
              contractRevisionId: revision.id,
              criterionId: entry.criterionId,
              sourceType: "prereview",
              sourceRef: `prereview:${turnId}:${entry.criterionId}`,
              contentSummary: `${entry.suggestion}: ${entry.reason}`,
              credibility: "ai_prereview",
              capturedBy: actor,
            },
          });
        }

        await tx.outcomeThreadTurn.update({
          where: { id: turnId },
          data: {
            result: toJson({
              revision: revision.revision,
              summary,
              attention: normalizedAttention,
              results: normalizedResults,
              report: {
                ...assemblePrereviewReport(outcomeId, revision.id, turnId, summary, normalizedResults, evidence, input.charts ?? []),
                attention: normalizedAttention.map(({ question }) => question),
              },
            }),
          },
        });

        await appendOutcomeEvent(tx, "outcome.prereview.submitted", outcomeId, {
          actor,
          contractRevision: revision.revision,
          idempotencyKey: input.clientRequestId,
          payload: {
            revision: revision.revision,
            turnId,
            suggestions: normalizedResults.map((r) => ({ criterionId: r.criterionId, suggestion: r.suggestion })),
          },
        });
        return this.outcomes.getInTransaction(tx, outcomeId);
      }
    );
  }

  async reviewTaskResult(
    outcomeId: string,
    turnId: string,
    expectedWorkItemId: string | null,
    input: ReviewTaskResultInput,
    actor: ActorRef
  ): Promise<OutcomeDetail> {
    if (expectedWorkItemId && expectedWorkItemId !== input.workItemId) {
      throw new ApiError(403, "outcome_thread_scope", "This review turn belongs to a different work item");
    }
    return outcomeWrite(
      this.prisma,
      `outcome-task-review:${input.workItemId}`,
      input.clientRequestId,
      { outcomeId, turnId, input },
      async (tx) => {
        const outcome = await lockOutcome(tx, outcomeId);
        if (outcome.cancelledAt || outcome.acceptedAt || outcome.status === "accepted" || outcome.status === "cancelled") {
          throw outcomeApiError("review_task_stale", `This goal is already ${outcome.status}`);
        }
        const workItem = await tx.outcomeWorkItem.findUnique({
          where: { id: input.workItemId },
          include: { contractRevision: { include: { criteria: { orderBy: { ordinal: "asc" } } } } },
        });
        if (
          !workItem ||
          workItem.outcomeId !== outcomeId ||
          workItem.contractRevisionId !== outcome.currentRevisionId ||
          workItem.contractRevision.status !== "approved"
        ) {
          throw outcomeApiError("review_task_stale", "Task review is stale because the goal contract changed");
        }
        if (workItem.status !== "completed") {
          throw outcomeApiError("review_task_stale", `Work item status is ${workItem.status}, cannot record review`);
        }

        const existingRework = await tx.outcomeWorkItem.findFirst({
          where: { reworkOfWorkItemId: workItem.id },
          select: { id: true },
        });
        if (existingRework) {
          throw outcomeApiError("review_reject_exhausted", "A work item can be rejected at most once");
        }

        const plan = parseOutcomePlan(workItem.contractRevision.plan);
        const planTask = workItem.planKey ? plan?.tasks.find((task) => task.key === workItem.planKey) : undefined;
        const note = input.note?.trim() || undefined;

        if (input.verdict === "pass") {
          await tx.outcomeThreadTurn.update({
            where: { id: turnId },
            data: {
              result: toJson({
                verdict: "pass",
                findings: [],
                ...(note ? { note } : {}),
              }),
            },
          });
          await appendOutcomeEvent(tx, "outcome.task_review.decided", outcomeId, {
            actor,
            contractRevision: workItem.contractRevision.revision,
            workItemId: workItem.id,
            idempotencyKey: input.clientRequestId,
            payload: { workItemId: workItem.id, verdict: "pass" },
          });
          const status = await recomputeOutcomeStatus(tx, outcomeId, actor);
          if (status === "review_pending") {
            await emitReviewRequiredIfNeeded(
              tx,
              outcomeId,
              workItem.contractRevisionId,
              workItem.contractRevision.revision,
              this.messaging
            );
          }
          if (this.messaging) {
            await dispatchQueuedOutcomeWorkItems(tx, this.messaging, workItem.botId, outcomeId);
          }
          return this.outcomes.getInTransaction(tx, outcomeId);
        }

        // Rejection path validation
        if (workItem.kind === "rework" || workItem.reworkOfWorkItemId) {
          throw outcomeApiError("review_not_rejectable", "Rework work items cannot be rejected");
        }
        if (!planTask || planTask.nature !== "deliverable") {
          throw outcomeApiError("review_not_rejectable", "Only deliverable plan tasks can be rejected");
        }
        if (!input.findings.length) {
          throw new ApiError(400, "invalid_request", "Rejecting a task requires at least one serious error or omission finding", {
            field: "findings",
          });
        }

        const coveredIds = new Set(planTask.covers);
        const criteriaById = new Map(workItem.contractRevision.criteria.map((c) => [c.id, c]));
        const boundaries = asBoundaries(workItem.contractRevision.boundaries);
        const normalizedFindings: TaskReviewFinding[] = [];
        const findingDescriptions: string[] = [];

        for (const finding of input.findings) {
          const reason = finding.reason.trim();
          if (!reason) {
            throw new ApiError(400, "invalid_request", "Every finding requires a reason", { field: "findings" });
          }
          if ("criterionId" in finding.basis) {
            const criterion = criteriaById.get(finding.basis.criterionId);
            if (!criterion) {
              throw outcomeApiError("review_not_rejectable", "Finding cites an unknown criterion", {
                criterionId: finding.basis.criterionId,
              });
            }
            if (!criterion.required) {
              throw outcomeApiError("review_not_rejectable", "Optional criteria cannot justify task rejection", {
                criterionId: criterion.id,
              });
            }
            if (!coveredIds.has(criterion.id)) {
              throw outcomeApiError("review_not_rejectable", "Rejection criterion is not covered by this task", {
                criterionId: criterion.id,
              });
            }
            normalizedFindings.push({
              kind: finding.kind,
              basis: { criterionId: criterion.id },
              reason,
            });
            findingDescriptions.push(
              `${findingDescriptions.length + 1}. [${finding.kind}] Required criterion: ${criterion.statement}\n   Reason: ${reason}`
            );
          } else {
            const { side, index } = finding.basis.boundary;
            const list = boundaries[side];
            if (index < 0 || index >= list.length) {
              throw outcomeApiError("review_not_rejectable", "Finding cites a nonexistent contract boundary index", {
                boundary: finding.basis.boundary,
              });
            }
            normalizedFindings.push({
              kind: finding.kind,
              basis: { boundary: { side, index } },
              reason,
            });
            findingDescriptions.push(
              `${findingDescriptions.length + 1}. [${finding.kind}] Contract boundary (${side}): ${list[index]}\n   Reason: ${reason}`
            );
          }
        }

        // Note is strictly isolated from rework instructions (never sent to executing bot).
        const reworkInstructions = [
          "The reviewer rejected this deliverable once due to the serious error(s)/omission(s) listed below.",
          "Fix only these findings under the unchanged approved contract and preserve other parts that already work.",
          "Original task instructions:",
          workItem.instructions,
          "Reviewer findings:",
          findingDescriptions.join("\n"),
        ].join("\n\n");

        const last = await tx.outcomeWorkItem.aggregate({ where: { outcomeId }, _max: { ordinal: true } });
        const reworkItem = await tx.outcomeWorkItem.create({
          data: {
            outcomeId,
            contractRevisionId: workItem.contractRevisionId,
            botId: workItem.botId,
            executorType: "agent",
            kind: "rework",
            status: "queued",
            title: `Rework: ${workItem.title}`.slice(0, 200),
            instructions: reworkInstructions,
            ordinal: (last._max.ordinal ?? 0) + 1,
            reworkOfWorkItemId: workItem.id,
          },
        });
        await appendOutcomeEvent(tx, "outcome.work_item.created", outcomeId, {
          actor,
          contractRevision: workItem.contractRevision.revision,
          workItemId: reworkItem.id,
          idempotencyKey: `rework-create:${input.clientRequestId}`,
          payload: { workItemId: reworkItem.id, executorType: "agent", kind: "rework" },
        });
        if (this.messaging) {
          await enqueueOutcomeTurn(tx, this.messaging, {
            workItemId: reworkItem.id,
            content: reworkInstructions,
            reason: "rework",
            clientId: `task-review-rework:${workItem.id}`,
          });
        }

        await tx.outcomeThreadTurn.update({
          where: { id: turnId },
          data: {
            result: toJson({
              verdict: "reject",
              findings: normalizedFindings,
              reworkWorkItemId: reworkItem.id,
              ...(note ? { note } : {}),
            }),
          },
        });
        await appendOutcomeEvent(tx, "outcome.task_review.decided", outcomeId, {
          actor,
          contractRevision: workItem.contractRevision.revision,
          workItemId: workItem.id,
          idempotencyKey: input.clientRequestId,
          payload: {
            workItemId: workItem.id,
            verdict: "reject",
            findings: normalizedFindings,
            reworkWorkItemId: reworkItem.id,
          },
        });
        await recomputeOutcomeStatus(tx, outcomeId, actor);
        return this.outcomes.getInTransaction(tx, outcomeId);
      }
    );
  }
}
