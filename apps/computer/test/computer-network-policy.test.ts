import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  readPrivateModelEndpoints,
  startComputerNetworkPolicy,
} from "../src/computer-network-policy";

test("private bridge endpoint validation rejects unsafe configuration", async () => {
  const child = Bun.spawn(
    [
      "python3",
      resolve(import.meta.dirname, "../../../scripts/imessage-bridge-linux/test_network.py"),
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    }
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
}, 5000);

test("retries a policy after a transient apply failure", async () => {
  let attempts = 0;
  let applied = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        mode: "lan",
        rules: [],
        revision: 1,
      }),
  });
  const policy = startComputerNetworkPolicy({
    serverUrl: `http://127.0.0.1:${server.port}`,
    token: "fixture-token",
    intervalMs: 10,
    apply: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient apply failure");
      return { modelEndpointCount: 1 };
    },
    applied: () => {
      applied += 1;
    },
  });
  try {
    // The first retry has a one-second backoff; allow time for the subsequent fetch and apply.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && policy.status().state !== "applied") {
      await Bun.sleep(10);
    }
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(policy.status()).toMatchObject({
      state: "applied",
      appliedRevision: 1,
      modelEndpointCount: 1,
    });
    expect(applied).toBe(1);
  } finally {
    policy.stop();
    server.stop();
  }
}, 5000);

test("public model-config writes do not re-apply policy or invalidate active routes, while private-IP endpoints do", async () => {
  const dir = await mkdtemp(join(tmpdir(), "outcomego-policy-models-"));
  const modelsPath = join(dir, "models.json");
  await writeFile(modelsPath, JSON.stringify({ providers: {} }), { mode: 0o600 });
  await chmod(modelsPath, 0o600);
  let applied = 0;
  let applyCalls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        mode: "lan",
        rules: [],
        revision: 1,
      }),
  });
  const policy = startComputerNetworkPolicy({
    serverUrl: `http://127.0.0.1:${server.port}`,
    token: "fixture-token",
    modelsPath,
    intervalMs: 15,
    apply: async () => {
      applyCalls += 1;
      const endpoints = await readPrivateModelEndpoints(modelsPath);
      return { modelEndpointCount: endpoints.length };
    },
    applied: () => {
      applied += 1;
    },
  });
  try {
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && !predicate()) await Bun.sleep(10);
      expect(predicate()).toBe(true);
    };
    await waitFor(() => applied === 1);
    expect(applyCalls).toBe(1);

    // Adding a public cloud provider or caching a model must not re-apply policy.
    await writeFile(
      modelsPath,
      JSON.stringify({
        providers: {
          "siliconflow-cn-api": {
            baseUrl: "https://api.siliconflow.cn/v1",
            models: [{ id: "Qwen/Qwen3-8B" }],
          },
          "deepseek-api": {
            baseUrl: "https://api.deepseek.com/v1",
            models: [],
          },
        },
      }),
      { mode: 0o600 }
    );
    await chmod(modelsPath, 0o600);
    await Bun.sleep(80);
    expect(applyCalls).toBe(1);
    expect(applied).toBe(1);

    // Adding a literal private-IP provider must trigger a policy update.
    await writeFile(
      modelsPath,
      JSON.stringify({
        providers: {
          "siliconflow-cn-api": { baseUrl: "https://api.siliconflow.cn/v1" },
          "local-vllm": { baseUrl: "http://10.255.0.83:3425/v1" },
        },
      }),
      { mode: 0o600 }
    );
    await chmod(modelsPath, 0o600);
    await waitFor(() => applied === 2);
    expect(applyCalls).toBe(2);
    expect(policy.status().modelEndpointCount).toBe(1);
  } finally {
    policy.stop();
    server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 5000);
