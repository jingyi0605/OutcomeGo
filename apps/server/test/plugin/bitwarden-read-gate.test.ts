import { expect, test } from "bun:test";
import { Effect } from "effect";
import { InternalToolService } from "../../src/services/internal-tool-service";

const request = (overrides: Record<string, unknown> = {}) => ({
  runId: "run-1",
  botId: "bot-1",
  conversationId: "conversation-1",
  channelId: "channel-1",
  deliveryId: null,
  callId: "read-1",
  tool: "ReadBitwardenCredential",
  arguments: { itemId: "00000000-0000-0000-0000-000000000001", field: "password" },
  ...overrides,
});

const service = (child: Record<string, unknown> | null = null) => new InternalToolService(
  {
    run: { findUnique: async () => ({ id: "run-1", botId: "bot-1", conversationId: "conversation-1", channelId: "channel-1", deliveryId: null, status: "running", origin: "user", inboxEvents: [] }) },
    subagent: { findUnique: async () => child },
  } as never,
  {} as never,
  {} as never,
  async () => {},
  {} as never,
  {} as never,
  {} as never,
  {} as never,
);

test("rejects a Bitwarden field read without a server-side approval reference", async () => {
  await expect(Effect.runPromise(service().execute(request()))).rejects.toThrow("approval is required");
});

test("does not expose Bitwarden read tools to executor subagents", async () => {
  await expect(Effect.runPromise(service({ id: "child", subagentType: "executor" }).execute(request()))).rejects.toThrow("available only to the user-facing agent");
});

test("approval card displays instance names and binds credential read strictly to the approved connectionId", async () => {
  const connA = "11111111-1111-1111-1111-111111111111";
  const connB = "22222222-2222-2222-2222-222222222222";
  const itemA = "00000000-0000-0000-0000-000000000001";
  const itemB = "00000000-0000-0000-0000-000000000002";
  const sentWidgets: any[] = [];
  let createdApproval: any = null;
  const approvedRecord = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    botId: "bot-1",
    channelId: "channel-1",
    connectionId: connA,
    instanceName: "alice@example.com",
    itemId: itemA,
    status: "approved",
    expiresAt: new Date(Date.now() + 60_000),
  };
  const db: any = {
    run: {
      findUnique: async () => ({
        id: "run-1",
        botId: "bot-1",
        conversationId: "conversation-1",
        channelId: "channel-1",
        deliveryId: null,
        status: "running",
        origin: "user",
        inboxEvents: [
          {
            payload: {
              content: "[SAND_HIDDEN_PROMPT]BITWARDEN_APPROVAL:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa approved",
            },
          },
        ],
      }),
    },
    subagent: { findUnique: async () => null },
    pluginConnection: {
      findMany: async () => [
        { id: connA, alias: "alice@example.com" },
        { id: connB, alias: "bob@vault.test" },
      ],
      findFirst: async ({ where }: any) =>
        where.id === connA ? { id: connA } : null,
    },
    bitwardenReadApproval: {
      create: async ({ data }: any) => {
        createdApproval = { id: "approval-new", ...data };
        return createdApproval;
      },
      update: async () => ({}),
      findUnique: async ({ where }: any) =>
        where.id === approvedRecord.id ? approvedRecord : null,
    },
  };
  const messaging: any = {
    sendVisible: async (_ctx: unknown, payload: unknown) => {
      sentWidgets.push(payload);
      return { acknowledgement: { message_id: "msg-1" } };
    },
  };
  const svc = new InternalToolService(
    db,
    messaging,
    {} as never,
    async () => {},
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await Effect.runPromise(
    svc.execute({
      ...request({
        callId: "approval-1",
        tool: "RequestBitwardenReadApproval",
        arguments: {
          candidates: [
            { connectionId: connA, itemId: itemA, title: "GitHub", hostname: "github.com" },
            { connectionId: connB, itemId: itemB, title: "GitHub Work", hostname: "github.com" },
          ],
        },
      }),
    })
  );
  expect(sentWidgets[0]?.widget?.options).toEqual([
    { label: "GitHub - github.com (alice@example.com)", value: `${connA}:${itemA}` },
    { label: "GitHub Work - github.com (bob@vault.test)", value: `${connB}:${itemB}` },
  ]);

  await expect(
    Effect.runPromise(
      svc.execute(
        request({
          arguments: { connectionId: connB, itemId: itemA, field: "password" },
        })
      )
    )
  ).rejects.toThrow("different Bitwarden item or instance");
});
