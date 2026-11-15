import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type InferenceProviderView,
  PI_REASONING_LEVELS,
  providerRowIcon,
  type PiReasoningLevel,
  type ServerInferenceSettings,
} from "@outcomego/contracts";
import { CHAT_PROVIDER_DEFINITIONS } from "./chat-provider-definitions";
import { openRouterReasoning, reasoningCapabilities, reasoningLevelMap } from "./reasoning-capabilities";
import { updateModelsConfig } from "./models-config";
import {
  availableInferenceModels,
  replacementFor,
  requireInferenceModel,
} from "./inference-models";

export const CHAT_PROVIDERS = new Set(Object.keys(CHAT_PROVIDER_DEFINITIONS));
const iconField = (icon: string | undefined) => (icon ? { icon } : {});
export const KEYLESS_API_KEY = "outcomego-no-auth";
export type ChatModel = Model<Api> & {
  reasoningLevels?: PiReasoningLevel[];
  defaultReasoningLevel?: PiReasoningLevel;
  recommended?: boolean;
};
type CustomConfig = {
  name?: string;
  catalog?: string;
  icon?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: Array<Record<string, unknown>>;
};
type Config = { providers?: Record<string, CustomConfig>; [key: string]: unknown };
const providerSettings = (config?: CustomConfig) => {
  const { models: _models, ...settings } = config ?? {};
  return settings;
};
type Entry = Record<string, unknown> & { id: string };
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown, fallback: number) =>
  Number.isSafeInteger(v) && Number(v) > 0 ? Number(v) : fallback;
/**
 * The largest prompt the provider accepts: the smallest advertised limit, since
 * a separate input cap (max_input_tokens, max_prompt_tokens) can sit below the
 * context length. Compaction thresholds and the output reserve derive from it.
 */
export const inputWindow = (limits: readonly unknown[], fallback: number): number => {
  const known = limits.map((limit) => positive(limit, 0)).filter((limit) => limit > 0);
  return known.length ? Math.min(...known) : fallback;
};
/**
 * OpenRouter publishes per-endpoint prompt caps (max_prompt_tokens) only on a
 * model's endpoints listing. Any endpoint may serve a request, so the lowest cap applies.
 */
