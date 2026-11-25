import {
  PLAN_ESTIMATE_MINUTES,
  parseOffsetTimestamp,
  type OutcomeDetail,
  type SetOutcomeDueInput,
  type SetWorkItemScheduleInput,
} from "@outcomego/contracts/outcomes";
import { MISSED_SCHEDULE_CONFIRMED_REASON, MISSED_SCHEDULE_REASON_CODE } from "@outcomego/contracts/outcome-inbox";
import type { Prisma, PrismaClient } from "@outcomego/db";
import {
  DEFERRED_BY_AGENT_REASON,
  appendOutcomeEvent,
  publishGoalScheduleChanged,
  closeOutcomeDecision,
  enqueueOutcomeTurn,
  type ActorRef,
  type AgentMessaging,
  type EnqueueOutcomeTurnInput,
} from "@outcomego/messaging";
import { outcomeApiError, type OutcomeService } from "./outcome-service";
import { lockOutcome, outcomeWrite } from "./outcome-write";

type Tx = Prisma.TransactionClient;
type ScheduleField = "scheduledAt" | "dueAt" | "estimateMinutes";

/** Human tasks the owner can still plan around: nothing has been handed in yet, or it was sent back. */
const EDITABLE_HUMAN_STATUSES = ["pending", "ready", "in_progress", "paused", "rejected"];
const activeRunStatuses = ["queued", "running"] as const;

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * The owner moves a task that has not started, or sets the goal's deadline (specs/004.10 design §5.5). Neither
 * touches the contract, its hash or any approval: these are dates and an estimate, not scope.
 */
