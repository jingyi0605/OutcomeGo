import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrismaClient, type PrismaClient } from "@outcomego/db";
import { AgentDataStore, AgentMessaging, AssetStore } from "@outcomego/messaging";
import { externalMessagePayloadHash, normalizeExternalMessage, type ExternalMessage, type ExternalPollEntry } from "@outcomego/plugin-sdk/messaging";
import { ExternalExchangeError } from "../../src/services/external-messaging/media-exchange";

export const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;

export const manifestFor = (platform = "chat", media = true) => ({
  key: `plugin-${platform}`,
  name: "Chat",
  version: "1.0.0",
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
        platform,
        inbound: { pollTool: "chat_poll", maxWaitSeconds: 1 },
        outbound: { deliverTool: "chat_deliver", maxTextChars: 100, ...(media ? { media: { kinds: ["image"], maxBytes: 5_000_000 } } : {}) },
      },
    },
  ],
});

/** A scripted stand-in for the computer's exchange: files by name, with optional failures. */
export class FakeExchange {
  files = new Map<string, Uint8Array>();
  inboundFailure: "unreachable" | null = null;
  staged: Array<{ deliveryId: string; name: string; bytes: number; sha256: string }> = [];
  stageFailure = false;
  cleaned: string[] = [];

  async openInbound(_connectionId: string, name: string) {
    if (this.inboundFailure === "unreachable") throw new ExternalExchangeError("external_exchange_unavailable", true);
    const bytes = this.files.get(name);
    if (!bytes) throw new ExternalExchangeError("external_media_missing", false);
    return { body: new Response(bytes as unknown as BodyInit).body!, size: bytes.byteLength };
  }

  async stageOutbound(input: { deliveryId: string; exchangeName: string; byteSize: number; sha256: string }) {
    if (this.stageFailure) throw new ExternalExchangeError("external_media_staging_failed", false);
    this.staged.push({ deliveryId: input.deliveryId, name: input.exchangeName, bytes: input.byteSize, sha256: input.sha256 });
  }

  async cleanupOutbound(_connectionId: string, deliveryId: string) {
    this.cleaned.push(deliveryId);
    return true;
  }
}

export interface Harness {
  prisma: PrismaClient;
  root: string;
  messaging: AgentMessaging;
  assets: AssetStore;
  exchange: FakeExchange;
  bots: string[];
  installs: string[];
  bot(options?: { status?: "active" | "archived" | "provisioning" }): Promise<{ id: string; conversationId: string }>;
  connection(options?: { platform?: string; ready?: boolean; messaging?: boolean; media?: boolean }): Promise<{ id: string; installId: string }>;
  bind(connectionId: string, botId: string, extra?: Record<string, unknown>): Promise<{ id: string }>;
  /** The Bot's own chat: where every message from an outside contact lands. */
  home(botId: string): Promise<string>;
  cleanup(): Promise<void>;
}

/** Real database, real messaging service; only the outside world (connector, computer) is scripted. */
export async function createHarness(): Promise<Harness> {
  const prisma = createPrismaClient(databaseUrl!);
  const root = await mkdtemp(join(tmpdir(), "external-messaging-"));
  const data = new AgentDataStore(prisma, { root: join(root, "data"), workspaceRoot: root });
  await data.writeRootSettings({});
  const assets = new AssetStore({ root: join(root, "assets"), allowedFileRoots: [root] });
  const messaging = new AgentMessaging(prisma, { send: async () => crypto.randomUUID(), sendDebounced: async () => crypto.randomUUID() } as never, data, assets);
  const bots: string[] = [];
  const installs: string[] = [];
  return {
    prisma,
    root,
    messaging,
    assets,
    exchange: new FakeExchange(),
    bots,
    installs,
    async bot(options = {}) {
      const created = await prisma.bot.create({
        data: { name: `Ext ${crypto.randomUUID().slice(0, 6)}`, status: options.status ?? "active", onboardingStatus: "completed", defaultDirectory: root, conversation: { create: {} } },
        include: { conversation: true },
      });
      bots.push(created.id);
      await prisma.channel.create({
        data: { kind: "bot_dm", directKey: `bot:${created.id}`, name: "Ext", members: { create: { botId: created.id, ordinal: 0 } } },
      });
      await data.initializeBot(created.id);
      return { id: created.id, conversationId: created.conversation!.id };
    },
    async connection(options = {}) {
      const installId = crypto.randomUUID();
      const platform = options.platform ?? "chat";
      await prisma.pluginInstallation.create({
        data: {
          id: installId,
          pluginKey: `ext-${installId.slice(0, 8)}`,
          version: "1.0.0",
          name: "Chat",
          publisher: "t",
          manifest: options.messaging === false ? { ...manifestFor(platform), connections: [{ ...manifestFor(platform).connections[0], messaging: undefined }] } : manifestFor(platform, options.media !== false),
        },
      });
      installs.push(installId);
      const connection = await prisma.pluginConnection.create({
        data: { installationId: installId, connectorKey: "chat", name: "Chat", transport: "stdio", authType: "none", status: options.ready === false ? "disconnected" : "ready" },
      });
      return { id: connection.id, installId };
    },
    async home(botId) {
      return (await prisma.channel.findFirstOrThrow({ where: { kind: "bot_dm", directKey: `bot:${botId}` }, select: { id: true } })).id;
    },
    async bind(connectionId, botId, extra = {}) {
      return prisma.externalMessagingBinding.create({ data: { connectionId, botId, ...extra } });
    },
    async cleanup() {
      await prisma.channel.deleteMany({ where: { kind: { in: ["external_dm", "bot_dm"] }, members: { some: { botId: { in: bots } } } } });
      await prisma.bot.deleteMany({ where: { id: { in: bots } } });
      await prisma.pluginInstallation.deleteMany({ where: { id: { in: installs } } });
      await prisma.$disconnect();
      await rm(root, { recursive: true, force: true });
    },
  };
}

let counter = 0;
/** A valid, normalized owner message. Override fields to make it something else. */
export const message = (overrides: Partial<ExternalMessage> = {}): ExternalMessage =>
  normalizeExternalMessage({
    providerMessageId: overrides.providerMessageId ?? `m-${Date.now()}-${++counter}`,
    peer: { id: "peer-1", type: "direct" },
    sender: { id: "peer-1", isAccountOwner: true },
    text: "hello bot",
    occurredAt: new Date().toISOString(),
    ...overrides,
  });

export const entry = (msg: ExternalMessage, ackCursor = `q:${++counter}`): ExternalPollEntry => ({ ackCursor, message: msg });
export const hashOf = externalMessagePayloadHash;

/** The result a connector tool returns as MCP content. */
export const structured = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