export const openRouterEndpointPromptCap = (body: unknown): number | undefined => {
  const data = object(body) && object(body.data) ? body.data : undefined;
  const caps = (Array.isArray(data?.endpoints) ? data.endpoints : [])
    .map((endpoint) => (object(endpoint) ? positive(endpoint.max_prompt_tokens, 0) : 0))
    .filter((cap) => cap > 0);
  return caps.length ? Math.min(...caps) : undefined;
};
const costKeys = {
  prompt: "input",
  completion: "output",
  input_cache_read: "cacheRead",
  input_cache_write: "cacheWrite",
} as const;
const tokenPrice = (value: unknown): number | undefined => {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && !value.trim())
  )
    return;
  const price = Number(value) * 1_000_000;
  return Number.isFinite(price) && price >= 0 ? price : undefined;
};
/** Normalize token-only overrides to Pi's request-wide, strictly-above tiers. */
export const openRouterCost = (pricing: Record<string, unknown>): ChatModel["cost"] => {
  const base: ChatModel["cost"] = {
    input: tokenPrice(pricing.prompt) ?? 0,
    output: tokenPrice(pricing.completion) ?? 0,
    cacheRead: tokenPrice(pricing.input_cache_read) ?? 0,
    cacheWrite: tokenPrice(pricing.input_cache_write) ?? 0,
  };
  const overrides = (Array.isArray(pricing.overrides) ? pricing.overrides : []).filter(
    (entry): entry is Record<string, unknown> =>
      object(entry) &&
      Number.isSafeInteger(entry.min_prompt_tokens) &&
      Number(entry.min_prompt_tokens) >= 0 &&
      Object.keys(entry).every(
        (key) => key === "min_prompt_tokens" || Object.hasOwn(costKeys, key)
      ) &&
      Object.keys(costKeys).every(
        (key) => entry[key] === undefined || tokenPrice(entry[key]) !== undefined
      )
  );
  // OpenRouter applies matching entries in document order, with later values winning
  // per key. Compile that result at each threshold before Pi selects the highest tier.
  const thresholds = [...new Set(overrides.map((entry) => Number(entry.min_prompt_tokens)))].sort(
    (a, b) => a - b
  );
  if (thresholds.length)
    base.tiers = thresholds.map((threshold) => {
      const rates = {
        input: base.input,
        output: base.output,
        cacheRead: base.cacheRead,
        cacheWrite: base.cacheWrite,
      };
      for (const entry of overrides) {
        if (Number(entry.min_prompt_tokens) > threshold) continue;
        for (const [key, target] of Object.entries(costKeys)) {
          if (entry[key] !== undefined) rates[target] = tokenPrice(entry[key])!;
        }
      }
      return { inputTokensAbove: threshold, ...rates };
    });
  return base;
};
/** Never attach another route's tiers to this model's base prices. */
export const openRouterEndpointCost = (
  body: unknown,
  base: unknown
): ChatModel["cost"] | undefined => {
  if (
    !object(base) ||
    !Object.values(costKeys).every(
      (key) => typeof base[key] === "number" && Number.isFinite(base[key]) && Number(base[key]) >= 0
    )
  )
    return;
  const data = object(body) && object(body.data) ? body.data : undefined;
  const costs = (Array.isArray(data?.endpoints) ? data.endpoints : [])
    .map((entry) => (object(entry) && object(entry.pricing) ? entry.pricing : undefined))
    .filter(
      (pricing): pricing is Record<string, unknown> =>
        Boolean(pricing) &&
        Object.keys(costKeys).every((key) => tokenPrice(pricing![key]) !== undefined)
    )
    .map(openRouterCost)
    .filter((cost) =>
      Object.values(costKeys).every(
        (key) =>
          Math.abs(cost[key] - Number(base[key])) <=
          Number.EPSILON * Math.max(1, cost[key], Number(base[key])) * 4
      )
    );
  const first = costs[0];
  return first && costs.every((cost) => JSON.stringify(cost) === JSON.stringify(first))
    ? first
    : undefined;
};
const validId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(v);
const advertisedInput = (entry: Entry): ChatModel["input"] | undefined => {
  const modalities = Array.isArray(entry.input_modalities)
    ? entry.input_modalities
    : object(entry.modalities) && Array.isArray(entry.modalities.input)
      ? entry.modalities.input
      : undefined;
  if (!modalities) return undefined;
  return modalities.includes("image") ? ["text", "image"] : ["text"];
};
const reasoningLevel = (value: unknown): PiReasoningLevel | undefined => {
  const normalized = value === "none" ? "off" : value;
  return typeof normalized === "string" &&
    (PI_REASONING_LEVELS as readonly string[]).includes(normalized)
    ? (normalized as PiReasoningLevel)
    : undefined;
};
const advertisedReasoning = (
  entry: Entry
):
  | {
      levels: PiReasoningLevel[];
      defaultLevel: PiReasoningLevel;
      levelMap: NonNullable<ChatModel["thinkingLevelMap"]>;
    }
  | undefined => {
  if (!Array.isArray(entry.supported_reasoning_levels)) return undefined;
  const levels: PiReasoningLevel[] = [];
  const advertisedValues = new Map<PiReasoningLevel, string>();
  for (const candidate of entry.supported_reasoning_levels) {
    const value = object(candidate) ? candidate.effort : candidate;
    const level = reasoningLevel(value);
    if (!level || typeof value !== "string" || advertisedValues.has(level)) continue;
    levels.push(level);
    advertisedValues.set(level, value);
  }
  const first = levels[0];
  const advertisedDefault = reasoningLevel(entry.default_reasoning_level);
  return {
    levels,
    defaultLevel:
      advertisedDefault && levels.includes(advertisedDefault)
        ? advertisedDefault
        : (first ?? "off"),
    levelMap: reasoningLevelMap(advertisedValues),
  };
};

