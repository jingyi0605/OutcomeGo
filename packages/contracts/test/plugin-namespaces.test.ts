import { expect, test } from "bun:test";
import { connectorCustomInstructionsSection, isReadonlyConnectorRead, pluginDynamicNamespaces } from "../src/plugin-namespaces";

const connection = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, name: "Google Calendar", alias: "default", connectorKey: "google-calendar", status: "ready", statusMessage: null,
  instructions: "", toolSnapshot: [{ name: "search_events", description: "Search", inputSchema: { type: "object" } }],
  installation: { pluginKey: "google-calendar" }, ...overrides,
});
const names = new Map([["a", "google-calendar"], ["b", "google-calendar--work"], ["c", "linear"], ["d", "hex"], ["e", "google-drive"]]);

test("explicit unsafe connector metadata overrides the read allowlist", () => {
  const legacy = { source: "google-calendar/google-calendar", name: "search_events", risk: "write" };
  expect(isReadonlyConnectorRead(legacy)).toBe(true);
  expect(isReadonlyConnectorRead({ ...legacy, risk: "destructive", readOnly: true })).toBe(false);
  expect(isReadonlyConnectorRead({ ...legacy, annotations: { readOnlyHint: true, destructiveHint: true } })).toBe(false);
  expect(isReadonlyConnectorRead({ ...legacy, annotations: { readOnlyHint: false } })).toBe(false);
  expect(isReadonlyConnectorRead({ ...legacy, name: "create_event" })).toBe(false);
  const [namespace] = pluginDynamicNamespaces([connection("a", {
    toolSnapshot: [{ name: "search_events", risk: "destructive" }],
  })], names);
  expect(namespace!.tools[0]!.readOnly).toBe(false);
  expect(isReadonlyConnectorRead(namespace!.tools[0]!)).toBe(false);
});

test("namespaces carry the account and a not-ready reason, never saved instructions", () => {
  const [ready, signedOut] = pluginDynamicNamespaces([
    connection("e", {
      name: "Google Drive", connectorKey: "google-drive", installation: { pluginKey: "google-drive" },
      toolSnapshot: [{ name: "search_files", description: "Search", inputSchema: { type: "object" }, risk: "read" }],
      instructions: "Use shared drive.", statusMessage: "stale",
    }),
    connection("b", { alias: "work", status: "needs_auth", statusMessage: "Sign in again" }),
  ], names);
  expect(ready).toEqual({
    name: "google-drive", description: "Google Drive (default)", namespaceStatus: "ready", fileTransfers: { upload: true, download: true },
    tools: [{ connectionId: "e", name: "search_files", description: "Search", inputSchema: { type: "object" }, source: "google-drive/google-drive", readOnly: true }],
  });
  expect(signedOut).toMatchObject({ name: "google-calendar--work", description: "Google Calendar (work)", namespaceStatus: "needsAuth", statusMessage: "Sign in again" });
});

test("shared server and worker namespaces hide manifest-declared and metadata-only host tools", () => {
  const hostNames = ["start_link", "finish_link", "link_status", "cancel_link", "remove_account", "poll_events", "send_draft", "poll_inbound", "deliver_message"];
  const [namespace] = pluginDynamicNamespaces([connection("a", {
    connectorKey: "signal",
    installation: { pluginKey: "signal", manifest: { connections: [{
      key: "signal", deviceLink: { startTool: hostNames[0], finishTool: hostNames[1], statusTool: hostNames[2],
        cancelTool: hostNames[3], removeTool: hostNames[4] },
      events: { pollTool: hostNames[5] }, drafts: { tool: hostNames[6] },
      messaging: { platform: "chat", inbound: { pollTool: hostNames[7] }, outbound: { deliverTool: hostNames[8], maxTextChars: 100 } },
    }, { key: "another", deviceLink: { startTool: "public_read" } }] } },
    toolSnapshot: [
      ...hostNames.map(name => ({ name, description: "host", inputSchema: {} })),
      { name: "metadata_host", _meta: { "openteam/hostOnly": true } },
      { name: "public_read", description: "Public", inputSchema: {}, risk: "read" },
    ],
  })], names);
  expect(namespace!.tools).toEqual([{ connectionId: "a", name: "public_read", description: "Public",
    inputSchema: {}, source: "signal/signal", readOnly: true }]);
});

test("saved instructions of connected accounts become the reference's always-follow section", () => {
  expect(connectorCustomInstructionsSection([
    connection("c", { name: "Linear", installation: { pluginKey: "linear" }, instructions: "  Use the ENG team.  " }),
    connection("b", { alias: "work", instructions: "Include conference links." }),
    connection("a", { status: "needs_auth", instructions: "Signed out, so not listed." }),
    connection("d", { name: "Hex", installation: { pluginKey: "custom-mcp-1" } }),
  ], names)).toBe([
    "## Connector custom instructions",
    "Custom instructions are configured for some connected tools (MCP connectors). Always follow the matching instruction whenever you use that connector's tools, even before your first call to it:",
    "- Google Calendar (work), namespace google-calendar--work: Include conference links.",
    "- Hex (default), namespace hex: When using Hex, get the underlying numbers as data: download/export the results as CSV or use the data the connector returns, and analyze those raw values directly. Don't read rendered charts or graphs from screenshots (computer-use chart reading is unreliable) — work from the actual data.",
    "- Linear (default), namespace linear: Use the ENG team.",
  ].join("\n"));
  expect(connectorCustomInstructionsSection([connection("a")], names)).toBe("");
});

test("Bitwarden credential instances never enter MCP dynamic namespaces or connector instructions", () => {
  const bw = connection("d", {
    name: "Bitwarden / Vaultwarden",
    alias: "alice@example.com",
    connectorKey: "bitwarden",
    instructions: "Should not appear in MCP section",
    toolSnapshot: [],
    installation: {
      pluginKey: "bitwarden",
      manifest: {
        connections: [{ key: "bitwarden", transport: "builtin", endpoint: "outcomego://bitwarden" }],
      },
    },
  });
  expect(pluginDynamicNamespaces([bw], names)).toEqual([]);
  expect(connectorCustomInstructionsSection([bw], names)).toBe("");
});
