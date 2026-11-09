/**
 * Provider presets for the three standard wire protocols. A preset is only a name, the
 * endpoints a vendor documents for each protocol, and where its keys are made. Clients
 * render this catalog and send the chosen endpoint back; the server stores it as a
 * custom provider, so adding a vendor is a data change here and nothing else.
 */

export const CUSTOM_PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
] as const;
export type CustomProviderApi = (typeof CUSTOM_PROVIDER_APIS)[number];

export const CUSTOM_PROVIDER_API_LABELS: Readonly<Record<CustomProviderApi, string>> = {
  "openai-completions": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};

export type InferenceProviderPresetGroup = "vendor" | "cloud" | "relay" | "local";

export interface InferenceProviderPreset {
  /** Stable key; the stored provider id is derived from it (see `presetProviderId`). */
  id: string;
  name: string;
  group: InferenceProviderPresetGroup;
  /** API base URL for each protocol the vendor documents, first is the default. */
  endpoints: Partial<Record<CustomProviderApi, string>>;
  keysUrl?: string;
  /** Local servers that accept requests without a key. */
  noKey?: boolean;
  /** The key field is shown but may stay empty (a local server that only asks for a key from other computers). */
  keyOptional?: boolean;
  /** One line shown under the name. */
  note?: string;
  /** The vendor's mark: a file name (no extension) in the provider icon set, see docs/provider-icons.md. */
  icon: string;
  /**
   * The id of the same vendor in the runtime's built-in model table. Its models' reasoning
   * levels and request quirks are reused for this endpoint, so a level is never guessed.
   */
  catalog?: string;
}

export interface AddInferenceProviderInput {
  /** The preset this came from, if any; it names the stored provider. */
  presetId?: string;
  name: string;
  baseUrl: string;
  api: CustomProviderApi;
  noAuth?: boolean;
}

export interface AddInferenceProviderResult {
  providerId: string;
}

const local = "Reached from your server's computer, so use an address that computer can open.";

/**
 * Pay-as-you-go endpoints only. Plans that restrict a key to named client apps are left
 * out; add those as a custom endpoint if your plan allows API clients.
 */
