import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createPrismaClient } from "@outcomego/db";
import { AgentDataStore, AgentMessaging, type ToolContext } from "@outcomego/messaging";
import { ChannelService } from "../src/services/channel-service";
import { ComputerNetworkPolicyService } from "../src/services/computer-network-policy-service";
import { InternalToolService } from "../src/services/internal-tool-service";
import { RichMessageService } from "../src/services/rich-message-service";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;

for (const kind of ["credential", "firewall"] as const) {
  for (const action of ["moved-on", "superseded"] as const) {
    test.skipIf(!databaseUrl)(`published ${kind} approval survives ${action} before the tool call returns`, async () => {
      const db = createPrismaClient(databaseUrl!);
      const root = await mkdtemp(join(tmpdir(), "question-publication-"));
      const data = new AgentDataStore(db, { root, workspaceRoot: root });
      const messaging = new AgentMessaging(db, { send: async () => null, sendDebounced: async () => null } as never, data);
      const rich = new RichMessageService(db, messaging, {} as never, {} as never);
      const channels = new ChannelService(db, messaging, root, async () => new Response(null));
      const tools = new InternalToolService(
        db, messaging, {} as never, async () => {}, {} as never, {} as never,
        {} as never, {} as never, rich, undefined, undefined, new ComputerNetworkPolicyService(db),
      );
      const botId = crypto.randomUUID();
      const channelId = crypto.randomUUID();
      let installationId: string | undefined;
      let operation: Promise<unknown> | undefined;
      let publication!: (id: string) => void;
      const published = new Promise<string>(resolve => { publication = resolve; });
      let resume!: () => void;
      const barrier = new Promise<void>(resolve => { resume = resolve; });
      try {
        const bot = await db.bot.create({ data: {
          id: botId, name: "Approval publication fixture", defaultDirectory: root,
          status: "active", onboardingStatus: "completed", conversation: { create: {} },
        }, include: { conversation: true } });
        const conversationId = bot.conversation!.id;
        await db.channel.create({ data: {
          id: channelId, kind: "bot_dm", name: "Approval publication fixture", directKey: `bot:${botId}`,
          members: { create: { botId, ordinal: 0 } },
        } });
        await data.initializeBot(botId);
        await data.writeRootSettings({});
        const run = await db.run.create({ data: {
          botId, channelId, conversationId, userMessageId: crypto.randomUUID(), status: "running",
        } });
        const context: ToolContext = {
          botId, channelId, conversationId, runId: run.id, origin: "user", deliveryId: null,
          callId: crypto.randomUUID(), replyToMessageId: null, isFork: false,
        };
        const itemId = crypto.randomUUID();
        let connectionId: string | undefined;
        if (kind === "credential") {
          const installation = await db.pluginInstallation.create({ data: {
            pluginKey: "bitwarden", name: "Vault fixture", publisher: "Fixture",
            version: "1.0.0", manifest: {},
          } });
          installationId = installation.id;
          const connection = await db.pluginConnection.create({ data: {
            installationId, connectorKey: "bitwarden", name: "Vault fixture", alias: "fixture@example.test",
            transport: "stdio", authType: "none", status: "ready",
          } });
          connectionId = connection.id;
        }
        const publish = messaging.sendVisible.bind(messaging);
        messaging.sendVisible = async (...args) => {
          const result = await publish(...args);
          publication((result.acknowledgement as { message_id: string }).message_id);
          await barrier;
          return result;
        };
        operation = Effect.runPromise(tools.execute({
          runId: run.id, botId, channelId, conversationId, deliveryId: null, callId: context.callId,
          tool: kind === "credential" ? "RequestBitwardenReadApproval" : "UpdateComputerNetworkPolicy",
          arguments: kind === "credential"
            ? { connectionId, itemId, title: "Fixture item", hostname: "example.test" }
            : { mode: "lan", rules: [{ address: "192.168.1.10", port: 443 }] },
        }));
        // The real publication transaction has committed; the tool handler has
        // not yet resumed any work it performs after awaiting sendVisible.
        const messageId = await Promise.race([
          published,
          operation.then(() => { throw new Error("Approval tool did not publish its card"); }),
        ]);
        if (action === "moved-on") {
          await Effect.runPromise(channels.sendDirectMessage(conversationId, {
            content: "Continue with another topic", clientId: crypto.randomUUID(), attachments: [],
          }));
        } else {
          const next = await db.run.create({ data: {
            botId, channelId, conversationId, userMessageId: crypto.randomUUID(), status: "running",
          } });
          await publish({ ...context, runId: next.id, callId: crypto.randomUUID() }, {
            type: "widget", widget: { prompt: "Another question", options: [{ label: "Continue", value: "continue" }] },
          });
        }
        const approval = kind === "credential"
          ? await db.bitwardenReadApproval.findFirstOrThrow({ where: { sourceRunId: run.id } })
          : await db.computerNetworkPolicyApproval.findFirstOrThrow({ where: { sourceRunId: run.id } });
        expect((await db.channelMessage.findUniqueOrThrow({ where: { id: messageId } })).metadata)
          .not.toHaveProperty("widgetDismissed");
        expect(approval.widgetMessageId).toBe(messageId);
        if (kind === "credential")
          expect(await db.channelNotification.count({ where: { key: `message:${messageId}` } })).toBe(1);
        resume();
        await operation;
        const response = await Effect.runPromise(rich.respondToWidget(messageId, {
          value: kind === "credential" ? `${connectionId}:${itemId}` : "verify",
          clientId: crypto.randomUUID(),
        }));
        expect(response.accepted).toBe(true);
        const settled = kind === "credential"
          ? await db.bitwardenReadApproval.findUniqueOrThrow({ where: { id: approval.id } })
          : await db.computerNetworkPolicyApproval.findUniqueOrThrow({ where: { id: approval.id } });
        expect(settled.status).toBe(kind === "credential" ? "approved" : "approval_pending");
      } finally {
        resume();
        await operation?.catch(() => undefined);
        await data.stopWatching();
        await db.channel.deleteMany({ where: { id: channelId } });
        await db.bot.deleteMany({ where: { id: botId } });
        if (installationId) await db.pluginInstallation.deleteMany({ where: { id: installationId } });
        await db.$disconnect();
        await rm(root, { recursive: true, force: true });
      }
    }, 30_000);
  }
}