/** Common non-chat families; structured task metadata takes precedence over inference by ID. */
export const isChatModel = (entry: Entry, known = false, chatEndpoint = false): boolean => {
  if (Array.isArray(entry.supportedGenerationMethods))
    return entry.supportedGenerationMethods.includes("generateContent");
  const task = String(entry.task ?? entry.type ?? "").toLowerCase();
  if (/embed|transcri|speech|audio|rerank|image|moderation|tts/.test(task)) return false;
  if (Array.isArray(entry.supported_endpoints)) {
    return entry.supported_endpoints.some((v) =>
      /(?:chat\/completions|responses|messages)$/.test(String(v))
    );
  }
  const id = entry.id.toLowerCase();
  if (
    /(?:whisper|transcrib|transcri|parakeet|canary|embedding|embed-|rerank|moderation|dall-e|gpt-image|tts|realtime|audio|sora)/.test(
      id
    )
  )
    return false;
  return known || chatEndpoint || /chat|llm|text-generation/.test(task);
};

/** OpenRouter publishes explicit modalities and parameter support; do not guess by ID. */
const openRouterChatModel = (entry: Entry): boolean => {
  const architecture = object(entry.architecture) ? entry.architecture : {};
  return (
    Array.isArray(architecture.output_modalities) &&
    architecture.output_modalities.includes("text") &&
    Array.isArray(entry.supported_parameters) &&
    entry.supported_parameters.includes("tools")
  );
};
const applyOpenRouterMetadata = (model: ChatModel, entry: Entry): void => {
  const architecture = object(entry.architecture) ? entry.architecture : {};
  const top = object(entry.top_provider) ? entry.top_provider : {};
  const pricing = object(entry.pricing) ? entry.pricing : {};
  model.api = "openai-completions";
  model.contextWindow = positive(entry.context_length, model.contextWindow);
  model.maxTokens = Math.min(
    positive(top.max_completion_tokens, model.maxTokens),
    model.contextWindow
  );
  model.reasoning =
    Array.isArray(entry.supported_parameters) &&
    entry.supported_parameters.some((p) => p === "reasoning" || p === "reasoning_effort");
  // Live metadata replaces bundled/persisted effort maps, including removals.
  Object.assign(model, openRouterReasoning(model.reasoning ? entry.reasoning : undefined));
  const capabilities = reasoningCapabilities(model);
  model.reasoningLevels = capabilities.reasoningLevels;
  model.defaultReasoningLevel = capabilities.defaultReasoningLevel;
  model.input =
    Array.isArray(architecture.input_modalities) && architecture.input_modalities.includes("image")
      ? ["text", "image"]
      : ["text"];
  model.cost = openRouterCost(pricing);
};

