import { parsePluginDefinition } from "@aiteamos/plugin-sdk";
import definition from "./utility-plugin.json";

export function createUtilityPluginFixture(key = "test-utility") {
  return parsePluginDefinition({ ...structuredClone(definition), key });
}
