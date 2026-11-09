import type { AddInferenceProviderInput } from "../../../packages/contracts/src/inference-presets";
import type {
  InferenceModelView,
  InferenceProviderAuthSessionView,
  PiReasoningLevel,
  ServerInferenceSettings,
  ServerSettingsView,
} from "../../../packages/contracts/src/inference";
import type {
  TranscriptionSettingsInput,
  TranscriptionSettingsView,
} from "../../../packages/contracts/src/transcription";

/** Deterministic setup endpoints for the native and desktop UI regressions.
 * Keep HTTP methods strict: accepting PATCH here hid a broken iOS voice save. */
export class ServerSetupFixture {
  constructor(private readonly modelSettings = false) {}
  inference: ServerInferenceSettings = {
    providerId: "openrouter",
    modelId: "qa-saved-model",
    reasoning: "off",
  };
  largeModelCatalog = false;
  saves: ServerInferenceSettings[] = [];
  tests: ServerInferenceSettings[] = [];
  private openaiConnected = false;
  /** Providers added by hand, keyed by id, with the request that added them. */
  added = new Map<string, { input: AddInferenceProviderInput; key: string | null }>();
  private session: InferenceProviderAuthSessionView | null = null;
  voice: TranscriptionSettingsView = {
    enabled: false,
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini-transcribe",
    language: "",
    hasApiKey: false,
    configured: false,
  };

  settings(provider = this.inference.providerId): ServerSettingsView {
    const extras: InferenceModelView[] = this.largeModelCatalog
      ? Array.from({ length: 20 }, (_, index) => {
          const maker = index % 2 ? "Anthropic" : "OpenAI";
          return {
            providerId: "openrouter",
            modelId: `${maker.toLowerCase()}/qa-model-${index}`,
            name: `${maker}: QA model ${index}`,
            reasoning: true,
            reasoningLevels: ["off", "low", "high"],
            defaultReasoningLevel: "low",
            contextWindow: 128000,
            maxTokens: 4096,
          };
        })
      : [];
    return {
      inference: { ...this.inference },
      providers: [
        ...["openrouter", "openai"].map((id) => ({
          id,
          name: id === "openrouter" ? "OpenRouter" : "OpenAI",
          custom: false,
          authMethods: [{ type: "api_key" as const, label: "API key", subscription: false }],
          connected: id === "openrouter" || this.openaiConnected,
          authType: id === "openrouter" || this.openaiConnected ? ("api_key" as const) : null,
          authSource: null,
          modelCount:
            id === "openrouter"
              ? (this.modelSettings ? 2 : 1) + extras.length
              : this.openaiConnected
                ? 1
                : 0,
        })),
        ...[...this.added].map(([id, { input, key }]) => ({
          id,
          name: input.name,
          custom: true,
          icon: input.presetId === "deepseek-api" ? "deepseek-color" : "generic-openai-chat",
          authMethods: [{ type: "api_key" as const, label: "API key", subscription: false }],
          connected: input.noAuth === true || key !== null,
          authType: input.noAuth === true || key !== null ? ("api_key" as const) : null,
          authSource: null,
          modelCount: input.noAuth === true || key !== null ? 1 : 0,
        })),
      ],
      models: this.added.has(provider)
        ? [
            {
              providerId: provider,
              modelId: `${provider}-model`,
              name: `${this.added.get(provider)!.input.name} QA model`,
              reasoning: false,
              reasoningLevels: ["off"] as PiReasoningLevel[],
              defaultReasoningLevel: "off" as const,
              contextWindow: 128000,
              maxTokens: 4096,
              recommended: true,
            },
          ]
        : provider === "openrouter"
          ? [
              {
                providerId: provider,
                modelId: "qa-saved-model",
                name: "Saved QA model",
                reasoning: false,
                reasoningLevels: ["off"],
                defaultReasoningLevel: "off",
                contextWindow: 128000,
                maxTokens: 4096,
                recommended: true,
              },
              ...(this.modelSettings
                ? [
                    {
                      providerId: provider,
                      modelId: "qa-reasoning-model",
                      name: "Reasoning QA model",
                      reasoning: true,
                      reasoningLevels: ["off", "low", "high"] as PiReasoningLevel[],
                      defaultReasoningLevel: "low" as const,
                      contextWindow: 128000,
                      maxTokens: 4096,
                    },
                  ]
                : []),
              ...extras,
            ]
          : this.openaiConnected
            ? [
                {
                  providerId: provider,
                  modelId: "qa-openai-model",
                  name: "OpenAI QA model",
                  reasoning: true,
                  reasoningLevels: ["low", "high"],
                  defaultReasoningLevel: "low",
                  contextWindow: 128000,
                  maxTokens: 4096,
                  recommended: true,
                },
              ]
            : [],
      modelProviderId: provider,
    };
  }

