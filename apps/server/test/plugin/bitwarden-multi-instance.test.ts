import { expect, test } from "bun:test";
import { Effect } from "effect";
import { pluginCatalog } from "@outcomego/plugins";
import { PluginConfiguration } from "../../src/services/plugin/configuration";
import { migrateLegacyBitwardenInstallation } from "../../src/services/plugin/bitwarden-migration";
import {
  bitwardenInstanceEnvironment,
  resolveBitwardenAlias,
  validAlias,
} from "../../src/services/plugin/values";
import { PluginService } from "../../src/services/plugin-service";

const bitwarden = pluginCatalog.find((plugin) => plugin.key === "bitwarden")!;

test("Bitwarden aliases support email addresses and disambiguate duplicate emails", () => {
  expect(validAlias("alice@example.com")).toBe("alice@example.com");
  expect(validAlias("alice+bot@example.com (vault2.test)")).toBe(
    "alice+bot@example.com (vault2.test)"
  );
  const taken = new Set(["alice@example.com"]);
  expect(
    resolveBitwardenAlias("alice@example.com", "https://vault2.example.test", taken)
  ).toBe("alice@example.com (vault2.example.test)");
  taken.add("alice@example.com (vault2.example.test)");
  expect(
    resolveBitwardenAlias("alice@example.com", "https://vault2.example.test", taken)
  ).toBe("alice@example.com-2");
});