export const INFERENCE_PROVIDER_PRESETS: readonly InferenceProviderPreset[] = [
  {
    id: "deepseek-api",
    icon: "deepseek-color",
    catalog: "deepseek",
    name: "DeepSeek",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.deepseek.com/v1",
      "openai-responses": "https://api.deepseek.com/v1",
      "anthropic-messages": "https://api.deepseek.com/anthropic",
    },
    keysUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "gemini-api",
    icon: "gemini-color",
    catalog: "google",
    name: "Google Gemini",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://generativelanguage.googleapis.com/v1beta/openai",
    },
    keysUrl: "https://aistudio.google.com/apikey",
    note: "Gemini Developer API",
  },
  {
    id: "xai-api",
    icon: "xai",
    catalog: "xai",
    name: "xAI",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.x.ai/v1",
      "openai-responses": "https://api.x.ai/v1",
      "anthropic-messages": "https://api.x.ai",
    },
    keysUrl: "https://console.x.ai",
  },
  {
    id: "mistral-api",
    icon: "mistral-color",
    catalog: "mistral",
    name: "Mistral",
    group: "vendor",
    endpoints: { "openai-completions": "https://api.mistral.ai/v1" },
    keysUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "moonshot-api",
    icon: "kimi",
    catalog: "moonshotai",
    name: "Kimi",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.moonshot.ai/v1",
      "anthropic-messages": "https://api.moonshot.ai/anthropic",
    },
    keysUrl: "https://platform.kimi.ai/console/api-keys",
    note: "Global",
  },
  {
    id: "moonshot-cn-api",
    icon: "kimi",
    catalog: "moonshotai-cn",
    name: "Kimi (China)",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.moonshot.cn/v1",
      "anthropic-messages": "https://api.moonshot.cn/anthropic",
    },
    keysUrl: "https://platform.kimi.com/console/api-keys",
  },
  {
    id: "zhipu-api",
    icon: "zhipu-color",
    catalog: "zai",
    name: "Zhipu GLM",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://open.bigmodel.cn/api/paas/v4",
      "anthropic-messages": "https://open.bigmodel.cn/api/anthropic",
    },
    keysUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    note: "Pay as you go",
  },
  {
    id: "zai-api",
    icon: "zai",
    catalog: "zai",
    name: "Z.ai",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.z.ai/api/paas/v4",
      "anthropic-messages": "https://api.z.ai/api/anthropic",
    },
    keysUrl: "https://z.ai/manage-apikey/apikey-list",
    note: "Pay as you go",
  },
  {
    id: "minimax-api",
    icon: "minimax-color",
    catalog: "minimax",
    name: "MiniMax",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.minimax.io/v1",
      "anthropic-messages": "https://api.minimax.io/anthropic",
    },
    keysUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    note: "Global",
  },
  {
    id: "minimax-cn-api",
    icon: "minimax-color",
    catalog: "minimax-cn",
    name: "MiniMax (China)",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.minimaxi.com/v1",
      "anthropic-messages": "https://api.minimaxi.com/anthropic",
    },
    keysUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  },
  {
    id: "stepfun-api",
    icon: "stepfun-color",
    name: "StepFun",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.stepfun.ai/v1",
      "anthropic-messages": "https://api.stepfun.ai",
    },
    keysUrl: "https://platform.stepfun.ai/interface-key",
    note: "Global",
  },
  {
    id: "stepfun-cn-api",
    icon: "stepfun-color",
    name: "StepFun (China)",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.stepfun.com/v1",
      "anthropic-messages": "https://api.stepfun.com",
    },
    keysUrl: "https://platform.stepfun.com/interface-key",
  },
  {
    id: "xiaomi-api",
    icon: "xiaomimimo",
    catalog: "xiaomi",
    name: "Xiaomi MiMo",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.xiaomimimo.com/v1",
      "openai-responses": "https://api.xiaomimimo.com/v1",
      "anthropic-messages": "https://api.xiaomimimo.com/anthropic",
    },
    keysUrl: "https://platform.xiaomimimo.com",
    note: "Pay as you go",
  },
  {
    id: "longcat-api",
    icon: "longcat",
    name: "LongCat",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.longcat.chat/openai/v1",
      "openai-responses": "https://api.longcat.chat/openai/v1",
      "anthropic-messages": "https://api.longcat.chat/anthropic",
    },
    keysUrl: "https://longcat.chat/platform/api_keys",
  },
  {
    id: "qwen-intl-api",
    icon: "qwen-color",
    name: "Qwen",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      "anthropic-messages": "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    },
    keysUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
    note: "Alibaba Cloud Model Studio, global",
  },
  {
    id: "qwen-cn-api",
    icon: "qwen-color",
    name: "Qwen (China)",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "anthropic-messages": "https://dashscope.aliyuncs.com/apps/anthropic",
    },
    keysUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    note: "Alibaba Cloud Bailian",
  },
  {
    id: "groq-api",
    icon: "groq",
    catalog: "groq",
    name: "Groq",
    group: "vendor",
    endpoints: {
      "openai-completions": "https://api.groq.com/openai/v1",
      "openai-responses": "https://api.groq.com/openai/v1",
    },
    keysUrl: "https://console.groq.com/keys",
  },
  {
    id: "baidu-qianfan-api",
    icon: "baiducloud-color",
    name: "Baidu Qianfan",
    group: "cloud",
    endpoints: {
      "openai-completions": "https://qianfan.baidubce.com/v2",
      "openai-responses": "https://qianfan.baidubce.com/v2",
      "anthropic-messages": "https://qianfan.baidubce.com/anthropic",
    },
    keysUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
  },
  {
    id: "tencent-tokenhub-api",
    icon: "tencentcloud-color",
    name: "Tencent Cloud TokenHub",
    group: "cloud",
    endpoints: {
      "openai-completions": "https://tokenhub.tencentmaas.com/v1",
      "openai-responses": "https://tokenhub.tencentmaas.com/v1",
      "anthropic-messages": "https://tokenhub.tencentmaas.com",
    },
    keysUrl: "https://console.cloud.tencent.com/tokenhub/apikey",
    note: "China",
  },
  {
    id: "tencent-tokenhub-intl-api",
    icon: "tencentcloud-color",
    name: "Tencent Cloud TokenHub (Global)",
    group: "cloud",
    endpoints: {
      "openai-completions": "https://tokenhub-intl.tencentmaas.com/v1",
      "openai-responses": "https://tokenhub-intl.tencentmaas.com/v1",
      "anthropic-messages": "https://tokenhub-intl.tencentmaas.com",
    },
    keysUrl: "https://console.tencentcloud.com/tokenhub/apikey",
  },
  {
    id: "huawei-maas-api",
    icon: "huaweicloud-color",
    name: "Huawei Cloud MaaS",
    group: "cloud",
    endpoints: {
      "openai-completions": "https://api.modelarts-maas.com/openai/v1",
      "anthropic-messages": "https://api.modelarts-maas.com/anthropic",
    },
    keysUrl: "https://console.huaweicloud.com/modelarts/?#/model-studio/authmanage",
    note: "Pay as you go",
  },
  {
    id: "volcengine-ark-api",
    icon: "volcengine-color",
    name: "Volcengine Ark",
    group: "cloud",
    endpoints: {
      "openai-completions": "https://ark.cn-beijing.volces.com/api/v3",
      "openai-responses": "https://ark.cn-beijing.volces.com/api/v3",
    },
    keysUrl: "https://ark.volcengine.com/region:cn-beijing/apikey",
    note: "Pay as you go",
  },
  {
    id: "together-api",
    icon: "together-color",
    catalog: "together",
    name: "Together AI",
    group: "relay",
    endpoints: { "openai-completions": "https://api.together.xyz/v1" },
    keysUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    id: "fireworks-api",
    icon: "fireworks-color",
    catalog: "fireworks",
    name: "Fireworks",
    group: "relay",
    endpoints: { "openai-completions": "https://api.fireworks.ai/inference/v1" },
    keysUrl: "https://app.fireworks.ai/settings/users/api-keys",
  },
  {
    id: "siliconflow-cn-api",
    icon: "siliconcloud-color",
    name: "SiliconFlow",
    group: "relay",
    endpoints: { "openai-completions": "https://api.siliconflow.cn/v1" },
    keysUrl: "https://cloud.siliconflow.cn/account/ak",
    note: "China",
  },
  {
    id: "siliconflow-intl-api",
    icon: "siliconcloud-color",
    name: "SiliconFlow (Global)",
    group: "relay",
    endpoints: { "openai-completions": "https://api.siliconflow.com/v1" },
    keysUrl: "https://cloud.siliconflow.com/account/ak",
  },
  {
    id: "nvidia-nim-api",
    icon: "nvidia-color",
    catalog: "nvidia",
    name: "NVIDIA NIM",
    group: "relay",
    endpoints: { "openai-completions": "https://integrate.api.nvidia.com/v1" },
    keysUrl: "https://build.nvidia.com/settings/api-keys",
  },
  {
    id: "modelscope-api",
    icon: "modelscope-color",
    name: "ModelScope",
    group: "relay",
    endpoints: {
      "openai-completions": "https://api-inference.modelscope.cn/v1",
      "openai-responses": "https://api-inference.modelscope.cn/v1",
    },
    keysUrl: "https://modelscope.cn/my/myaccesstoken",
  },
  {
    id: "ollama-cloud-api",
    icon: "ollama",
    name: "Ollama Cloud",
    group: "relay",
    endpoints: {
      "openai-completions": "https://ollama.com/v1",
      "anthropic-messages": "https://ollama.com",
    },
    keysUrl: "https://ollama.com/settings/keys",
  },
  {
    id: "nous-api",
    icon: "nousresearch",
    name: "Nous Portal",
    group: "relay",
    endpoints: { "openai-completions": "https://inference-api.nousresearch.com/v1" },
    keysUrl: "https://portal.nousresearch.com",
  },
  {
    id: "aihubmix-api",
    icon: "aihubmix-color",
    name: "AiHubMix",
    group: "relay",
    endpoints: {
      "openai-completions": "https://aihubmix.com/v1",
      "anthropic-messages": "https://aihubmix.com",
    },
    keysUrl: "https://console.aihubmix.com/token",
  },
  {
    id: "pipellm-api",
    icon: "pipellm-color",
    name: "PipeLLM",
    group: "relay",
    endpoints: {
      "openai-completions": "https://api.pipellm.ai/openai/v1",
      "openai-responses": "https://api.pipellm.ai/v1",
      "anthropic-messages": "https://api.pipellm.ai",
    },
    keysUrl: "https://console.pipellm.ai",
  },
  {
    id: "302ai-api",
    icon: "ai302-color",
    name: "302.AI",
    group: "relay",
    endpoints: {
      "openai-completions": "https://api.302.ai/v1",
      "anthropic-messages": "https://api.302.ai",
    },
    keysUrl: "https://302.ai/api-keys/list",
  },
  {
    id: "cherryin-api",
    icon: "cherryin-color",
    name: "CherryIN",
    group: "relay",
    endpoints: {
      "openai-completions": "https://open.cherryin.ai/v1",
      "openai-responses": "https://open.cherryin.ai/v1",
      "anthropic-messages": "https://open.cherryin.ai",
    },
    keysUrl: "https://open.cherryin.ai/console/token",
  },
  {
    id: "opencode-go-api",
    icon: "opencode",
    catalog: "opencode-go",
    name: "OpenCode Go",
    group: "relay",
    endpoints: {
      "openai-completions": "https://opencode.ai/zen/go/v1",
      "openai-responses": "https://opencode.ai/zen/go/v1",
      "anthropic-messages": "https://opencode.ai/zen/go",
    },
    keysUrl: "https://opencode.ai/auth",
  },
  {
    id: "magpie-local",
    name: "magpie",
    group: "local",
    icon: "magpie",
    endpoints: {
      "openai-completions": "http://127.0.0.1:3425/v1",
      "openai-responses": "http://127.0.0.1:3425/v1",
      "anthropic-messages": "http://127.0.0.1:3425",
    },
    keyOptional: true,
    note: "Another computer's magpie: use its address and the gateway key under Settings → Network and sharing → Share on local network. Leave the key empty for the magpie on this server's own computer.",
  },
  {
    id: "ollama-local",
    icon: "ollama",
    name: "Ollama",
    group: "local",
    endpoints: {
      "openai-completions": "http://localhost:11434/v1",
      "anthropic-messages": "http://localhost:11434",
    },
    noKey: true,
    note: local,
  },
  {
    id: "lmstudio-local",
    icon: "lmstudio",
    name: "LM Studio",
    group: "local",
    endpoints: { "openai-completions": "http://localhost:1234/v1" },
    noKey: true,
    note: local,
  },
];

