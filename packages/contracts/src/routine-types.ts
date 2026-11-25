/** Public routine owner represented by the API. */
export type RoutineOwnerKind = "bot" | "group";

export const DATED_ROUTINE_CRON = /^\s*[0-9]+\s+[0-9]+\s+[0-9]+\s+[0-9]+\s+[*]\s*$/;

export function isDatedRoutineCron(routine: {
  scheduleKind: string;
  cronExpression: string | null;
  trigger?: unknown;
}): boolean {
  return routine.scheduleKind === "cron" &&
    (routine.trigger as { type?: unknown } | null | undefined)?.type === "cron" &&
    DATED_ROUTINE_CRON.test(routine.cronExpression ?? "");
}

export interface OnceRoutineTrigger {
  type: "once";
  runAt: string;
  preparation?: { at: string; instruction: string };
}

export function isOnceTrigger(value: unknown): value is OnceRoutineTrigger & Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const trigger = value as Partial<OnceRoutineTrigger>;
  return trigger.type === "once" && typeof trigger.runAt === "string";
}

export interface RoutineExecutionView {
  id: string;
  routineId: string;
  runId: string | null;
  kind: "scheduled" | "test" | "preparation";
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "skipped";
  scheduledFor: string;
  enqueuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  skipReason: string | null;
  error: unknown;
  createdAt: string;
  revision?: number;
  result?: { summary: string | null; delivered: boolean };
}

/** Portable API projection. Scheduling and persistence behavior remain server-side. */
export interface RoutineView {
  id: string;
  folder: string;
  ownerId: string;
  ownerKind: RoutineOwnerKind;
  botId: string | null;
  channelId: string | null;
  name: string;
  prompt: string;
  schedule: string;
  schedules: string[];
  scheduleKind: "cron" | "interval" | "event" | "once";
  onceStartedAt?: string | null;
  cronExpression: string | null;
  intervalSeconds: number | null;
  timezone: string;
  timezoneMode: string;
  enabled: boolean;
  validationError?: string | null;
  revision: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestExecution: RoutineExecutionView | null;
  trigger?: unknown;
  triggerPresentation: unknown;
}

export interface ScheduledGoalSummary {
  id: string;
  name: string;
  botId: string;
  runAt: string | null;
  state: "scheduled" | "waiting" | "preparing" | "paused" | "running" | "completed" | "failed" | "skipped" | "cancelled";
}

export interface ScheduledGoalDetail extends ScheduledGoalSummary {
  routine: RoutineView;
  executions: RoutineExecutionView[];
}

export interface CreateRoutineInput {
  name: string;
  prompt: string;
  schedule?: string;
  trigger?: unknown;
  presentation?: unknown;
  enabled: boolean;
}

export interface UpdateRoutineInput {
  name?: string;
  prompt?: string;
  schedule?: string;
  trigger?: unknown;
  presentation?: unknown;
  enabled?: boolean;
  expectedRevision: number;
}
