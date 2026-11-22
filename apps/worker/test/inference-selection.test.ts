import { expect, test } from "bun:test";
import { checkComputerModelAvailable, resolveRunInference } from "../src/inference-selection";

const globalInference = {
  providerId: "openai-codex",
  modelId: "gpt-5.6-terra",
  reasoning: "medium" as const,
};

test("resolveRunInference obeys priority: subagent parent > role turn > bot model > global", async () => {
  const available = async () => ({ available: true });

  // 1. Subagent inherits parent run model even when bot model or turn model differs
  const parentSelected = await resolveRunInference({
    parentRun: { inferenceProvider: "openrouter", inferenceModel: "anthropic/claude-opus-4", inferenceReasoning: "high" },
    turnModel: { providerId: "anthropic", modelId: "claude-sonnet-4", reasoning: "low" },
    botModel: { inferenceProvider: "openai", inferenceModel: "gpt-5", inferenceReasoning: "minimal" },
    globalInference,
    checkAvailability: available,
  });
  expect(parentSelected).toEqual({
    settings: { providerId: "openrouter", modelId: "anthropic/claude-opus-4", reasoning: "high" },
    fallback: null,
    source: "parent",
  });

  // 2. Role turn model overrides bot model and global
  const roleSelected = await resolveRunInference({
    turnModel: { providerId: "anthropic", modelId: "claude-sonnet-4", reasoning: "high" },
    botModel: { inferenceProvider: "openai", inferenceModel: "gpt-5", inferenceReasoning: "low" },
    globalInference,
    checkAvailability: available,
  });
  expect(roleSelected).toEqual({
    settings: { providerId: "anthropic", modelId: "claude-sonnet-4", reasoning: "high" },
    fallback: null,
    source: "role",
  });

  // 3. Bot model overrides global when no turn model is set
  const botSelected = await resolveRunInference({
    botModel: { inferenceProvider: "openai", inferenceModel: "gpt-5", inferenceReasoning: null },
    globalInference,
    checkAvailability: available,
  });
  expect(botSelected).toEqual({
    settings: { providerId: "openai", modelId: "gpt-5", reasoning: "medium" },
    fallback: null,
    source: "bot",
  });

  // 4. Global used when neither turn nor bot model is set
  const globalSelected = await resolveRunInference({
    botModel: { inferenceProvider: null, inferenceModel: null, inferenceReasoning: null },
    globalInference,
    checkAvailability: available,
  });
  expect(globalSelected).toEqual({
    settings: globalInference,
    fallback: null,
    source: "global",
  });
});

test("resolveRunInference falls back down the chain and annotates reason when a model is unavailable", async () => {
  // Role model unavailable -> falls back to bot model
  const roleToBot = await resolveRunInference({
    turnModel: { providerId: "anthropic", modelId: "missing-model", reasoning: "high" },
    botModel: { inferenceProvider: "openai", inferenceModel: "gpt-5", inferenceReasoning: "low" },
    globalInference,
    checkAvailability: async (candidate) =>
      candidate.modelId === "missing-model"
        ? { available: false, reason: "Provider anthropic is not connected" }
        : { available: true },
  });
  expect(roleToBot).toEqual({
    settings: { providerId: "openai", modelId: "gpt-5", reasoning: "low" },
    fallback: {
      fromLevel: "role",
      toLevel: "bot",
      requestedProviderId: "anthropic",
      requestedModelId: "missing-model",
      reason: "Provider anthropic is not connected",
    },
    source: "bot",
  });

  // Role model and bot model both unavailable -> falls back to global
  const roleToGlobal = await resolveRunInference({
    turnModel: { providerId: "anthropic", modelId: "missing-role", reasoning: "high" },
    botModel: { inferenceProvider: "openai", inferenceModel: "missing-bot", inferenceReasoning: "low" },
    globalInference,
    checkAvailability: async () => ({ available: false, reason: "Retired model" }),
  });
  expect(roleToGlobal).toEqual({
    settings: globalInference,
    fallback: {
      fromLevel: "role",
      toLevel: "global",
      requestedProviderId: "anthropic",
      requestedModelId: "missing-role",
      reason: "Retired model",
    },
    source: "global",
  });

  // Bot model unavailable -> falls back to global
  const botToGlobal = await resolveRunInference({
    botModel: { inferenceProvider: "openai", inferenceModel: "missing-bot", inferenceReasoning: "low" },
    globalInference,
    checkAvailability: async () => ({ available: false, reason: "Auth expired" }),
  });
  expect(botToGlobal).toEqual({
    settings: globalInference,
    fallback: {
      fromLevel: "bot",
      toLevel: "global",
      requestedProviderId: "openai",
      requestedModelId: "missing-bot",
      reason: "Auth expired",
    },
    source: "global",
  });
});

test("checkComputerModelAvailable detects unauthenticated or missing models from computer health", async () => {
  const unauth = await checkComputerModelAvailable(
    "http://localhost:8790",
    "tok",
    globalInference,
    (async () =>
      new Response(JSON.stringify({ inference: { ready: true, authenticated: false } }), {
        status: 200,
      })) as unknown as typeof fetch
  );
  expect(unauth.available).toBe(false);

  const missing = await checkComputerModelAvailable(
    "http://localhost:8790",
    "tok",
    globalInference,
    (async () =>
      new Response(JSON.stringify({ error: "Pi does not provide openai-codex/gpt-5.6-terra" }), {
        status: 500,
      })) as unknown as typeof fetch
  );
  expect(missing.available).toBe(false);
  expect(missing.reason).toContain("does not provide");

  const ready = await checkComputerModelAvailable(
    "http://localhost:8790",
    "tok",
    globalInference,
    (async () =>
      new Response(JSON.stringify({ inference: { ready: true, authenticated: true } }), {
        status: 200,
      })) as unknown as typeof fetch
  );
  expect(ready).toEqual({ available: true });
});