const API_SUFFIX: Readonly<Record<CustomProviderApi, string>> = {
  "openai-completions": "chat",
  "openai-responses": "responses",
  "anthropic-messages": "anthropic",
};

export const findInferenceProviderPreset = (
  presetId: string | undefined
): InferenceProviderPreset | undefined =>
  presetId ? INFERENCE_PROVIDER_PRESETS.find((preset) => preset.id === presetId) : undefined;

/** The protocol a preset is added with unless the person picks another. */
export const presetDefaultApi = (preset: InferenceProviderPreset): CustomProviderApi =>
  CUSTOM_PROVIDER_APIS.find((api) => preset.endpoints[api]) ?? "openai-completions";

/**
 * The stored provider id. A preset keeps its own id for its default protocol, so adding
 * the same vendor on another protocol gets a distinct provider instead of a clash.
 */
export const presetProviderId = (preset: InferenceProviderPreset, api: CustomProviderApi): string =>
  api === presetDefaultApi(preset) ? preset.id : `${preset.id}-${API_SUFFIX[api]}`;

/** An id for an endpoint the person typed in: `custom-` plus the name, lowercased. */
export const customProviderIdFromName = (name: string): string => {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!slug) throw new Error("Use letters or digits in the provider name");
  return `custom-${slug}`;
};

/** Marks for the providers the runtime ships, by provider id. */
export const BUILTIN_PROVIDER_ICONS: Readonly<Record<string, string>> = {
  "openai-codex": "openai",
  "claude-code": "claude-color",
  openai: "openai",
  anthropic: "anthropic",
  openrouter: "openrouter",
};

/** A custom endpoint with no vendor mark shows its protocol's generic one. */
export const GENERIC_PROTOCOL_ICONS: Readonly<Record<CustomProviderApi, string>> = {
  "openai-completions": "generic-openai-chat",
  "openai-responses": "generic-openai-responses",
  "anthropic-messages": "generic-anthropic-messages",
};

/** The icon a provider row shows: its own mark, else its protocol's generic one. */
export const providerRowIcon = (
  providerId: string,
  custom: { icon?: string; api?: string } | undefined
): string | undefined => {
  if (!custom) return BUILTIN_PROVIDER_ICONS[providerId];
  if (custom.icon) return custom.icon;
  return (CUSTOM_PROVIDER_APIS as readonly string[]).includes(custom.api ?? "")
    ? GENERIC_PROTOCOL_ICONS[custom.api as CustomProviderApi]
    : undefined;
};
