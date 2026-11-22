import {
  ApiError,
  type InferenceModelSelection,
  normalizeInferenceModelId,
  normalizeInferenceProviderId,
  normalizePiReasoningLevel,
  type PiReasoningLevel,
} from "@outcomego/contracts";
import { COMPUTER_API_PATHS } from "@outcomego/contracts/service-protocol";
import type { AgentDataStore } from "@outcomego/messaging";
import type { ComputerFetch } from "./service-utils";

export interface VerifiedInferenceModel {
  providerId: string;
  modelId: string;
  reasoning: PiReasoningLevel | null;
}

/**
 * Normalizes a user-chosen model selection and verifies against the computer runtime
 * that the provider is connected and the model is available.
 */
export async function verifyInferenceModelSelection(
  computerFetch: ComputerFetch,
  agentData: Pick<AgentDataStore, "loadInferenceSettings">,
  selection: InferenceModelSelection
): Promise<VerifiedInferenceModel> {
  let providerId: string;
  let modelId: string;
  let explicitReasoning: PiReasoningLevel | null = null;
  try {
    providerId = normalizeInferenceProviderId(selection.providerId);
    modelId = normalizeInferenceModelId(selection.modelId);
    if (selection.reasoning !== undefined) {
      explicitReasoning = normalizePiReasoningLevel(selection.reasoning);
    }
  } catch (error) {
    throw new ApiError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid inference model selection"
    );
  }
  const globalSettings = await agentData.loadInferenceSettings({ allowUnconfigured: true });
  const reasoningToVerify = explicitReasoning ?? globalSettings.reasoning;
  const response = await computerFetch(COMPUTER_API_PATHS.inferenceSettingsVerify, {
    method: "POST",
    body: JSON.stringify({ providerId, modelId, reasoning: reasoningToVerify }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : `Model ${providerId}/${modelId} is unavailable`;
    throw new ApiError(400, "model_unavailable", message);
  }
  return { providerId, modelId, reasoning: explicitReasoning };
}