const configFile = async (path: string): Promise<Config> => {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!object(value) || (value.providers !== undefined && !object(value.providers)))
      throw new Error("Invalid provider registry");
    return value as Config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      "The custom provider registry is invalid. Repair models.json before loading providers."
    );
  }
};
export const modelsEndpoint = (baseUrl: string, anthropic = false): URL => {
  const url = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Use an HTTP(S) API base URL without credentials, a query, or a fragment.");
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/(chat\/completions|responses|messages|models)$/.test(path))
    throw new Error("Use the API base URL ending in /v1, rather than a specific request endpoint.");
  url.pathname = `${path}${(!path || anthropic) && !/\/v\d+$/.test(path) ? "/v1" : ""}/models`;
  return url;
};
async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) throw new DiscoveryError("The provider returned an empty model list.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) throw new DiscoveryError("The provider's model list is too large to load.");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class ChatProviderRegistry {
  constructor(
    private readonly runtime: () => ModelRuntime,
    readonly modelsPath: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}
  async catalog(providerId?: string) {
    const runtime = this.runtime();
    const signal = AbortSignal.timeout(8_000);
    await runtime.refresh({ allowNetwork: false, signal });
    const config = await configFile(this.modelsPath);
    const custom = config.providers ?? {};
    const allowed = runtime
      .getProviders()
      .filter((p) => CHAT_PROVIDERS.has(p.id) || Object.hasOwn(custom, p.id));
    const groups = await Promise.all(
      allowed.map(async (p) => {
        const isCustom = !CHAT_PROVIDERS.has(p.id) && Object.hasOwn(custom, p.id);
        const authentication = await runtime.checkAuth(p.id, { signal }).catch(() => undefined);
        const row: InferenceProviderView = {
          id: p.id,
          name: CHAT_PROVIDER_DEFINITIONS[p.id]?.name ?? p.name,
          connected: Boolean(authentication),
          authType: authentication?.type ?? null,
          authSource: authentication?.source ?? null,
          custom: isCustom,
          ...iconField(providerRowIcon(p.id, isCustom ? custom[p.id] : undefined)),
          modelCount: 0,
          authMethods: [
            ...(p.auth.oauth
              ? [
                  {
                    type: "oauth" as const,
                    label: p.auth.oauth.name,
                    subscription: Boolean(p.auth.oauth.isSubscription),
                  },
                ]
              : []),
            ...(p.auth.apiKey?.login
              ? [{ type: "api_key" as const, label: p.auth.apiKey.name, subscription: false }]
              : []),
          ],
          modelStatus: authentication ? "unavailable" : "disconnected",
          modelMessage: authentication
            ? undefined
            : "Connect this provider to load its chat models.",
        };
        if (!authentication) return { row, models: [] as ChatModel[] };
        try {
          const models = await this.discover(p.id, custom[p.id], authentication.type, signal);
          row.modelCount = models.length;
          row.modelStatus = "ready";
          row.modelMessage = models.length
            ? undefined
            : "No supported chat models were returned. Check model access or the endpoint's model types.";
          return { row, models };
        } catch (error) {
          row.modelMessage =
            error instanceof DiscoveryError ? error.message : describeDiscoveryFailure(error);
          // The code names the cause for whoever runs the server; the message stays a fixed sentence.
          if (!(error instanceof DiscoveryError))
            console.warn(`Model discovery failed for ${p.id}: ${failureCode(error) || "unknown"}`);
          return { row, models: [] as ChatModel[] };
        }
      })
    );
    // Keep the registry usable when the saved selection names a removed/legacy provider.
    return {
      providers: groups.map((g) => g.row),
      models: groups.flatMap((g) => (!providerId || g.row.id === providerId ? g.models : [])),
      modelProviderId: providerId ?? "",
    };
  }
  private async discover(
    id: string,
    config: CustomConfig | undefined,
    authType: string,
    signal: AbortSignal
  ): Promise<ChatModel[]> {
    const runtime = this.runtime();
    const provider = runtime.getProvider(id)!;
    const resolved = await runtime.getAuth(id, { signal });
    if (!resolved) throw new DiscoveryError(`Reconnect ${provider.name} to load its chat models.`);
    const auth = resolved.auth;
    const keyless = config?.apiKey === KEYLESS_API_KEY;
    const base = config?.baseUrl ?? auth.baseUrl ?? provider.baseUrl;
    if (!base) throw new DiscoveryError("Add an API base URL before loading models.");
    let url: URL;
    const headers = new Headers();
    if (!keyless)
      for (const [name, value] of Object.entries(auth.headers ?? {}))
        if (typeof value === "string") headers.set(name, value);
    if (id === "openai-codex") {
      // Older client versions can receive only hidden review models, leaving
      // an authenticated subscription with an empty chat-model picker.
      url = new URL("https://chatgpt.com/backend-api/codex/models?client_version=1.0.0");
      headers.set("authorization", `Bearer ${auth.apiKey}`);
      try {
        const claim = JSON.parse(Buffer.from(auth.apiKey!.split(".")[1]!, "base64url").toString());
        const account = claim["https://api.openai.com/auth"]?.chatgpt_account_id;
        if (typeof account === "string") headers.set("chatgpt-account-id", account);
      } catch {}
    } else {
      const anthropic =
        id === "anthropic" || id === "claude-code" || config?.api === "anthropic-messages";
      url = modelsEndpoint(base, anthropic);
      if (id === "openrouter") url.pathname += "/user";
      if (anthropic) {
        headers.set("anthropic-version", "2023-06-01");
        url.searchParams.set("limit", "1000");
        if (auth.apiKey && !keyless) {
          if (authType === "oauth") {
            headers.set("authorization", `Bearer ${auth.apiKey}`);
            headers.set("anthropic-beta", "oauth-2025-04-20");
          } else headers.set("x-api-key", auth.apiKey);
        }
      } else if (config?.api === "google-generative-ai" && auth.apiKey && !keyless)
        headers.set("x-goog-api-key", auth.apiKey);
      else if (auth.apiKey && !keyless && !headers.has("authorization"))
        headers.set("authorization", `Bearer ${auth.apiKey}`);
    }
    headers.set("accept", "application/json");
    const entries: Entry[] = [];
    const cursors = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const response = await this.fetchImpl(url, { headers, signal, redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new DiscoveryError(
            `The provider rejected model discovery (HTTP ${response.status}). Reconnect it or grant model-list access.`
          );
        if (response.status === 404 || response.status === 405)
          throw new DiscoveryError(
            "This endpoint does not expose a model list. Check the API base URL or configure model discovery on the server."
          );
        throw new DiscoveryError(
          `Model discovery failed (HTTP ${response.status}). Check the provider's availability and retry.`
        );
      }
      const body = await responseJson(response);
      const values = object(body)
        ? id === "openai-codex" || config?.api === "google-generative-ai"
          ? body.models
          : body.data
        : undefined;
      if (!Array.isArray(values))
        throw new DiscoveryError(
          "The provider returned an invalid model list. Check the API base URL and protocol."
        );
      for (const value of values) {
        if (!object(value))
          throw new DiscoveryError("The model list has an entry that is not an object. Check the API base URL and protocol.");
        const modelId =
          id === "openai-codex"
            ? value.slug
            : config?.api === "google-generative-ai" && typeof value.name === "string"
              ? value.name.replace(/^models\//, "")
              : value.id;
        if (!validId(modelId))
          throw new DiscoveryError("The model list has an entry without a usable id. Check the API base URL and protocol.");
        if (id === "openai-codex" && value.visibility !== "list") continue;
        entries.push({ ...value, id: modelId });
      }
      if (object(body) && typeof body.nextPageToken === "string" && body.nextPageToken) {
        if (page === 19 || cursors.has(body.nextPageToken))
          throw new DiscoveryError("The provider returned invalid model pagination.");
        cursors.add(body.nextPageToken);
        url.searchParams.set("pageToken", body.nextPageToken);
        continue;
      }
      if (!object(body) || body.has_more !== true) break;
      if (page === 19 || !validId(body.last_id) || cursors.has(body.last_id))
        throw new DiscoveryError(
          "The provider returned invalid model pagination. Retry after fixing its model-list response."
        );
      cursors.add(body.last_id);
      url.searchParams.set("after_id", body.last_id);
    }
    // A custom endpoint of a vendor the runtime already knows reuses that vendor's model table:
    // its reasoning levels and request quirks. Only models for the same wire protocol are
    // borrowed, since the level mapping is that protocol's. The endpoint's own entries win.
    const borrowed = config?.catalog
      ? availableInferenceModels(runtime, config.catalog).filter(
          (m) => !config.api || m.api === config.api
        )
      : [];
    const known = new Map(
      [...borrowed, ...availableInferenceModels(runtime, id)].map((m) => [m.id, m])
    );
    const custom = !CHAT_PROVIDERS.has(id) && Boolean(config);
    const models = [
      ...new Map(
        entries
          .filter((m) => !replacementFor(id, m.id))
          .filter((m) =>
            id === "openrouter"
              ? openRouterChatModel(m)
              : isChatModel(
                  m,
                  known.has(m.id) ||
                    (id === "openai" &&
                      (known.has(m.id.split(":")[1] ?? "") ||
                        /^(?:gpt-[3-9]|o[1-9](?:-|$)|chatgpt-)/.test(m.id)) &&
                      !/instruct/.test(m.id)),
                  custom || id === "anthropic" || id === "claude-code" || id === "openai-codex"
                )
          )
          .map((m) => {
            const existing =
              known.get(m.id) ??
              (id === "openai" ? known.get(m.id.split(":")[1] ?? "") : undefined);
            const advertised = advertisedReasoning(m);
            const model: ChatModel = {
              ...existing,
              id: m.id,
              provider: id,
              name: String(m.display_name ?? m.displayName ?? m.name ?? existing?.name ?? m.id),
              api:
                existing?.api ??
                (config?.api as Api) ??
                CHAT_PROVIDER_DEFINITIONS[id]?.api ??
                "openai-completions",
              baseUrl: base,
              reasoning:
                (advertised ? advertised.levels.some((level) => level !== "off") : undefined) ??
                (typeof m.thinking === "boolean" ? m.thinking : undefined) ??
                existing?.reasoning ??
                (m.thinking === true ||
                  (Array.isArray(m.supported_reasoning_levels) &&
                    m.supported_reasoning_levels.length > 0)),
              ...(advertised
                ? {
                    reasoningLevels: advertised.levels,
                    defaultReasoningLevel: advertised.defaultLevel,
                    thinkingLevelMap: advertised.levelMap,
                  }
                : {}),
              // Live capabilities override stale persisted/bundled model metadata.
              input: advertisedInput(m) ?? existing?.input ?? ["text"],
              cost: existing?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: inputWindow(
                [m.context_window, m.max_input_tokens, m.inputTokenLimit],
                existing?.contextWindow ?? 128000
              ),
              maxTokens: positive(m.max_tokens ?? m.outputTokenLimit, existing?.maxTokens ?? 16384),
            };
            if (id === "openrouter") applyOpenRouterMetadata(model, m);
            else if (advertised || typeof m.thinking === "boolean")
              Object.assign(model, reasoningCapabilities(model));
            return [m.id, model] as const;
          })
      ).values(),
    ].filter((m): m is ChatModel => Boolean(m));
    // Apps preselect the first model when none is saved, so the suggestion leads the list.
    const suggestion = CHAT_PROVIDER_DEFINITIONS[id]?.recommendedModels
      ?.map((modelId) => models.findIndex((m) => m.id === modelId))
      .find((index) => index >= 0);
    if (suggestion !== undefined) {
      const [recommended] = models.splice(suggestion, 1);
      models.unshift({ ...recommended!, recommended: true });
    }
    return models;
  }
  async verify(settings: ServerInferenceSettings): Promise<void> {
    // Check retirements before making network requests, and access before accepting a saved choice.
    const existingModel = this.runtime().getModel(settings.providerId, settings.modelId);
    if (existingModel)
      requireInferenceModel(this.runtime(), settings);
    const before = (await configFile(this.modelsPath)).providers?.[settings.providerId];
    const catalog = await this.catalog(settings.providerId);
    const provider = catalog.providers.find((p) => p.id === settings.providerId);
    if (!provider)
      throw new Error(
        `Provider ${settings.providerId} is not in your registry. Connect a built-in provider, or add a custom endpoint with outcomego provider add.`
      );
    const model = catalog.models.find((m) => m.id === settings.modelId);
    if (!model)
      throw new Error(
        provider.modelMessage ??
          `Model ${settings.modelId} is not available from this connected provider. Refresh its model list and choose a listed chat model.`
      );
    const { reasoningLevels: levels, defaultReasoningLevel: fallbackReasoningLevel } =
      reasoningCapabilities(model);
    if (
      levels.length
        ? !levels.includes(settings.reasoning)
        : settings.reasoning !== fallbackReasoningLevel
    ) {
      throw new Error(
        `${model.name} does not support reasoning level ${settings.reasoning}. Choose one of: ${levels.length ? levels.join(", ") : "provider default"}.`
      );
    }
    // Persist dynamic capability mappings so inference keeps the same request contract
    // after a restart, even before the next catalog refresh.
    const previous = before?.models?.find((m) => m.id === settings.modelId);
    const liveReasoning =
      model.reasoningLevels !== undefined
        ? {
            reasoning: model.reasoning,
            reasoningLevels: model.reasoningLevels,
            defaultReasoningLevel: model.defaultReasoningLevel,
            thinkingLevelMap: model.thinkingLevelMap,
          }
        : undefined;
    const previousReasoning = previous
      ? {
          reasoning: previous.reasoning,
          reasoningLevels: previous.reasoningLevels,
          defaultReasoningLevel: previous.defaultReasoningLevel,
          thinkingLevelMap: previous.thinkingLevelMap,
        }
      : undefined;
    const persist =
      (liveReasoning !== undefined && !isDeepStrictEqual(liveReasoning, previousReasoning)) ||
      settings.providerId === "openrouter" ||
      settings.providerId === "openai-codex" ||
      !existingModel ||
      JSON.stringify(existingModel.input) !== JSON.stringify(model.input);
    if (persist && provider.id === "openrouter") {
      const endpoints = await this.openRouterEndpoints(model);
      const cap = openRouterEndpointPromptCap(endpoints);
      if (cap) model.contextWindow = Math.min(model.contextWindow, cap);
      if (!model.cost.tiers)
        model.cost = openRouterEndpointCost(endpoints, model.cost) ?? model.cost;
    }
    const {
      id,
      name,
      reasoning,
      reasoningLevels,
      defaultReasoningLevel,
      thinkingLevelMap,
      input,
      cost,
      contextWindow,
      maxTokens,
      api,
      baseUrl,
      compat,
      samplingParams,
      headers,
    } = model;
    const apply = (document: Config) => {
      const current = document.providers?.[provider.id];
      if (
        (before && !current) ||
        !isDeepStrictEqual(providerSettings(before), providerSettings(current))
      ) {
        throw new Error("Provider settings changed. Reload the model list and retry.");
      }
      document.providers ??= {};
      const config = (document.providers[provider.id] ??= {});
      const saved = config.models?.find((m) => m.id === id);
      if (previous && !saved) {
        throw new Error("Model settings changed. Reload the model list and retry.");
      }
      if (!persist) return false;
      const dynamic = provider.id === "openrouter" || provider.id === "openai-codex";
      // Existing custom models own their endpoint, protocol, headers, sampling
      // and compatibility settings. Repair only the capabilities advertised live.
      const snapshot =
        saved && !dynamic
          ? {
              ...saved,
              input,
              ...liveReasoning,
            }
          : {
              ...(saved ?? { compat, samplingParams, headers }),
              id,
              name,
              reasoning,
              reasoningLevels,
              defaultReasoningLevel,
              thinkingLevelMap,
              input,
              // Keep a pricing refresh or user edit that completed during discovery.
              cost:
                previous && saved && !isDeepStrictEqual(previous.cost, saved.cost)
                  ? saved.cost
                  : cost,
              // A prompt-cap refresh or user edit may have lowered the window
              // while this verification was fetching its own endpoint limits.
              contextWindow:
                previous && saved && previous.contextWindow !== saved.contextWindow
                  ? Math.min(contextWindow, positive(saved.contextWindow, contextWindow))
                  : contextWindow,
              maxTokens,
              api,
              baseUrl: saved?.baseUrl ?? baseUrl,
            };
      if (saved && isDeepStrictEqual(saved, snapshot)) return false;
      config.models = [...(config.models ?? []).filter((m) => m.id !== id), snapshot];
      return true;
    };
    // Even a no-write verification must reject stale discovery and reload model
    // edits. Avoid creating a write lock when the configuration is read-only.
    if (persist) await updateModelsConfig(this.modelsPath, apply);
    else apply(await configFile(this.modelsPath));
    await this.runtime().refresh({ allowNetwork: false, signal: AbortSignal.timeout(8_000) });
  }
  /**
   * Bound saved OpenRouter models by their endpoints' current prompt cap, so a model
   * saved before the cap was published (or checked) compacts in time without re-selection.
   * Also refresh matching endpoint prices so already-selected models gain pricing tiers.
   */
  async refreshPromptCaps(): Promise<void> {
    const updates = new Map<
      string,
      { baseUrl: string; oldCost: unknown; cost?: ChatModel["cost"]; cap?: number }
    >();
    for (const model of (await configFile(this.modelsPath)).providers?.openrouter?.models ?? []) {
      if (!validId(model.id) || typeof model.baseUrl !== "string") continue;
      const endpoints = await this.openRouterEndpoints({ id: model.id, baseUrl: model.baseUrl });
      const cap = openRouterEndpointPromptCap(endpoints);
      const cost = openRouterEndpointCost(endpoints, model.cost);
      if (
        (cap && cap < positive(model.contextWindow, Infinity)) ||
        (cost && !isDeepStrictEqual(cost, model.cost))
      ) {
        updates.set(model.id, { baseUrl: model.baseUrl, oldCost: model.cost, cap, cost });
      }
    }
    if (!updates.size) return;
    // Re-read so a selection saved during the lookups isn't overwritten.
    const document = await configFile(this.modelsPath);
    let changed = false;
    for (const model of document.providers?.openrouter?.models ?? []) {
      const update = updates.get(String(model.id));
      if (!update || model.baseUrl !== update.baseUrl) continue;
      if (update.cap && update.cap < positive(model.contextWindow, Infinity)) {
        model.contextWindow = update.cap;
        changed = true;
      }
      if (
        update.cost &&
        isDeepStrictEqual(model.cost, update.oldCost) &&
        !isDeepStrictEqual(model.cost, update.cost)
      ) {
        model.cost = update.cost;
        changed = true;
      }
    }
    if (changed) await this.save(document);
  }
  /** Adds a custom endpoint. It never replaces a built-in provider or an existing entry. */
  async addCustom(id: string, entry: CustomConfig): Promise<void> {
    const document = await configFile(this.modelsPath);
    const configured = Object.hasOwn(document.providers ?? {}, id);
    if (!configured && (CHAT_PROVIDERS.has(id) || this.runtime().getProvider(id)))
      throw new Error(`Custom providers cannot replace built-in provider ${id}`);
    if (configured) throw new Error(`Custom provider ${id} already exists`);
    document.providers = { ...document.providers, [id]: entry };
    await this.save(document);
  }
  /** Removes a custom endpoint from the registry; built-in providers are not removable. */
  async removeCustom(providerId: string): Promise<void> {
    const document = await configFile(this.modelsPath);
    if (!Object.hasOwn(document.providers ?? {}, providerId))
      throw new Error(`Custom provider ${providerId} is not configured`);
    const { [providerId]: _removed, ...rest } = document.providers ?? {};
    document.providers = rest;
    await this.save(document);
  }
  private async save(document: Config): Promise<void> {
    await mkdir(dirname(this.modelsPath), { recursive: true, mode: 0o700 });
    const temp = `${this.modelsPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(document, null, 2) + "\n", { mode: 0o600 });
      await rename(temp, this.modelsPath);
    } finally {
      await rm(temp, { force: true });
    }
    await this.runtime().refresh({ allowNetwork: false, signal: AbortSignal.timeout(8_000) });
  }
  /** Endpoint metadata is shared by prompt-cap and pricing refreshes. */
  private async openRouterEndpoints(model: Pick<ChatModel, "id" | "baseUrl">): Promise<unknown> {
    try {
      const signal = AbortSignal.timeout(8_000);
      const url = modelsEndpoint(model.baseUrl);
      url.pathname += `/${model.id.split("/").map(encodeURIComponent).join("/")}/endpoints`;
      const headers = new Headers({ accept: "application/json" });
      const apiKey = (await this.runtime().getAuth("openrouter", { signal }))?.auth.apiKey;
      if (apiKey && apiKey !== KEYLESS_API_KEY) headers.set("authorization", `Bearer ${apiKey}`);
      const response = await this.fetchImpl(url, { headers, signal, redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        return undefined;
      }
      return await responseJson(response);
    } catch {
      return undefined;
    }
  }
}
class DiscoveryError extends Error {}

/** The error code a failed fetch carries, on the error or its cause. */
export const failureCode = (error: unknown): string => {
  const read = (value: unknown): string =>
    object(value) && typeof value.code === "string" ? value.code : "";
  return read(error) || (object(error) ? read(error.cause) : "");
};

/**
 * A fixed sentence for a failed model-list request, chosen by the cause. Never the raw
 * message: it can carry the address, and fixed sentences are the ones the apps translate.
 */
export const describeDiscoveryFailure = (error: unknown): string => {
  const code = failureCode(error);
  const name = object(error) && typeof error.name === "string" ? error.name : "";
  if (/CERT|SELF_SIGNED|UNABLE_TO_(VERIFY|GET)|ISSUER|TLS|SSL/i.test(code))
    return "The server's TLS certificate could not be verified. The computer may lack the issuing certificate, or the server may not send its full certificate chain.";
  if (code === "UnexpectedRedirect")
    return "The endpoint redirected the request. Use the final API base URL.";
  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT")
    return "The provider did not answer in time. Check the address and the server's network.";
  if (code === "ECONNREFUSED")
    return "The connection was refused. Check the address and port, and that the service is running.";
  if (/^(ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ENETUNREACH)$/.test(code))
    return "The provider could not be reached. Check the address and the server's network.";
  return "Could not load chat models. Check the endpoint and credentials, then refresh the provider.";
};
