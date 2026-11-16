import type { Prisma, PrismaClient } from "@outcomego/db";
import type { PluginConnectorDefinition } from "@outcomego/plugin-sdk";
import { toJson } from "../service-utils";
import { pluginSecretOwner } from "../process-secrets";
import {
  BITWARDEN_PUBLIC_FIELDS,
  BITWARDEN_SECRET_FIELDS,
  jsonObject,
  resolveBitwardenAlias,
} from "./values";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Migrate legacy single-instance `plugin:bitwarden` ProcessSecret values into the first
 * Bitwarden PluginConnection instance and remove the obsolete global secrets.
 */
export async function migrateLegacyBitwardenInstallation(
  db: Db,
  installationId: string,
  connector?: Pick<PluginConnectorDefinition, "name" | "endpoint" | "transport" | "auth" | "tools">
): Promise<boolean> {
  const ownerKey = pluginSecretOwner("bitwarden");
  const secrets = await db.processSecret.findMany({
    where: { ownerKey },
    select: { name: true, value: true },
  });
  if (!secrets.length) return false;

  const secretMap = Object.fromEntries(secrets.map((row) => [row.name, row.value]));
  const publicValues = Object.fromEntries(
    BITWARDEN_PUBLIC_FIELDS.flatMap((key) =>
      typeof secretMap[key] === "string" && secretMap[key]
        ? [[key, key === "BW_EMAIL" ? secretMap[key]!.trim() : secretMap[key]!]]
        : []
    )
  );
  const credentialValues = Object.fromEntries(
    BITWARDEN_SECRET_FIELDS.flatMap((key) =>
      typeof secretMap[key] === "string" && secretMap[key] ? [[key, secretMap[key]!]] : []
    )
  );
  const hasAny =
    Object.keys(publicValues).length > 0 || Object.keys(credentialValues).length > 0;
  const hasAll =
    BITWARDEN_PUBLIC_FIELDS.every((key) => Boolean(publicValues[key])) &&
    BITWARDEN_SECRET_FIELDS.every((key) => Boolean(credentialValues[key]));

  const existingConnections = await db.pluginConnection.findMany({
    where: { installationId, connectorKey: "bitwarden" },
    orderBy: { createdAt: "asc" },
  });

  if (existingConnections.length === 0) {
    if (!hasAny) {
      await db.processSecret.deleteMany({ where: { ownerKey } });
      return false;
    }
    const email = typeof publicValues.BW_EMAIL === "string" ? publicValues.BW_EMAIL : "";
    const serverUrl =
      typeof publicValues.BW_SERVER_URL === "string" ? publicValues.BW_SERVER_URL : "";
    const alias = email ? resolveBitwardenAlias(email, serverUrl, new Set()) : "default";
    await db.pluginConnection.create({
      data: {
        installationId,
        connectorKey: "bitwarden",
        name: connector?.name ?? "Bitwarden / Vaultwarden",
        alias,
        transport: connector?.transport ?? "builtin",
        authType: connector?.auth ?? "none",
        endpoint: connector?.endpoint ?? "outcomego://bitwarden",
        configuration: toJson({ values: publicValues, autoAlias: true }),
        credentials: toJson({ values: credentialValues }),
        toolSnapshot: toJson(connector?.tools ?? []),
        status: "disconnected",
        statusMessage: hasAll
          ? "Migrated existing configuration. Connect to verify."
          : "Plugin setup values are required.",
      },
    });
    await db.processSecret.deleteMany({ where: { ownerKey } });
    return true;
  }

  const first = existingConnections[0]!;
  const existingConfig = jsonObject(first.configuration);
  const existingConfigValues = jsonObject(existingConfig.values);
  const existingCreds = jsonObject(first.credentials);
  const existingCredValues = jsonObject(existingCreds.values);
  const firstIsEmpty =
    Object.keys(existingConfigValues).length === 0 && Object.keys(existingCredValues).length === 0;

  if (hasAny && firstIsEmpty) {
    const taken = new Set(existingConnections.slice(1).map((c) => c.alias));
    const email = typeof publicValues.BW_EMAIL === "string" ? publicValues.BW_EMAIL : "";
    const serverUrl =
      typeof publicValues.BW_SERVER_URL === "string" ? publicValues.BW_SERVER_URL : "";
    const alias =
      first.alias === "default" && email
        ? resolveBitwardenAlias(email, serverUrl, taken)
        : first.alias;
    await db.pluginConnection.update({
      where: { id: first.id },
      data: {
        alias,
        configuration: toJson({
          ...existingConfig,
          values: publicValues,
          autoAlias: first.alias === "default" || existingConfig.autoAlias === true,
        }),
        credentials: toJson({ ...existingCreds, values: credentialValues }),
        status: "disconnected",
        statusMessage: hasAll
          ? "Migrated existing configuration. Connect to verify."
          : "Plugin setup values are required.",
      },
    });
  }

  await db.processSecret.deleteMany({ where: { ownerKey } });
  return hasAny && firstIsEmpty;
}