export class OutcomeScheduleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outcomes: Pick<OutcomeService, "getInTransaction">,
    private readonly messaging?: AgentMessaging
  ) {}

  /**
   * A field left out is unchanged and `null` clears it. Moving a held bot task replaces the start it is holding with
   * the same content under a new request ID, so a task moved to a time that has passed starts now, exactly once.
   */
  async setWorkItemSchedule(outcomeId: string, workItemId: string, input: SetWorkItemScheduleInput, actor: ActorRef): Promise<OutcomeDetail> {
    return outcomeWrite(this.prisma, `outcome-schedule:${outcomeId}`, input.clientRequestId, { workItemId, ...input }, async (tx) => {
      await this.requireOpenOutcome(tx, outcomeId);
      const item = await this.lockWorkItem(tx, outcomeId, workItemId);
      await this.requireEditable(tx, item);

      const next = this.resolveNext(item, input);
      const current = { scheduledAt: item.scheduledAt, dueAt: item.dueAt, estimateMinutes: item.estimateMinutes };
      const changed = (["scheduledAt", "dueAt", "estimateMinutes"] as const).filter((field) => {
        const a = current[field] instanceof Date ? (current[field] as Date).getTime() : current[field];
        const b = next[field] instanceof Date ? (next[field] as Date).getTime() : next[field];
        return a !== b;
      });
      if (!changed.length) return this.outcomes.getInTransaction(tx, outcomeId);

      const now = Date.now();
      const scheduledChanged = changed.includes("scheduledAt");
      const wasHeldForOwner = item.statusReason === MISSED_SCHEDULE_REASON_CODE || item.statusReason === MISSED_SCHEDULE_CONFIRMED_REASON;
      let statusReason: string | null | undefined;
      if (scheduledChanged && item.statusReason !== DEFERRED_BY_AGENT_REASON && item.executorType === "agent") {
        // A time that has passed is the owner's own call to go now, so it is not judged late and not asked again.
        // Any other change returns a task that was waiting on the owner to the normal schedule.
        if (next.scheduledAt && next.scheduledAt.getTime() <= now) statusReason = MISSED_SCHEDULE_CONFIRMED_REASON;
        else if (wasHeldForOwner) statusReason = null;
      }
      if (wasHeldForOwner && scheduledChanged && item.executorType === "agent") await this.closeMissedScheduleDecision(tx, item.id, actor);

      await tx.outcomeWorkItem.update({
        where: { id: item.id },
        data: {
          scheduledAt: next.scheduledAt,
          dueAt: next.dueAt,
          estimateMinutes: next.estimateMinutes,
          ...(changed.includes("dueAt") || scheduledChanged ? { inspectionRevisionId: null } : {}),
          ...(statusReason !== undefined ? { statusReason } : {}),
        },
      });
      await publishGoalScheduleChanged(tx, outcomeId);
      await appendOutcomeEvent(tx, "outcome.schedule.changed", outcomeId, {
        actor,
        contractRevision: item.contractRevision.revision,
        workItemId: item.id,
        idempotencyKey: `schedule:${item.id}:${input.clientRequestId}`,
        payload: {
          target: "work_item",
          workItemId: item.id,
          scheduledAt: iso(next.scheduledAt),
          dueAt: iso(next.dueAt),
          estimateMinutes: next.estimateMinutes,
          previous: { scheduledAt: iso(current.scheduledAt), dueAt: iso(current.dueAt), estimateMinutes: current.estimateMinutes },
          source: "owner",
        },
      });
      if (item.executorType === "agent" && scheduledChanged) await this.reissueHeldStart(tx, item.id, input.clientRequestId);
      return this.outcomes.getInTransaction(tx, outcomeId);
    });
  }

  /** Sets or clears the goal's deadline. A deadline that has passed is allowed: the goal is simply overdue. */
  async setOutcomeDue(outcomeId: string, input: SetOutcomeDueInput, actor: ActorRef): Promise<OutcomeDetail> {
    return outcomeWrite(this.prisma, `outcome-due:${outcomeId}`, input.clientRequestId, input, async (tx) => {
      const outcome = await this.requireOpenOutcome(tx, outcomeId);
      let dueAt: Date | null = null;
      if (input.dueAt !== null) {
        dueAt = parseOffsetTimestamp(input.dueAt);
        if (!dueAt) throw outcomeApiError("invalid_schedule", "dueAt must be an ISO 8601 time with a UTC offset", { fields: ["dueAt"] });
      }
      if ((outcome.dueAt?.getTime() ?? null) === (dueAt?.getTime() ?? null)) return this.outcomes.getInTransaction(tx, outcomeId);
      await tx.outcome.update({ where: { id: outcomeId }, data: { dueAt, inspectionRevisionId: null } });
      const revision = outcome.currentRevisionId
        ? await tx.outcomeContractRevision.findUnique({ where: { id: outcome.currentRevisionId }, select: { revision: true } })
        : null;
      await publishGoalScheduleChanged(tx, outcomeId);
      await appendOutcomeEvent(tx, "outcome.schedule.changed", outcomeId, {
        actor,
        ...(revision ? { contractRevision: revision.revision } : {}),
        idempotencyKey: `due:${outcomeId}:${input.clientRequestId}`,
        payload: { target: "outcome", dueAt: iso(dueAt), previous: { dueAt: iso(outcome.dueAt) }, source: "owner" },
      });
      return this.outcomes.getInTransaction(tx, outcomeId);
    });
  }

  private async requireOpenOutcome(tx: Tx, outcomeId: string) {
    const outcome = await lockOutcome(tx, outcomeId);
    if (outcome.cancelledAt || outcome.acceptedAt)
      throw outcomeApiError("outcome_not_open", `This goal is ${outcome.acceptedAt ? "accepted" : "cancelled"}`, { currentStatus: outcome.status });
    return outcome;
  }

  private async lockWorkItem(tx: Tx, outcomeId: string, workItemId: string) {
    // The goal's lock is already held; the task's lock follows, the same order every other change uses.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-work-item:${workItemId}`}))`;
    const item = await tx.outcomeWorkItem.findUnique({ where: { id: workItemId }, include: { contractRevision: { select: { revision: true } } } });
    if (!item || item.outcomeId !== outcomeId) throw outcomeApiError("work_item_not_found", "Work item not found");
    return item;
  }

  private async requireEditable(tx: Tx, item: { id: string; executorType: string; status: string }) {
    const editable =
      item.executorType === "agent"
        ? item.status === "queued" && (await tx.run.count({ where: { outcomeWorkItemId: item.id, status: { in: [...activeRunStatuses] } } })) === 0
        : EDITABLE_HUMAN_STATUSES.includes(item.status);
    if (!editable)
      throw outcomeApiError("schedule_not_editable", "This task has already started or finished, so its schedule can no longer change", { currentStatus: item.status });
  }

  /** The three values the task will have, checked for shape, range and order. Nothing is written here. */
  private resolveNext(
    item: { scheduledAt: Date | null; dueAt: Date | null; estimateMinutes: number | null },
    input: SetWorkItemScheduleInput
  ): { scheduledAt: Date | null; dueAt: Date | null; estimateMinutes: number | null } {
    const bad = new Set<ScheduleField>();
    const time = (field: "scheduledAt" | "dueAt", value: string | null | undefined, kept: Date | null): Date | null => {
      if (value === undefined) return kept;
      if (value === null) return null;
      const parsed = parseOffsetTimestamp(value);
      if (!parsed) bad.add(field);
      return parsed;
    };
    const scheduledAt = time("scheduledAt", input.scheduledAt, item.scheduledAt);
    const dueAt = time("dueAt", input.dueAt, item.dueAt);
    let estimateMinutes = item.estimateMinutes;
    if (input.estimateMinutes !== undefined) {
      const value = input.estimateMinutes;
      if (value === null) estimateMinutes = null;
      else if (!Number.isInteger(value) || value < PLAN_ESTIMATE_MINUTES.min || value > PLAN_ESTIMATE_MINUTES.max) bad.add("estimateMinutes");
      else estimateMinutes = value;
    }
    if (!bad.has("scheduledAt") && !bad.has("dueAt") && scheduledAt && dueAt && dueAt.getTime() < scheduledAt.getTime()) bad.add("dueAt");
    if (bad.size) throw outcomeApiError("invalid_schedule", "The schedule is not valid", { fields: [...bad] });
    return { scheduledAt, dueAt, estimateMinutes };
  }

  /** The goal-level decision that asked the owner about this task, if it is still open. */
  private async closeMissedScheduleDecision(tx: Tx, workItemId: string, actor: ActorRef) {
    const open = await tx.outcomeDecision.findUnique({ where: { openWorkItemId: workItemId }, include: { contractRevision: { select: { revision: true } } } });
    if (open && open.reasonCode === MISSED_SCHEDULE_REASON_CODE) await closeOutcomeDecision(tx, open, "withdrawn", actor);
  }

  /**
   * A bot task holds the start it will make when its time comes. Replace it with the same content and reason under a
   * new request ID so the new time takes effect: held again if it is in the future, started now if it has passed.
   */
  private async reissueHeldStart(tx: Tx, workItemId: string, clientRequestId: string) {
    if (!this.messaging) return;
    const pending = await tx.idempotencyRecord.findFirst({ where: { scope: `outcome-turn:${workItemId}`, status: "processing" }, orderBy: { createdAt: "asc" } });
    const held = (pending?.response as { input?: EnqueueOutcomeTurnInput } | null)?.input;
    if (!held) return;
    await tx.idempotencyRecord.deleteMany({ where: { scope: `outcome-turn:${workItemId}`, status: "processing" } });
    await enqueueOutcomeTurn(tx, this.messaging, { ...held, clientId: `reschedule:${workItemId}:${clientRequestId}` });
  }
}
