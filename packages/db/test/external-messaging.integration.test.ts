import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrismaClient } from "../src";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const hash = (seed: string) => seed.padEnd(64, "0").slice(0, 64);

/** PostgreSQL SQLSTATEs, so a test says which kind of rule refused the write. */
const UNIQUE = "23505";
const CHECK = "23514";

/** Resolves to the SQLSTATE the database refused the write with; fails if the write succeeded. */
const refusedWith = async (write: PromiseLike<unknown>): Promise<string> => {
  try {
    await write;
  } catch (error) {
    const text = String((error as Error)?.message ?? error);
    const state = /Code: `(\d{5})`/.exec(text)?.[1] ?? (/\bUnique constraint failed\b/.test(text) ? UNIQUE : undefined);
    if (!state) throw new Error(`write failed, but not with a database rule: ${text.slice(0, 200)}`);
    return state;
  }
  throw new Error("the database accepted a write it should have refused");
};

describe.skipIf(!url)("external messaging tables", () => {
  const prisma = createPrismaClient(url);
  const created = { bots: [] as string[], installs: [] as string[], channels: [] as string[] };

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.channel.deleteMany({ where: { id: { in: created.channels } } });
    await prisma.bot.deleteMany({ where: { id: { in: created.bots } } });
    await prisma.pluginInstallation.deleteMany({ where: { id: { in: created.installs } } });
    await prisma.$disconnect();
  });

  const bot = async () => {
    const id = crypto.randomUUID();
    await prisma.bot.create({ data: { id, name: `ext ${id.slice(0, 6)}`, defaultDirectory: "/tmp", conversation: { create: {} } } });
    created.bots.push(id);
    return id;
  };
  const connection = async () => {
    const installId = crypto.randomUUID();
    const key = `ext-${installId.slice(0, 8)}`;
    await prisma.pluginInstallation.create({
      data: { id: installId, pluginKey: key, version: "1.0.0", name: "Ext", publisher: "t", manifest: {} },
    });
    created.installs.push(installId);
    return (await prisma.pluginConnection.create({
      data: { installationId: installId, connectorKey: "chat", name: "Chat", transport: "stdio", authType: "none", status: "ready" },
    })).id;
  };
  const externalChannel = async (botId: string) => {
    const id = crypto.randomUUID();
    await prisma.channel.create({
      data: { id, kind: "external_dm", directKey: `external:${id}`, name: "chat", members: { create: { botId, ordinal: 0 } } },
    });
    created.channels.push(id);
    return id;
  };
  const mapping = async (connectionId: string, botId: string, peerId = "peer-1") =>
    prisma.externalChannelMapping.create({
      data: { connectionId, botId, peerId, platform: "chat", channelId: await externalChannel(botId) },
    });
  const message = async (channelId: string, sender: "user" | "agent" = "agent") =>
    (await prisma.channelMessage.create({ data: { channelId, sender, content: "hi" } })).id;
  const delivery = (connectionId: string, botId: string, channelMessageId: string, extra: Record<string, unknown> = {}) =>
    prisma.externalOutboundDelivery.create({
      data: {
        callId: `external-delivery:${crypto.randomUUID()}`,
        connectionId,
        botId,
        channelMessageId,
        deliveryLeaseOwner: "owner-1",
        deliveryLeaseExpiresAt: new Date(Date.now() + 120_000),
        ...extra,
      } as never,
    });

  describe("Channel kind", () => {
    test("external_dm exists beside bot_dm and does not disturb bot_dm lookups", async () => {
      const botId = await bot();
      const dm = crypto.randomUUID();
      await prisma.channel.create({ data: { id: dm, kind: "bot_dm", directKey: `bot:${botId}`, name: "dm", members: { create: { botId, ordinal: 0 } } } });
      created.channels.push(dm);
      await externalChannel(botId);
      await externalChannel(botId);
      const dms = await prisma.channel.findMany({ where: { kind: "bot_dm", members: { some: { botId } } } });
      expect(dms.map((channel) => channel.id)).toEqual([dm]);
      expect((await prisma.channel.findUnique({ where: { directKey: `bot:${botId}` } }))!.id).toBe(dm);
      expect(await prisma.channel.count({ where: { kind: "external_dm", members: { some: { botId } } } })).toBe(2);
    });
  });

  describe("Mapping", () => {
    test("(connection, peer, bot) is unique, also under concurrent first messages", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const attempts = await Promise.allSettled(Array.from({ length: 12 }, async () => mapping(connectionId, botId, "same-peer")));
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.externalChannelMapping.count({ where: { connectionId, botId, peerId: "same-peer" } })).toBe(1);
    });

    test("the same peer id on two connections, or for two Bots, is a separate mapping", async () => {
      const [one, two] = [await connection(), await connection()];
      const [botA, botB] = [await bot(), await bot()];
      await mapping(one, botA, "shared");
      await mapping(two, botA, "shared");
      await mapping(one, botB, "shared");
      expect(await prisma.externalChannelMapping.count({ where: { peerId: "shared", connectionId: { in: [one, two] } } })).toBe(3);
    });

    test("a Channel belongs to at most one mapping", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const first = await mapping(connectionId, botId, "a");
      expect(await refusedWith(prisma.externalChannelMapping.create({ data: { connectionId, botId, peerId: "b", platform: "chat", channelId: first.channelId } }))).toBe(UNIQUE);
    });

    test.each([
      ["a peer type other than direct", { peerType: "group" }],
      ["an unknown status", { status: "paused" }],
      ["an empty peer id", { peerId: "" }],
      ["a peer id over 256 characters", { peerId: "x".repeat(257) }],
      ["a display name over 120 characters", { displayName: "n".repeat(121) }],
    ])("refuses %s", async (_label, extra) => {
      const connectionId = await connection();
      const botId = await bot();
      expect(await refusedWith(prisma.externalChannelMapping.create({
          data: { connectionId, botId, peerId: "p", platform: "chat", channelId: await externalChannel(botId), ...extra },
        }))).toBe(CHECK);
    });
  });

  describe("Receipt", () => {
    const receipt = (connectionId: string, providerMessageId: string, extra: Record<string, unknown> = {}) =>
      prisma.externalMessageReceipt.create({
        data: { connectionId, providerMessageId, peerId: "p", payloadHash: hash("a"), status: "accepted", ...extra },
      });

    test("(connection, provider message id) is unique, also under concurrent redelivery", async () => {
      const connectionId = await connection();
      const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => receipt(connectionId, "18446744073709551615")));
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
      // A second connection may carry the same provider id.
      await receipt(await connection(), "18446744073709551615");
    });

    test("there is no in-progress state, and rejected and accepted carry the right code", async () => {
      const connectionId = await connection();
      expect(await refusedWith(receipt(connectionId, "1", { status: "processing" }))).toBe(CHECK);
      expect(await refusedWith(receipt(connectionId, "2", { status: "rejected" }))).toBe(CHECK);
      expect(await refusedWith(receipt(connectionId, "3", { status: "accepted", rejectionCode: "external_message_invalid" }))).toBe(CHECK);
      await receipt(connectionId, "4", { status: "rejected", rejectionCode: "external_sender_not_allowed" });
      await receipt(connectionId, "5");
    });

    test.each([
      ["a short hash", "abc"],
      ["an uppercase hash", "A".repeat(64)],
      ["a non-hex hash", "z".repeat(64)],
    ])("refuses %s", async (_label, payloadHash) => {
      expect(await refusedWith(receipt(await connection(), "9", { payloadHash }))).toBe(CHECK);
    });

    test("an over-long provider message id is refused", async () => {
      expect(await refusedWith(receipt(await connection(), "x".repeat(257)))).toBe(CHECK);
    });

    test("deleting the message or run only detaches the receipt", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const { channelId } = await mapping(connectionId, botId);
      const messageId = await message(channelId, "user");
      const kept = await receipt(connectionId, "keep", { channelMessageId: messageId });
      await prisma.channelMessage.delete({ where: { id: messageId } });
      expect((await prisma.externalMessageReceipt.findUnique({ where: { id: kept.id } }))!.channelMessageId).toBeNull();
    });
  });

  describe("Delivery", () => {
    test("callId and channel message are each unique, so a replayed call cannot make a second record", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const { channelId } = await mapping(connectionId, botId);
      const messageId = await message(channelId);
      const callId = `external-delivery:${crypto.randomUUID()}`;
      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, () => delivery(connectionId, botId, messageId, { callId }))
      );
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
      expect(await refusedWith(delivery(connectionId, botId, messageId))).toBe(UNIQUE);
      expect(await refusedWith(delivery(connectionId, botId, await message(channelId), { callId }))).toBe(UNIQUE);
    });

    test("the five statuses are the only ones, and a lease exists exactly while not terminal", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const { channelId } = await mapping(connectionId, botId);
      const noLease = { deliveryLeaseOwner: null, deliveryLeaseExpiresAt: null };
      expect(await refusedWith(delivery(connectionId, botId, await message(channelId), { status: "queued" }))).toBe(CHECK);
      for (const status of ["pending", "sending"]) {
        await delivery(connectionId, botId, await message(channelId), { status });
        expect(await refusedWith(delivery(connectionId, botId, await message(channelId), { status, ...noLease }))).toBe(CHECK);
        expect(await refusedWith(delivery(connectionId, botId, await message(channelId), { status, deliveryLeaseOwner: null }))).toBe(CHECK);
      }
      for (const status of ["sent", "failed", "uncertain"]) {
        await delivery(connectionId, botId, await message(channelId), { status, ...noLease });
        expect(await refusedWith(delivery(connectionId, botId, await message(channelId), { status }))).toBe(CHECK);
      }
    });

    test("an error message over 500 characters is refused", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const { channelId } = await mapping(connectionId, botId);
      expect(await refusedWith(delivery(connectionId, botId, await message(channelId), { status: "failed", deliveryLeaseOwner: null, deliveryLeaseExpiresAt: null, errorMessage: "m".repeat(501) }))).toBe(CHECK);
    });

    test("the lease-conditional finish writes once, and a late result cannot overwrite it", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const { channelId } = await mapping(connectionId, botId);
      const row = await delivery(connectionId, botId, await message(channelId));
      const start = (owner: string) =>
        prisma.externalOutboundDelivery.updateMany({
          where: { id: row.id, status: "pending", deliveryLeaseOwner: owner, deliveryLeaseExpiresAt: { gt: new Date() } },
          data: { status: "sending", startedAt: new Date() },
        });
      // Only the owner that created the lease can start sending, and only once.
      expect((await start("someone-else")).count).toBe(0);
      expect((await start("owner-1")).count).toBe(1);
      expect((await start("owner-1")).count).toBe(0);
      const finish = (status: string, owner: string) =>
        prisma.externalOutboundDelivery.updateMany({
          where: { id: row.id, status: "sending", deliveryLeaseOwner: owner },
          data: { status, deliveryLeaseOwner: null, deliveryLeaseExpiresAt: null, completedAt: new Date() },
        });
      // The recovery writer wins first; the late result from the original sender is a no-op.
      expect((await finish("uncertain", "owner-1")).count).toBe(1);
      expect((await finish("sent", "owner-1")).count).toBe(0);
      expect((await prisma.externalOutboundDelivery.findUnique({ where: { id: row.id } }))!.status).toBe("uncertain");
    });

    test("terminal states cannot keep a lease, so a recovery write cannot leave one behind", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const { channelId } = await mapping(connectionId, botId);
      const row = await delivery(connectionId, botId, await message(channelId));
      expect(await refusedWith(prisma.externalOutboundDelivery.update({ where: { id: row.id }, data: { status: "sent" } }))).toBe(CHECK);
      expect((await prisma.externalOutboundDelivery.findUnique({ where: { id: row.id } }))!.status).toBe("pending");
    });
  });

  describe("Binding", () => {
    test("one binding per connection, owner_only only, two statuses", async () => {
      const connectionId = await connection();
      const botId = await bot();
      await prisma.externalMessagingBinding.create({ data: { connectionId, botId } });
      expect(await refusedWith(prisma.externalMessagingBinding.create({ data: { connectionId, botId } }))).toBe(UNIQUE);
      const other = await connection();
      expect(await refusedWith(prisma.externalMessagingBinding.create({ data: { connectionId: other, botId, inboundPolicy: "everyone" } }))).toBe(CHECK);
      expect(await refusedWith(prisma.externalMessagingBinding.create({ data: { connectionId: other, botId, status: "broken" } }))).toBe(CHECK);
      await prisma.externalMessagingBinding.create({ data: { connectionId: other, botId, status: "needs_attention", inboundCursor: "q1:7" } });
    });

    test("the cursor update with a previous-value condition never moves backwards under a race", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const binding = await prisma.externalMessagingBinding.create({ data: { connectionId, botId, inboundCursor: "q1:1" } });
      const advance = (from: string, to: string) =>
        prisma.externalMessagingBinding.updateMany({ where: { id: binding.id, inboundCursor: from }, data: { inboundCursor: to } });
      const results = await Promise.all([advance("q1:1", "q1:2"), advance("q1:1", "q1:3"), advance("q1:1", "q1:4")]);
      expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(1);
      expect((await advance("q1:1", "q1:9")).count).toBe(0);
    });

    test("only one process can take an expired lease", async () => {
      const connectionId = await connection();
      const botId = await bot();
      const binding = await prisma.externalMessagingBinding.create({ data: { connectionId, botId } });
      const claim = (owner: string) =>
        prisma.externalMessagingBinding.updateMany({
          where: { id: binding.id, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
          data: { leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + 60_000) },
        });
      const results = await Promise.all(Array.from({ length: 8 }, (_, index) => claim(`server-${index}`)));
      expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(1);
    });
  });

  describe("cascades", () => {
    const populate = async () => {
      const connectionId = await connection();
      const botId = await bot();
      await prisma.externalMessagingBinding.create({ data: { connectionId, botId } });
      const map = await mapping(connectionId, botId);
      const userMessage = await message(map.channelId, "user");
      await prisma.externalMessageReceipt.create({
        data: { connectionId, providerMessageId: "m1", peerId: "peer-1", payloadHash: hash("b"), status: "accepted", mappingId: map.id, channelMessageId: userMessage },
      });
      const agentMessage = await message(map.channelId);
      const row = await delivery(connectionId, botId, agentMessage, { mappingId: map.id });
      return { connectionId, botId, map, userMessage, agentMessage, delivery: row };
    };
    const counts = (connectionId: string) =>
      Promise.all([
        prisma.externalMessagingBinding.count({ where: { connectionId } }),
        prisma.externalChannelMapping.count({ where: { connectionId } }),
        prisma.externalMessageReceipt.count({ where: { connectionId } }),
        prisma.externalOutboundDelivery.count({ where: { connectionId } }),
      ]);

    test("removing a connection removes binding, mappings, receipts and deliveries, and keeps the Channel for archiving", async () => {
      const f = await populate();
      expect(await counts(f.connectionId)).toEqual([1, 1, 1, 1]);
      await prisma.pluginConnection.delete({ where: { id: f.connectionId } });
      expect(await counts(f.connectionId)).toEqual([0, 0, 0, 0]);
      const channel = await prisma.channel.findUnique({ where: { id: f.map.channelId } });
      expect(channel).not.toBeNull();
      expect(channel!.archivedAt).toBeNull(); // archiving is the service's job, in the same transaction
    });

    test("deleting a Bot removes its binding, mappings and deliveries", async () => {
      const f = await populate();
      await prisma.bot.delete({ where: { id: f.botId } });
      expect(await counts(f.connectionId)).toEqual([0, 0, 1, 0]);
    });

    test("deleting the Channel removes its mapping; the receipt keeps its history without it", async () => {
      const f = await populate();
      await prisma.channel.delete({ where: { id: f.map.channelId } });
      expect(await prisma.externalChannelMapping.count({ where: { id: f.map.id } })).toBe(0);
      const receipt = await prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: f.connectionId } });
      expect([receipt.mappingId, receipt.channelMessageId]).toEqual([null, null]);
      expect(await prisma.externalOutboundDelivery.count({ where: { connectionId: f.connectionId } })).toBe(0);
    });

    test("deleting only the mapping detaches its deliveries instead of deleting them", async () => {
      const f = await populate();
      await prisma.externalChannelMapping.delete({ where: { id: f.map.id } });
      const row = await prisma.externalOutboundDelivery.findUniqueOrThrow({ where: { id: f.delivery.id } });
      expect(row.mappingId).toBeNull();
    });
  });
});
