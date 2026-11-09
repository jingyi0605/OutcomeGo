import { normalizeInferenceModelId, normalizeInferenceProviderId } from "@aiteamos/contracts";
import { KEYLESS_API_KEY, modelsEndpoint } from "./chat-provider-registry";

/** An icon is a file name in the bundled icon set, so it is never a path. */
const validIconName = (value: unknown): string => {
  const name = String(value);
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(name)) throw new Error("Custom provider icon is invalid");
  return name;
};

export type CustomProviderInput = {
  id: string;
  name: string;
  baseUrl: string;
  api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
  model?: string;
  noAuth?: boolean;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  createOnly?: boolean;
  /** The same vendor's id in the runtime's built-in model table. */
  catalog?: string;
  /** The vendor's mark in the provider icon set. */
  icon?: string;
};

export const customProviderInput = (value: unknown): CustomProviderInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Custom provider input must be an object");
  }
  const input = value as Record<string, unknown>;
  const id = normalizeInferenceProviderId(String(input.id ?? ""));
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 100) throw new Error("Custom provider name is invalid");
  const endpoint = new URL(String(input.baseUrl ?? ""));
  if (!["https:", "http:"].includes(endpoint.protocol)) {
    throw new Error("Custom provider URL must use HTTP or HTTPS");
  }
  modelsEndpoint(endpoint.toString(), input.api === "anthropic-messages");
  const supportedApis = [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
  ] as const;
  const api = String(input.api ?? "") as CustomProviderInput["api"];
  if (api.startsWith("openai-") && (!endpoint.pathname || endpoint.pathname === "/"))
    endpoint.pathname = "/v1";
  if (input.noAuth === true && !api.startsWith("openai-"))
    throw new Error("--no-auth is supported for OpenAI-compatible chat endpoints.");
  if (!supportedApis.includes(api)) throw new Error(`Unsupported Pi API protocol: ${api}`);
  const positiveInteger = (field: "contextWindow" | "maxTokens", fallback: number) => {
    const number = input[field] === undefined ? fallback : Number(input[field]);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${field} must be positive`);
    return number;
  };
  return {
    id,
    name,
    baseUrl: endpoint.toString().replace(/\/$/, ""),
    api,
    model: input.model ? normalizeInferenceModelId(String(input.model)) : undefined,
    noAuth: input.noAuth === true,
    reasoning: input.reasoning === true,
    contextWindow: positiveInteger("contextWindow", 128_000),
    maxTokens: positiveInteger("maxTokens", 16_384),
    createOnly: input.createOnly === true,
    ...(input.catalog === undefined ? {} : { catalog: normalizeInferenceProviderId(String(input.catalog)) }),
    ...(input.icon === undefined ? {} : { icon: validIconName(input.icon) }),
  };
};

/** The `models.json` entry for a validated custom provider. */
export const customProviderEntry = (input: CustomProviderInput) => ({
  name: input.name,
  baseUrl: input.baseUrl,
  api: input.api,
  ...(input.catalog ? { catalog: input.catalog } : {}),
  ...(input.icon ? { icon: input.icon } : {}),
  ...(input.noAuth
    ? // The OpenAI SDK requires a nonempty placeholder even for servers with no auth.
      { apiKey: KEYLESS_API_KEY }
    : {}),
  models: input.model
    ? [
        {
          id: input.model,
          name: input.model,
          reasoning: input.reasoning,
          contextWindow: input.contextWindow,
          maxTokens: input.maxTokens,
        },
      ]
    : [],
});
