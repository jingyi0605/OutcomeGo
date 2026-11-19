import { afterEach, expect, test } from "bun:test";
import { createOpenTeamClient } from "../../../../packages/client-core/src";
import { pluginCatalog } from "@outcomego/plugins";
import { createToolValidator } from "@outcomego/plugin-sdk/json-schema";
import { McpHttpClientManager } from "../../src/plugins/mcp-client-manager";
import { createPluginFlowFixture } from "./fixtures/plugin-flow";

const DSH_WEB_TOOL_SCHEMAS = [
  {
    name: "workspace_list",
    description: "List managed workspaces.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "workspace_file_list",
    description: "List files in a managed workspace.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        path: { type: "string" },
        depth: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "workspace_file_read",
    description: "Read a file in a managed workspace.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        path: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "base64"] },
        limitBytes: { type: "integer", minimum: 1, maximum: 1048576 },
      },
      required: ["workspaceId", "path"],
    },
  },
  {
    name: "workspace_git_status",
    description: "Read Git status for a managed workspace.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { workspaceId: { type: "string" } },
      required: ["workspaceId"],
    },
  },
  {
    name: "workspace_git_log",
    description: "Read Git log for a managed workspace.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        branch: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        skip: { type: "integer", minimum: 0 },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "workspace_git_diff",
    description: "Read Git diff for a managed workspace.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        path: { type: "string" },
        fromRef: { type: "string" },
        toRef: { type: "string" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "session_list",
    description: "List sessions in managed workspaces.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
      },
    },
  },
  {
    name: "session_create",
    description: "Create a session.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        adapterId: { type: "string" },
        modelId: { type: "string" },
        prompt: { type: "string" },
        agentId: { type: "string", minLength: 1, maxLength: 256 },
        priority: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "session_continue",
    description: "Send a message to an existing session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        message: { type: "string" },
        agentId: { type: "string", minLength: 1, maxLength: 256 },
      },
      required: ["sessionId", "message"],
    },
  },
  {
    name: "session_queue_peek",
    description: "Inspect queued messages for a session.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        includeProcessing: { type: "boolean" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "session_history",
    description: "Read user and assistant text history for a managed session.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "integer", minimum: 0 },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "session_search",
    description: "Search managed sessions by keyword.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 256 },
        workspaceId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
    },
  },
  {
    name: "message_status",
    description: "Inspect the status of a queued or processing message.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        messageId: { type: "string" },
      },
      required: ["sessionId", "messageId"],
    },
  },
  {
    name: "message_cancel",
    description: "Cancel a queued message.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        messageId: { type: "string" },
      },
      required: ["sessionId", "messageId"],
    },
  },
  {
    name: "message_prioritize",
    description: "Update priority of a queued message.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        messageId: { type: "string" },
        priority: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["sessionId", "messageId", "priority"],
    },
  },
  {
    name: "session_questions",
    description: "List unresolved questions for a session.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "session_answer",
    description: "Answer a pending session question.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        callId: { type: "string" },
        answer: { type: "object" },
      },
      required: ["sessionId", "callId", "answer"],
    },
  },
  {
    name: "session_request_permission",
    description: "Request permission during an active session turn.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        toolName: { type: "string" },
        reason: { type: "string" },
        callId: { type: "string" },
      },
      required: ["sessionId", "toolName", "reason"],
    },
  },
  {
    name: "session_permission_status",
    description: "Check permission request status.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        requestId: { type: "string" },
      },
      required: ["sessionId", "requestId"],
    },
  },
  {
    name: "terminal_list",
    description: "List terminals for a session.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        sessionId: { type: "string" },
      },
      required: ["workspaceId", "sessionId"],
    },
  },
  {
    name: "terminal_read",
    description: "Read terminal output.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        sessionId: { type: "string" },
        terminalId: { type: "string" },
        limitBytes: { type: "integer", minimum: 1, maximum: 65536 },
      },
      required: ["workspaceId", "sessionId", "terminalId"],
    },
  },
  {
    name: "terminal_write",
    description: "Write text to a terminal.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        sessionId: { type: "string" },
        terminalId: { type: "string" },
        data: { type: "string" },
      },
      required: ["workspaceId", "sessionId", "terminalId", "data"],
    },
  },
] as const;

