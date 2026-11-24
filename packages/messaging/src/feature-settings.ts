import {
  ApiError,
  type FeatureSettingsView,
  type InferenceModelSelection,
  normalizeInferenceModelId,
  normalizeInferenceProviderId,
  normalizePiReasoningLevel,
  type UpdateFeatureSettingsInput,
} from "@outcomego/contracts";
import { mergeTaskPolicy, validateTaskPolicyUpdate, type TaskPolicyUpdate } from "@outcomego/contracts/task-policy";
import { Prisma, type PrismaClient } from "@outcomego/db";

// `$executeRaw` is only needed when the task policy is written; reads and the other settings use `featureSettings`.
type FeatureDb = Pick<PrismaClient | Prisma.TransactionClient, "featureSettings"> &
  Partial<Pick<PrismaClient | Prisma.TransactionClient, "$executeRaw">>;

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
  taskPolicy?: unknown;
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
  // Only the keys the owner changed, with anything unknown or out of range dropped. Missing keys mean "initial value".
  taskPolicy: mergeTaskPolicy(row?.taskPolicy, {}) as Record<string, number | boolean | string>,
  updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
});

export const readFeatureSettings = async (db: FeatureDb): Promise<FeatureSettingsView> =>
  featureSettingsView(
    (await db.featureSettings.findUnique({ where: { id: "global" } })) as FeatureSettingsRow | null
  );

export const readOutcomesEnabled = async (db: FeatureDb): Promise<boolean> =>
  (await readFeatureSettings(db)).outcomesEnabled;

/**
 * Merges a policy update into the stored overrides in one statement, so two concurrent updates to different
 * keys can't overwrite each other and the first write can create the row. A value sets its key; null removes it.
 */
const writeTaskPolicy = async (db: FeatureDb, update: TaskPolicyUpdate): Promise<void> => {
  if (!db.$executeRaw) throw new Error("This database handle cannot write the task policy");
  const entries = Object.entries(update).filter(([, value]) => value !== undefined);
  const set = Object.fromEntries(entries.filter(([, value]) => value !== null));
  const remove = entries.filter(([, value]) => value === null).map(([key]) => key);
  const setJson = JSON.stringify(set);
  const removeJson = JSON.stringify(remove);
  await db.$executeRaw`
    INSERT INTO "outcomego_feature_settings" ("id", "outcomesEnabled", "streamBotReplies", "taskPolicy", "updatedAt")
    VALUES ('global', false, false, ${setJson}::jsonb, now())
    ON CONFLICT ("id") DO UPDATE SET
      "taskPolicy" = (COALESCE("outcomego_feature_settings"."taskPolicy", '{}'::jsonb) || ${setJson}::jsonb)
        - ARRAY(SELECT jsonb_array_elements_text(${removeJson}::jsonb)),
      "updatedAt" = now()`;
};

export const updateFeatureSettings = async (
  db: FeatureDb,
  input: UpdateFeatureSettingsInput
): Promise<FeatureSettingsView> => {
  // Refuse a bad policy before anything is written, naming every bad key and its allowed range.
  if (input.taskPolicy !== undefined) {
    const checked = validateTaskPolicyUpdate(input.taskPolicy as TaskPolicyUpdate);
    if (!checked.ok)
      throw new ApiError(400, "invalid_task_policy", "A policy value is unknown or outside its allowed range", {
        errors: checked.errors,
      });
  }
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
  const otherSettingsChanged = Object.keys(data).length > 0;
  const upserted =
    otherSettingsChanged || input.taskPolicy === undefined
      ? await db.featureSettings.upsert({ where: { id: "global" }, create: createData, update: data })
      : null;
  if (input.taskPolicy === undefined) return featureSettingsView(upserted);
  await writeTaskPolicy(db, input.taskPolicy as TaskPolicyUpdate);
  return readFeatureSettings(db);
};
