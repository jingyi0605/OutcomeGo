import { expect, test } from "bun:test";
import { PluginInvocations } from "../../src/services/plugin/invocations";

const manifest = {
  key: "chat-plugin",
  version: "1.0.0",
  name: "Chat",
  skills: [],
  connections: [
    {
      key: "chat",
      name: "Chat",
      transport: "stdio",
      auth: "none",
      endpoint: "",
      tools: [],
      persistentState: true,
      messaging: {
        platform: "chat",
        inbound: { pollTool: "chat_poll_inbound" },
        outbound: { deliverTool: "chat_deliver_message", maxTextChars: 100 },
      },
    },
  ],
};

const tool = (name: string) => ({ name, description: name, risk: "read", inputSchema: { type: "object" } });

/** A connection whose snapshot even contains the host tools, to prove they are filtered by declaration. */
const prisma = {
  pluginConnection: {
    findUnique: async () => ({
      id: "11111111-1111-4111-8111-111111111111",
      connectorKey: "chat",
      status: "ready",
      transport: "stdio",
      installation: { status: "installed", manifest },
      toolSnapshot: [tool("chat_poll_inbound"), tool("chat_deliver_message"), tool("list_peers")],
    }),
  },
  $transaction: async () => {
    throw new Error("a rejected call must not reach the invocation ledger");
  },
};

const request = (toolName: string, hostTool?: boolean) => ({
  connectionId: "11111111-1111-4111-8111-111111111111",
  botId: "22222222-2222-4222-8222-222222222222",
  runId: "33333333-3333-4333-8333-333333333333",
  callId: crypto.randomUUID(),
  toolName,
  arguments: {},
  ...(hostTool === undefined ? {} : { hostTool }),
});

const invocations = () =>
  new PluginInvocations(prisma as never, (async () => {
    throw new Error("must not execute");
  }) as never);

test.each(["chat_poll_inbound", "chat_deliver_message"])("a Bot run cannot call the host-only messaging tool %s", async (name) => {
  await expect(invocations().invoke(request(name))).rejects.toMatchObject({ status: 404, code: "plugin_tool_not_found" });
});

test("the read-only peer tool is an ordinary Bot tool", async () => {
  // It passes the host-tool gate and only stops at the (faked) invocation ledger.
  await expect(invocations().invoke(request("list_peers"))).rejects.toThrow("invocation ledger");
});

test("the host may call its own messaging tools but not an undeclared one", async () => {
  await expect(invocations().invoke(request("chat_poll_inbound", true))).rejects.toThrow("invocation ledger");
  await expect(invocations().invoke(request("list_peers", true))).rejects.toMatchObject({
    status: 400,
    code: "plugin_host_tool_unsupported",
  });
});