const EXPECTED_TOOL_NAMES = DSH_WEB_TOOL_SCHEMAS.map((tool) => tool.name).sort();

function createMockDshWebMcpServer(expectedToken: string) {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const sessions = new Set<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${expectedToken}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (request.method === "GET") {
        return new Response("SSE not available", { status: 405, headers: { allow: "POST" } });
      }
      if (request.method === "DELETE") return new Response(null, { status: 204 });

      const message = (await request.json()) as {
        id?: string | number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method === "initialize") {
        const sessionId = crypto.randomUUID();
        sessions.add(sessionId);
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "mock-dsh-web", version: "1.0.0" },
            },
          },
          { headers: { "mcp-session-id": sessionId } }
        );
      }
      if (!sessions.has(request.headers.get("mcp-session-id") ?? "")) {
        return new Response("Session expired", { status: 404 });
      }
      if (message.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: DSH_WEB_TOOL_SCHEMAS },
        });
      }
      if (message.method === "tools/call") {
        const name = message.params?.name ?? "";
        const args = message.params?.arguments ?? {};
        calls.push({ name, arguments: args });
        let payload: unknown = { ok: true, name, arguments: args };
        if (name === "session_create") {
          payload = { sessionId: "sess-1", agentId: args.agentId, queuePosition: 1 };
        } else if (name === "session_continue") {
          payload = {
            messageId: "msg-1",
            status: "queued",
            queuePosition: 1,
            estimatedWaitMs: 1000,
            success: true,
          };
        } else if (name === "session_history") {
          payload = {
            sessionId: args.sessionId,
            workspaceId: "ws-1",
            messages: [
              { seq: 1, role: "user", text: "hi", agentId: "bot-1" },
              { seq: 2, role: "assistant", text: "hello" },
            ],
            limit: args.limit ?? 20,
            hasMore: true,
            nextCursor: 1,
            omittedWithoutText: 1,
          };
        } else if (name === "session_search") {
          payload = {
            results: [{ sessionId: "sess-1", workspaceId: "ws-1", snippet: "...keyword..." }],
            limit: args.limit ?? 10,
            hasMore: false,
          };
        }
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
        });
      }
      return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}/mcp`,
    calls,
    close: () => server.stop(true),
  };
}

const activeHttpManagers: McpHttpClientManager[] = [];
const activeServers: Array<() => void> = [];

afterEach(async () => {
  await Promise.all(activeHttpManagers.splice(0).map((manager) => manager.closeAll()));
  for (const close of activeServers.splice(0)) close();
});

test("host MCP client discovers all 22 DSH-WEB tools and validates arguments against discovered schemas", async () => {
  const token = "synthetic-dsh-web-api-key";
  const mock = createMockDshWebMcpServer(token);
  activeServers.push(mock.close);
  const manager = new McpHttpClientManager();
  activeHttpManagers.push(manager);

  const options = {
    endpoint: mock.endpoint,
    headers: { Authorization: `Bearer ${token}` },
  };
  const discovered = await manager.discover("dsh-web-mock", options);
  expect(discovered).toHaveLength(22);
  expect(discovered.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);

  const byName = new Map(discovered.map((tool) => [tool.name, tool]));
  const sessionCreateValidator = createToolValidator(byName.get("session_create")!.inputSchema);
  expect(sessionCreateValidator({ workspaceId: "ws-1", agentId: "bot-1", priority: 80 }).valid).toBe(true);
  expect(sessionCreateValidator({ workspaceId: "ws-1", priority: 101 }).valid).toBe(false);
  expect(sessionCreateValidator({ workspaceId: "ws-1", priority: "high" }).valid).toBe(false);

  const sessionSearchValidator = createToolValidator(byName.get("session_search")!.inputSchema);
  expect(sessionSearchValidator({ query: "keyword", workspaceId: "ws-1", limit: 10 }).valid).toBe(true);
  expect(sessionSearchValidator({ query: "" }).valid).toBe(false);
  expect(sessionSearchValidator({ query: "keyword", limit: 21 }).valid).toBe(false);

  const sessionHistoryValidator = createToolValidator(byName.get("session_history")!.inputSchema);
  expect(sessionHistoryValidator({ sessionId: "sess-1", limit: 20, cursor: 0 }).valid).toBe(true);
  expect(sessionHistoryValidator({ sessionId: "sess-1", limit: 101 }).valid).toBe(false);

  await manager.call("dsh-web-mock", options, "session_create", {
    workspaceId: "ws-1",
    agentId: "bot-1",
    priority: 80,
  });
  await manager.call("dsh-web-mock", options, "session_continue", {
    sessionId: "sess-1",
    message: "hello",
    agentId: "bot-1",
  });
  expect(mock.calls).toEqual([
    { name: "session_create", arguments: { workspaceId: "ws-1", agentId: "bot-1", priority: 80 } },
    { name: "session_continue", arguments: { sessionId: "sess-1", message: "hello", agentId: "bot-1" } },
  ]);
});

const databaseUrl = (process.env.OUTCOMEGO_TEST_DATABASE_URL ?? process.env.OPENTEAM_TEST_DATABASE_URL);
test.skipIf(!databaseUrl)("DSH-WEB connects, discovers all 22 tools, forwards parameters, and rejects invalid arguments", async () => {
  const token = "synthetic-dsh-web-api-key";
  const mock = createMockDshWebMcpServer(token);
  const fixture = await createPluginFlowFixture(databaseUrl!);
  const plugin = structuredClone(pluginCatalog.find((entry) => entry.key === "dsh-web")!);
  plugin.key = `dsh-web-test-${crypto.randomUUID()}`;
  fixture.definitions.push(plugin);
  const client = createOpenTeamClient({ baseUrl: fixture.server.url.origin });
  try {
    await client.installPlugin(plugin.key);
    const connection = (await client.pluginSettings()).installs.find(
      (entry) => entry.pluginKey === plugin.key
    )!.connections[0]!;

    const saved = await client.savePluginConfiguration(connection.id, {
      values: { mcpUrl: mock.endpoint, token },
    });
    expect(saved).toMatchObject({ configured: true });

    const config = await client.pluginConfiguration(connection.id);
    expect(config.endpoint).toBe(mock.endpoint);
    expect(config.values.mcpUrl).toBe(mock.endpoint);
    expect(config.configuredSecrets).toContain("token");
    expect(JSON.stringify(config)).not.toContain(token);

    const connected = await client.connectPlugin(connection.id);
    expect(connected).toMatchObject({ status: "ready", toolCount: 22 });

    const updatedConnection = (await client.pluginSettings()).installs
      .find((entry) => entry.pluginKey === plugin.key)!
      .connections.find((entry) => entry.id === connection.id)!;
    expect(updatedConnection.tools).toHaveLength(22);
    expect(updatedConnection.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);

    await client.testPluginConnection(connection.id, {
      toolName: "session_create",
      arguments: { workspaceId: "ws-1", agentId: "bot-1", priority: 80 },
    });
    await client.testPluginConnection(connection.id, {
      toolName: "session_continue",
      arguments: { sessionId: "sess-1", message: "hello", agentId: "bot-1" },
    });
    const historyResult = await client.testPluginConnection(connection.id, {
      toolName: "session_history",
      arguments: { sessionId: "sess-1", limit: 20 },
    });
    expect(JSON.stringify(historyResult)).toContain("nextCursor");
    const searchResult = await client.testPluginConnection(connection.id, {
      toolName: "session_search",
      arguments: { query: "keyword", workspaceId: "ws-1", limit: 10 },
    });
    expect(JSON.stringify(searchResult)).toContain("snippet");

    expect(mock.calls).toEqual([
      { name: "session_create", arguments: { workspaceId: "ws-1", agentId: "bot-1", priority: 80 } },
      { name: "session_continue", arguments: { sessionId: "sess-1", message: "hello", agentId: "bot-1" } },
      { name: "session_history", arguments: { sessionId: "sess-1", limit: 20 } },
      { name: "session_search", arguments: { query: "keyword", workspaceId: "ws-1", limit: 10 } },
    ]);

    await expect(
      client.testPluginConnection(connection.id, {
        toolName: "session_create",
        arguments: { workspaceId: "ws-1", priority: 101 },
      })
    ).rejects.toThrow("Invalid tool arguments");
    await expect(
      client.testPluginConnection(connection.id, {
        toolName: "session_search",
        arguments: { query: "", limit: 21 },
      })
    ).rejects.toThrow("Invalid tool arguments");
    expect(mock.calls).toHaveLength(4);
  } finally {
    await fixture.close();
    mock.close();
  }
}, 30_000);
