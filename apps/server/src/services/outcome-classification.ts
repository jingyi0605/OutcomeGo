import { ApiError } from "@outcomego/contracts";
import type { OutcomeTriageResult } from "@outcomego/contracts/outcome-plan";
import type { ClassifyOutcomeInput, OutcomeThreadTurnView } from "@outcomego/contracts/outcome-thread";
import { outcomeKindRequiresBot } from "@outcomego/contracts/outcome-view";
import type { Outcome, Prisma, PrismaClient } from "@outcomego/db";
import type { ActorRef } from "@outcomego/messaging";
import { outcomeApiError, type OutcomeService } from "./outcome-service";
import { lockOutcome, outcomeWrite } from "./outcome-write";
import { metadataRecord, toJson } from "./service-utils";

type Tx = Prisma.TransactionClient;
type ClassifierContext = { runId: string; botId: string };
type EnqueueContractPlan = (id: string, input: { mode: "contract_plan"; expectedRevision: number; clientRequestId: string }, actor: ActorRef) => Promise<OutcomeThreadTurnView>;
type ClassificationReceipt = { result: OutcomeTriageResult; owner: ActorRef; followUp: Array<{ id: string; revision: number }> };

const denied = () => new ApiError(403, "outcome_thread_tool_forbidden", "Classification requires the planner's own Go intake triage turn");
const turnInclude = {
  thread: { select: { role: true, outcomeId: true } },
  run: { select: { id: true, botId: true, status: true, origin: true, outcomeThreadId: true } },
} satisfies Prisma.OutcomeThreadTurnInclude;

function sourceOwner(source: Outcome): ActorRef {
  if (source.ownerId === "local" && source.createdBy === "owner:local") return "owner:local";
  if (source.createdBy === `user:${source.ownerId}`) return `user:${source.ownerId}`;
  throw denied();
}

export class OutcomeClassificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outcomes: Pick<OutcomeService, "createInTransaction" | "applyIntakeClassificationInTransaction">,
    private readonly enqueuePlan: EnqueueContractPlan,
  ) {}

  async classify(context: ClassifierContext, input: ClassifyOutcomeInput): Promise<OutcomeTriageResult> {
    const turn = await this.boundTurn(this.prisma, context);
    const { clientRequestId: _clientRequestId, ...semanticInput } = input;
    const receipt = await outcomeWrite<ClassificationReceipt>(this.prisma, "outcome-classify", turn.id,
      { botId: context.botId, input: semanticInput }, async (tx) => {
        const source = await lockOutcome(tx, turn.thread.outcomeId);
        const current = await this.boundTurn(tx, context);
        if (current.id !== turn.id || current.thread.outcomeId !== source.id || current.status !== "running" || current.run?.status !== "running") throw denied();
        const meta = metadataRecord(source.kindMeta);
        if (meta.createdVia !== "owner_go_inbox") throw denied();
        if (current.outcomeRevision !== source.revision) throw outcomeApiError("outcome_revision_conflict", "This intake changed after triage started", { currentRevision: source.revision });
        if (source.kind !== "note" || source.status !== "active" || (meta.triageStatus !== "pending" && meta.triageStatus !== "failed")) throw denied();
        if (current.result !== null) throw new ApiError(409, "idempotency_conflict", "This triage turn already classified its intake");
        return this.apply(tx, source, current.id, context.botId, input);
      });

    await Promise.all(receipt.followUp.map(async ({ id, revision }) => {
      try {
        await this.enqueuePlan(id, {
          mode: "contract_plan", expectedRevision: revision, clientRequestId: `outcome-classify-plan:${turn.id}:${id}:${revision}`,
        }, receipt.owner);
      } catch (error) {
        console.warn("outcome.classification_plan_enqueue_failed", { outcomeId: id, turnId: turn.id, code: error instanceof ApiError ? error.code : "enqueue_failed" });
      }
    }));
    return receipt.result;
  }

  private async boundTurn(db: Pick<Tx, "outcomeThreadTurn">, context: ClassifierContext) {
    const turn = await db.outcomeThreadTurn.findUnique({ where: { runId: context.runId }, include: turnInclude });
    if (!turn || turn.planMode !== "triage" || turn.thread.role !== "planner" || !turn.run ||
      turn.run.botId !== context.botId || turn.run.origin !== "outcome_thread" || turn.run.outcomeThreadId !== turn.threadId) throw denied();
    return turn;
  }

  private async apply(tx: Tx, source: Outcome, turnId: string, botId: string, input: ClassifyOutcomeInput): Promise<ClassificationReceipt> {
    const owner = sourceOwner(source);
    const planner: ActorRef = `bot:${botId}`;
    const classificationRequestId = `outcome-classify:${turnId}`;
    const memorySummary = input.memoryFacts?.map((fact) => fact.trim()).join("; ");
    const change = { expectedRevision: source.revision, clientRequestId: classificationRequestId, memorySummary };
    const common = {
      schemaVersion: 1 as const, sourceOutcomeId: source.id, summary: input.summary.trim(),
      ...(input.memoryFacts?.length ? { memoryFacts: input.memoryFacts } : {}),
    };
    const targetBotId = (target: { kind: Outcome["kind"]; botId?: string | null | undefined }) => {
      if (target.botId) return target.botId;
      if (outcomeKindRequiresBot(target.kind)) return source.botId ?? botId;
      return target.botId === null ? null : source.botId;
    };
    const followUp: ClassificationReceipt["followUp"] = [];
    let result: OutcomeTriageResult;
    if (input.strategy === "single_convert") {
      const outcome = await this.outcomes.applyIntakeClassificationInTransaction(tx, source.id,
        { ...change, classification: { ...input.outcome, botId: targetBotId(input.outcome) } }, owner, planner);
      if (outcome.kind === "standard") followUp.push({ id: outcome.id, revision: outcome.revision });
      result = { ...common, strategy: "single_convert", sourceKind: outcome.kind, createdChildren: [] };
    } else {
      await this.outcomes.applyIntakeClassificationInTransaction(tx, source.id, { ...change, sourceNote: input.sourceNote }, owner, planner);
      const createdChildren: Extract<OutcomeTriageResult, { strategy: "split_from_note" }>["createdChildren"][number][] = [];
      for (const [ordinal, child] of input.children.entries()) {
        const outcome = await this.outcomes.createInTransaction(tx, {
          ...child, botId: targetBotId(child), parentOutcomeId: source.id, clientRequestId: `${classificationRequestId}:${ordinal}`,
        }, owner);
        if (outcome.kind === "standard") followUp.push({ id: outcome.id, revision: outcome.revision });
        createdChildren.push({ outcomeId: outcome.id, kind: child.kind, title: outcome.title });
      }
      result = { ...common, strategy: "split_from_note", sourceKind: "note", createdChildren };
    }
    await tx.outcomeThreadTurn.update({ where: { id: turnId }, data: { result: toJson(result) } });
    await tx.event.create({ data: {
      topic: "goal.updated", entityId: source.id,
      payload: toJson({ outcomeId: source.id, actor: planner, triageStatus: "completed", triageSummary: result.summary, createdChildren: result.createdChildren, sourceKind: result.sourceKind }),
    } });
    return { result, owner, followUp };
  }
}
