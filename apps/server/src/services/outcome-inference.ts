import type { ComputerInferenceRequest, ComputerInferenceResponse } from "@outcomego/contracts/service-protocol";
import { COMPUTER_API_PATHS } from "@outcomego/contracts/service-protocol";
import type { AgentDataStore } from "@outcomego/messaging";

export type OutcomeInference = (input: Pick<ComputerInferenceRequest, "kind" | "instructions" | "prompt">,
  signal?: AbortSignal) => Promise<ComputerInferenceResponse>;

export function outcomeInference(agentData: Pick<AgentDataStore, "loadInferenceSettings">,
  computerJson: <T>(path: string, init: RequestInit) => Promise<T>): OutcomeInference {
  return async (input, signal) => {
    const settings = await agentData.loadInferenceSettings();
    return computerJson<ComputerInferenceResponse>(COMPUTER_API_PATHS.inference, {
      method: "POST",
      body: JSON.stringify({ ...input, timeoutMs: 60_000, model: `${settings.providerId}/${settings.modelId}`, reasoning: settings.reasoning }),
      signal: AbortSignal.any([AbortSignal.timeout(75_000), ...(signal ? [signal] : [])]),
    });
  };
}
