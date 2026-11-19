import { afterEach, expect, test } from "bun:test";
import { McpHttpClientManager } from "../../src/plugins/mcp-client-manager";
import { PluginTransport } from "../../src/services/plugin/transport";
import { isUnsupportedPollTool } from "../../src/services/plugin/events";

// A remote MCP server that lists a Bot tool and an event-poll tool, and requires the account's token.
let server: ReturnType<typeof Bun.serve> | null = null;
const http = new McpHttpClientManager();
afterEach(async () => {
  await http.closeAll();
  server?.stop(true);
  server = null;
});

const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const manifest = {
  key: "dsh-web",
  name: "DSH-WEB",
  skills: [],
  connections: [
    { key: "dsh", transport: "http", events: { pollTool: "session_events", source: "plugin" } },
  ],
};
const startServer = (calls: Array<{ tool: string; args: unknown; authorization: string | null }>) => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "GET") return new Response("no stream", { status: 405, headers: { allow: "POST" } });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      const message = (await request.json()) as { id?: string; method: string; params?: { name?: string; arguments?: unknown } };
      if (message.method === "initialize")
        return Response.json(
          { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "dsh", version: "1" } } },
          { headers: { "mcp-session-id": "s" } }
        );
      if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (message.method === "tools/list")
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              { name: "session_list", inputSchema: { type: "object", properties: {} } },
              { name: "session_events", inputSchema: { type: "object", properties: { cursor: {} } } },
            ],
          },
        });
      calls.push({ tool: message.params!.name!, args: message.params!.arguments, authorization: request.headers.get("authorization") });
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result: { structuredContent: { events: [{ id: "e1", kind: "session.completed", text: "Done", resourceId: "s1" }], cursor: { after: 1 } }, content: [] },
      });
    },
  });
  return `http://127.0.0.1:${server.port}`;
};

// The transport reads the saved connection before each tools/call. Its snapshot omits the poll tool,
// as the Bot-visible list does; the manifest declares it as a host tool.
const database = (status = "ready") =>
  ({
    pluginConnection: {
      findUnique: async () => ({
        runtimeGeneration: 1,
        status,
        toolSnapshot: [{ name: "session_list", inputSchema: { type: "object" } }],
        connectorKey: "dsh",
        configuration: {},
        credentials: {},
        installation: { status: "installed", manifest },
      }),
    },
  }) as never;
const connection = (endpoint: string, id = CONNECTION_ID) => ({
  id,
  connectorKey: "dsh",
  transport: "http",
  authType: "token",
  endpoint,
  configuration: { endpoint },
  credentials: { bearerToken: "secret-token-value" },
  runtimeGeneration: 1,
});

test("the server calls a remote event-poll tool with the account's token even though Bots cannot see it", async () => {
  const calls: Array<{ tool: string; args: unknown; authorization: string | null }> = [];
  const endpoint = startServer(calls);
  const transport = new PluginTransport(database(), http, "https://example.test");
  const result = await transport.callHostTool(connection(endpoint), "session_events", { cursor: null });
  expect(result).toMatchObject({ structuredContent: { cursor: { after: 1 } } });
  expect(calls).toEqual([{ tool: "session_events", args: { cursor: null }, authorization: "Bearer secret-token-value" }]);
});

test("a remote host-tool call still refuses tools that are neither visible nor declared, and revoked access", async () => {
  const calls: Array<{ tool: string; args: unknown; authorization: string | null }> = [];
  const endpoint = startServer(calls);
  const transport = new PluginTransport(database(), http, "https://example.test");
  await expect(transport.callHostTool(connection(endpoint), "workspace_secret", {})).rejects.toThrow("no longer available");
  const revoked = new PluginTransport(database("needs_auth"), http, "https://example.test");
  // The MCP client is cached per connection, so a revoked account is a different connection here.
  await expect(
    revoked.callHostTool(connection(endpoint, "33333333-3333-4333-8333-333333333333"), "session_events", { cursor: null })
  ).rejects.toThrow("revoked");
  expect(calls).toEqual([]);
});

test("an aborted remote poll stops waiting", async () => {
  const calls: Array<{ tool: string; args: unknown; authorization: string | null }> = [];
  const endpoint = startServer(calls);
  const transport = new PluginTransport(database(), http, "https://example.test");
  await expect(
    transport.callHostTool(connection(endpoint), "session_events", { cursor: null }, AbortSignal.abort(new Error("The operation timed out")))
  ).rejects.toThrow("timed out");
});

test("a remote call without a connector key or authentication type is rejected before any request", async () => {
  const transport = new PluginTransport(database(), http, "https://example.test");
  await expect(
    transport.callHostTool({ id: CONNECTION_ID, configuration: {}, credentials: {}, transport: "http" }, "session_events", {})
  ).rejects.toThrow("connector key and authentication type");
});

test("a server that predates the poll tool answers in a way the host recognizes as 'not supported yet'", async () => {
  // DSH-WEB answers an unknown tool with JSON-RPC -32601, as in its workspace MCP transport.
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "GET") return new Response("no stream", { status: 405, headers: { allow: "POST" } });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      const message = (await request.json()) as { id?: string; method: string };
      if (message.method === "initialize")
        return Response.json(
          { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "old-dsh", version: "1" } } },
          { headers: { "mcp-session-id": "s" } }
        );
      if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    },
  });
  const transport = new PluginTransport(database(), http, "https://example.test");
  const error = await transport
    .callHostTool(connection(`http://127.0.0.1:${server.port}`), "session_events", { cursor: null })
    .then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(isUnsupportedPollTool(error)).toBe(true);
  // A real failure from a server that does have the tool is still a failure.
  expect(isUnsupportedPollTool(new Error("The operation timed out"))).toBe(false);
  expect(isUnsupportedPollTool(Object.assign(new Error("Streamable HTTP error: 401"), { code: 401 }))).toBe(false);
});
