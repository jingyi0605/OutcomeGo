import { DEFAULT_PI_REASONING_LEVEL, type InferenceModelSelection, type OutcomeThreadTurnModelView } from "@outcomego/contracts";
import type { OutcomeThreadPurpose, OutcomeThreadRole } from "@outcomego/contracts/outcome-thread";
import { OutcomeError } from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { readFeatureSettings } from "./feature-settings";
import type { AgentMessaging } from "./index";

export type RoleDb = Pick<PrismaClient | Prisma.TransactionClient, "bot" | "channel" | "featureSettings">;

export interface ResolvedOutcomeRole {
  status: "disabled" | "configured" | "model_only" | "fallback" | "unset";
  botId: string | null;
  model: InferenceModelSelection | null;
  fallback: boolean;
  fallbackReason?: string;
}

/** Above work-item execution turns (280): the owner is waiting for an answer. */
export const OUTCOME_THREAD_PRIORITY = 290;
/** System-initiated goal-thread turns (replan, review, review_task): below owner messages, above work items. */
export const OUTCOME_THREAD_SYSTEM_PRIORITY = 285;
export const OUTCOME_THREAD_EVENT_TOPIC = "goal.thread.updated";

export const roleForThreadPurpose = (purpose: OutcomeThreadPurpose): OutcomeThreadRole =>
  purpose === "review" || purpose === "review_task" || purpose === "inspection" ? "reviewer" : "planner";

/**
 * Checks whether a bot is an active primary bot with a conversation and active bot_dm channel.
 */
export async function isBotRunnable(
  db: Pick<PrismaClient | Prisma.TransactionClient, "bot" | "channel">,
  botId: string
): Promise<boolean> {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    select: {
      id: true,
      status: true,
      subagentIdentity: { select: { id: true } },
      conversation: { select: { id: true } },
    },
  });
  if (!bot || bot.status !== "active" || bot.subagentIdentity || !bot.conversation) return false;
  const dm = await db.channel.findFirst({
    where: { kind: "bot_dm", archivedAt: null, members: { some: { botId } } },
    select: { id: true },
  });
  return Boolean(dm);
}

/**
 * Resolves the active bot and optional model override for an Outcome thread role.
 * When a configured bot was deleted or is no longer active, falls back cleanly without blocking.
 */
export async function resolveOutcomeRole(
  db: RoleDb,
  role: OutcomeThreadRole,
  outcomeBotId?: string
): Promise<ResolvedOutcomeRole> {
  const settings = await readFeatureSettings(db);
  if (!settings.outcomesEnabled) {
    return { status: "disabled", botId: null, model: null, fallback: false };
  }
  const configuredBotId = role === "planner" ? (settings.plannerBotId ?? null) : (settings.reviewerBotId ?? null);
  const configuredModel = role === "planner" ? (settings.plannerModel ?? null) : (settings.reviewerModel ?? null);

  if (configuredBotId) {
    if (await isBotRunnable(db, configuredBotId)) {
      return {
        status: "configured",
        botId: configuredBotId,
        model: configuredModel,
        fallback: false,
      };
    }
    return {
      status: "fallback",
      botId: role === "planner" ? (outcomeBotId ?? null) : null,
      model: null,
      fallback: true,
      fallbackReason: "configured_bot_not_runnable",
    };
  }

  if (configuredModel) {
    return {
      status: "model_only",
      botId: outcomeBotId ?? null,
      model: configuredModel,
      fallback: false,
    };
  }

  return {
    status: "unset",
    botId: role === "planner" ? (outcomeBotId ?? null) : null,
    model: null,
    fallback: false,
  };
}

/** True when a planning role (bot or independent planner model) is active for new Outcomes. */
export async function hasActivePlannerRole(db: RoleDb): Promise<boolean> {
  const resolved = await resolveOutcomeRole(db, "planner");
  return resolved.status === "configured" || resolved.status === "model_only";
}

