import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { startComputerNetworkPolicy } from "../src/computer-network-policy";

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
    for (let i = 0; i < 100 && policy.status().state !== "applied"; i++) {
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
