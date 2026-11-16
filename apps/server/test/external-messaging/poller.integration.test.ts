import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ExternalInboundMessageService, type AcceptContext, type AcceptResult } from "../../src/services/external-messaging/inbound";
import { ExternalInboundPoller, RETRY_LIMIT, RETRY_WINDOW_MS, backoffMs, type CallHostTool } from "../../src/services/external-messaging/poller";
import { createHarness, databaseUrl, message, structured, type Harness } from "./fixtures";

type Script = Array<unknown | Error | (() => unknown | Promise<unknown>)>;

describe.skipIf(!databaseUrl)("inbound poller", () => {
  let h: Harness;
  let real: ExternalInboundMessageService;
  const never = (_ms: number, signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));

  beforeAll(async () => {
    h = await createHarness();
    real = new ExternalInboundMessageService({
      prisma: h.prisma, messaging: h.messaging, assets: h.assets, exchange: h.exchange,
      computerFetch: async () => new Response("{}"), interruptRun: async () => {},
    });
  });
  afterAll(() => h.cleanup());

  /** A connector that answers from a script, then goes quiet. Records every call. */
  const connector = (script: Script) => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const callHostTool: CallHostTool = async (_connection, tool, args) => {
      calls.push({ tool, args });
      const next = script.shift();
      if (next instanceof Error) throw next;
      const value = typeof next === "function" ? await (next as () => unknown)() : next;
      return value === undefined ? structured({ messages: [] }) : value;
    };
    return { calls, callHostTool };
  };
  const poll = (messages: unknown[], extra: Record<string, unknown> = {}) => structured({ messages, ...extra });
  const wire = (id: number, text = `m${id}`) => ({ ackCursor: `q:${id}`, message: message({ providerMessageId: `p${id}`, text }) });

  const setup = async (options: { bot?: Awaited<ReturnType<Harness["bot"]>>; cursor?: string | null } = {}) => {
    const bot = options.bot ?? (await h.bot());
    const connection = await h.connection();
    const binding = await h.bind(connection.id, bot.id, options.cursor === undefined ? {} : { inboundCursor: options.cursor });
    return { bot, connection, binding };
  };
  const poller = (callHostTool: CallHostTool, extra: { inbound?: Pick<ExternalInboundMessageService, "accept" | "deadLetter">; now?: () => Date; instanceId?: string } = {}) =>
    new ExternalInboundPoller({ prisma: h.prisma, callHostTool, inbound: extra.inbound ?? real, now: extra.now, sleep: never, instanceId: extra.instanceId });
  const binding = (id: string) => h.prisma.externalMessagingBinding.findUniqueOrThrow({ where: { id } });
  const messagesOf = (connectionId: string) => h.prisma.channelMessage.count({ where: { channel: { externalMapping: { connectionId } } } });

  describe("one pass", () => {
    test("asks for what follows the saved cursor, within the batch and wait limits", async () => {
      const { binding: b } = await setup({ cursor: "q:7" });
      const fake = connector([]);
      expect(await poller(fake.callHostTool).iterate(b.id, 0)).toMatchObject({ next: "continue" });
      expect(fake.calls).toEqual([{ tool: "chat_poll", args: { cursor: "q:7", limit: 20, waitMs: 1000 } }]);
      expect((await binding(b.id)).lastPolledAt).not.toBeNull();
    });

    test("hands messages over in order and moves the cursor after each one", async () => {
      const { binding: b, connection } = await setup();
      const fake = connector([poll([wire(1), wire(2), wire(3)])]);
      await poller(fake.callHostTool).iterate(b.id, 0);
      expect((await binding(b.id)).inboundCursor).toBe("q:3");
      expect(await messagesOf(connection.id)).toBe(3);
      const texts = (await h.prisma.channelMessage.findMany({ where: { channel: { externalMapping: { connectionId: connection.id } } }, orderBy: { sequence: "asc" } })).map((row) => row.content);
      expect(texts).toEqual(["m1", "m2", "m3"]);
    });

    test("a refused message still moves the cursor on", async () => {
      const { binding: b } = await setup();
      const stranger = { ackCursor: "q:1", message: message({ providerMessageId: "x", sender: { id: "z", isAccountOwner: false } }) };
      await poller(connector([poll([stranger, wire(2)])]).callHostTool).iterate(b.id, 0);
      expect((await binding(b.id)).inboundCursor).toBe("q:2");
    });

    test("a duplicate moves the cursor on without a second message", async () => {
      const { binding: b, connection } = await setup();
      const fake = connector([poll([wire(1)]), poll([wire(1), wire(2)])]);
      const p = poller(fake.callHostTool);
      await p.iterate(b.id, 0);
      await h.prisma.externalMessagingBinding.update({ where: { id: b.id }, data: { inboundCursor: null } });
      await p.iterate(b.id, 0);
      expect(await messagesOf(connection.id)).toBe(2);
      expect((await binding(b.id)).inboundCursor).toBe("q:2");
    });

    test("a reset from the connector clears the saved cursor before the new messages are read", async () => {
      const { binding: b } = await setup({ cursor: "old-queue:99" });
      await poller(connector([poll([wire(1)], { resetCursor: true })]).callHostTool).iterate(b.id, 0);
      expect((await binding(b.id)).inboundCursor).toBe("q:1");
    });

    test("an empty answer that comes back at once is paused briefly rather than spun on", async () => {
      const { binding: b } = await setup();
      expect(await poller(connector([]).callHostTool).iterate(b.id, 0)).toEqual({ next: "continue", delayMs: 250 });
    });
  });

  describe("when a message cannot be handled yet", () => {
    const stub = (results: AcceptResult[]) => ({
      calls: [] as Array<{ id: string }>,
      accept: async function (this: { calls: Array<{ id: string }> }, _context: AcceptContext, entry: { ackCursor: string }) {
        this.calls.push({ id: entry.ackCursor });
        return results.shift() ?? ({ status: "accepted", runId: null } as AcceptResult);
      },
      deadLetters: [] as string[],
      deadLetter: async function (this: { deadLetters: string[] }, _context: AcceptContext, entry: { ackCursor: string }) {
        this.deadLetters.push(entry.ackCursor);
      },
    });
    const retry: AcceptResult = { status: "retry", code: "external_accept_failed", targetUnavailable: false };

    test("a retry stops the batch: later messages wait, earlier ones are kept", async () => {
      const { binding: b } = await setup();
      const inbound = stub([{ status: "accepted", runId: null }, retry]);
      const fake = connector([poll([wire(1), wire(2), wire(3)])]);
      const outcome = await poller(fake.callHostTool, { inbound: { accept: inbound.accept.bind(inbound) as never, deadLetter: inbound.deadLetter.bind(inbound) } }).iterate(b.id, 0);
      expect(inbound.calls.map((call) => call.id)).toEqual(["q:1", "q:2"]);
      const row = await binding(b.id);
      expect(row).toMatchObject({ inboundCursor: "q:1", retryAckCursor: "q:2", retryCount: 1 });
      expect(outcome).toMatchObject({ next: "continue", delayMs: backoffMs(2) });
    });

    test(`after ${RETRY_LIMIT} failed attempts the message becomes a dead letter and the cursor moves on`, async () => {
      const { binding: b } = await setup();
      const inbound = stub(Array.from({ length: RETRY_LIMIT }, () => retry));
      const fake = connector(Array.from({ length: RETRY_LIMIT }, () => poll([wire(1), wire(2)])));
      const p = poller(fake.callHostTool, { inbound: { accept: inbound.accept.bind(inbound) as never, deadLetter: inbound.deadLetter.bind(inbound) } });
      for (let attempt = 1; attempt < RETRY_LIMIT; attempt++) {
        await p.iterate(b.id, 0);
        expect(await binding(b.id)).toMatchObject({ inboundCursor: null, retryCount: attempt });
      }
      expect(inbound.deadLetters).toEqual([]);
      await p.iterate(b.id, 0);
      expect(inbound.deadLetters).toEqual(["q:1"]);
      expect(await binding(b.id)).toMatchObject({ inboundCursor: "q:2", retryCount: 0, retryAckCursor: null });
    });

    test("so does a message that has been failing for more than thirty minutes", async () => {
      const { binding: b } = await setup();
      let clock = Date.parse("2026-11-16T08:00:00.000Z");
      const inbound = stub([retry, retry]);
      const fake = connector([poll([wire(1)]), poll([wire(1)])]);
      const p = poller(fake.callHostTool, { now: () => new Date(clock), inbound: { accept: inbound.accept.bind(inbound) as never, deadLetter: inbound.deadLetter.bind(inbound) } });
      await p.iterate(b.id, 0);
      expect(inbound.deadLetters).toEqual([]);
      clock += RETRY_WINDOW_MS + 1_000;
      await p.iterate(b.id, 0);
      expect(inbound.deadLetters).toEqual(["q:1"]);
      expect((await binding(b.id)).inboundCursor).toBe("q:1");
    });

    test("a real dead letter leaves a record and does not lose the messages after it", async () => {
      const { binding: b, connection } = await setup();
      h.exchange.inboundFailure = "unreachable";
      h.exchange.files.set("pic", Buffer.from("x"));
      const stuck = { ackCursor: "q:1", message: message({ providerMessageId: "stuck", text: "with a picture", media: [{ exchangeName: "pic", fileName: "pic.png", byteSize: 1, sha256: "a".repeat(64) }] }) };
      const fake = connector(Array.from({ length: RETRY_LIMIT }, () => poll([stuck, wire(2)])));
      const p = poller(fake.callHostTool);
      for (let i = 0; i < RETRY_LIMIT; i++) await p.iterate(b.id, 0);
      h.exchange.inboundFailure = null;
      // On the last attempt the stuck message is given up on and the one behind it goes through in the same pass.
      expect((await binding(b.id)).inboundCursor).toBe("q:2");
      expect(await h.prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: connection.id, providerMessageId: "stuck" } })).toMatchObject({ status: "rejected", rejectionCode: "external_retry_exhausted" });
      expect(await messagesOf(connection.id)).toBe(1);
      expect(await h.prisma.channelMessage.findFirstOrThrow({ where: { channel: { externalMapping: { connectionId: connection.id } } } })).toMatchObject({ content: "m2" });
    });

    test("a Bot that cannot run pauses everything and the cursor stays; fixing it carries on from there", async () => {
      const { bot, binding: b, connection } = await setup();
      await h.prisma.bot.update({ where: { id: bot.id }, data: { status: "archived" } });
      const first = connector([poll([wire(1), wire(2)])]);
      expect(await poller(first.callHostTool).iterate(b.id, 0)).toEqual({ next: "stop", delayMs: 0 });
      expect(await binding(b.id)).toMatchObject({ status: "needs_attention", inboundCursor: null, retryCount: 0 });
      expect(await messagesOf(connection.id)).toBe(0);
      // Paused bindings are not polled at all.
      const idle = connector([poll([wire(1)])]);
      expect(await poller(idle.callHostTool).iterate(b.id, 0)).toEqual({ next: "stop", delayMs: 0 });
      expect(idle.calls).toEqual([]);
      // The Bot comes back and the owner saves the binding again.
      await h.prisma.bot.update({ where: { id: bot.id }, data: { status: "active" } });
      // A real loop frees its lease when it ends; calling one pass directly does not, so do that here.
      await h.prisma.externalMessagingBinding.update({ where: { id: b.id }, data: { status: "active", leaseOwner: null, leaseExpiresAt: null } });
      await poller(connector([poll([wire(1), wire(2)])]).callHostTool).iterate(b.id, 0);
      expect(await messagesOf(connection.id)).toBe(2);
      expect((await binding(b.id)).inboundCursor).toBe("q:2");
    });
  });

  describe("when the connector fails", () => {
    test("the cursor stays, the failure is recorded, and the wait grows from 2 to 60 seconds", async () => {
      const { binding: b } = await setup({ cursor: "q:5" });
      const fake = connector(Array.from({ length: 8 }, () => new Error("connector exploded with secret-token-xyz")));
      const p = poller(fake.callHostTool);
      const delays: number[] = [];
      for (let i = 0; i < 8; i++) delays.push((await p.iterate(b.id, 0)).delayMs);
      expect(delays).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
      const row = await binding(b.id);
      expect(row).toMatchObject({ inboundCursor: "q:5", consecutiveFailures: 8, lastErrorCode: "external_poll_failed" });
      expect(JSON.stringify(row)).not.toContain("secret-token-xyz");
    });

    test("one good answer ends the streak", async () => {
      const { binding: b } = await setup();
      const p = poller(connector([new Error("x"), new Error("x"), poll([])]).callHostTool);
      await p.iterate(b.id, 0);
      await p.iterate(b.id, 0);
      expect((await binding(b.id)).consecutiveFailures).toBe(2);
      await p.iterate(b.id, 0);
      expect(await binding(b.id)).toMatchObject({ consecutiveFailures: 0 });
    });

    test.each([
      ["a result that is not a list of messages", structured({ nope: true }), "external_poll_invalid"],
      ["more messages than were asked for", poll(Array.from({ length: 21 }, (_, i) => wire(i + 1))), "external_poll_invalid"],
      ["two messages with the same cursor", poll([wire(1), wire(1)]), "external_poll_invalid"],
      ["a tool error", { isError: true, content: [{ type: "text", text: "wechat_needs_pairing: scan again" }] }, "external_poll_failed"],
      ["text that is not JSON", { content: [{ type: "text", text: "<html>" }] }, "external_poll_failed"],
    ])("%s is a failed poll that changes nothing", async (_label, answer, code) => {
      const { binding: b, connection } = await setup({ cursor: "q:3" });
      await poller(connector([answer]).callHostTool).iterate(b.id, 0);
      expect(await binding(b.id)).toMatchObject({ inboundCursor: "q:3", lastErrorCode: code, consecutiveFailures: 1 });
      expect(await messagesOf(connection.id)).toBe(0);
    });

    test("one bad message among good ones is refused and skipped, not a failed poll", async () => {
      const { binding: b, connection } = await setup();
      const broken = { ackCursor: "q:2", message: { providerMessageId: "bad", peer: { id: "p", type: "direct" }, sender: { id: "p", isAccountOwner: true }, text: "x", occurredAt: "not a date" } };
      await poller(connector([poll([wire(1), broken, wire(3)])]).callHostTool).iterate(b.id, 0);
      expect(await messagesOf(connection.id)).toBe(2);
      expect((await binding(b.id)).inboundCursor).toBe("q:3");
      expect(await h.prisma.externalMessageReceipt.findFirstOrThrow({ where: { connectionId: connection.id, providerMessageId: "bad" } })).toMatchObject({ status: "rejected", rejectionCode: "external_message_invalid" });
    });
  });

  describe("two pollers", () => {
    test("only one holds the lease at a time", async () => {
      const { binding: b } = await setup();
      const one = connector([]);
      const two = connector([]);
      const a = poller(one.callHostTool, { instanceId: "a" });
      const c = poller(two.callHostTool, { instanceId: "c" });
      expect((await a.iterate(b.id, 0)).next).toBe("continue");
      expect(await c.iterate(b.id, 0)).toEqual({ next: "stop", delayMs: 0 });
      expect(two.calls).toEqual([]);
    });

    test("a lease that has run out can be taken over", async () => {
      const { binding: b } = await setup();
      const a = poller(connector([]).callHostTool, { instanceId: "a" });
      await a.iterate(b.id, 0);
      await h.prisma.$executeRaw`UPDATE "outcomego_external_messaging_binding" SET "leaseExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "id" = ${b.id}::uuid`;
      const fake = connector([]);
      expect((await poller(fake.callHostTool, { instanceId: "c" }).iterate(b.id, 0)).next).toBe("continue");
      expect(fake.calls).toHaveLength(1);
    });

    test("an overlap after a lease expires neither repeats a message nor moves the cursor backwards", async () => {
      const { binding: b, connection } = await setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      // The first poller has its batch but is slow; its lease runs out and a second one takes over.
      const slow = connector([async () => (await gate, poll([wire(1), wire(2)]))]);
      const first = poller(slow.callHostTool, { instanceId: "a" });
      const running = first.iterate(b.id, 0);
      await Bun.sleep(50);
      await h.prisma.$executeRaw`UPDATE "outcomego_external_messaging_binding" SET "leaseExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "id" = ${b.id}::uuid`;
      await poller(connector([poll([wire(1), wire(2)])]).callHostTool, { instanceId: "c" }).iterate(b.id, 0);
      expect((await binding(b.id)).inboundCursor).toBe("q:2");
      release();
      await running;
      expect((await binding(b.id)).inboundCursor).toBe("q:2");
      expect(await messagesOf(connection.id)).toBe(2);
      expect(await h.prisma.externalMessageReceipt.count({ where: { connectionId: connection.id } })).toBe(2);
    });
  });

  describe("when to stop", () => {
    test.each([
      ["the binding is switched off", async (id: string) => h.prisma.externalMessagingBinding.update({ where: { id }, data: { enabled: false } })],
      ["the binding needs attention", async (id: string) => h.prisma.externalMessagingBinding.update({ where: { id }, data: { status: "needs_attention" } })],
    ])("it does not poll when %s", async (_label, change) => {
      const { binding: b } = await setup();
      await change(b.id);
      const fake = connector([]);
      expect(await poller(fake.callHostTool).iterate(b.id, 0)).toEqual({ next: "stop", delayMs: 0 });
      expect(fake.calls).toEqual([]);
    });

    test("it does not poll a connection that is not ready, or was restarted since the loop began", async () => {
      const { binding: b, connection } = await setup();
      const fake = connector([]);
      expect(await poller(fake.callHostTool).iterate(b.id, 3)).toEqual({ next: "stop", delayMs: 0 });
      await h.prisma.pluginConnection.update({ where: { id: connection.id }, data: { status: "disconnected" } });
      expect(await poller(fake.callHostTool).iterate(b.id, 0)).toEqual({ next: "stop", delayMs: 0 });
      expect(fake.calls).toEqual([]);
    });

    test("it does not poll a connector that does not declare messaging", async () => {
      const bot = await h.bot();
      const connection = await h.connection({ messaging: false });
      const b = await h.bind(connection.id, bot.id);
      const fake = connector([]);
      expect(await poller(fake.callHostTool).iterate(b.id, 0)).toEqual({ next: "stop", delayMs: 0 });
      expect(fake.calls).toEqual([]);
    });
  });

  describe("scanning", () => {
    test("starts a loop only for bindings that can be polled, and stop() ends them and frees the lease", async () => {
      const ok = await setup();
      const off = await setup();
      await h.prisma.externalMessagingBinding.update({ where: { id: off.binding.id }, data: { enabled: false } });
      const paused = await setup();
      await h.prisma.externalMessagingBinding.update({ where: { id: paused.binding.id }, data: { status: "needs_attention" } });
      const down = await setup();
      await h.prisma.pluginConnection.update({ where: { id: down.connection.id }, data: { status: "disconnected" } });
      const fake = connector([]);
      const seen = new Set<string>();
      const spy: CallHostTool = async (connection, tool, args) => (seen.add(connection.id), fake.callHostTool(connection, tool, args));
      const p = poller(spy, { instanceId: "scan" });
      p.start();
      await Bun.sleep(400);
      expect(seen.has(ok.connection.id)).toBe(true);
      for (const other of [off, paused, down]) expect(seen.has(other.connection.id)).toBe(false);
      expect((await binding(ok.binding.id)).leaseOwner).toStartWith("scan:");
      await p.stop();
      expect(await binding(ok.binding.id)).toMatchObject({ leaseOwner: null, leaseExpiresAt: null });
    });
  });

  test("receipts older than 90 days are removed and newer ones kept", async () => {
    const { connection } = await setup();
    const day = 24 * 60 * 60_000;
    const make = (id: string, ageDays: number) => h.prisma.externalMessageReceipt.create({ data: { connectionId: connection.id, providerMessageId: id, peerId: "p", payloadHash: "a".repeat(64), status: "accepted", createdAt: new Date(Date.now() - ageDays * day) } });
    await make("old", 91);
    await make("fresh", 89);
    expect(await poller(connector([]).callHostTool).cleanupReceipts()).toBeGreaterThanOrEqual(1);
    expect((await h.prisma.externalMessageReceipt.findMany({ where: { connectionId: connection.id } })).map((row) => row.providerMessageId)).toEqual(["fresh"]);
  });
});
