import type { PrismaClient } from "@outcomego/db";
import { connectionNamespaces } from "@outcomego/plugin-sdk";

/** Every caller names connections from the same full set, so identifiers agree everywhere. */
export const loadConnectionNamespaces = async (prisma: Pick<PrismaClient, "pluginConnection">) =>
  connectionNamespaces(
    await prisma.pluginConnection.findMany({ select: { id: true, name: true, alias: true, createdAt: true } })
  );
