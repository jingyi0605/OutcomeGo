import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { ChannelService } from "../../src/services/channel-service";
import { toBotView } from "../../src/services/view-mappers";
import { createHarness, databaseUrl, type Harness } from "./fixtures";

/**
 * Messages from outside chats now join the Bot's own `bot_dm`, so no chat of a new kind appears. Chats
 * of kind `external_dm` can still exist from the earlier design, as archived history: everything that
 * finds "the Bot's chat" by kind must keep finding the same one (specs/009 requirement 2.6, property 7).
 */
describe.skipIf(!databaseUrl)("a Bot with earlier external conversations", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.cleanup());

  const withChats = async (externalFirst: boolean) => {
    const bot = await h.bot();
    // The harness gives every Bot its own chat; these cases control the order, so start without it.
    await h.prisma.channel.deleteMany({ where: { kind: "bot_dm", directKey: `bot:${bot.id}` } });
    const makeExternal = (name: string) =>
      h.prisma.channel.create({ data: { kind: "external_dm", directKey: `external:${crypto.randomUUID()}`, name, members: { create: { botId: bot.id, ordinal: 0 } } } });
    const makeHome = () => h.prisma.channel.create({ data: { kind: "bot_dm", directKey: `bot:${bot.id}`, name: "home", members: { create: { botId: bot.id, ordinal: 0 } } } });
    let home: { id: string };
    const externals = [];
    if (externalFirst) {
      externals.push(await makeExternal("first"), await makeExternal("second"));
      home = await makeHome();
    } else {
      home = await makeHome();
      externals.push(await makeExternal("first"), await makeExternal("second"));
    }
    return { bot, home, externals };
  };

  test.each([[true], [false]])("its app chat is still the one chat of kind bot_dm (external chats created first: %s)", async (externalFirst) => {
    const { bot, home, externals } = await withChats(externalFirst);
    const loaded = await h.prisma.bot.findUniqueOrThrow({ where: { id: bot.id }, include: { conversation: true, channelMemberships: { include: { channel: true } } } });
    expect(loaded.channelMemberships).toHaveLength(3);
    expect(toBotView(loaded).dmChannelId).toBe(home.id);
    expect(externals.map((channel) => channel.id)).not.toContain(toBotView(loaded).dmChannelId);
    // Lookups by kind or by the Bot's direct key are unchanged.
    expect((await h.prisma.channel.findMany({ where: { kind: "bot_dm", members: { some: { botId: bot.id } } } })).map((channel) => channel.id)).toEqual([home.id]);
    expect((await h.prisma.channel.findUniqueOrThrow({ where: { directKey: `bot:${bot.id}` } })).id).toBe(home.id);
  });

  test("the app cannot write into an external conversation", async () => {
    const { bot, externals } = await withChats(false);
    const channels = new ChannelService(h.prisma, h.messaging, h.root, async () => new Response("{}"));
    const exit = await Effect.runPromiseExit(channels.sendGroupMessage(externals[0]!.id, { content: "typed in the app", clientId: `client-${crypto.randomUUID()}` } as never));
    if (!Exit.isFailure(exit)) throw new Error("the send should have been refused");
    const error = Cause.squash(exit.cause) as { status?: number; code?: string };
    expect(error).toMatchObject({ status: 409, code: "external_channel_read_only" });
    expect(await h.prisma.channelMessage.count({ where: { channelId: externals[0]!.id } })).toBe(0);
    expect(await h.prisma.inboxEvent.count({ where: { botId: bot.id } })).toBe(0);
  });

  test("an external conversation raises no push notification", async () => {
    const { bot, externals } = await withChats(false);
    const { publishMessageNotification } = await import("@outcomego/messaging");
    const message = await h.prisma.channelMessage.create({ data: { channelId: externals[0]!.id, sender: "agent", senderBotId: bot.id, content: "reply", metadata: { address: "a1" } } });
    await h.prisma.$transaction((tx) => publishMessageNotification(tx, message as never));
    expect(await h.prisma.channelNotification.count({ where: { channelId: externals[0]!.id } })).toBe(0);
  });

  test("the app chat still raises one, as before", async () => {
    const { bot, home } = await withChats(false);
    const { publishMessageNotification } = await import("@outcomego/messaging");
    const message = await h.prisma.channelMessage.create({ data: { channelId: home.id, sender: "agent", senderBotId: bot.id, content: "reply", metadata: { address: "a1" } } });
    await h.prisma.$transaction((tx) => publishMessageNotification(tx, message as never));
    expect(await h.prisma.channelNotification.count({ where: { channelId: home.id } })).toBeGreaterThan(0);
  });
});
