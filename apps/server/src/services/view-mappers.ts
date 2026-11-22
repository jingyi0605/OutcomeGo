import type { ChannelMessageView } from "@outcomego/contracts";
import {
  type BotView,
  type ChannelView,
  type InferenceModelSelection,
  normalizePiReasoningLevel,
  resolveBotAvatarMark,
  type ServerInferenceSettings,
} from "@outcomego/contracts";
import type { Prisma } from "@outcomego/db";

export const serialize = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_key, nested) =>
      typeof nested === "bigint" ? nested.toString() : nested
    )
  ) as T;

export const toChannelView = (channel: {
  id: string;
  kind: ChannelView["kind"];
  name: string;
  description: string;
  notificationsMuted?: boolean;
  avatarPath?: string | null;
  directKey: string | null;
  workingDirectory: string | null;
  hiddenFromSidebar?: boolean;
  members: Array<{ botId: string; ordinal: number }>;
  createdAt: Date;
  updatedAt: Date;
}): ChannelView => ({
  id: channel.id,
  kind: channel.kind,
  name: channel.name,
  description: channel.description,
  notificationsMuted: channel.notificationsMuted,
  hasAvatar: Boolean(channel.avatarPath),
  directKey: channel.directKey,
  workingDirectory: channel.workingDirectory,
  hiddenFromSidebar: channel.kind === "agent_dm",
  members: channel.members.map(({ botId, ordinal }) => ({ botId, ordinal })),
  createdAt: channel.createdAt.toISOString(),
  updatedAt: channel.updatedAt.toISOString(),
});

export type BotWithConversation = Prisma.BotGetPayload<{
  include: {
    conversation: true;
    channelMemberships: { include: { channel: true } };
  };
}>;

export const botConfiguredModel = (bot: {
  inferenceProvider?: string | null;
  inferenceModel?: string | null;
  inferenceReasoning?: string | null;
}): InferenceModelSelection | null => {
  if (!bot.inferenceProvider || !bot.inferenceModel) return null;
  let reasoning: InferenceModelSelection["reasoning"];
  if (bot.inferenceReasoning) {
    try {
      reasoning = normalizePiReasoningLevel(bot.inferenceReasoning);
    } catch {
      reasoning = undefined;
    }
  }
  return {
    providerId: bot.inferenceProvider,
    modelId: bot.inferenceModel,
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
};

export const botEffectiveModel = (
  botModel: InferenceModelSelection | null,
  globalInference?: ServerInferenceSettings | null
): ServerInferenceSettings | null => {
  if (!globalInference) return null;
  if (!botModel) return globalInference;
  return {
    providerId: botModel.providerId,
    modelId: botModel.modelId,
    reasoning: botModel.reasoning ?? globalInference.reasoning,
  };
};

export const toBotView = (
  bot: BotWithConversation,
  globalInference?: ServerInferenceSettings | null
): BotView => {
  const avatar = resolveBotAvatarMark({
    agentId: bot.id,
    avatarShape: bot.icon,
    avatarColor: bot.color,
  });
  const model = botConfiguredModel(bot);
  const effectiveModel = botEffectiveModel(model, globalInference);

  return {
    id: bot.id,
    name: bot.name,
    title: bot.title,
    description: bot.description,
    instructions: bot.instructions,
    voice: bot.voice,
    icon: avatar.shape,
    color: avatar.color,
    hasAvatar: Boolean(bot.avatarPath),
    notificationsEnabled: bot.notificationsEnabled,
    hiddenFromSidebar: false,
    draftingDisabled: bot.draftingDisabled,
    draftAllowedRecipients: bot.draftAllowedRecipients,
    defaultDirectory: bot.defaultDirectory,
    status: bot.status,
    onboardingStatus: bot.onboardingStatus,
    onboardingVersion: bot.onboardingVersion,
    onboardingCompletedAt: bot.onboardingCompletedAt?.toISOString() ?? null,
    provisioningError: bot.provisioningError,
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
    conversationId: bot.conversation!.id,
    dmChannelId: bot.channelMemberships.find((membership) => membership.channel.kind === "bot_dm")!
      .channelId,
    model,
    ...(effectiveModel !== null ? { effectiveModel } : {}),
  };
};

export const toChannelMessageView = (message: {
  id: string;
  clientId?: string | null;
  sequence: bigint;
  channelId: string;
  sender: string;
  senderBotId: string | null;
  sourceRunId: string | null;
  content: string;
  metadata: unknown;
  createdAt: Date;
}): ChannelMessageView => ({
  id: message.id,
  ...(typeof message.clientId === "string" ? { clientId: message.clientId } : {}),
  sequence: message.sequence.toString(),
  channelId: message.channelId,
  sender: message.sender as ChannelMessageView["sender"],
  senderBotId: message.senderBotId,
  sourceRunId: message.sourceRunId,
  content: message.content,
  metadata: message.metadata,
  createdAt: message.createdAt.toISOString(),
});
