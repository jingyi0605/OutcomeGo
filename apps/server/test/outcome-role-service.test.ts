import { expect, test } from "bun:test";
import { UpdateFeatureSettingsInput } from "@outcomego/contracts";
import { featureSettingsView, updateFeatureSettings } from "@outcomego/messaging";
import { Schema } from "effect";
import { hasActivePlannerRole, isBotRunnable, resolveOutcomeRole } from "../src/services/outcome-role-service";

function makeRoleDb(options: {
  enabled?: boolean;
  plannerBotId?: string | null;
  reviewerBotId?: string | null;
  plannerModel?: { providerId: string; modelId: string; reasoning?: string } | null;
  reviewerModel?: { providerId: string; modelId: string; reasoning?: string } | null;
  environmentNote?: string | null;
  activeBotIds?: string[];
} = {}) {
  const active = new Set(options.activeBotIds ?? []);
  let row: Record<string, any> = {
    id: "global",
    outcomesEnabled: options.enabled ?? true,
    streamBotReplies: false,
    plannerBotId: options.plannerBotId ?? null,
    reviewerBotId: options.reviewerBotId ?? null,
    plannerModel: options.plannerModel ?? null,
    reviewerModel: options.reviewerModel ?? null,
    environmentNote: options.environmentNote ?? null,
    updatedAt: new Date("2026-11-21T00:00:00Z"),
  };
  return {
    featureSettings: {
      findUnique: async () => row,
      upsert: async ({ create, update }: any) => {
        row = { ...row, ...(row ? update : create), updatedAt: new Date() };
        return row;
      },
    },
    bot: {
      findUnique: async ({ where }: any) =>
        active.has(where.id)
          ? { id: where.id, status: "active", subagentIdentity: null, conversation: { id: `conv-${where.id}` } }
          : null,
    },
    channel: {
      findFirst: async ({ where }: any) => {
        const botId = where?.members?.some?.botId;
        return active.has(botId) ? { id: `dm-${botId}` } : null;
      },
    },
  };
}

test("resolveOutcomeRole handles configured, unset, model-only, disabled, and unrunnable fallback", async () => {
  const plannerId = "11111111-1111-4111-8111-111111111111";
  const reviewerId = "22222222-2222-4222-8222-222222222222";
  const outcomeBotId = "33333333-3333-4333-8333-333333333333";

  // Disabled
  const disabledDb = makeRoleDb({ enabled: false, plannerBotId: plannerId, activeBotIds: [plannerId] });
  expect(await resolveOutcomeRole(disabledDb as never, "planner", outcomeBotId)).toMatchObject({ status: "disabled", botId: null });
  expect(await hasActivePlannerRole(disabledDb as never)).toBe(false);

  // Unset
  const unsetDb = makeRoleDb({ enabled: true });
  expect(await resolveOutcomeRole(unsetDb as never, "planner", outcomeBotId)).toEqual({
    status: "unset",
    botId: outcomeBotId,
    model: null,
    fallback: false,
  });
  expect(await resolveOutcomeRole(unsetDb as never, "reviewer", outcomeBotId)).toEqual({
    status: "unset",
    botId: null,
    model: null,
    fallback: false,
  });
  expect(await hasActivePlannerRole(unsetDb as never)).toBe(false);

  // Configured & runnable
  const configuredDb = makeRoleDb({
    plannerBotId: plannerId,
    plannerModel: { providerId: "anthropic", modelId: "claude-opus-4", reasoning: "high" },
    reviewerBotId: reviewerId,
    activeBotIds: [plannerId, reviewerId],
  });
  expect(await resolveOutcomeRole(configuredDb as never, "planner", outcomeBotId)).toEqual({
    status: "configured",
    botId: plannerId,
    model: { providerId: "anthropic", modelId: "claude-opus-4", reasoning: "high" },
    fallback: false,
  });
  expect(await resolveOutcomeRole(configuredDb as never, "reviewer", outcomeBotId)).toEqual({
    status: "configured",
    botId: reviewerId,
    model: null,
    fallback: false,
  });
  expect(await hasActivePlannerRole(configuredDb as never)).toBe(true);

  // Deleted/unrunnable bot falls back without throwing
  const brokenDb = makeRoleDb({
    plannerBotId: plannerId,
    reviewerBotId: reviewerId,
    plannerModel: { providerId: "anthropic", modelId: "claude-opus-4" },
    activeBotIds: [outcomeBotId],
  });
  expect(await isBotRunnable(brokenDb as never, plannerId)).toBe(false);
  expect(await resolveOutcomeRole(brokenDb as never, "planner", outcomeBotId)).toEqual({
    status: "fallback",
    botId: outcomeBotId,
    model: null,
    fallback: true,
    fallbackReason: "configured_bot_not_runnable",
  });
  expect(await resolveOutcomeRole(brokenDb as never, "reviewer", outcomeBotId)).toEqual({
    status: "fallback",
    botId: null,
    model: null,
    fallback: true,
    fallbackReason: "configured_bot_not_runnable",
  });

  // Model-only reviewer uses outcome's bot with independent model
  const modelOnlyDb = makeRoleDb({
    reviewerModel: { providerId: "openai", modelId: "gpt-5" },
    activeBotIds: [outcomeBotId],
  });
  expect(await resolveOutcomeRole(modelOnlyDb as never, "reviewer", outcomeBotId)).toEqual({
    status: "model_only",
    botId: outcomeBotId,
    model: { providerId: "openai", modelId: "gpt-5" },
    fallback: false,
  });
});

test("updateFeatureSettings preserves unrelated fields and enforces 8000-char environmentNote limit", async () => {
  const db = makeRoleDb({
    plannerBotId: "11111111-1111-4111-8111-111111111111",
    environmentNote: "Keep existing note",
  });
  const next = await updateFeatureSettings(db as never, { streamBotReplies: true });
  expect(next.plannerBotId).toBe("11111111-1111-4111-8111-111111111111");
  expect(next.environmentNote).toBe("Keep existing note");
  expect(next.streamBotReplies).toBe(true);

  expect(featureSettingsView(null).plannerBotId).toBeNull();
  expect(() =>
    Schema.decodeUnknownSync(UpdateFeatureSettingsInput)({
      environmentNote: "x".repeat(8_001),
    })
  ).toThrow();
});
