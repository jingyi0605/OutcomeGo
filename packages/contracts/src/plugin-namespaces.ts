import { fileTransferCapabilities } from "@outcomego/plugin-sdk";
import type { PluginDynamicNamespace } from "./index";
import { getDefaultMcpCustomInstruction } from "./reference-formatters";

export interface NamespaceConnection {
  id: string;
  name: string;
  alias: string;
  connectorKey: string;
  status: string;
  statusMessage: string | null;
  instructions: string | null;
  toolSnapshot: unknown;
  installation: { pluginKey: string; manifest?: unknown };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const namespaceStatus = (status: string): PluginDynamicNamespace["namespaceStatus"] =>
  status === "ready" ? "ready" : status === "needs_auth" ? "needsAuth" : status === "error" ? "error" : "loading";

/** The service and account a namespace belongs to, e.g. `Gmail (work)`. */
export const connectionDisplayName = (connection: Pick<NamespaceConnection, "name" | "alias">): string =>
  `${connection.name} (${connection.alias})`;

const manifestHostTools = (manifest: unknown, connectorKey: string): Set<string> => {
  const tools = new Set<string>();
  const connections = record(manifest).connections;
  if (!Array.isArray(connections)) return tools;
  for (const connection of connections) {
    const value = record(connection);
    if (value.key !== connectorKey) continue;
    const deviceLink = record(value.deviceLink);
    for (const key of ["startTool", "finishTool", "statusTool", "cancelTool", "removeTool"]) {
      if (typeof deviceLink[key] === "string") tools.add(deviceLink[key] as string);
    }
    const events = record(value.events);
    if (typeof events.pollTool === "string") tools.add(events.pollTool as string);
    const drafts = record(value.drafts);
    if (typeof drafts.tool === "string") tools.add(drafts.tool as string);
  }
  return tools;
};

/** One shape for the turn-start catalog and every mid-turn refresh. */
export function pluginDynamicNamespaces(
  connections: readonly NamespaceConnection[],
  namespaces: ReadonlyMap<string, string>
): PluginDynamicNamespace[] {
  return connections.map((connection) => ({
    name: namespaces.get(connection.id)!,
    description: connectionDisplayName(connection),
    namespaceStatus: namespaceStatus(connection.status),
    ...(connection.status !== "ready" && connection.statusMessage
      ? { statusMessage: connection.statusMessage.slice(0, 500) }
      : {}),
    fileTransfers: fileTransferCapabilities(connection.installation.pluginKey),
    tools: Array.isArray(connection.toolSnapshot)
      ? connection.toolSnapshot.flatMap((candidate) => {
          const tool = record(candidate);
          if (typeof tool.name !== "string") return [];
          if (
            manifestHostTools(connection.installation.manifest, connection.connectorKey).has(tool.name) ||
            record(tool._meta)["openteam/hostOnly"] === true
          )
            return [];
          return [{
            connectionId: connection.id,
            name: tool.name,
            description: typeof tool.description === "string" ? tool.description : "",
            inputSchema: record(tool.inputSchema),
            source: `${connection.installation.pluginKey}/${connection.connectorKey}`,
            ...(tool.risk === "read" ? { readOnly: true } : {}),
          }];
        })
      : [],
  }));
}

/** The reference's always-follow section for saved connector instructions, from connected accounts only. */
export function connectorCustomInstructionsSection(
  connections: readonly NamespaceConnection[],
  namespaces: ReadonlyMap<string, string>
): string {
  const entries = connections
    .filter((connection) => connection.status === "ready")
    .flatMap((connection) => {
      const instructions = connection.instructions?.trim() || getDefaultMcpCustomInstruction(connection.name);
      return instructions ? [`- ${connectionDisplayName(connection)}, namespace ${namespaces.get(connection.id)}: ${instructions}`] : [];
    })
    .sort((a, b) => a.localeCompare(b));
  return entries.length
    ? [
        "## Connector custom instructions",
        "Custom instructions are configured for some connected tools (MCP connectors). Always follow the matching instruction whenever you use that connector's tools, even before your first call to it:",
        ...entries,
      ].join("\n")
    : "";
}