export interface EnqueueOutcomeThreadTurnInput {
  outcomeId: string;
  botId: string;
  purpose: OutcomeThreadPurpose;
  text: string;
  actor: string;
  clientRequestId: string;
  model?: InferenceModelSelection | OutcomeThreadTurnModelView | null;
  workItemId?: string | null;
  priority?: number;
  result?: Prisma.InputJsonObject;
}

function serializeTurnModel(
  model: InferenceModelSelection | OutcomeThreadTurnModelView | null | undefined
): Prisma.InputJsonValue | undefined {
  if (!model) return undefined;
  return JSON.parse(
    JSON.stringify({
      providerId: model.providerId,
      modelId: model.modelId,
      reasoning: model.reasoning ?? DEFAULT_PI_REASONING_LEVEL,
      ...("fallback" in model && model.fallback ? { fallback: model.fallback } : {}),
    })
  ) as Prisma.InputJsonValue;
}

/**
 * Records a thread turn and wakes the assigned role bot atomically in the caller's transaction.
 */
export async function enqueueOutcomeThreadTurn(
  tx: Prisma.TransactionClient,
  messaging: AgentMessaging,
  input: EnqueueOutcomeThreadTurnInput
) {
  const role = roleForThreadPurpose(input.purpose);
  let thread = await tx.outcomeThread.upsert({
    where: { outcomeId_role: { outcomeId: input.outcomeId, role } },
    update: {},
    create: { outcomeId: input.outcomeId, role, botId: input.botId },
  });
  let channel = await tx.channel.findFirst({
    where: { kind: "bot_dm", archivedAt: null, members: { some: { botId: thread.botId } } },
    orderBy: { createdAt: "asc" },
  });
  if (thread.botId !== input.botId) {
    const existingBot = await tx.bot.findUnique({ where: { id: thread.botId }, select: { status: true } });
    if (!channel || existingBot?.status !== "active") {
      thread = await tx.outcomeThread.update({
        where: { id: thread.id },
        data: { botId: input.botId },
      });
      channel = await tx.channel.findFirst({
        where: { kind: "bot_dm", archivedAt: null, members: { some: { botId: thread.botId } } },
        orderBy: { createdAt: "asc" },
      });
    }
  }
  if (!channel) throw new OutcomeError("bot_not_runnable", "This Bot has no conversation to work in");
  const modelJson = serializeTurnModel(input.model);
  const turn = await tx.outcomeThreadTurn.create({
    data: {
      threadId: thread.id,
      purpose: input.purpose,
      trigger: input.text,
      triggerBy: input.actor,
      clientRequestId: input.clientRequestId,
      ...(modelJson !== undefined ? { model: modelJson } : {}),
      ...(input.workItemId ? { workItemId: input.workItemId } : {}),
      ...(input.result ? { result: input.result } : {}),
    },
  });
  const priority =
    input.priority ??
    (input.purpose === "plan" || input.purpose === "owner_message"
      ? OUTCOME_THREAD_PRIORITY
      : OUTCOME_THREAD_SYSTEM_PRIORITY);
  // Owner words and role triggers go to the bot without wrappers.
  const wake = await messaging.enqueueWake(tx, {
    botId: thread.botId,
    channelId: channel.id,
    origin: "outcome_thread",
    outcomeThreadId: thread.id,
    type: "outcome.thread_turn",
    content: input.text,
    clientId: `outcome-thread:${turn.id}`,
    priority,
    includeAttachmentPaths: false,
    wrapUserContent: false,
  });
  const linked = await tx.outcomeThreadTurn.update({
    where: { id: turn.id },
    data: { runId: wake.run.id },
  });
  const outcome = await tx.outcome.findUnique({ where: { id: input.outcomeId }, select: { title: true } });
  await tx.event.create({
    data: {
      topic: OUTCOME_THREAD_EVENT_TOPIC,
      entityId: input.outcomeId,
      payload: { outcomeId: input.outcomeId, turnId: turn.id, status: "queued", title: outcome?.title ?? "" },
    },
  });
  return { thread, turn: linked };
}