test("Bitwarden configuration masks plaintext values, trims email, preserves master password whitespace, and supports partial updates", async () => {
  const row: any = {
    id: "conn-1",
    installationId: "inst-1",
    connectorKey: "bitwarden",
    name: "Bitwarden / Vaultwarden",
    alias: "default",
    transport: "builtin",
    authType: "none",
    endpoint: "outcomego://bitwarden",
    status: "ready",
    statusMessage: null,
    configuration: {
      values: {
        BW_SERVER_URL: "https://vault.example.test",
        BW_EMAIL: "old@example.test",
      },
    },
    credentials: {
      values: {
        BW_CLIENT_ID: "client-id",
        BW_CLIENT_SECRET: "client-secret",
        BW_MASTER_PASSWORD: "  initial pass  ",
      },
    },
    runtimeGeneration: 1,
    installation: { pluginKey: "bitwarden", status: "installed", manifest: bitwarden },
  };
  let savedData: any = null;
  const prisma: any = {
    pluginConnection: {
      findUnique: async () => row,
      findMany: async () => [],
      updateMany: async ({ data }: any) => {
        savedData = data;
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
  const configuration = new PluginConfiguration(prisma, "https://app.example.test", async () => {});

  const before = await Effect.runPromise(configuration.get("conn-1"));
  expect(before.values).toEqual({});
  expect(before.configuredFields).toEqual(
    expect.arrayContaining([
      "BW_SERVER_URL",
      "BW_EMAIL",
      "BW_CLIENT_ID",
      "BW_CLIENT_SECRET",
      "BW_MASTER_PASSWORD",
    ])
  );

  await Effect.runPromise(
    configuration.save("conn-1", {
      values: {
        BW_EMAIL: "  new@example.test  ",
        BW_MASTER_PASSWORD: "  rotated secret \n ",
        BW_SERVER_URL: "",
      },
    })
  );
  expect(savedData.status).toBe("disconnected");
  expect(savedData.connectedAt).toBeNull();
  expect(bitwardenInstanceEnvironment(row)).toEqual({
    BW_SERVER_URL: "https://vault.example.test",
    BW_EMAIL: "new@example.test",
    BW_CLIENT_ID: "client-id",
    BW_CLIENT_SECRET: "client-secret",
    BW_MASTER_PASSWORD: "  rotated secret \n ",
  });
});

test("Bitwarden instance only becomes ready after computer bw.sh status succeeds and defaults alias to email", async () => {
  const installation: any = {
    id: "inst-1",
    pluginKey: "bitwarden",
    status: "installed",
    manifest: bitwarden,
  };
  const connections: any[] = [
    {
      id: "conn-1",
      installationId: "inst-1",
      connectorKey: "bitwarden",
      name: "Bitwarden / Vaultwarden",
      alias: "default",
      transport: "builtin",
      authType: "none",
      endpoint: "outcomego://bitwarden",
      status: "disconnected",
      statusMessage: null,
      instructions: "",
      configuration: {
        values: {
          BW_SERVER_URL: "https://vault.example.test",
          BW_EMAIL: "alice@example.test",
        },
      },
      credentials: {
        values: {
          BW_CLIENT_ID: "client-1",
          BW_CLIENT_SECRET: "secret-1",
          BW_MASTER_PASSWORD: "  master-1  ",
        },
      },
      runtimeGeneration: 1,
      toolSnapshot: [],
      updatedAt: new Date(),
      installation,
    },
  ];
  let checkOutcome: Record<string, unknown> = {
    ok: false,
    errorCode: "vault_locked",
    stage: "unlock",
    message: "The Bitwarden vault could not be unlocked.",
  };
  const prisma: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(prisma),
    $queryRaw: async () => [],
    pluginConnection: {
      findUnique: async ({ where }: any) => connections.find((c) => c.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        connections.filter((c) => !where?.id?.not || c.id !== where.id.not),
      update: async ({ where, data }: any) => {
        const target = connections.find((c) => c.id === where.id)!;
        Object.assign(target, data);
        return target;
      },
      updateMany: async ({ where, data }: any) => {
        const target = connections.find((c) => c.id === where.id);
        if (!target) return { count: 0 };
        Object.assign(target, data);
        return { count: 1 };
      },
    },
    pluginActivity: { create: async () => ({}) },
    event: { create: async () => ({}) },
  };
  const service = new PluginService(
    prisma,
    async (path) => {
      if (path === "/v1/bitwarden/check") return Response.json(checkOutcome);
      throw new Error(`Unexpected computer path ${path}`);
    }
  );

  await expect(Effect.runPromise(service.connect("conn-1"))).rejects.toThrow("could not be unlocked");
  expect(connections[0]!.status).toBe("error");
  expect(connections[0]!.alias).toBe("default");

  checkOutcome = {
    ok: true,
    kind: "status",
    serverOrigin: "https://vault.example.test",
    authenticated: true,
    unlocked: true,
    synced: true,
  };
  await expect(Effect.runPromise(service.connect("conn-1"))).resolves.toMatchObject({
    id: "conn-1",
    status: "ready",
  });
  expect(connections[0]!.status).toBe("ready");
  expect(connections[0]!.alias).toBe("alice@example.test");

  // Manual rename clears autoAlias so future reconnects keep the custom alias.
  await Effect.runPromise(service.renameAccount("conn-1", "Company Vault"));
  expect(connections[0]!.alias).toBe("Company Vault");
  await Effect.runPromise(service.connect("conn-1"));
  expect(connections[0]!.alias).toBe("Company Vault");
});

test("legacy plugin:bitwarden ProcessSecret automatically migrates into the first instance", async () => {
  const legacySecrets = [
    { ownerKey: "plugin:bitwarden", name: "BW_SERVER_URL", value: "https://vault.legacy.test" },
    { ownerKey: "plugin:bitwarden", name: "BW_EMAIL", value: "  legacy@example.test " },
    { ownerKey: "plugin:bitwarden", name: "BW_CLIENT_ID", value: "legacy-client" },
    { ownerKey: "plugin:bitwarden", name: "BW_CLIENT_SECRET", value: "legacy-secret" },
    { ownerKey: "plugin:bitwarden", name: "BW_MASTER_PASSWORD", value: " legacy-pass " },
  ];
  const createdConnections: any[] = [];
  let deletedOwnerKey: string | null = null;
  const db: any = {
    processSecret: {
      findMany: async ({ where }: any) =>
        legacySecrets.filter((row) => row.ownerKey === where.ownerKey),
      deleteMany: async ({ where }: any) => {
        deletedOwnerKey = where.ownerKey;
        return { count: legacySecrets.length };
      },
    },
    pluginConnection: {
      findMany: async () => createdConnections,
      create: async ({ data }: any) => {
        createdConnections.push(data);
        return data;
      },
    },
  };

  const migrated = await migrateLegacyBitwardenInstallation(db, "inst-1", bitwarden.connections[0]);
  expect(migrated).toBe(true);
  expect(deletedOwnerKey as string | null).toBe("plugin:bitwarden");
  expect(createdConnections).toHaveLength(1);
  expect(createdConnections[0]).toMatchObject({
    installationId: "inst-1",
    connectorKey: "bitwarden",
    alias: "legacy@example.test",
    status: "disconnected",
    configuration: {
      values: {
        BW_SERVER_URL: "https://vault.legacy.test",
        BW_EMAIL: "legacy@example.test",
      },
      autoAlias: true,
    },
    credentials: {
      values: {
        BW_CLIENT_ID: "legacy-client",
        BW_CLIENT_SECRET: "legacy-secret",
        BW_MASTER_PASSWORD: " legacy-pass ",
      },
    },
  });
});
