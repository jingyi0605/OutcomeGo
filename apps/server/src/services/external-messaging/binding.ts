import { ApiError } from "@outcomego/contracts";
import type { PrismaClient } from "@outcomego/db";
import { messagingOf } from "./shared";
import { bindingView, type ExternalMessagingView } from "./views";

export interface PutBindingInput {
  enabled: boolean;
  botId: string;
}

/**
 * A chat account is useless without somewhere to send what it receives, so linking one requires its
 * Bot first. Connections whose plugin declares no `messaging` are unaffected.
 */
export const assertMessagingBound = async (
  prisma: PrismaClient,
  connection: { id: string; connectorKey: string; installation: { manifest: unknown } }
): Promise<void> => {
  if (!messagingOf(connection)) return;
  const binding = await prisma.externalMessagingBinding.findUnique({ where: { connectionId: connection.id }, select: { id: true } });
  if (!binding) throw new ApiError(409, "external_binding_required", "Choose the Bot for this account before connecting it.");
};

/** Bots that can be a target: real, running, not a subagent identity. */
const TARGET_STATUSES = ["active", "provisioning"] as const;

/**
 * Which Bot a messaging connection's inbound messages go to (specs/009 requirement 1).
 * Holds no delivery logic: it only validates and persists the Binding.
 */
export class ExternalMessagingBindingService {
  constructor(private readonly prisma: PrismaClient) {}

  private async connection(connectionId: string) {
    const connection = await this.prisma.pluginConnection.findUnique({
      where: { id: connectionId },
      include: { installation: true },
    });
    if (!connection) throw new ApiError(404, "plugin_connection_unavailable", "Plugin connection not found");
    return connection;
  }

  async get(connectionId: string): Promise<ExternalMessagingView> {
    const connection = await this.connection(connectionId);
    const messaging = messagingOf(connection);
    if (!messaging) return { supported: false, platform: null, binding: null };
    const binding = await this.prisma.externalMessagingBinding.findUnique({ where: { connectionId } });
    return { supported: true, platform: messaging.platform, binding: binding ? bindingView(binding) : null };
  }

  async put(connectionId: string, input: PutBindingInput): Promise<ExternalMessagingView> {
    const connection = await this.connection(connectionId);
    const messaging = messagingOf(connection);
    if (!messaging)
      throw new ApiError(409, "external_messaging_unsupported", "This connection does not support chat messaging");
    const bot = await this.prisma.bot.findUnique({
      where: { id: input.botId },
      include: { subagentIdentity: { select: { id: true } } },
    });
    if (!bot || bot.subagentIdentity || !(TARGET_STATUSES as readonly string[]).includes(bot.status))
      throw new ApiError(409, "external_target_unavailable", "The selected bot is not available");
    // The cursor is deliberately left alone when the target changes: it marks messages already
    // handled, and the new Bot must not receive them again.
    await this.prisma.externalMessagingBinding.upsert({
      where: { connectionId },
      create: { connectionId, botId: input.botId, enabled: input.enabled },
      update: {
        botId: input.botId,
        enabled: input.enabled,
        status: "active",
        // A fresh save is a fresh start for failure accounting, not for the cursor.
        retryAckCursor: null,
        retryCount: 0,
        retryFirstAt: null,
        consecutiveFailures: 0,
        lastErrorCode: null,
        lastErrorAt: null,
      },
    });
    return this.get(connectionId);
  }

  /** Removes the Binding only; mappings and Channels stay as history. */
  async delete(connectionId: string): Promise<void> {
    await this.connection(connectionId);
    await this.prisma.externalMessagingBinding.deleteMany({ where: { connectionId } });
  }
}
