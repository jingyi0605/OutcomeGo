import { createPluginTemplate, parsePluginDefinition } from "@outcomego/plugin-sdk";

/** A real manifest shape for tests that persist a reviewed-email connector. */
export function createReviewedEmailPlugin(key: string) {
  const plugin = createPluginTemplate("packaged-mcp", key);
  plugin.name = "Mail";
  plugin.publisher = "Test";
  const connector = plugin.connections[0]!;
  connector.key = "email";
  connector.name = "Mail";
  connector.drafts = { platform: "email", tool: "send_reviewed_email" };
  return parsePluginDefinition(plugin);
}
