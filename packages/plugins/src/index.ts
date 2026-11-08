import registry from "../_generated/registry.json";
import { parsePluginDefinition } from "@aiteamos/plugin-sdk";
export const pluginCatalog = registry.map(parsePluginDefinition);
