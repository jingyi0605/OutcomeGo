import {
  type FeatureSettingsView,
  type InferenceModelSelection,
  normalizeInferenceModelId,
  normalizeInferenceProviderId,
  normalizePiReasoningLevel,
  type UpdateFeatureSettingsInput,
} from "@outcomego/contracts";
import { Prisma, type PrismaClient } from "@outcomego/db";

type FeatureDb = Pick<PrismaClient | Prisma.TransactionClient, "featureSettings">;

export const parseInferenceModelSelection = (raw: unknown): InferenceModelSelection | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.providerId !== "string" || typeof record.modelId !== "string") return null;
  try {
    const providerId = normalizeInferenceProviderId(record.providerId);
    const modelId = normalizeInferenceModelId(record.modelId);
    const reasoning =
      record.reasoning !== undefined ? normalizePiReasoningLevel(record.reasoning) : undefined;
    return {
      providerId,
      modelId,
      ...(reasoning !== undefined ? { reasoning } : {}),
    };
  } catch {
    return null;
  }
};

type FeatureSettingsRow = {
  outcomesEnabled?: boolean | null;
  streamBotReplies?: boolean | null;
  plannerBotId?: string | null;
  reviewerBotId?: string | null;
  plannerModel?: unknown;
  reviewerModel?: unknown;
  environmentNote?: string | null;
  updatedAt?: Date | null;
};

/** Every optional module is off until the owner switches it on. */
export const featureSettingsView = (
  row: FeatureSettingsRow | null
): FeatureSettingsView => ({
  outcomesEnabled: row?.outcomesEnabled ?? false,
  streamBotReplies: row?.streamBotReplies ?? false,
  plannerBotId: row?.plannerBotId ?? null,
  reviewerBotId: row?.reviewerBotId ?? null,
  plannerModel: parseInferenceModelSelection(row?.plannerModel),
  reviewerModel: parseInferenceModelSelection(row?.reviewerModel),
  environmentNote: row?.environmentNote ?? null,
  updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
});

export const readFeatureSettings = async (db: FeatureDb): Promise<FeatureSettingsView> =>
  featureSettingsView(
    (await db.featureSettings.findUnique({ where: { id: "global" } })) as FeatureSettingsRow | null
  );

export const readOutcomesEnabled = async (db: FeatureDb): Promise<boolean> =>
  (await readFeatureSettings(db)).outcomesEnabled;

export const updateFeatureSettings = async (
  db: FeatureDb,
  input: UpdateFeatureSettingsInput
): Promise<FeatureSettingsView> => {
  const data: Prisma.FeatureSettingsUpdateInput = {
    ...(input.outcomesEnabled !== undefined ? { outcomesEnabled: input.outcomesEnabled } : {}),
    ...(input.streamBotReplies !== undefined ? { streamBotReplies: input.streamBotReplies } : {}),
    ...(input.plannerBotId !== undefined ? { plannerBotId: input.plannerBotId } : {}),
    ...(input.reviewerBotId !== undefined ? { reviewerBotId: input.reviewerBotId } : {}),
    ...(input.plannerModel !== undefined
      ? { plannerModel: input.plannerModel === null ? Prisma.DbNull : (input.plannerModel as unknown as Prisma.InputJsonValue) }
      : {}),
    ...(input.reviewerModel !== undefined
      ? { reviewerModel: input.reviewerModel === null ? Prisma.DbNull : (input.reviewerModel as unknown as Prisma.InputJsonValue) }
      : {}),
    ...(input.environmentNote !== undefined
      ? { environmentNote: input.environmentNote === null ? null : input.environmentNote }
      : {}),
  };
  const createData: Prisma.FeatureSettingsCreateInput = {
    id: "global",
    outcomesEnabled: input.outcomesEnabled ?? false,
    streamBotReplies: input.streamBotReplies ?? false,
    ...(input.plannerBotId !== undefined ? { plannerBotId: input.plannerBotId } : {}),
    ...(input.reviewerBotId !== undefined ? { reviewerBotId: input.reviewerBotId } : {}),
    ...(input.plannerModel !== undefined
      ? { plannerModel: input.plannerModel === null ? undefined : (input.plannerModel as unknown as Prisma.InputJsonValue) }
      : {}),
    ...(input.reviewerModel !== undefined
      ? { reviewerModel: input.reviewerModel === null ? undefined : (input.reviewerModel as unknown as Prisma.InputJsonValue) }
      : {}),
    ...(input.environmentNote !== undefined ? { environmentNote: input.environmentNote } : {}),
  };
  return featureSettingsView(
    await db.featureSettings.upsert({
      where: { id: "global" },
      create: createData,
      update: data,
    })
  );
};