  handle(path: string, method: string, input: unknown, url: URL): Response | undefined {
    if (path === "/api/v0/server-settings" && method === "GET") {
      return Response.json(this.settings(url.searchParams.get("provider") ?? undefined));
    }
    if (path === "/api/v0/server-settings/inference" && method === "PATCH") {
      const chosen = input as ServerInferenceSettings;
      const model = this.settings(chosen.providerId).models.find(
        (m) => m.modelId === chosen.modelId
      );
      if (!model || !model.reasoningLevels.includes(chosen.reasoning)) {
        return Response.json(
          { message: "Choose a model and supported reasoning effort." },
          { status: 400 }
        );
      }
      this.inference = { ...chosen };
      this.saves.push({ ...chosen });
      return Response.json(this.settings(chosen.providerId));
    }
    if (path === "/api/v0/server-settings/inference/test" && method === "POST") {
      this.tests.push({ ...this.inference });
      return Response.json({
        ok: true,
        providerId: this.inference.providerId,
        modelId: this.inference.modelId,
        latencyMs: 12,
      });
    }
    if (this.modelSettings && path === "/api/v0/inference-provider-presets" && method === "GET") {
      return Response.json([
        {
          id: "deepseek-api",
          name: "DeepSeek",
          group: "vendor",
          icon: "deepseek-color",
          endpoints: {
            "openai-completions": "https://api.deepseek.com/v1",
            "anthropic-messages": "https://api.deepseek.com/anthropic",
          },
          keysUrl: "https://platform.deepseek.com/api_keys",
        },
        {
          id: "magpie-local",
          name: "magpie",
          group: "local",
          icon: "magpie",
          endpoints: {
            "openai-completions": "http://127.0.0.1:3425/v1",
            "anthropic-messages": "http://127.0.0.1:3425",
          },
          keyOptional: true,
          note: "Another computer's magpie: use its address and the gateway key.",
        },
        {
          id: "ollama-local",
          name: "Ollama",
          group: "local",
          icon: "ollama",
          endpoints: { "openai-completions": "http://localhost:11434/v1" },
          noKey: true,
          note: "Reached from your server's computer.",
        },
      ]);
    }
    if (this.modelSettings && path === "/api/v0/inference-providers" && method === "POST") {
      const body = input as AddInferenceProviderInput;
      const id =
        body.presetId && body.api === "openai-completions"
          ? body.presetId
          : body.presetId
            ? `${body.presetId}-anthropic`
            : `custom-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (this.added.has(id))
        return Response.json({ error: { message: `Custom provider ${id} already exists` } }, { status: 400 });
      this.added.set(id, { input: body, key: null });
      return Response.json({ providerId: id }, { status: 201 });
    }
    const customSession = path.match(/^\/api\/v0\/inference-providers\/([^/]+)\/auth-sessions$/);
    if (this.modelSettings && customSession?.[1] && this.added.has(customSession[1]) && method === "POST") {
      this.session = {
        id: `qa-custom-${customSession[1]}`,
        providerId: customSession[1],
        authType: "api_key",
        status: "waiting",
        prompt: { id: "qa-custom-prompt", type: "secret", message: "API key" },
        authorizationUrl: null,
        deviceCode: null,
        messages: [],
        error: null,
      };
      return Response.json(this.session);
    }
    const customRespond = path.match(
      /^\/api\/v0\/inference-provider-auth-sessions\/qa-custom-([^/]+)\/respond$/
    );
    if (this.modelSettings && customRespond?.[1] && method === "POST") {
      const entry = this.added.get(customRespond[1]);
      const answer = input as { promptId: string; value: string };
      if (!entry || !this.session) return Response.json({ error: { message: "No session." } }, { status: 404 });
      if (answer.value !== "qa-good-key") {
        this.session = { ...this.session, status: "failed", prompt: null, error: "That key was refused." };
      } else {
        entry.key = answer.value;
        this.session = { ...this.session, status: "connected", prompt: null };
      }
      return Response.json(this.session);
    }
    const customPoll = path.match(/^\/api\/v0\/inference-provider-auth-sessions\/qa-custom-([^/]+)$/);
    if (this.modelSettings && customPoll?.[1] && method === "GET" && this.session)
      return Response.json(this.session);
    const customRemove = path.match(/^\/api\/v0\/inference-custom-providers\/([^/]+)$/);
    if (this.modelSettings && customRemove?.[1] && method === "DELETE") {
      this.added.delete(decodeURIComponent(customRemove[1]));
      return Response.json({ ok: true });
    }
    if (path === "/api/v0/inference-providers/openai/auth-sessions" && method === "POST") {
      if (this.modelSettings) {
        this.session = {
          id: "qa-model-key",
          providerId: "openai",
          authType: "api_key",
          status: "waiting",
          prompt: { id: "qa-key-prompt", type: "secret", message: "API key" },
          authorizationUrl: null,
          deviceCode: null,
          messages: [],
          error: null,
        };
        return Response.json(this.session);
      }
      return Response.json(
        { error: { message: "OpenAI didn't accept that key. Check it and try again." } },
        { status: 400 }
      );
    }
    if (
      this.modelSettings &&
      path === "/api/v0/inference-provider-auth-sessions/qa-model-key/respond" &&
      method === "POST"
    ) {
      const answer = input as { promptId: string; value: string };
      if (!this.session || answer.promptId !== "qa-key-prompt" || answer.value !== "qa-model-key") {
        return Response.json({ message: "The fixture key was refused." }, { status: 400 });
      }
      this.openaiConnected = true;
      this.session = { ...this.session, status: "connected", prompt: null };
      return Response.json(this.session);
    }
    if (this.modelSettings && path === "/api/v0/inference-provider-auth-sessions/qa-model-key") {
      if (method === "DELETE" && this.session)
        this.session = { ...this.session, status: "cancelled", prompt: null };
      if ((method === "GET" || method === "DELETE") && this.session)
        return Response.json(this.session);
    }
    if (path === "/api/v0/server-settings/transcription") {
      if (method === "GET") return Response.json(this.voice);
      if (method === "PUT") {
        const { apiKey, ...settings } = input as TranscriptionSettingsInput;
        const same =
          settings.provider === this.voice.provider && settings.baseUrl === this.voice.baseUrl;
        if (!same && this.voice.hasApiKey && apiKey === undefined)
          return Response.json({ message: "Enter a replacement key or explicitly delete the saved key before changing the transcription endpoint." }, { status: 400 });
        const hasApiKey =
          typeof apiKey === "string"
            ? Boolean(apiKey)
            : apiKey === null
              ? false
              : same && this.voice.hasApiKey;
        this.voice = {
          ...settings,
          hasApiKey,
          apiKeySuffix: hasApiKey ? typeof apiKey === "string" && apiKey.length > 4 ? apiKey.slice(-4) : this.voice.apiKeySuffix ?? null : null,
          configured:
            settings.enabled &&
            Boolean(settings.baseUrl && settings.model) &&
            (settings.provider === "openai-compatible" || hasApiKey),
        };
        return Response.json(this.voice);
      }
      return Response.json({ message: "Use PUT to save voice settings." }, { status: 405 });
    }
    if (path === "/api/v0/server-settings/transcription/check" && method === "POST") {
      return Response.json({ level: "pass", status: "ready", detail: "Voice notes are ready." });
    }
  }
}
