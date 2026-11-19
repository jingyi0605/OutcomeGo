import type { FeatureSettingsView } from "@outcomego/contracts";
import type { Prisma, PrismaClient } from "@outcomego/db";

type FeatureDb = Pick<PrismaClient | Prisma.TransactionClient, "featureSettings">;

/** Every optional module is off until the owner switches it on. */
export const featureSettingsView = (
  row: { outcomesEnabled: boolean } | null
): FeatureSettingsView => ({ outcomesEnabled: row?.outcomesEnabled ?? false });

export const readFeatureSettings = async (db: FeatureDb): Promise<FeatureSettingsView> =>
  featureSettingsView(await db.featureSettings.findUnique({ where: { id: "global" } }));

export const readOutcomesEnabled = async (db: FeatureDb): Promise<boolean> =>
  (await readFeatureSettings(db)).outcomesEnabled;

export const updateFeatureSettings = async (
  db: FeatureDb,
  input: { outcomesEnabled?: boolean }
): Promise<FeatureSettingsView> => {
  const data = input.outcomesEnabled === undefined ? {} : { outcomesEnabled: input.outcomesEnabled };
  return featureSettingsView(
    await db.featureSettings.upsert({
      where: { id: "global" },
      create: { id: "global", ...data },
      update: data,
    })
  );
};
