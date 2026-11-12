import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InferenceProviderService } from "../src/inference-providers";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const service = async () => {
  const dir = await mkdtemp(join(tmpdir(), "outcomego-custom-provider-"));
  dirs.push(dir);
  const path = join(dir, "models.json");
  const loggedOut: string[] = [];
  const providers = () => {
    let added: Record<string, { name?: string }> = {};
    try {
      added = JSON.parse(readFileSync(path, "utf8")).providers ?? {};
    } catch {}
    return [
      { id: "openai", name: "OpenAI", auth: {} },
      ...Object.entries(added).map(([id, entry]) => ({ id, name: entry.name ?? id, auth: {} })),
    ];
  };
  const runtime = {
    // Like the real runtime, it lists the built-in provider and whatever models.json holds.
    getProviders: () => providers(),
    getProvider: (id: string) => providers().find((provider) => provider.id === id),
    refresh: async () => {},
    checkAuth: async () => undefined,
    getModels: () => [],
    logout: async (id: string) => void loggedOut.push(id),
  } as unknown as ModelRuntime;
  return { svc: new InferenceProviderService(() => runtime, path), path, loggedOut };
};

const input = (over: Record<string, unknown> = {}) => ({
  id: "deepseek-api",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1",
  api: "openai-completions",
  createOnly: true,
  ...over,
});

describe("custom providers over the standard protocols", () => {
  test.each([
    ["openai-completions", "https://api.example.com/v1"],
    ["openai-responses", "https://api.example.com/v1"],
    ["anthropic-messages", "https://api.example.com"],
  ])("stores a %s endpoint", async (api, baseUrl) => {
    const { svc, path } = await service();
    expect(await svc.addCustom(input({ api, baseUrl }))).toEqual({ providerId: "deepseek-api" });
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.providers["deepseek-api"]).toMatchObject({ api, baseUrl, models: [] });
  });

  test("rejects a duplicate, a built-in id and unsupported input", async () => {
    const { svc } = await service();
    await svc.addCustom(input());
    await expect(svc.addCustom(input())).rejects.toThrow("already exists");
    await expect(svc.addCustom(input({ id: "openai" }))).rejects.toThrow("built-in");
    await expect(svc.addCustom(input({ api: "google-generative-ai", id: "g" }))).resolves.toBeDefined();
    await expect(svc.addCustom(input({ id: "a", baseUrl: "ftp://x.test" }))).rejects.toThrow();
    await expect(svc.addCustom(input({ id: "b", baseUrl: "https://x.test/v1/chat/completions" }))).rejects.toThrow("/v1");
    await expect(svc.addCustom(input({ id: "c", api: "anthropic-messages", noAuth: true }))).rejects.toThrow();
  });

  test("removing forgets the key and refuses what was never added", async () => {
    const { svc, path, loggedOut } = await service();
    await svc.addCustom(input());
    await svc.removeCustom("deepseek-api");
    expect(JSON.parse(await readFile(path, "utf8")).providers).toEqual({});
    expect(loggedOut).toEqual(["deepseek-api"]);
    await expect(svc.removeCustom("openai")).rejects.toThrow("not configured");
  });
});

describe("custom provider icons", () => {
  test("the catalog carries a preset's icon, else the protocol's generic one", async () => {
    const { svc } = await service();
    await svc.addCustom(input({ icon: "deepseek-color" }));
    await svc.addCustom(input({ id: "mine", name: "Mine", baseUrl: "https://x.test/v1", api: "anthropic-messages" }));
    await expect(svc.addCustom(input({ id: "bad", icon: "../etc/passwd" }))).rejects.toThrow("icon");
    const view = await svc.catalog();
    const icons = Object.fromEntries(view.providers.map((p) => [p.id, p.icon]));
    expect(icons["deepseek-api"]).toBe("deepseek-color");
    expect(icons["mine"]).toBe("generic-anthropic-messages");
  });
});
