import registry from "../_generated/registry.json";
import { parsePluginDefinition } from "@outcomego/plugin-sdk";
export const pluginCatalog = registry.map(parsePluginDefinition);
