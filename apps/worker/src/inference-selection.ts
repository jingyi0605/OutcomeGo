import {
  formatPiModelRef,
  type InferenceFallbackRecord,
  normalizePiReasoningLevel,
  type PiReasoningLevel,
  type ServerInferenceSettings,
} from "@outcomego/contracts";

export interface ModelAvailabilityCheck {
  available: boolean;
  reason?: string;
}

export type ModelAvailabilityChecker = (
  candidate: ServerInferenceSettings
) => Promise<ModelAvailabilityCheck>;

export interface ResolveRunInferenceInput {
  parentRun?: {
    inferenceProvider: string | null;
    inferenceModel: string | null;
    inferenceReasoning: string | null;
  } | null;
  turnModel?: {
    providerId?: string | null;
    modelId?: string | null;
    reasoning?: string | null;
  } | null;
  botModel?: {
    inferenceProvider: string | null;
    inferenceModel: string | null;
    inferenceReasoning: string | null;
  } | null;
  globalInference: ServerInferenceSettings;
  checkAvailability: ModelAvailabilityChecker;
}

export interface ResolvedRunInference {
  settings: ServerInferenceSettings;
  fallback: InferenceFallbackRecord | null;
  source: "parent" | "role" | "bot" | "global";
}

const safeReasoning = (raw: string | null | undefined, fallback: PiReasoningLevel): PiReasoningLevel => {
  if (!raw) return fallback;
  try {
    return normalizePiReasoningLevel(raw);
  } catch {
    return fallback;
  }
};

/**
 * Resolves the effective model for a run in priority order:
 * subagent parent > role turn override > bot model > global inference.
 * Falls back down the chain if a configured model is unavailable.
 */
export async function resolveRunInference(
  input: ResolveRunInferenceInput
): Promise<ResolvedRunInference> {
  const { parentRun, turnModel, botModel, globalInference, checkAvailability } = input;
  if (parentRun?.inferenceProvider && parentRun.inferenceModel) {
    return {
      settings: {
        providerId: parentRun.inferenceProvider,
        modelId: parentRun.inferenceModel,
        reasoning: safeReasoning(parentRun.inferenceReasoning, globalInference.reasoning),
      },
      fallback: null,
      source: "parent",
    };
  }

  const candidates: Array<{
    level: "role" | "bot";
    settings: ServerInferenceSettings;
  }> = [];

  if (turnModel?.providerId && turnModel.modelId) {
    candidates.push({
      level: "role",
      settings: {
        providerId: turnModel.providerId,
        modelId: turnModel.modelId,
        reasoning: safeReasoning(turnModel.reasoning, globalInference.reasoning),
      },
    });
  }
  if (botModel?.inferenceProvider && botModel.inferenceModel) {
    candidates.push({
      level: "bot",
      settings: {
        providerId: botModel.inferenceProvider,
        modelId: botModel.inferenceModel,
        reasoning: safeReasoning(botModel.inferenceReasoning, globalInference.reasoning),
      },
    });
  }

  let firstFailure: {
    level: "role" | "bot";
    providerId: string;
    modelId: string;
    reason: string;
  } | null = null;

  for (const candidate of candidates) {
    const check = await checkAvailability(candidate.settings);
    if (check.available) {
      return {
        settings: candidate.settings,
        fallback: firstFailure
          ? {
              fromLevel: firstFailure.level,
              toLevel: candidate.level === "role" ? "bot" : candidate.level,
              requestedProviderId: firstFailure.providerId,
              requestedModelId: firstFailure.modelId,
              reason: firstFailure.reason,
            }
          : null,
        source: candidate.level,
      };
    }
    firstFailure ??= {
      level: candidate.level,
      providerId: candidate.settings.providerId,
      modelId: candidate.settings.modelId,
      reason: check.reason ?? `Model ${formatPiModelRef(candidate.settings)} is unavailable`,
    };
  }

  return {
    settings: globalInference,
    fallback: firstFailure
      ? {
          fromLevel: firstFailure.level,
          toLevel: "global",
          requestedProviderId: firstFailure.providerId,
          requestedModelId: firstFailure.modelId,
          reason: firstFailure.reason,
        }
      : null,
    source: "global",
  };
}

/** Checks model availability against the computer's /health/authenticated?model=... endpoint. */
export async function checkComputerModelAvailable(
  computerUrl: string,
  controlToken: string,
  candidate: ServerInferenceSettings,
  fetchImpl: typeof fetch = fetch
): Promise<ModelAvailabilityCheck> {
  try {
    const url = `${computerUrl}/health/authenticated?model=${encodeURIComponent(formatPiModelRef(candidate))}`;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${controlToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      inference?: { ready?: unknown; authenticated?: unknown; error?: unknown };
    } | null;
    if (response.status >= 400 && response.status < 500) {
      return {
        available: false,
        reason: typeof body?.error === "string" ? body.error : `Model check failed (${response.status})`,
      };
    }
    if (response.status >= 500 && typeof body?.error === "string") {
      return { available: false, reason: body.error };
    }
    if (body?.inference) {
      if (body.inference.ready === false || body.inference.authenticated === false) {
        const provider = candidate.providerId;
        const reason =
          typeof body.inference.error === "string"
            ? body.inference.error
            : `Provider ${provider} is not authenticated or model is unavailable`;
        return { available: false, reason };
      }
      return { available: true };
    }
    return { available: true };
  } catch {
    // Transient network error reaching computer; let turn dispatch handle connectivity normally.
    return { available: true };
  }
}
