import { expect, test } from "bun:test";
import { UpdateBotInput, UpdateProfileToolInput } from "@outcomego/contracts";
import { Effect } from "effect";
import { Schema } from "effect";
import { BotService } from "../src/services/bot-service";

function makeBotFixture(initial?: { provider?: string | null; model?: string | null; reasoning?: string | null }) {
  const now = new Date();
  let row = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Researcher",
    title: "",
    description: "Finds sources",
    instructions: "",
    voice: "",
    icon: "●",
    color: "#4f7cff",
    avatarPath: null,
    notificationsEnabled: true,
    hiddenFromSidebar: false,
    draftingDisabled: false,
    draftAllowedRecipients: [],
    defaultDirectory: "/workspace",
    status: "active",
    onboardingStatus: "completed",
    onboardingVersion: 1,
    onboardingCompletedAt: now,
    provisioningError: null,
    inferenceProvider: initial?.provider ?? null,
    inferenceModel: initial?.model ?? null,
    inferenceReasoning: initial?.reasoning ?? null,
    createdAt: now,
    updatedAt: now,
    subagentIdentity: null,
    conversation: { id: "00000000-0000-0000-0000-000000000002" },
    channelMemberships: [{ channelId: "00000000-0000-0000-0000-000000000003", channel: { kind: "bot_dm" } }],
  };
  let verifyStatus = 200;
  let verifyError = "";
  const tx = {
    bot: {
      findUnique: async () => row,
      update: async ({ data }: any) => {
        row = {
          ...row,
          ...(data.inferenceProvider !== undefined ? { inferenceProvider: data.inferenceProvider } : {}),
          ...(data.inferenceModel !== undefined ? { inferenceModel: data.inferenceModel } : {}),
          ...(data.inferenceReasoning !== undefined ? { inferenceReasoning: data.inferenceReasoning } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
        };
        return row;
      },
    },
    channel: { updateMany: async () => ({ count: 1 }) },
    event: { create: async () => ({}) },
  };
  const prisma = { ...tx, $transaction: async (fn: any) => fn(tx) };
  const agentData = {
    reconcileBot: async () => {},
    mutateBotFiles: async (_id: string, _targets: unknown, fn: any) => fn(tx),
    loadInferenceSettings: async () => ({ providerId: "openai-codex", modelId: "gpt-5.6-terra", reasoning: "medium" as const }),
  };
  const service = new BotService(
    prisma as never,
    {} as never,
    "/workspace",
    async (path) => {
      if (path === "/v1/inference/settings/verify") {
        return verifyStatus === 200
          ? Response.json({ ok: true })
          : Response.json({ error: verifyError || "Model unavailable" }, { status: verifyStatus });
      }
      return Response.json({ ok: true });
    },
    agentData as never
  );
  return {
    service,
    setVerifyFailure: (status: number, error: string) => {
      verifyStatus = status;
      verifyError = error;
    },
  };
}

test("BotService.update sets, validates, and clears per-bot model and reports effectiveModel", async () => {
  const f = makeBotFixture();
  const updated = await Effect.runPromise(
    f.service.update("00000000-0000-0000-0000-000000000001", {
      model: { providerId: "openrouter", modelId: "anthropic/claude-opus-4", reasoning: "high" },
    })
  );
  expect(updated.model).toEqual({
    providerId: "openrouter",
    modelId: "anthropic/claude-opus-4",
    reasoning: "high",
  });
  expect(updated.effectiveModel).toEqual({
    providerId: "openrouter",
    modelId: "anthropic/claude-opus-4",
    reasoning: "high",
  });

  // Clearing returns to global model
  const cleared = await Effect.runPromise(
    f.service.update("00000000-0000-0000-0000-000000000001", { model: null })
  );
  expect(cleared.model).toBeNull();
  expect(cleared.effectiveModel).toEqual({
    providerId: "openai-codex",
    modelId: "gpt-5.6-terra",
    reasoning: "medium",
  });

  // Unavailable model is rejected with model_unavailable
  f.setVerifyFailure(400, "Provider openrouter is not authenticated");
  const failed = await Effect.runPromise(
    Effect.either(
      f.service.update("00000000-0000-0000-0000-000000000001", {
        model: { providerId: "openrouter", modelId: "bad-model" },
      })
    )
  );
  expect(failed._tag).toBe("Left");
  if (failed._tag === "Left") {
    expect(failed.left).toMatchObject({ code: "model_unavailable" });
  }
});

test("UpdateBotInput validates model while UpdateProfileToolInput cannot set model", () => {
  const decoded = Schema.decodeUnknownSync(UpdateBotInput)({
    model: { providerId: "openai", modelId: "gpt-5", reasoning: "low" },
  });
  expect(decoded.model).toEqual({ providerId: "openai", modelId: "gpt-5", reasoning: "low" });
  expect(
    Schema.decodeUnknownSync(UpdateProfileToolInput)({
      name: "Bot",
      model: { providerId: "openai", modelId: "gpt-5" },
    })
  ).not.toHaveProperty("model");
});
