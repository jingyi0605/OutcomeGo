import { describe, expect, test } from "bun:test";
import { ComputerNetworkPolicyService } from "../src/services/computer-network-policy-service";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "global",
  mode: "lan",
  rules: [],
  revision: 1,
  createdAt: new Date("2026-11-16T00:00:00Z"),
  updatedAt: new Date("2026-11-16T00:00:00Z"),
  ...overrides,
});

const database = (current = row()) => {
  let saved = current;
  return {
    computerNetworkPolicy: {
      upsert: async () => saved,
      updateMany: async ({ where, data }: any) => {
        if (where.revision !== saved.revision) return { count: 0 };
        saved = {
          ...saved,
          mode: data.mode,
          rules: data.rules,
          revision: saved.revision + 1,
          updatedAt: new Date("2026-11-16T00:01:00Z"),
        };
        return { count: 1 };
      },
    },
  } as any;
};

describe("ComputerNetworkPolicyService", () => {
  test("defaults to LAN access and exposes an unknown runtime", async () => {
    const service = new ComputerNetworkPolicyService(database());
    await expect(service.view()).resolves.toMatchObject({
      policy: { mode: "lan", revision: 1, rules: [] },
      runtime: { state: "unknown" },
    });
  });

  test("normalizes the removed managed mode to allowlist when reading old data", async () => {
    const service = new ComputerNetworkPolicyService(database(row({ mode: "managed" })));
    await expect(service.view()).resolves.toMatchObject({
      policy: { mode: "allowlist" },
    });
  });

  test("accepts private model gateway rules and advances the revision", async () => {
    const service = new ComputerNetworkPolicyService(database());
    const result = await service.update({
      expectedRevision: 1,
      mode: "allowlist",
      rules: [{ id: "model", address: "10.255.0.83", port: 3425, label: "Model gateway" }],
    });
    expect(result.policy).toMatchObject({
      mode: "allowlist",
      revision: 2,
      rules: [{ address: "10.255.0.83", port: 3425 }],
    });
  });

  test("rejects public addresses and invalid ports", async () => {
    const service = new ComputerNetworkPolicyService(database());
    await expect(
      service.update({
        expectedRevision: 1,
        mode: "allowlist",
        rules: [{ id: "public", address: "8.8.8.8", port: 443, label: null }],
      })
    ).rejects.toThrow("private IP");
    await expect(
      service.update({
        expectedRevision: 1,
        mode: "allowlist",
        rules: [{ id: "bad-port", address: "10.0.0.2", port: 0, label: null }],
      })
    ).rejects.toThrow("TCP port");
  });

  test("rejects stale revisions without overwriting the saved policy", async () => {
    const service = new ComputerNetworkPolicyService(database());
    await service.update({
      expectedRevision: 1,
      mode: "allowlist",
      rules: [],
    });
    await expect(
      service.update({
        expectedRevision: 1,
        mode: "lan",
        rules: [],
      })
    ).rejects.toThrow("changed");
  });
});
