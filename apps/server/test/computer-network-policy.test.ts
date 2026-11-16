import { describe, expect, test } from "bun:test";
import { normalizeComputerNetworkAddress, normalizeComputerNetworkPort } from "@outcomego/contracts";
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

const existingRule = { id: "existing", address: "10.255.0.1", port: 80, label: "Existing service" };
const addedRule = { id: "added", address: "10.255.0.75", port: 443, label: "New service" };

const approvalDatabase = (current = row({ mode: "allowlist", rules: [existingRule] }), overrides: Record<string, unknown> = {}) => {
  let saved = current;
  let approval = {
    id: "approval-1",
    botId: "bot-1",
    channelId: "channel-1",
    expectedRevision: 1,
    mode: "allowlist",
    rules: [existingRule, addedRule],
    status: "approved",
    expiresAt: new Date(Date.now() + 15 * 60_000),
    consumedAt: null as Date | null,
    ...overrides,
  };
  const tx = {
    computerNetworkPolicy: {
      findUnique: async () => saved,
      updateMany: async ({ where, data }: any) => {
        if (where.revision !== saved.revision) return { count: 0 };
        saved = { ...saved, mode: data.mode, rules: data.rules, revision: saved.revision + 1 };
        return { count: 1 };
      },
    },
    computerNetworkPolicyApproval: {
      findFirst: async () => approval.status === "approved" && approval.consumedAt === null ? approval : null,
      update: async ({ data }: any) => {
        approval = { ...approval, ...data };
        return approval;
      },
    },
  };
  return {
    db: {
      computerNetworkPolicy: { upsert: async () => saved },
      $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } as any,
    saved: () => saved,
    approval: () => approval,
  };
};

