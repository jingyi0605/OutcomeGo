import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INFERENCE_PROVIDER_PRESETS } from "@aiteamos/contracts";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ChatProviderRegistry } from "../src/chat-provider-registry";
import { createModelRuntime } from "../src/model-runtime";

describe("preset catalog ids", () => {
  test("every catalog names a vendor in the runtime's built-in model table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aiteamos-preset-catalog-"));
    for (const file of ["auth.json", "models-store.json"]) writeFileSync(join(dir, file), "{}");
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-store.json"),
      allowModelNetwork: false,
    });
    const known = new Set(runtime.getProviders().map((p) => p.id));
    const withCatalog = INFERENCE_PROVIDER_PRESETS.filter((preset) => preset.catalog);
    expect(withCatalog.length).toBeGreaterThan(0);
    for (const preset of withCatalog) expect(known.has(preset.catalog!)).toBe(true);
  });
});

describe("a preset endpoint reuses its vendor's reasoning levels", () => {
  const setup = async (api: string) => {
    const dir = mkdtempSync(join(tmpdir(), "aiteamos-preset-borrow-"));
    writeFileSync(join(dir, "models-store.json"), "{}");
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ "ds-test": { type: "api_key", key: "sk-test" } }));
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          "ds-test": { name: "DeepSeek", baseUrl: "https://ds.test/v1", api, catalog: "deepseek", models: [] },
        },
      })
    );
    const runtime = await createModelRuntime({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-store.json"),
      allowModelNetwork: false,
    });
    const fetcher = (async () =>
      Response.json({
        data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }, { id: "not-in-the-table" }],
      })) as unknown as typeof fetch;
    return new ChatProviderRegistry(() => runtime, join(dir, "models.json"), fetcher);
  };

  test("known models get the vendor's levels; unknown ones stay without", async () => {
    const levels = Object.fromEntries(
      (await (await setup("openai-completions")).catalog("ds-test")).models.map((m) => [
        m.id,
        [m.reasoning, m.reasoningLevels ?? getSupportedThinkingLevels(m)],
      ])
    );
    expect(levels["deepseek-v4-pro"]).toEqual([true, ["off", "high", "max"]]);
    expect(levels["deepseek-v4-flash"]).toEqual([true, ["off", "low", "high", "max"]]);
    expect(levels["not-in-the-table"]).toEqual([false, ["off"]]);
  });

  test("a different wire protocol borrows nothing, since the level mapping is the protocol's", async () => {
    const models = (await (await setup("anthropic-messages")).catalog("ds-test")).models;
    expect(models.every((m) => m.reasoning === false)).toBe(true);
  });
});
