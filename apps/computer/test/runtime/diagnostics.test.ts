import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputerRuntime } from "../../src/runtime";

test("diagnostics use the saved selection and leave new installs unconfigured", async () => {
  const root = await mkdtemp(join(tmpdir(), "outcomego-diagnostics-"));
  try {
    const runtime = new ComputerRuntime();
    const internals = runtime as unknown as {
      settingsPath: string;
      refreshAuthentication(): Promise<void>;
      modelRuntime: unknown;
      started: boolean;
      resolveModel: (ref: unknown) => unknown;
    };
    internals.settingsPath = join(root, "settings.json");
    internals.started = true;
    const authProviders: string[] = [];
    internals.modelRuntime = {
      checkAuth: async (provider: string) => {
        authProviders.push(provider);
        return { type: "api_key" };
      },
      isUsingSubscription: () => false,
    };
    runtime.start = () => internals.refreshAuthentication();
    await runtime.start();
    expect(runtime.diagnostics.model).toBe("");
    expect(runtime.diagnostics.qualifiedModel).toBe("");
    expect(await runtime.inferenceDiagnostics()).toMatchObject({ ready: true, model: "", authenticated: false });

    const inference = { providerId: "custom", modelId: "saved-model", reasoning: "off" };
    await writeFile(internals.settingsPath, JSON.stringify({ inference }));
    internals.resolveModel = (ref) => {
      expect(ref).toMatchObject({ providerId: "custom", modelId: "saved-model" });
      return { reasoning: false };
    };
    expect(await runtime.inferenceDiagnostics()).toMatchObject({
      inferenceProvider: "custom",
      model: "saved-model",
      reasoning: "off",
    });
    expect(runtime.diagnostics.qualifiedModel).toBe("custom/saved-model");
    expect(authProviders.at(-1)).toBe("custom");

    await writeFile(
      internals.settingsPath,
      JSON.stringify({ inference: { ...inference, modelId: "" } })
    );
    expect(await runtime.inferenceDiagnostics()).toMatchObject({ model: "", authenticated: false });
    expect(runtime.diagnostics.model).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a saved model the registry no longer has is reported, not thrown, and its provider can't be removed while in use", async () => {
  const root = await mkdtemp(join(tmpdir(), "outcomego-diagnostics-missing-"));
  try {
    const runtime = new ComputerRuntime();
    const internals = runtime as unknown as {
      settingsPath: string;
      refreshAuthentication(): Promise<void>;
      modelRuntime: unknown;
      started: boolean;
      inferenceProviders: { removeCustom(id: string): Promise<void> };
    };
    internals.settingsPath = join(root, "settings.json");
    internals.started = true;
    internals.modelRuntime = {
      checkAuth: async () => ({ type: "api_key" }),
      isUsingSubscription: () => false,
      // The registry has no such model: what remains after its provider was removed and re-added.
      getModel: () => undefined,
      getModels: () => [],
    };
    runtime.start = () => internals.refreshAuthentication();
    const removed: string[] = [];
    internals.inferenceProviders = { removeCustom: async (id: string) => void removed.push(id) };
    await writeFile(
      internals.settingsPath,
      JSON.stringify({ inference: { providerId: "gone-api", modelId: "saved-model", reasoning: "off" } })
    );
    await runtime.start();

    // The health check gets an answer, so the computer stays healthy while bots wait for a model.
    const report = await runtime.inferenceDiagnostics();
    expect(report).toMatchObject({ ready: false, authenticated: false, model: "saved-model" });
    expect(String((report as { error?: string }).error)).toContain("gone-api/saved-model");
    // A caller that asked for a specific model still gets the error.
    await expect(runtime.inferenceDiagnostics("gone-api/saved-model")).rejects.toThrow("does not provide");

    // The provider in use stays; any other one can go.
    await expect(runtime.removeCustomInferenceProvider("gone-api")).rejects.toThrow("bots use now");
    expect(removed).toEqual([]);
    await runtime.removeCustomInferenceProvider("other-api");
    expect(removed).toEqual(["other-api"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
