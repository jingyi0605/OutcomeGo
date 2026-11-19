import { expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import { dismissQuestions, lockQuestions } from "@outcomego/messaging";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;

for (const reason of ["moved-on", "superseded"] as const) {
  test.skipIf(!databaseUrl)(`question retirement (${reason}) preserves linked credential and firewall approvals`, async () => {
    const db = createPrismaClient(databaseUrl!);
    const botId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    try {
      const bot = await db.bot.create({ data: {
        id: botId, name: "Question approval fixture", defaultDirectory: "/tmp",
        conversation: { create: {} },
      }, include: { conversation: true } });
      await db.channel.create({ data: {
        id: channelId, kind: "bot_dm", name: "Question approval fixture",
        members: { create: { botId, ordinal: 0 } },
      } });
      const run = await db.run.create({ data: {
        botId, channelId, conversationId: bot.conversation!.id,
        userMessageId: crypto.randomUUID(), status: "running",
      } });
      const card = () => db.channelMessage.create({ data: {
        channelId, sender: "agent", senderBotId: botId,
        content: "Choose an option", metadata: { type: "widget", widget: { prompt: "Choose an option" } },
      } });
      const ordinary = await card();
      const credential = await card();
      const firewall = await card();
      const expiresAt = new Date(Date.now() + 60_000);
      const vaultApproval = await db.bitwardenReadApproval.create({ data: {
        botId, channelId, sourceRunId: run.id, widgetMessageId: credential.id,
        title: "Fixture item", hostname: "example.test", expiresAt,
      } });
      const firewallApproval = await db.computerNetworkPolicyApproval.create({ data: {
        botId, channelId, sourceRunId: run.id, sourceCallId: crypto.randomUUID(),
        widgetMessageId: firewall.id, expectedRevision: 0, mode: "allowlist", rules: [], expiresAt,
      } });
      const retired = await db.$transaction(async tx => {
        await lockQuestions(tx, channelId);
        return dismissQuestions(tx, channelId, null, reason);
      });
      expect(retired).toEqual([{ id: ordinary.id }]);
      expect((await db.channelMessage.findUniqueOrThrow({ where: { id: ordinary.id } })).metadata)
        .toMatchObject({ widgetDismissed: true, widgetDismissalReason: reason });
      for (const message of [credential, firewall]) {
        expect((await db.channelMessage.findUniqueOrThrow({ where: { id: message.id } })).metadata)
          .not.toHaveProperty("widgetDismissed");
        expect(await db.event.count({ where: { entityId: message.id } })).toBe(0);
      }
      expect(await db.bitwardenReadApproval.findUniqueOrThrow({ where: { id: vaultApproval.id } }))
        .toMatchObject({ status: "pending", widgetMessageId: credential.id });
      expect(await db.computerNetworkPolicyApproval.findUniqueOrThrow({ where: { id: firewallApproval.id } }))
        .toMatchObject({ status: "verification_pending", widgetMessageId: firewall.id });
    } finally {
      await db.channel.deleteMany({ where: { id: channelId } });
      await db.bot.deleteMany({ where: { id: botId } });
      await db.$disconnect();
    }
  });
}
