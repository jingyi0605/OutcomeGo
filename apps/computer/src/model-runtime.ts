import { envApiKeyAuth } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { wrapOpenCodeProvider } from "./opencode-zen";

/** Product identities own their authentication, even when they share a transport. */
export async function createModelRuntime(
  options: NonNullable<Parameters<typeof ModelRuntime.create>[0]>
) {
  const runtime = await ModelRuntime.create(options);
  const anthropic = anthropicProvider();
  const claudeModels = runtime
    .getModels("anthropic")
    .map((model) => ({ ...model, provider: "claude-code" }));
  runtime.registerNativeProvider({
    ...anthropic,
    id: "claude-code",
    name: "Claude Code",
    auth: { oauth: anthropic.auth.oauth },
    getModels: () => claudeModels,
  });
  runtime.registerNativeProvider({
    ...anthropic,
    auth: { apiKey: envApiKeyAuth("Anthropic API key", ["ANTHROPIC_API_KEY"]) },
  });
  const openrouter = openrouterProvider();
  runtime.registerNativeProvider({ ...openrouter, auth: { apiKey: openrouter.auth.apiKey } });
  runtime.registerNativeProvider(wrapOpenCodeProvider(opencodeProvider()));
  await runtime.refresh({ allowNetwork: false });
  return runtime;
}