describe("ComputerNetworkPolicyService", () => {
  test("normalizes private subnets and inclusive TCP port ranges", async () => {
    const service = new ComputerNetworkPolicyService(database(row({ mode: "allowlist" })));
    await expect(service.prepareBotRequest({
      mode: "allowlist",
      rules: [
        { address: "10.20.30.99/24", port: "8000-8100" },
        { address: "192.168.10.99/255.255.255.0", port: 443 },
        { address: "fd75::1234/64", port: "080-090" },
      ],
    })).resolves.toMatchObject({
      rules: [
        { address: "10.20.30.0/24", port: "8000-8100" },
        { address: "192.168.10.0/24", port: 443 },
        { address: "fd75::/64", port: "80-90" },
      ],
    });
  });

  test.each([
    ["10.0.0.0/7", "80"],
    ["192.168.0.0/15", 80],
    ["fd00::/6", 80],
    ["10.0.0.0/33", 80],
    ["10.0.0.0/255.0.255.0", 80],
    ["10.0.0.1", "0-80"],
    ["10.0.0.1", "81-80"],
    ["10.0.0.1", "80-65536"],
  ])("rejects out-of-range subnet or port rule %s:%s", async (address, port) => {
    const service = new ComputerNetworkPolicyService(database(row({ mode: "allowlist" })));
    await expect(service.prepareBotRequest({
      mode: "allowlist",
      rules: [{ address, port }],
    })).rejects.toThrow();
  });

  test("shared rule parsers canonicalize private networks and ports", () => {
    expect(normalizeComputerNetworkAddress("10.20.30.99/24")).toBe("10.20.30.0/24");
    expect(normalizeComputerNetworkAddress("10.20.30.99/255.255.255.0")).toBe("10.20.30.0/24");
    expect(normalizeComputerNetworkAddress("10.0.0.0/7")).toBeNull();
    expect(normalizeComputerNetworkAddress("010.0.0.1")).toBeNull();
    expect(normalizeComputerNetworkPort("080-090")).toBe("80-90");
    expect(normalizeComputerNetworkPort("81-80")).toBeNull();
  });
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

  test("requires rules for allowlist requests but permits an empty LAN request", async () => {
    const service = new ComputerNetworkPolicyService(database(row({ mode: "allowlist" })));
    await expect(
      service.prepareBotRequest({ mode: "allowlist", rules: [] })
    ).rejects.toThrow("at least one TCP rule");
    await expect(
      new ComputerNetworkPolicyService(database(row({ mode: "lan" }))).prepareBotRequest({ mode: "lan", rules: [] })
    ).resolves.toMatchObject({ mode: "lan", rules: [], expectedRevision: 1 });
  });

  test("merges bot additions into the existing policy instead of replacing manual rules", async () => {
    const service = new ComputerNetworkPolicyService(database(row({
      mode: "allowlist",
      rules: [
        { id: "existing", address: "10.255.0.75", port: 80, label: "Existing UI" },
      ],
      revision: 4,
    })));
    await expect(service.prepareBotRequest({
      mode: "allowlist",
      rules: [
        { id: "new", address: "10.255.0.75", port: 443, label: "Existing HTTPS UI" },
        { id: "duplicate", address: "10.255.0.75", port: 80, label: "Should not replace the existing label" },
      ],
    })).resolves.toMatchObject({
      expectedRevision: 4,
      mode: "allowlist",
      rules: [
        { address: "10.255.0.75", port: 80, label: "Existing UI" },
        { address: "10.255.0.75", port: 443, label: "Existing HTTPS UI" },
      ],
    });
  });

  test("does not let a bot switch the active mode", async () => {
    const service = new ComputerNetworkPolicyService(database(row({ mode: "lan", revision: 2 })));
    await expect(service.prepareBotRequest({
      mode: "allowlist",
      rules: [{ address: "10.255.0.75", port: 443 }],
    })).rejects.toThrow("Change the active mode in Settings first");
  });

  test("enforces the limit on merged rules and allows an existing destination at capacity", async () => {
    const currentRules = Array.from({ length: 128 }, (_, index) => ({
      id: `existing-${index}`, address: "10.255.0.1", port: index + 1, label: null,
    }));
    const service = new ComputerNetworkPolicyService(database(row({ mode: "allowlist", rules: currentRules })));
    await expect(service.prepareBotRequest({ mode: "allowlist", rules: [addedRule] })).rejects.toThrow("at most 128 rules");
    const duplicate = await service.prepareBotRequest({ mode: "allowlist", rules: [{ address: "10.255.0.1", port: 1 }] });
    expect(duplicate.rules).toEqual(currentRules);
  });

  test("does not discard invalid stored rules when preparing an additive request", async () => {
    const service = new ComputerNetworkPolicyService(database(row({ mode: "allowlist", rules: [{ address: "invalid", port: 80 }] })));
    await expect(service.prepareBotRequest({ mode: "allowlist", rules: [addedRule] })).rejects.toThrow("private IP");
  });

  test("fails closed when the saved policy is invalid instead of presenting an empty policy", async () => {
    const service = new ComputerNetworkPolicyService(database(row({ mode: "allowlist", rules: [{ address: "invalid", port: 80 }] })));
    await expect(service.view()).rejects.toThrow("stored computer network policy is invalid");
  });

  test("applies exactly the merged policy and consumes approval once", async () => {
    const fixture = approvalDatabase();
    const service = new ComputerNetworkPolicyService(fixture.db);
    await expect(service.applyApproved("approval-1", "bot-1", "channel-1")).resolves.toMatchObject({
      policy: { mode: "allowlist", revision: 2, rules: [existingRule, addedRule] },
    });
    expect(fixture.approval().consumedAt).toBeInstanceOf(Date);
    await expect(service.applyApproved("approval-1", "bot-1", "channel-1")).rejects.toThrow("missing, expired, or already used");
  });

  test("rejects an approved request when the policy revision changed", async () => {
    const fixture = approvalDatabase(row({ mode: "allowlist", rules: [existingRule], revision: 2 }));
    const service = new ComputerNetworkPolicyService(fixture.db);
    await expect(service.applyApproved("approval-1", "bot-1", "channel-1")).rejects.toThrow("Request a new approval");
    expect(fixture.saved().revision).toBe(2);
    expect(fixture.approval().consumedAt).toBeNull();
  });

  test.each([
    { name: "removed existing rule", rules: [addedRule] },
    { name: "changed existing label", rules: [{ ...existingRule, label: "Replacement label" }, addedRule] },
    { name: "changed existing identity", rules: [{ ...existingRule, id: "replacement" }, addedRule] },
    { name: "changed active mode", mode: "lan", rules: [existingRule, addedRule] },
  ])("rejects legacy replacement approval: $name", async ({ name, ...candidate }) => {
    const fixture = approvalDatabase(undefined, candidate);
    const service = new ComputerNetworkPolicyService(fixture.db);
    await expect(service.applyApproved("approval-1", "bot-1", "channel-1")).rejects.toThrow("would replace existing settings");
    expect(fixture.saved()).toMatchObject({ mode: "allowlist", rules: [existingRule], revision: 1 });
    expect(fixture.approval().consumedAt).toBeNull();
  });
});
