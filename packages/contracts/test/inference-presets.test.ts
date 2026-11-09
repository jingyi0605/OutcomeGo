import { describe, expect, test } from "bun:test";
import {
  CUSTOM_PROVIDER_APIS,
  INFERENCE_PROVIDER_PRESETS,
  customProviderIdFromName,
  normalizeInferenceProviderId,
  presetDefaultApi,
  presetProviderId,
  providerRowIcon,
} from "../src/index";

describe("inference provider presets", () => {
  test("every preset has unique ids and valid https or local endpoints", () => {
    const ids = INFERENCE_PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of INFERENCE_PROVIDER_PRESETS) {
      const apis = Object.keys(preset.endpoints);
      expect(apis.length).toBeGreaterThan(0);
      for (const api of apis) expect(CUSTOM_PROVIDER_APIS as readonly string[]).toContain(api);
      for (const url of Object.values(preset.endpoints)) {
        const parsed = new URL(url!);
        expect(parsed.search + parsed.hash).toBe("");
        expect(preset.group === "local" ? ["http:"] : ["https:"]).toContain(parsed.protocol);
      }
    }
  });

  test("stored ids are valid provider ids and differ per protocol", () => {
    for (const preset of INFERENCE_PROVIDER_PRESETS) {
      const ids = Object.keys(preset.endpoints).map((api) =>
        presetProviderId(preset, api as (typeof CUSTOM_PROVIDER_APIS)[number])
      );
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(normalizeInferenceProviderId(id)).toBe(id);
      expect(ids[0]).toBe(preset.id);
      expect(presetDefaultApi(preset)).toBe(Object.keys(preset.endpoints)[0] as never);
    }
  });

  test("a typed-in name becomes a safe custom id", () => {
    expect(customProviderIdFromName("My Relay #2")).toBe("custom-my-relay-2");
    expect(() => customProviderIdFromName("中文")).toThrow();
  });
});

describe("provider row icons", () => {
  test("a built-in provider uses the app's mark, a preset its own, a custom endpoint its protocol's", () => {
    expect(providerRowIcon("claude-code", undefined)).toBe("claude-color");
    expect(providerRowIcon("deepseek-api", { icon: "deepseek-color", api: "openai-completions" })).toBe("deepseek-color");
    expect(providerRowIcon("custom-mine", { api: "anthropic-messages" })).toBe("generic-anthropic-messages");
    expect(providerRowIcon("custom-mine", { api: "openai-responses" })).toBe("generic-openai-responses");
    expect(providerRowIcon("custom-mine", { api: "nonsense" })).toBeUndefined();
    expect(providerRowIcon("unknown-builtin", undefined)).toBeUndefined();
  });

  test("every preset names a valid icon", () => {
    for (const preset of INFERENCE_PROVIDER_PRESETS) expect(preset.icon).toMatch(/^[a-z0-9][a-z0-9-]{0,47}$/);
  });
});

describe("preset keys", () => {
  test("a preset is keyless or has an optional key, never both", () => {
    for (const preset of INFERENCE_PROVIDER_PRESETS) expect(Boolean(preset.noKey && preset.keyOptional)).toBe(false);
  });

  test("magpie takes a key for another computer's gateway and none for its own", () => {
    const magpie = INFERENCE_PROVIDER_PRESETS.find((preset) => preset.id === "magpie-local")!;
    expect(magpie.keyOptional).toBe(true);
    expect(magpie.noKey).toBeUndefined();
    expect(magpie.endpoints["anthropic-messages"]).toBe("http://127.0.0.1:3425");
  });
});
