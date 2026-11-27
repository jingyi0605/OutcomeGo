import { describe, expect, test } from "bun:test";
import { featureSettingsView, updateFeatureSettings } from "../src/feature-settings";

describe("goal management default", () => {
  test("is on while nothing is stored, and a saved choice wins", () => {
    expect(featureSettingsView(null).outcomesEnabled).toBe(true);
    expect(featureSettingsView({ outcomesEnabled: false }).outcomesEnabled).toBe(false);
    expect(featureSettingsView({ outcomesEnabled: true }).outcomesEnabled).toBe(true);
  });

  test("stays on when the first saved setting is a different one", async () => {
    const db = {
      featureSettings: { upsert: async ({ create }: { create: Record<string, unknown> }) => ({ ...create, updatedAt: null }) },
    } as unknown as Parameters<typeof updateFeatureSettings>[0];
    expect((await updateFeatureSettings(db, { streamBotReplies: true })).outcomesEnabled).toBe(true);
    expect((await updateFeatureSettings(db, { outcomesEnabled: false })).outcomesEnabled).toBe(false);
  });
});
